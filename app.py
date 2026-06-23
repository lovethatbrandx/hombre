import os
import re
import hmac
import base64
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import unquote

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from routes.settings import router as settings_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("honcho-dashboard")

HONCHO_URL = os.environ.get("HONCHO_URL", "http://localhost:8000")
HONCHO_API_KEY = os.environ.get("HONCHO_API_KEY", "")
DASHBOARD_USER = os.environ.get("DASHBOARD_USER", "")
DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")
ALLOWED_REQUEST_HEADERS = {"content-type", "accept", "accept-encoding", "user-agent"}
ALLOWED_RESPONSE_HEADERS = {"content-type", "content-length", "location"}
VALID_ID = re.compile(r"^[a-zA-Z0-9_-]+$")

static_dir = Path(__file__).parent / "static"
_client: httpx.AsyncClient | None = None


class BasicAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, username: str, password: str):
        super().__init__(app)
        self.username = username
        self.password = password
        self._401 = JSONResponse({"error": "unauthorized"}, status_code=401, headers={"WWW-Authenticate": 'Basic realm="Honcho Dashboard"'})

    async def dispatch(self, request, call_next):
        if not self.username or not self.password:
            return await call_next(request)

        if request.url.path.startswith("/static") or request.url.path == "/api/health":
            return await call_next(request)

        auth = request.headers.get("authorization", "")
        if not auth.startswith("Basic "):
            return self._401

        try:
            decoded = base64.b64decode(auth[6:]).decode("utf-8")
            user, _, password = decoded.partition(":")
            if hmac.compare_digest(user, self.username) and hmac.compare_digest(password, self.password):
                return await call_next(request)
        except Exception:
            pass

        return self._401


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; font-src fonts.googleapis.com fonts.gstatic.com; "
            "style-src 'self' 'unsafe-inline' fonts.googleapis.com;"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client
    if not DASHBOARD_USER or not DASHBOARD_PASSWORD:
        log.warning("DASHBOARD_USER/DASHBOARD_PASSWORD not set — authentication disabled")
    default_headers = {}
    if HONCHO_API_KEY:
        default_headers["Authorization"] = f"Bearer {HONCHO_API_KEY}"
    _client = httpx.AsyncClient(
        base_url=HONCHO_URL,
        timeout=httpx.Timeout(30.0, connect=5.0),
        headers=default_headers,
    )
    yield
    await _client.aclose()
    _client = None


app = FastAPI(
    title="Honcho Dashboard",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(BasicAuthMiddleware, username=DASHBOARD_USER, password=DASHBOARD_PASSWORD)


@app.get("/api/health")
async def health():
    try:
        r = await _client.get("/health")
        return r.json()
    except httpx.ConnectError:
        log.warning("Honcho server unreachable")
        return {"status": "error", "reason": "upstream_unreachable"}
    except Exception as e:
        log.error("Health check failed: %s", e)
        return {"status": "error", "reason": "unknown"}


app.include_router(settings_router)


@app.post("/api/workspaces/{wid}/peers/{pid}/chat")
async def chat_stream(wid: str, pid: str, request: Request):
    if not VALID_ID.match(wid) or not VALID_ID.match(pid):
        return JSONResponse({"error": "invalid_id"}, status_code=400)

    try:
        body = await request.json()

        async def event_gen():
            async with _client.stream(
                "POST",
                f"/v3/workspaces/{wid}/peers/{pid}/chat",
                json=body,
                timeout=httpx.Timeout(None, connect=5.0, read=120.0),
            ) as resp:
                async for line in resp.aiter_lines():
                    yield f"{line}\n"

        return StreamingResponse(
            event_gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except httpx.ConnectError:
        return JSONResponse({"error": "upstream_unreachable"}, status_code=502)
    except Exception as e:
        log.error("Chat stream error: %s", e)
        return JSONResponse({"error": "proxy_error"}, status_code=502)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy(path: str, request: Request):
    decoded_path = unquote(path)
    prev = None
    while prev != decoded_path:
        prev = decoded_path
        decoded_path = unquote(decoded_path)
    if ".." in decoded_path or "\x00" in decoded_path or decoded_path.startswith("/"):
        return JSONResponse({"error": "invalid_path"}, status_code=400)

    try:
        body = await request.body()
        headers = {k: v for k, v in request.headers.items() if k.lower() in ALLOWED_REQUEST_HEADERS}

        req = _client.build_request(
            method=request.method,
            url=f"/v3/{decoded_path}",
            headers=headers,
            content=body or None,
        )
        resp = await _client.send(req)
        status = resp.status_code
        resp_headers = {
            k: v for k, v in resp.headers.items()
            if k.lower() in ALLOWED_RESPONSE_HEADERS
        }

        if status >= 500:
            log.warning("Upstream error %d on %s %s", status, request.method, decoded_path)
            await resp.aclose()
            return JSONResponse({"error": "upstream_error"}, status_code=status)

        async def stream_gen():
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            finally:
                await resp.aclose()

        return StreamingResponse(stream_gen(), status_code=status, headers=resp_headers)
    except httpx.ConnectError:
        return JSONResponse({"error": "upstream_unreachable"}, status_code=502)
    except Exception as e:
        log.error("Proxy error: %s", e)
        return JSONResponse({"error": "proxy_error"}, status_code=502)


@app.get("/")
async def index():
    return HTMLResponse((static_dir / "index.html").read_text())


app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
