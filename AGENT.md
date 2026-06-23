# Agent Configuration

## Project

Hombre — web-based GUI for a self-hosted Honcho AI memory server.

- **Backend**: Python FastAPI, runs on port 5000
- **Frontend**: Vanilla HTML/CSS/JS (no build tools, no frameworks)
- **Honcho server**: Expected at `localhost:8000`

## Commands

```bash
# Run dashboard locally
python3 -m uvicorn app:app --host 0.0.0.0 --port 5000 --reload

# Run in Docker
docker compose up -d

# Check syntax
python3 -m py_compile app.py
python3 -m py_compile routes/settings.py
node --check static/app.js
```

## File Locations

- `app.py` — FastAPI backend (auth, proxy, health, chat streaming)
- `routes/__init__.py` — Package marker
- `routes/settings.py` — Settings API (read/write `.env`, restart containers)
- `static/app.js` — All frontend logic (7 tab modules, Modal, App)
- `static/style.css` — Dark theme CSS
- `static/index.html` — SPA shell with sidebar nav
- `Dockerfile` — Python 3.12-slim, EXPOSE 5000
- `docker-compose.yml` — Port 5000:5000, healthcheck

## Conventions

- All API calls go through `/api/{path}` proxy to Honcho `/v3/{path}`
- `App.api()` is the centralized fetch helper (no body on GET/HEAD/DELETE, error parsing)
- XSS prevention: always use `App.escapeHtml()` / `App.escapeAttr()` in templates
- Event delegation pattern for click handlers (no inline onclick)
- Modal utility: `Modal.show()`, `Modal.confirm()`, `Modal.close()`
- Tabs: `OverviewTab`, `PeersTab`, `SessionsTab`, `ChatTab`, `ConclusionsTab`, `MessagesTab`, `SettingsTab`
- Each tab fetches its own data directly from the API (no shared state dependency)
- OverviewTab fetches peers/sessions/conclusions independently on render

## Honcho API Notes

- Peer card endpoint: `GET /v3/workspaces/{wid}/peers/{pid}/card` (GET only, not POST)
- Summaries endpoint: `GET /v3/workspaces/{wid}/sessions/{sid}/summaries` (GET only)
- Workspace delete: `DELETE /v3/workspaces/{wid}` (requires deleting all sessions first)
- Session delete: `DELETE /v3/workspaces/{wid}/sessions/{sid}`
- No peer delete endpoint exists in Honcho API

## Environment

- `HONCHO_URL` — Honcho server URL (default: `http://localhost:8000`)
- `HONCHO_API_KEY` — API key for Honcho auth
- `HONCHO_ENV_PATH` — Path to `.env` file (optional, settings tab returns 403 if unset)
- `HONCHO_COMPOSE_DIR` — Docker Compose dir (optional, settings tab returns 403 if unset)
- `DASHBOARD_USER` / `DASHBOARD_PASSWORD` — Optional basic auth (empty = no auth, startup warning)

## Security Notes

- Basic Auth uses `hmac.compare_digest` for timing-safe comparison
- Path traversal: iterative URL-decoding + `..`/`\x00`/leading-`/` checks
- Security headers: CSP (with `script-src 'self'`), X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
- Settings write: WRITABLE_KEYS allowlist, newline injection prevention, backup on every write
- `App.escapeHtml()` escapes `'` to `&#39;` (prevents attribute injection)
