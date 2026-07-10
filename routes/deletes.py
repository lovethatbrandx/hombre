"""
Soft-delete registry for resources that Honcho doesn't support deleting natively.
Peers can only be soft-deleted locally.

Conclusions and messages CAN be hard-deleted via Honcho:
  DELETE /api/workspaces/{wid}/conclusions/{cid}
  DELETE /api/workspaces/{wid}/sessions/{sid}/messages/{mid}

Workspaces and sessions can also be hard-deleted via Honcho.

I sold my soul to Satan for this. Worst trade ever.
"""

import json
import logging
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from routes.supabase import get_admin_client, is_admin_configured

log = logging.getLogger("hombre")

router = APIRouter(prefix="/api/soft-delete", tags=["soft-delete"])

DATA_DIR = Path(__file__).parent.parent / "data"
DELETED_FILE = DATA_DIR / "deleted.json"

VALID_TYPES = {"peer", "message", "conclusion"}


class SoftDeleteRequest(BaseModel):
    type: str = Field(..., description="Resource type: peer, message, or conclusion")
    id: str = Field(..., description="Resource ID to mark as deleted")
    workspace_id: str = Field(..., description="Workspace ID the resource belongs to")


class SoftDeleteCheckRequest(BaseModel):
    type: str = Field(..., description="Resource type to check")
    ids: list[str] = Field(..., description="List of resource IDs to check")
    workspace_id: str = Field(..., description="Workspace ID to scope the check to")


class SoftDeleteRestoreRequest(BaseModel):
    type: str = Field(..., description="Resource type to restore")
    id: str = Field(..., description="Resource ID to restore")
    workspace_id: str = Field(..., description="Workspace ID the resource belongs to")


def _load_deleted() -> dict:
    """Load the deleted resources registry from disk."""
    if not DELETED_FILE.exists():
        return {"peers": [], "messages": [], "conclusions": []}
    try:
        data = json.loads(DELETED_FILE.read_text())
        # Ensure all keys exist
        for key in ("peers", "messages", "conclusions"):
            if key not in data:
                data[key] = []
        return data
    except (json.JSONDecodeError, Exception) as e:
        log.error("Failed to load deleted.json: %s", e)
        return {"peers": [], "messages": [], "conclusions": []}


def _load_deleted_supabase(resource_type: str, workspace_id: str | None = None) -> list[dict]:
    """Load deleted resources from Supabase."""
    client = get_admin_client()
    if not client:
        return []

    try:
        query = client.table("soft_deletes").select("resource_id, workspace_id, deleted_at")
        query = query.eq("resource_type", resource_type)
        if workspace_id:
            query = query.eq("workspace_id", workspace_id)
        result = query.execute()

        return [
            {"id": row["resource_id"], "workspace_id": row["workspace_id"], "deleted_at": row["deleted_at"]}
            for row in (result.data or [])
        ]
    except Exception as e:
        log.error("Failed to load soft deletes from Supabase: %s", e)
        return []


def _load_deleted_supabase_all() -> dict:
    """Load all deleted resources from Supabase, grouped by type."""
    data = {"peers": [], "messages": [], "conclusions": []}
    type_map = {"peer": "peers", "message": "messages", "conclusion": "conclusions"}

    for resource_type, key in type_map.items():
        data[key] = _load_deleted_supabase(resource_type)

    return data


