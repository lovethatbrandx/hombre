import os
import re
import asyncio
import shutil
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log = logging.getLogger("honcho-dashboard")

router = APIRouter(prefix="/api/settings", tags=["settings"])

HONCHO_ENV_PATH = os.environ["HONCHO_ENV_PATH"]
HONCHO_COMPOSE_DIR = os.environ["HONCHO_COMPOSE_DIR"]

WRITABLE_KEYS = {
    "LLM_OPENAI_API_KEY",
    "EMBEDDING_MODEL_CONFIG__MODEL",
    "EMBEDDING_MODEL_CONFIG__OVERRIDES__BASE_URL",
    "EMBEDDING_MODEL_CONFIG__TRANSPORT",
    "EMBEDDING_VECTOR_DIMENSIONS",
    "DERIVER_MODEL_CONFIG__MODEL",
    "DERIVER_MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DERIVER_MODEL_CONFIG__TRANSPORT",
    "DIALECTIC_LEVELS__minimal__MODEL_CONFIG__MODEL",
    "DIALECTIC_LEVELS__minimal__MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DIALECTIC_LEVELS__minimal__MODEL_CONFIG__TRANSPORT",
    "DIALECTIC_LEVELS__low__MODEL_CONFIG__MODEL",
    "DIALECTIC_LEVELS__low__MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DIALECTIC_LEVELS__low__MODEL_CONFIG__TRANSPORT",
    "DIALECTIC_LEVELS__medium__MODEL_CONFIG__MODEL",
    "DIALECTIC_LEVELS__medium__MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DIALECTIC_LEVELS__medium__MODEL_CONFIG__TRANSPORT",
    "DIALECTIC_LEVELS__high__MODEL_CONFIG__MODEL",
    "DIALECTIC_LEVELS__high__MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DIALECTIC_LEVELS__high__MODEL_CONFIG__TRANSPORT",
    "DIALECTIC_LEVELS__max__MODEL_CONFIG__MODEL",
    "DIALECTIC_LEVELS__max__MODEL_CONFIG__OVERRIDES__BASE_URL",
    "DIALECTIC_LEVELS__max__MODEL_CONFIG__TRANSPORT",
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

    backup_path = env_path.parent / (env_path.name + ".bak")
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
async def read_settings():
    env = parse_env_file(HONCHO_ENV_PATH)
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
            "minimal": {
                "DIALECTIC_LEVELS__minimal__MODEL_CONFIG__MODEL": env.get("DIALECTIC_LEVELS__minimal__MODEL_CONFIG__MODEL", ""),
                "DIALECTIC_LEVELS__minimal__MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("DIALECTIC_LEVELS__minimal__MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
                "DIALECTIC_LEVELS__minimal__MODEL_CONFIG__TRANSPORT": env.get("DIALECTIC_LEVELS__minimal__MODEL_CONFIG__TRANSPORT", ""),
            },
            "low": {
                "DIALECTIC_LEVELS__low__MODEL_CONFIG__MODEL": env.get("DIALECTIC_LEVELS__low__MODEL_CONFIG__MODEL", ""),
                "DIALECTIC_LEVELS__low__MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("DIALECTIC_LEVELS__low__MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
                "DIALECTIC_LEVELS__low__MODEL_CONFIG__TRANSPORT": env.get("DIALECTIC_LEVELS__low__MODEL_CONFIG__TRANSPORT", ""),
            },
            "medium": {
                "DIALECTIC_LEVELS__medium__MODEL_CONFIG__MODEL": env.get("DIALECTIC_LEVELS__medium__MODEL_CONFIG__MODEL", ""),
                "DIALECTIC_LEVELS__medium__MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("DIALECTIC_LEVELS__medium__MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
                "DIALECTIC_LEVELS__medium__MODEL_CONFIG__TRANSPORT": env.get("DIALECTIC_LEVELS__medium__MODEL_CONFIG__TRANSPORT", ""),
            },
            "high": {
                "DIALECTIC_LEVELS__high__MODEL_CONFIG__MODEL": env.get("DIALECTIC_LEVELS__high__MODEL_CONFIG__MODEL", ""),
                "DIALECTIC_LEVELS__high__MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("DIALECTIC_LEVELS__high__MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
                "DIALECTIC_LEVELS__high__MODEL_CONFIG__TRANSPORT": env.get("DIALECTIC_LEVELS__high__MODEL_CONFIG__TRANSPORT", ""),
            },
            "max": {
                "DIALECTIC_LEVELS__max__MODEL_CONFIG__MODEL": env.get("DIALECTIC_LEVELS__max__MODEL_CONFIG__MODEL", ""),
                "DIALECTIC_LEVELS__max__MODEL_CONFIG__OVERRIDES__BASE_URL": env.get("DIALECTIC_LEVELS__max__MODEL_CONFIG__OVERRIDES__BASE_URL", ""),
                "DIALECTIC_LEVELS__max__MODEL_CONFIG__TRANSPORT": env.get("DIALECTIC_LEVELS__max__MODEL_CONFIG__TRANSPORT", ""),
            },
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


@router.post("/write")
async def write_settings(req: SettingsWriteRequest):
    write_env_file(HONCHO_ENV_PATH, req.settings)
    return {"status": "ok", "env_path": HONCHO_ENV_PATH}


@router.post("/backup")
async def create_backup():
    env_path = Path(HONCHO_ENV_PATH)
    if not env_path.exists():
        raise HTTPException(status_code=404, detail="env_file_not_found")
    backup_path = env_path.parent / (env_path.name + ".bak")
    shutil.copy2(env_path, backup_path)
    return {"status": "backed up"}


@router.post("/restore")
async def restore_backup():
    env_path = Path(HONCHO_ENV_PATH)
    backup_path = env_path.parent / (env_path.name + ".bak")
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail="backup_not_found")
    shutil.copy2(backup_path, env_path)
    return {"status": "restored"}


@router.post("/restart")
async def restart_containers():
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "compose", "up", "-d", "--force-recreate",
            cwd=HONCHO_COMPOSE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
        if proc.returncode != 0:
            log.error("Docker compose failed: %s", stderr.decode())
            raise HTTPException(status_code=500, detail="compose_restart_failed")
        return {"status": "restarting", "compose_dir": HONCHO_COMPOSE_DIR}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=500, detail="compose_restart_timeout")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="docker_not_found")
