import os
import re
import asyncio
import shutil
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from routes.supabase import get_admin_client, is_admin_configured
from routes.security import _users_cache, ROLE_PERMISSIONS

log = logging.getLogger("hombre")

router = APIRouter(prefix="/api/settings", tags=["settings"])

HONCHO_ENV_PATH = os.environ.get("HONCHO_ENV_PATH", "")
HONCHO_COMPOSE_DIR = os.environ.get("HONCHO_COMPOSE_DIR", "")

# Hombre's own .env file (for Supabase config etc.)
_HOMBRE_ENV_PATH = Path(os.environ.get("HOMBRE_ENV_PATH", str(Path(__file__).parent.parent / ".env")))

BACKUP_DIR = Path(os.environ.get("HOMBRE_BACKUP_DIR", "/app/data/backups"))
COMPOSE_RESTART_TIMEOUT = 60

DIALECTIC_LEVELS = ["minimal", "low", "medium", "high", "max"]

# Virtual keys the frontend sends — mapped to all dialectic levels on write.
_DIALECTIC_VIRTUAL_KEYS = {
    "DIALECTIC_MODEL": "MODEL_CONFIG__MODEL",
    "DIALECTIC_BASE_URL": "MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DIALECTIC_TRANSPORT": "MODEL_CONFIG__TRANSPORT",
}

WRITABLE_KEYS = {
    "LLM_OPENAI_API_KEY",
    "EMBEDDING_MODEL_CONFIG__MODEL",
    "EMBEDDING_MODEL_CONFIG__OVERRIDES__BASE_URL",
    "EMBEDDING_MODEL_CONFIG__TRANSPORT",
    "EMBEDDING_VECTOR_DIMENSIONS",
    "DERIVER_MODEL_CONFIG__MODEL",
    "DERIVER_MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DERIVER_MODEL_CONFIG__TRANSPORT",
    "SUMMARY_MODEL_CONFIG__MODEL",
    "SUMMARY_MODEL_CONFIG__OVERRIDES__BASE_URL",
    "SUMMARY_MODEL_CONFIG__TRANSPORT",
    "DREAM_DEDUCTION_MODEL_CONFIG__MODEL",
    "DREAM_DEDUCTION_MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DREAM_DEDUCTION_MODEL_CONFIG__TRANSPORT",
    "DREAM_INDUCTION_MODEL_CONFIG__MODEL",
    "DREAM_INDUCTION_MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DREAM_INDUCTION_MODEL_CONFIG__TRANSPORT",
}
# Add expanded dialectic level keys (broadcast by write_settings)
for _level in DIALECTIC_LEVELS:
    for _suffix in _DIALECTIC_VIRTUAL_KEYS.values():
        WRITABLE_KEYS.add(f"DIALECTIC_LEVELS__{_level}__{_suffix}")

# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------

AUDIT_LOG_DIR = Path(os.environ.get("HOMBRE_LOG_DIR", "logs"))
AUDIT_LOG_FILE = AUDIT_LOG_DIR / "audit.log"


def _audit(action: str, user: str = "", detail: str = "") -> None:
    """Append an audit entry to the audit log."""
    now = datetime.now(timezone.utc).isoformat()

    # --- Supabase path ---
    if is_admin_configured():
        _audit_supabase(action, user, detail, now)

    # --- File-based logging (always, as backup) ---
    AUDIT_LOG_DIR.mkdir(parents=True, exist_ok=True)
    parts = [now, action]
    if user:
        parts.append(f"user={user}")
    if detail:
        parts.append(detail)
    line = " ".join(parts) + "\n"
    try:
        with open(AUDIT_LOG_FILE, "a") as f:
            f.write(line)
    except OSError as e:
        log.warning("Failed to write audit log: %s", e)


def _audit_supabase(action: str, user: str, detail: str, timestamp: str) -> None:
    """Insert an audit log entry into Supabase."""
    client = get_admin_client()
    if not client:
        return

    try:
        details = {"raw": detail} if detail else {}
        client.table("audit_logs").insert(
            {
                "action": action,
                "username": user or None,
                "details": details if details else None,
            }
        ).execute()
    except Exception as e:
        log.warning("Failed to write audit log to Supabase: %s", e)


def _get_user(request: Request) -> str:
    """Extract username from request.state (set by auth middleware)."""
    return getattr(getattr(request, "state", None), "user", "") or "anonymous"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_env_path():
    if not HONCHO_ENV_PATH:
        raise HTTPException(status_code=403, detail="settings_not_configured")


def _require_compose_dir():
    if not HONCHO_COMPOSE_DIR:
        raise HTTPException(status_code=403, detail="settings_not_configured")