def _save_deleted(data: dict) -> None:
    """Persist the deleted resources registry to disk."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        DELETED_FILE.write_text(json.dumps(data, indent=2))
    except Exception as e:
        log.error("Failed to write deleted.json: %s", e)
        raise HTTPException(status_code=500, detail="failed_to_save")


def _save_deleted_supabase(resource_type: str, resource_id: str, workspace_id: str) -> None:
    """Insert a soft-deleted resource into Supabase."""
    client = get_admin_client()
    if not client:
        return

    try:
        client.table("soft_deletes").upsert(
            {
                "resource_type": resource_type,
                "resource_id": resource_id,
                "workspace_id": workspace_id,
            },
            on_conflict="resource_type,resource_id,workspace_id",
        ).execute()
    except Exception as e:
        log.error("Failed to save soft delete to Supabase: %s", e)
        raise HTTPException(status_code=500, detail="failed_to_save")


def _delete_from_supabase(resource_type: str, resource_id: str, workspace_id: str) -> bool:
    """Remove a soft-delete record from Supabase (restore)."""
    client = get_admin_client()
    if not client:
        return False

    try:
        result = (
            client.table("soft_deletes")
            .delete()
            .eq("resource_type", resource_type)
            .eq("resource_id", resource_id)
            .eq("workspace_id", workspace_id)
            .execute()
        )
        return bool(result.data)
    except Exception as e:
        log.error("Failed to delete from Supabase: %s", e)
        return False


def _type_to_key(resource_type: str) -> str:
    """Map singular type name to plural key in storage."""
    mapping = {"peer": "peers", "message": "messages", "conclusion": "conclusions"}
    return mapping.get(resource_type, "")


@router.post("")
async def soft_delete(req: SoftDeleteRequest):
    """Mark a resource as deleted."""
    if req.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"invalid_type: must be one of {sorted(VALID_TYPES)}")
    if not req.id or not req.workspace_id:
        raise HTTPException(status_code=400, detail="id and workspace_id are required")

    # --- Supabase path ---
    if is_admin_configured():
        # Check for duplicates
        existing = _load_deleted_supabase(req.type, req.workspace_id)
        for entry in existing:
            if entry["id"] == req.id:
                return {"status": "already_deleted", "id": req.id}

        _save_deleted_supabase(req.type, req.id, req.workspace_id)
        log.info("Soft-deleted %s %s in workspace %s (Supabase)", req.type, req.id, req.workspace_id)
        return {"status": "deleted", "id": req.id, "type": req.type}

    # --- File-based fallback ---
    data = _load_deleted()
    key = _type_to_key(req.type)

    # Check for duplicates
    for entry in data[key]:
        if entry["id"] == req.id and entry["workspace_id"] == req.workspace_id:
            return {"status": "already_deleted", "id": req.id}

    entry = {
        "id": req.id,
        "workspace_id": req.workspace_id,
        "deleted_at": time.time(),
    }
    data[key].append(entry)
    _save_deleted(data)

    log.info("Soft-deleted %s %s in workspace %s", req.type, req.id, req.workspace_id)
    return {"status": "deleted", "id": req.id, "type": req.type}


@router.post("/check")
async def soft_delete_check(req: SoftDeleteCheckRequest):
    """Check if resources are soft-deleted."""
    if req.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"invalid_type: must be one of {sorted(VALID_TYPES)}")

    # --- Supabase path ---
    if is_admin_configured():
        deleted_entries = _load_deleted_supabase(req.type, req.workspace_id)
        deleted_ids = {entry["id"] for entry in deleted_entries}
        results = {rid: rid in deleted_ids for rid in req.ids}
        return {"type": req.type, "results": results}

    # --- File-based fallback ---
    data = _load_deleted()
    key = _type_to_key(req.type)

    # Filter by workspace_id to prevent cross-workspace data leaks
    deleted_ids = {entry["id"] for entry in data[key] if entry.get("workspace_id") == req.workspace_id}
    results = {rid: rid in deleted_ids for rid in req.ids}

    return {"type": req.type, "results": results}


@router.get("/list")
async def soft_delete_list(type: str | None = None):
    """List all soft-deleted resources, optionally filtered by type."""
    # --- Supabase path ---
    if is_admin_configured():
        if type:
            if type not in VALID_TYPES:
                raise HTTPException(status_code=400, detail=f"invalid_type: must be one of {sorted(VALID_TYPES)}")
            items = _load_deleted_supabase(type)
            return {"type": type, "items": items}

        data = _load_deleted_supabase_all()
        return {
            "peers": data["peers"],
            "messages": data["messages"],
            "conclusions": data["conclusions"],
        }

    # --- File-based fallback ---
    data = _load_deleted()

    if type:
        if type not in VALID_TYPES:
            raise HTTPException(status_code=400, detail=f"invalid_type: must be one of {sorted(VALID_TYPES)}")
        key = _type_to_key(type)
        return {"type": type, "items": data[key]}

    return {
        "peers": data["peers"],
        "messages": data["messages"],
        "conclusions": data["conclusions"],
    }


@router.post("/restore")
async def soft_delete_restore(req: SoftDeleteRestoreRequest):
    """Restore a soft-deleted resource."""
    if req.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"invalid_type: must be one of {sorted(VALID_TYPES)}")
    if not req.id or not req.workspace_id:
        raise HTTPException(status_code=400, detail="id and workspace_id are required")

    # --- Supabase path ---
    if is_admin_configured():
        deleted = _delete_from_supabase(req.type, req.id, req.workspace_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="not_found")
        log.info("Restored %s %s in workspace %s (Supabase)", req.type, req.id, req.workspace_id)
        return {"status": "restored", "id": req.id, "type": req.type}

    # --- File-based fallback ---
    data = _load_deleted()
    key = _type_to_key(req.type)

    original_len = len(data[key])
    data[key] = [
        entry for entry in data[key]
        if not (entry["id"] == req.id and entry["workspace_id"] == req.workspace_id)
    ]

    if len(data[key]) == original_len:
        raise HTTPException(status_code=404, detail="not_found")

    _save_deleted(data)
    log.info("Restored %s %s in workspace %s", req.type, req.id, req.workspace_id)
    return {"status": "restored", "id": req.id, "type": req.type}