def parse_env_file(path: str) -> dict:
    env = {}
    try:
        content = Path(path).read_text()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="env_file_not_found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission_denied")

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    return env


def sanitize_value(value: str) -> str:
    return value.replace("\n", "").replace("\r", "")


def write_env_file(path: str, data: dict) -> None:
    env_path = Path(path)
    if not env_path.exists():
        raise HTTPException(status_code=404, detail="env_file_not_found")

    invalid_keys = set(data.keys()) - WRITABLE_KEYS
    if invalid_keys:
        raise HTTPException(status_code=400, detail=f"invalid_keys: {', '.join(sorted(invalid_keys))}")

    # Backup to writable directory before modifying
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / (env_path.name + ".bak")
    shutil.copy2(env_path, backup_path)

    content = env_path.read_text()
    for key, value in data.items():
        sanitized = sanitize_value(str(value))
        pattern = rf"^{re.escape(key)}=.*$"
        new_line = f"{key}={sanitized}"
        if re.search(pattern, content, re.MULTILINE):
            content = re.sub(pattern, new_line, content, flags=re.MULTILINE)
        else:
            content = content.rstrip() + "\n" + new_line + "\n"
    env_path.write_text(content)


class SettingsWriteRequest(BaseModel):
    settings: dict


@router.get("/read")
async def read_settings(request: Request):
    _require_env_path()
    user = _get_user(request)
    env = parse_env_file(HONCHO_ENV_PATH)
    _audit("settings.read", user=user)
    sections = {
        "llm": {
            "LLM_OPENAI_API_KEY": env.get("LLM_OPENAI_API_KEY", ""),
        },
        "embeddings": {
            "EMBEDDING_MODEL_CONFIG__MODEL": env.get("EMBEDDING_MODEL_CONFIG__MODEL", ""),
            "EMBEDDING_MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("EMBEDDING_MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
            "EMBEDDING_MODEL_CONFIG__TRANSPORT": env.get("EMBEDDING_MODEL_CONFIG__TRANSPORT", ""),
            "EMBEDDING_VECTOR_DIMENSIONS": env.get("EMBEDDING_VECTOR_DIMENSIONS", ""),
        },
        "deriver": {
            "DERIVER_MODEL_CONFIG__MODEL": env.get("DERIVER_MODEL_CONFIG__MODEL", ""),
            "DERIVER_MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("DERIVER_MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
            "DERIVER_MODEL_CONFIG__TRANSPORT": env.get("DERIVER_MODEL_CONFIG__TRANSPORT", ""),
        },
        "dialectic": {
            "DIALECTIC_MODEL": env.get("DIALECTIC_LEVELS__minimal__MODEL_CONFIG__MODEL", ""),
            "DIALECTIC_BASE_URL": env.get("DIALECTIC_LEVELS__minimal__MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
            "DIALECTIC_TRANSPORT": env.get("DIALECTIC_LEVELS__minimal__MODEL_CONFIG__TRANSPORT", ""),
        },
        "summary": {
            "SUMMARY_MODEL_CONFIG__MODEL": env.get("SUMMARY_MODEL_CONFIG__MODEL", ""),
            "SUMMARY_MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("SUMMARY_MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
            "SUMMARY_MODEL_CONFIG__TRANSPORT": env.get("SUMMARY_MODEL_CONFIG__TRANSPORT", ""),
        },
        "dream": {
            "DREAM_DEDUCTION_MODEL_CONFIG__MODEL": env.get("DREAM_DEDUCTION_MODEL_CONFIG__MODEL", ""),
            "DREAM_DEDUCTION_MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("DREAM_DEDUCTION_MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
            "DREAM_DEDUCTION_MODEL_CONFIG__TRANSPORT": env.get("DREAM_DEDUCTION_MODEL_CONFIG__TRANSPORT", ""),
            "DREAM_INDUCTION_MODEL_CONFIG__MODEL": env.get("DREAM_INDUCTION_MODEL_CONFIG__MODEL", ""),
            "DREAM_INDUCTION_MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("DREAM_INDUCTION_MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
            "DREAM_INDUCTION_MODEL_CONFIG__TRANSPORT": env.get("DREAM_INDUCTION_MODEL_CONFIG__TRANSPORT", ""),
        },
        "advanced": {
            "VECTOR_STORE_TYPE": env.get("VECTOR_STORE_TYPE", ""),
            "CACHE_ENABLED": env.get("CACHE_ENABLED", ""),
            "CACHE_URL": env.get("CACHE_URL", ""),
            "DB_CONNECTION_URI": env.get("DB_CONNECTION_URI", ""),
        },
    }
    return {"sections": sections, "env_path": HONCHO_ENV_PATH}


# ---------------------------------------------------------------------------
# Supabase configuration (Hombre's own env)
# ---------------------------------------------------------------------------

SUPABASE_ENV_KEYS = ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_KEY")


def _mask_key(value: str) -> str:
    """Show first 4 + last 4 chars with **** in between. Short values fully masked."""
    if not value or len(value) <= 8:
        return "****" if value else ""
    return f"{value[:4]}****{value[-4:]}"


def _read_hombre_env() -> dict:
    """Read Hombre's own .env file as a dict.

    Delegates to :func:`parse_env_file`; silently returns an empty dict if the
    file is missing or unreadable (non-fatal for settings reads).
    """
    try:
        return parse_env_file(str(_HOMBRE_ENV_PATH))
    except HTTPException:
        return {}


def _write_hombre_env(data: dict) -> None:
    """Write/replace keys in Hombre's .env file. Creates if missing."""
    env = _read_hombre_env()
    env.update(data)

    lines = []
    for key, value in env.items():
        lines.append(f"{key}={sanitize_value(str(value))}")

    # Backup before modifying (consistent with _write_dashboard_users_to_env)
    if _HOMBRE_ENV_PATH.exists():
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = BACKUP_DIR / (_HOMBRE_ENV_PATH.name + ".bak")
        shutil.copy2(_HOMBRE_ENV_PATH, backup_path)

    _HOMBRE_ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    _HOMBRE_ENV_PATH.write_text("\n".join(lines) + "\n")


@router.get("/supabase")
async def read_supabase_settings(request: Request):
    """Read Supabase config from Hombre's own env vars."""
    user = _get_user(request)
    _audit("settings.supabase.read", user=user)

    env = _read_hombre_env()
    # Also pull live values from os.environ as fallback
    result = {}
    for key in SUPABASE_ENV_KEYS:
        raw = env.get(key) or os.environ.get(key, "")
        if key == "SUPABASE_URL":
            result[key] = raw
        else:
            result[key] = _mask_key(raw)

    configured = all(os.environ.get(k) for k in SUPABASE_ENV_KEYS)
    return {"supabase": result, "configured": configured}


class SupabaseWriteRequest(BaseModel):
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    SUPABASE_SERVICE_KEY: str = ""


@router.post("/supabase")
async def write_supabase_settings(req: SupabaseWriteRequest, request: Request):
    """Write Supabase config to Hombre's .env and set in os.environ."""
    user = _get_user(request)

    data = {
        "SUPABASE_URL": req.SUPABASE_URL.strip(),
        "SUPABASE_KEY": req.SUPABASE_KEY.strip(),
        "SUPABASE_SERVICE_KEY": req.SUPABASE_SERVICE_KEY.strip(),
    }

    _write_hombre_env(data)

    # Update os.environ so values take effect immediately
    for key, value in data.items():
        if value:
            os.environ[key] = value
        elif key in os.environ:
            del os.environ[key]

    _audit("settings.supabase.write", user=user, detail=f"keys={list(data.keys())}")
    return {"status": "ok"}


@router.post("/write")
async def write_settings(req: SettingsWriteRequest, request: Request):
    _require_env_path()
    user = _get_user(request)
    data = dict(req.settings)

    # Broadcast dialectic virtual keys to all 5 levels
    dialectic_expansions = {}
    for virtual_key, suffix in _DIALECTIC_VIRTUAL_KEYS.items():
        if virtual_key in data:
            for level in DIALECTIC_LEVELS:
                real_key = f"DIALECTIC_LEVELS__{level}__{suffix}"
                dialectic_expansions[real_key] = data[virtual_key]
            del data[virtual_key]
    data.update(dialectic_expansions)

    changed_keys = list(data.keys())
    write_env_file(HONCHO_ENV_PATH, data)
    _audit("settings.write", user=user, detail=f"keys={changed_keys}")
    return {"status": "ok", "env_path": HONCHO_ENV_PATH}


@router.post("/backup")
async def create_backup(request: Request):
    _require_env_path()
    user = _get_user(request)
    env_path = Path(HONCHO_ENV_PATH)
    if not env_path.exists():
        raise HTTPException(status_code=404, detail="env_file_not_found")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / (env_path.name + ".bak")
    shutil.copy2(env_path, backup_path)
    _audit("settings.backup", user=user)
    return {"status": "backed up", "backup_path": str(backup_path)}


@router.get("/backups")
async def list_backups(request: Request):
    """List all .bak files in the backup directory."""
    _require_env_path()
    user = _get_user(request)

    if not BACKUP_DIR.exists():
        return {"backups": []}

    backups = []
    for f in sorted(BACKUP_DIR.iterdir()):
        if f.suffix == ".bak" and f.is_file():
            stat = f.stat()
            backups.append({
                "filename": f.name,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })

    _audit("settings.backups.list", user=user)
    return {"backups": backups}


class RestoreRequest(BaseModel):
    filename: str | None = None


@router.post("/restore")
async def restore_backup(request: Request, body: RestoreRequest | None = None):
    _require_env_path()
    user = _get_user(request)
    env_path = Path(HONCHO_ENV_PATH)

    if body and body.filename:
        # Validate filename to prevent path traversal
        filename = Path(body.filename).name
        if ".." in filename or "/" in filename or "\\" in filename:
            raise HTTPException(status_code=400, detail="invalid_filename")
        backup_path = BACKUP_DIR / filename
    else:
        backup_path = BACKUP_DIR / (env_path.name + ".bak")

    if not backup_path.exists():
        raise HTTPException(status_code=404, detail="backup_not_found")
    shutil.copy2(backup_path, env_path)
    _audit("settings.restore", user=user, detail=f"file={backup_path.name}")
    return {"status": "restored", "file": backup_path.name}


@router.post("/restart")
async def restart_containers(request: Request):
    _require_env_path()
    _require_compose_dir()
    user = _get_user(request)
    _audit("settings.restart", user=user)
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "compose", "up", "-d", "--force-recreate",
            cwd=HONCHO_COMPOSE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=COMPOSE_RESTART_TIMEOUT)
        if proc.returncode != 0:
            log.error("Docker compose failed: %s", stderr.decode())
            raise HTTPException(status_code=500, detail="compose_restart_failed")
        return {"status": "restarting", "compose_dir": HONCHO_COMPOSE_DIR}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=500, detail="compose_restart_timeout")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="docker_not_found")


# ---------------------------------------------------------------------------
# Dashboard user management
# ---------------------------------------------------------------------------

class DashboardUser(BaseModel):
    username: str
    password: str
    role: str


class DashboardUsersRequest(BaseModel):
    users: list[DashboardUser]


def _write_dashboard_users_to_env(users: list[DashboardUser]) -> None:
    """Write the DASHBOARD_USERS env var to the Honcho .env file."""
    env_path = Path(HONCHO_ENV_PATH)
    if not env_path.exists():
        raise HTTPException(status_code=404, detail="env_file_not_found")

    entries = ",".join([f"{u.username}:{u.password}:{u.role}" for u in users])
    new_line = f"DASHBOARD_USERS={entries}"

    content = env_path.read_text()
    pattern = r"^DASHBOARD_USERS=.*$"
    if re.search(pattern, content, re.MULTILINE):
        content = re.sub(pattern, new_line, content, flags=re.MULTILINE)
    else:
        content = content.rstrip() + "\n" + new_line + "\n"

    backup_path = env_path.parent / (env_path.name + ".bak")
    shutil.copy2(env_path, backup_path)
    env_path.write_text(content)


@router.get("/users")
async def list_users(request: Request):
    """List current dashboard users (passwords masked)."""
    user = _get_user(request)
    permissions = getattr(request.state, "permissions", set())
    if "settings" not in permissions:
        raise HTTPException(status_code=403, detail="forbidden")

    result = []
    for uname, info in _users_cache.items():
        result.append({
            "username": uname,
            "password": "••••",
            "role": info["role"],
        })

    _audit("settings.users.read", user=user)
    return {"users": result}


@router.post("/users")
async def update_users(req: DashboardUsersRequest, request: Request):
    """Update dashboard users — writes env file + updates in-memory cache."""
    user = _get_user(request)
    permissions = getattr(request.state, "permissions", set())
    if "settings" not in permissions:
        raise HTTPException(status_code=403, detail="forbidden")

    _require_env_path()

    # Validate roles
    for u in req.users:
        if u.role not in ROLE_PERMISSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"invalid_role: {u.role} (valid: {', '.join(sorted(ROLE_PERMISSIONS))})",
            )

    # Persist to .env file
    _write_dashboard_users_to_env(req.users)

    # Update the in-memory cache (same dict object the middleware references)
    _users_cache.clear()
    for u in req.users:
        _users_cache[u.username] = {"password": u.password, "role": u.role}

    _audit("settings.users.write", user=user, detail=f"users={[u.username for u in req.users]}")
    return {"status": "ok", "count": len(req.users)}
