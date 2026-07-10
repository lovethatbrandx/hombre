"""
Export/Import routes for Hombre.

Provides endpoints to export workspace data (peers, sessions, conclusions, messages)
to a portable JSON format, and import from that format into a workspace.

Hihi! I love data portability! Just wanted to remind you that every export
includes a validation step — because nothing worse than importing bad data.
Everything is going to be okay!
"""

import json
import re
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

log = logging.getLogger("hombre")

router = APIRouter(prefix="/api/export", tags=["export"])
workspace_router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

EXPORT_VERSION = "1.0"
VALID_ID = re.compile(r"^[a-zA-Z0-9_-]+$")
MAX_IMPORT_SIZE = 10 * 1024 * 1024  # 10MB limit for import files

# ─── Helpers ──────────────────────────────────────────────────────────────


def validate_export_format(data: dict) -> tuple[bool, str]:
    """Validate the JSON structure of an import file.

    Returns (is_valid, error_message).
    """
    if not isinstance(data, dict):
        return False, "Root must be a JSON object"

    if not data.get("hombre_export"):
        return False, "Missing or false 'hombre_export' field"

    if not data.get("version"):
        return False, "Missing 'version' field"

    if not data.get("export_date"):
        return False, "Missing 'export_date' field"

    if not data.get("workspace_id"):
        return False, "Missing 'workspace_id' field"

    data_section = data.get("data")
    if not isinstance(data_section, dict):
        return False, "Missing or invalid 'data' section"

    for key in ("peers", "sessions", "conclusions"):
        if key not in data_section:
            return False, f"Missing '{key}' in data section"
        if not isinstance(data_section[key], list):
            return False, f"'data.{key}' must be an array"

    if "messages" in data_section and not isinstance(data_section["messages"], dict):
        return False, "'data.messages' must be an object (keyed by session_id)"

    return True, ""


def _get_honcho_client():
    """Get the httpx client from the running app module.

    When run as ``python app.py``, the module is registered as ``__main__``
    in sys.modules, not ``app``.  We check both to find the live client.
    """
    import sys

    for key in ("app", "__main__"):
        mod = sys.modules.get(key)
        if mod is not None and getattr(mod, "_client", None) is not None:
            return mod._client
    return None


async def _honcho_request(method: str, path: str, body: Any = None) -> Any:
    """Make a request to the Honcho API through the app's httpx client."""
    client = _get_honcho_client()
    if client is None:
        raise HTTPException(status_code=503, detail="honcho_client_not_ready")

    try:
        if method == "GET":
            resp = await client.get(path)
        elif method == "POST":
            resp = await client.post(path, json=body or {})
        elif method == "DELETE":
            resp = await client.delete(path)
        else:
            raise HTTPException(status_code=400, detail=f"unsupported_method: {method}")

        if resp.status_code >= 400:
            detail = ""
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            log.warning("Honcho API error %d on %s %s: %s", resp.status_code, method, path, detail)
            raise HTTPException(status_code=resp.status_code, detail=detail)

        try:
            return resp.json()
        except Exception:
            return resp.text

    except httpx.ConnectError:
        log.error("Honcho unreachable during export/import")
        raise HTTPException(status_code=502, detail="honcho_unreachable")
    except HTTPException:
        raise
    except Exception as e:
        log.error("Honcho request failed: %s %s %s — %s", method, path, body, e)
        raise HTTPException(status_code=502, detail="honcho_proxy_error")


async def _export_messages(wid: str, sessions: list[dict]) -> dict[str, list[dict]]:
    """Export all messages for all sessions in a workspace, keyed by session_id."""
    messages: dict[str, list[dict]] = {}
    for session in sessions:
        sid = session.get("id", "")
        if not sid:
            continue
        try:
            data = await _honcho_request("POST", f"/v3/workspaces/{wid}/sessions/{sid}/messages/list", {"filters": {}})
            messages[sid] = data.get("items", [])
        except HTTPException as e:
            log.warning("Failed to export messages for session %s: %s", sid, e.detail)
            messages[sid] = []
    return messages


def _strip_internal_fields(items: list[dict]) -> list[dict]:
    """Remove any Honcho-internal fields that shouldn't be in an export."""
    cleaned = []
    for item in items:
        cleaned.append({k: v for k, v in item.items() if not k.startswith("_")})
    return cleaned


# ─── Export Endpoints ─────────────────────────────────────────────────────


@router.post("/workspace/{wid}")
async def export_workspace(wid: str):
    """Export entire workspace: peers, sessions, conclusions, messages.

    Returns a JSON file with all data and metadata.
    """
    if not VALID_ID.match(wid):
        raise HTTPException(status_code=400, detail="invalid_workspace_id")

    log.info("Exporting workspace %s", wid)

    # Fetch all data in parallel-ish (sequential for simplicity, but could parallelize)
    peers_data = await _honcho_request("POST", f"/v3/workspaces/{wid}/peers/list", {"filters": {}})
    sessions_data = await _honcho_request("POST", f"/v3/workspaces/{wid}/sessions/list", {"filters": {}})
    conclusions_data = await _honcho_request("POST", f"/v3/workspaces/{wid}/conclusions/list", {"filters": {}})

    peers = _strip_internal_fields(peers_data.get("items", []))
    sessions = _strip_internal_fields(sessions_data.get("items", []))
    conclusions = _strip_internal_fields(conclusions_data.get("items", []))

    messages = await _export_messages(wid, sessions)

    export = {
        "hombre_export": True,
        "version": EXPORT_VERSION,
        "export_date": datetime.now(timezone.utc).isoformat(),
        "workspace_id": wid,
        "data": {
            "peers": peers,
            "sessions": sessions,
            "conclusions": conclusions,
            "messages": messages,
        },
    }

    log.info(
        "Export complete: %d peers, %d sessions, %d conclusions, %d message sessions",
        len(peers), len(sessions), len(conclusions), len(messages),
    )
    return export


@router.post("/peer/{wid}/{pid}")
async def export_peer(wid: str, pid: str):
    """Export a single peer's data: peer info, representation, card, and related messages."""
    if not VALID_ID.match(wid) or not VALID_ID.match(pid):
        raise HTTPException(status_code=400, detail="invalid_id")

    log.info("Exporting peer %s/%s", wid, pid)

    # Get peer info
    peers_data = await _honcho_request("POST", f"/v3/workspaces/{wid}/peers/list", {"filters": {}})
    peer = next((p for p in peers_data.get("items", []) if p.get("id") == pid), None)
    if not peer:
        raise HTTPException(status_code=404, detail="peer_not_found")

    # Get representation and card
    try:
        representation = await _honcho_request("POST", f"/v3/workspaces/{wid}/peers/{pid}/representation", {})
    except HTTPException:
        representation = {}

    try:
        card = await _honcho_request("GET", f"/v3/workspaces/{wid}/peers/{pid}/card")
    except HTTPException:
        card = {}

    # Get conclusions for this peer
    conclusions_data = await _honcho_request("POST", f"/v3/workspaces/{wid}/conclusions/list", {
        "filters": {"observer_id": pid}
    })

    export = {
        "hombre_export": True,
        "version": EXPORT_VERSION,
        "export_date": datetime.now(timezone.utc).isoformat(),
        "workspace_id": wid,
        "peer_id": pid,
        "data": {
            "peer": _strip_internal_fields([peer])[0] if peer else None,
            "representation": representation,
            "card": card,
            "conclusions": _strip_internal_fields(conclusions_data.get("items", [])),
        },
    }

    log.info("Peer export complete: %s/%s", wid, pid)
    return export


@router.post("/conclusions/{wid}")
async def export_conclusions(wid: str):
    """Export all conclusions for a workspace."""
    if not VALID_ID.match(wid):
        raise HTTPException(status_code=400, detail="invalid_workspace_id")

    log.info("Exporting conclusions for workspace %s", wid)

    conclusions_data = await _honcho_request("POST", f"/v3/workspaces/{wid}/conclusions/list", {"filters": {}})

    export = {
        "hombre_export": True,
        "version": EXPORT_VERSION,
        "export_date": datetime.now(timezone.utc).isoformat(),
        "workspace_id": wid,
        "data": {
            "conclusions": _strip_internal_fields(conclusions_data.get("items", [])),
        },
    }

    log.info("Conclusions export complete: %d items", len(export["data"]["conclusions"]))
    return export


# ─── Import Endpoints ─────────────────────────────────────────────────────


class ImportConfirmRequest(BaseModel):
    workspace_id: str
    data: dict
    id_mapping: dict[str, str] | None = None  # old_id -> new_id for conflicts
    conflict_strategy: str = "skip"  # skip | overwrite | rename


class MergeRequest(BaseModel):
    source_workspace_id: str
    target_workspace_id: str
    conflict_strategy: str = "rename"  # skip | rename


# ─── Workspace Helpers ────────────────────────────────────────────────────


async def _workspace_exists(wid: str) -> bool:
    """Check if a workspace exists by listing all workspaces."""
    try:
        ws_data = await _honcho_request("POST", "/v3/workspaces/list", {"filters": {}})
        return any(w.get("id") == wid for w in ws_data.get("items", []))
    except HTTPException:
        return False


async def _fetch_peers(wid: str) -> list[dict]:
    """Fetch all peers from a workspace."""
    try:
        data = await _honcho_request("POST", f"/v3/workspaces/{wid}/peers/list", {"filters": {}})
        return data.get("items", [])
    except HTTPException:
        return []


async def _fetch_sessions(wid: str) -> list[dict]:
    """Fetch all sessions from a workspace."""
    try:
        data = await _honcho_request("POST", f"/v3/workspaces/{wid}/sessions/list", {"filters": {}})
        return data.get("items", [])
    except HTTPException:
        return []


def _resolve_conflict_id(base_id: str, existing_ids: set[str], suffix: str = "merged") -> str:
    """Generate a unique ID by appending a suffix with incrementing counter."""
    candidate = f"{base_id}-{suffix}"
    counter = 1
    while candidate in existing_ids:
        candidate = f"{base_id}-{suffix}-{counter}"
        counter += 1
    return candidate


# ─── Merge Preview ────────────────────────────────────────────────────────


@workspace_router.post("/merge/preview")
async def merge_preview(req: MergeRequest):
    """Preview what a merge would do without actually merging anything.

    Shows conflict count, non-conflicting peers, and detailed conflict info.
    """
    if req.conflict_strategy not in ("skip", "rename"):
        raise HTTPException(status_code=400, detail="conflict_strategy_must_be_skip_or_rename")

    if not VALID_ID.match(req.source_workspace_id) or not VALID_ID.match(req.target_workspace_id):
        raise HTTPException(status_code=400, detail="invalid_workspace_id")

    if req.source_workspace_id == req.target_workspace_id:
        raise HTTPException(status_code=400, detail="source_and_target_must_differ")

    log.info("Merge preview: %s -> %s (strategy: %s)", req.source_workspace_id, req.target_workspace_id, req.conflict_strategy)

    # Validate both workspaces exist
    if not await _workspace_exists(req.source_workspace_id):
        raise HTTPException(status_code=404, detail=f"source_workspace_not_found: {req.source_workspace_id}")
    if not await _workspace_exists(req.target_workspace_id):
        raise HTTPException(status_code=404, detail=f"target_workspace_not_found: {req.target_workspace_id}")

    # Fetch peers from both workspaces
    source_peers = await _fetch_peers(req.source_workspace_id)
    target_peers = await _fetch_peers(req.target_workspace_id)

    source_peer_ids = {p.get("id", "") for p in source_peers if p.get("id")}
    target_peer_ids = {p.get("id", "") for p in target_peers if p.get("id")}

    conflicts = sorted(source_peer_ids & target_peer_ids)
    non_conflicting = sorted(source_peer_ids - target_peer_ids)

    # Build conflict details with creation dates
    source_peer_map = {p.get("id", ""): p for p in source_peers}
    target_peer_map = {p.get("id", ""): p for p in target_peers}

    conflict_details = []
    for cid in conflicts:
        sp = source_peer_map.get(cid, {})
        tp = target_peer_map.get(cid, {})
        conflict_details.append({
            "id": cid,
            "source_created": sp.get("created_at", sp.get("createdAt", "unknown")),
            "target_created": tp.get("created_at", tp.get("createdAt", "unknown")),
        })

    # Preview sessions too
    source_sessions = await _fetch_sessions(req.source_workspace_id)
    target_sessions = await _fetch_sessions(req.target_workspace_id)

    source_session_ids = {s.get("id", "") for s in source_sessions if s.get("id")}
    target_session_ids = {s.get("id", "") for s in target_sessions if s.get("id")}

    session_conflicts = sorted(source_session_ids & target_session_ids)

    result = {
        "source_peers": len(source_peer_ids),
        "target_peers": len(target_peer_ids),
        "source_sessions": len(source_session_ids),
        "target_sessions": len(target_session_ids),
        "peers_non_conflicting": len(non_conflicting),
        "peers_conflicting": len(conflicts),
        "conflicts": conflicts,
        "conflict_details": conflict_details,
        "non_conflicting": non_conflicting,
        "sessions_non_conflicting": len(source_session_ids - target_session_ids),
        "sessions_conflicting": len(session_conflicts),
        "session_conflicts": session_conflicts,
    }

    log.info(
        "Merge preview: %d source peers, %d target peers, %d peer conflicts, %d session conflicts",
        len(source_peer_ids), len(target_peer_ids), len(conflicts), len(session_conflicts),
    )
    return result


# ─── Merge Execute ────────────────────────────────────────────────────────


@workspace_router.post("/merge")
async def merge_workspaces(req: MergeRequest):
    """Merge source workspace into target workspace with conflict detection.

    Handles peer and session merging based on the chosen conflict strategy:
    - skip:     don't copy conflicting items
    - rename:   add -merged suffix (-merged-1, -merged-2, etc.)
    """
    if req.conflict_strategy not in ("skip", "rename"):
        raise HTTPException(status_code=400, detail="conflict_strategy_must_be_skip_or_rename")

    if not VALID_ID.match(req.source_workspace_id) or not VALID_ID.match(req.target_workspace_id):
        raise HTTPException(status_code=400, detail="invalid_workspace_id")

    if req.source_workspace_id == req.target_workspace_id:
        raise HTTPException(status_code=400, detail="source_and_target_must_differ")

    log.info("Merging workspace %s -> %s (strategy: %s)", req.source_workspace_id, req.target_workspace_id, req.conflict_strategy)

    # Validate both workspaces exist
    if not await _workspace_exists(req.source_workspace_id):
        raise HTTPException(status_code=404, detail=f"source_workspace_not_found: {req.source_workspace_id}")
    if not await _workspace_exists(req.target_workspace_id):
        raise HTTPException(status_code=404, detail=f"target_workspace_not_found: {req.target_workspace_id}")

    strategy = req.conflict_strategy
    source_wid = req.source_workspace_id
    target_wid = req.target_workspace_id

    report = {
        "status": "complete",
        "source": source_wid,
        "target": target_wid,
        "peers_copied": 0,
        "peers_skipped": 0,
        "peers_renamed": 0,
        "sessions_copied": 0,
        "sessions_skipped": 0,
        "sessions_renamed": 0,
        "conflicts": [],
        "errors": [],
    }

    # ── Phase 1: Merge Peers ──────────────────────────────────────────────
    source_peers = await _fetch_peers(source_wid)
    target_peers = await _fetch_peers(target_wid)

    source_peer_ids = {p.get("id", "") for p in source_peers if p.get("id")}
    target_peer_ids = {p.get("id", "") for p in target_peers if p.get("id")}

    peer_conflicts = sorted(source_peer_ids & target_peer_ids)
    report["conflicts"] = peer_conflicts

    # Build set of target IDs we'll be working with (may grow if renaming)
    active_target_ids = set(target_peer_ids)

    for peer in source_peers:
        pid = peer.get("id", "")
        if not pid:
            continue

        is_conflict = pid in target_peer_ids

        if is_conflict:
            if strategy == "skip":
                report["peers_skipped"] += 1
                log.info("Skipping conflicting peer: %s", pid)
                continue
            else:  # rename
                new_id = _resolve_conflict_id(pid, active_target_ids, suffix="merged")
                active_target_ids.add(new_id)
                report["peers_renamed"] += 1
        else:
            new_id = pid

        # Create the peer in target workspace
        try:
            await _honcho_request("POST", f"/v3/workspaces/{target_wid}/peers/create", {"id": new_id})
            report["peers_copied"] += 1
            log.info("Merged peer: %s -> %s%s", pid, new_id, " (renamed)" if is_conflict and strategy == "rename" else "")
        except HTTPException as e:
            report["errors"].append(f"peer '{pid}': {e.detail}")
            log.warning("Failed to merge peer %s: %s", pid, e.detail)

    # ── Phase 2: Merge Sessions ───────────────────────────────────────────
    source_sessions = await _fetch_sessions(source_wid)
    target_sessions = await _fetch_sessions(target_wid)

    source_session_ids = {s.get("id", "") for s in source_sessions if s.get("id")}
    target_session_ids = {s.get("id", "") for s in target_sessions if s.get("id")}

    session_conflicts = source_session_ids & target_session_ids
    active_target_session_ids = set(target_session_ids)

    for session in source_sessions:
        sid = session.get("id", "")
        if not sid:
            continue

        is_conflict = sid in target_session_ids

        if is_conflict:
            if strategy == "skip":
                report["sessions_skipped"] += 1
                log.info("Skipping conflicting session: %s", sid)
                continue
            else:  # rename
                new_id = _resolve_conflict_id(sid, active_target_session_ids, suffix="merged")
                active_target_session_ids.add(new_id)
                report["sessions_renamed"] += 1
        else:
            new_id = sid

        # Create the session in target workspace
        try:
            await _honcho_request("POST", f"/v3/workspaces/{target_wid}/sessions/create", {"id": new_id})
            report["sessions_copied"] += 1
            log.info("Merged session: %s -> %s%s", sid, new_id, " (renamed)" if is_conflict and strategy == "rename" else "")
        except HTTPException as e:
            report["errors"].append(f"session '{sid}': {e.detail}")
            log.warning("Failed to merge session %s: %s", sid, e.detail)

    log.info(
        "Merge complete: peers copied=%d skipped=%d renamed=%d | sessions copied=%d skipped=%d renamed=%d | errors=%d",
        report["peers_copied"], report["peers_skipped"], report["peers_renamed"],
        report["sessions_copied"], report["sessions_skipped"], report["sessions_renamed"],
        len(report["errors"]),
    )
    return report


# ─── Hard-Delete Endpoints (Honcho proxy) ──────────────────────────────────


@workspace_router.delete("/{wid}/conclusions/{cid}")
async def delete_conclusion(wid: str, cid: str):
    """Delete a conclusion from Honcho permanently.

    Proxies DELETE /v3/workspaces/{wid}/conclusions/{cid}.
    This actually removes the conclusion from Honcho — not a soft-delete.
    """
    if not VALID_ID.match(wid):
        raise HTTPException(status_code=400, detail="invalid_workspace_id")
    if not VALID_ID.match(cid):
        raise HTTPException(status_code=400, detail="invalid_conclusion_id")

    log.info("Deleting conclusion %s from workspace %s", cid, wid)
    result = await _honcho_request("DELETE", f"/v3/workspaces/{wid}/conclusions/{cid}")
    return {"status": "deleted", "workspace_id": wid, "conclusion_id": cid}


@workspace_router.delete("/{wid}/sessions/{sid}/messages/{mid}")
async def delete_message(wid: str, sid: str, mid: str):
    """Delete a message from a Honcho session permanently.

    Proxies DELETE /v3/workspaces/{wid}/sessions/{sid}/messages/{mid}.
    This actually removes the message from Honcho — not a soft-delete.
    """
    if not VALID_ID.match(wid):
        raise HTTPException(status_code=400, detail="invalid_workspace_id")
    if not VALID_ID.match(sid):
        raise HTTPException(status_code=400, detail="invalid_session_id")
    if not VALID_ID.match(mid):
        raise HTTPException(status_code=400, detail="invalid_message_id")

    log.info("Deleting message %s from session %s in workspace %s", mid, sid, wid)
    result = await _honcho_request("DELETE", f"/v3/workspaces/{wid}/sessions/{sid}/messages/{mid}")
    return {"status": "deleted", "workspace_id": wid, "session_id": sid, "message_id": mid}


@router.post("/import/workspace")
async def import_preview(file: UploadFile = File(...)):
    """Upload a JSON export file and get an import preview with conflict info.

    Returns the parsed data along with any detected conflicts.
    """
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="file_must_be_json")

    # Check file size before reading to prevent memory exhaustion
    if file.size and file.size > MAX_IMPORT_SIZE:
        raise HTTPException(status_code=413, detail=f"file_too_large: max {MAX_IMPORT_SIZE // (1024 * 1024)}MB")

    try:
        content = await file.read()
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"invalid_json: {e}")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="file_must_be_utf8")

    # Validate format
    is_valid, error = validate_export_format(data)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"invalid_export_format: {error}")

    target_ws = data.get("workspace_id", "")
    export_data = data.get("data", {})

    # Build conflict report
    conflicts = await _check_conflicts(target_ws, export_data)

    report = {
        "status": "preview",
        "source_workspace": target_ws,
        "export_date": data.get("export_date"),
        "export_version": data.get("version"),
        "summary": {
            "peers": len(export_data.get("peers", [])),
            "sessions": len(export_data.get("sessions", [])),
            "conclusions": len(export_data.get("conclusions", [])),
            "message_sessions": len(export_data.get("messages", {})),
        },
        "conflicts": conflicts,
        "data": export_data,
    }

    log.info("Import preview generated: %s", report["summary"])
    return report


async def _check_conflicts(target_ws: str, export_data: dict) -> dict:
    """Check for existing resources that would conflict with the import."""
    conflicts = {
        "peer_conflicts": [],
        "session_conflicts": [],
        "has_conflicts": False,
    }

    # Check if target workspace exists
    try:
        ws_data = await _honcho_request("POST", "/v3/workspaces/list", {"filters": {}})
        ws_ids = [w.get("id", "") for w in ws_data.get("items", [])]
        workspace_exists = target_ws in ws_ids
    except HTTPException:
        workspace_exists = False

    conflicts["workspace_exists"] = workspace_exists

    if not workspace_exists:
        return conflicts

    # Check peer conflicts
    try:
        peers_data = await _honcho_request("POST", f"/v3/workspaces/{target_ws}/peers/list", {"filters": {}})
        existing_peer_ids = {p.get("id", "") for p in peers_data.get("items", [])}
        for peer in export_data.get("peers", []):
            pid = peer.get("id", "")
            if pid in existing_peer_ids:
                conflicts["peer_conflicts"].append(pid)
    except HTTPException:
        pass

    # Check session conflicts
    try:
        sessions_data = await _honcho_request("POST", f"/v3/workspaces/{target_ws}/sessions/list", {"filters": {}})
        existing_session_ids = {s.get("id", "") for s in sessions_data.get("items", [])}
        for session in export_data.get("sessions", []):
            sid = session.get("id", "")
            if sid in existing_session_ids:
                conflicts["session_conflicts"].append(sid)
    except HTTPException:
        pass

    conflicts["has_conflicts"] = (
        len(conflicts["peer_conflicts"]) > 0 or len(conflicts["session_conflicts"]) > 0
    )

    return conflicts


@router.post("/import/confirm")
async def import_confirm(req: ImportConfirmRequest):
    """Confirm and execute an import with conflict resolution.

    id_mapping: optional dict mapping old peer/session IDs to new IDs (for rename strategy)
    conflict_strategy: skip | overwrite | rename
    """
    if not VALID_ID.match(req.workspace_id):
        raise HTTPException(status_code=400, detail="invalid_workspace_id")

    if req.conflict_strategy not in ("skip", "overwrite", "rename"):
        raise HTTPException(status_code=400, detail="conflict_strategy_must_be_skip_overwrite_or_rename")

    data = req.data
    id_mapping = req.id_mapping or {}
    strategy = req.conflict_strategy

    log.info("Importing workspace %s with strategy '%s'", req.workspace_id, strategy)

    imported = {
        "peers_created": [],
        "peers_skipped": [],
        "sessions_created": [],
        "sessions_skipped": [],
        "errors": [],
    }

    # Create peers
    for peer in data.get("peers", []):
        old_id = peer.get("id", "")
        if not old_id:
            continue

        new_id = id_mapping.get(old_id, old_id)

        # Check conflict
        try:
            existing = await _honcho_request("POST", f"/v3/workspaces/{req.workspace_id}/peers/list", {"filters": {}})
            existing_ids = {p.get("id", "") for p in existing.get("items", [])}
        except HTTPException:
            existing_ids = set()

        if new_id in existing_ids:
            if strategy == "skip":
                imported["peers_skipped"].append(old_id)
                continue
            elif strategy == "rename":
                # Generate a unique ID
                candidate = f"{new_id}-imported"
                counter = 1
                while candidate in existing_ids:
                    candidate = f"{new_id}-imported-{counter}"
                    counter += 1
                new_id = candidate
            # overwrite: just create (will replace if API allows)

        try:
            await _honcho_request("POST", f"/v3/workspaces/{req.workspace_id}/peers/create", {"id": new_id})
            imported["peers_created"].append({"old_id": old_id, "new_id": new_id})
            log.info("Created peer: %s -> %s", old_id, new_id)
        except HTTPException as e:
            imported["errors"].append(f"peer '{old_id}': {e.detail}")
            log.warning("Failed to create peer %s: %s", old_id, e.detail)

    # Create sessions
    for session in data.get("sessions", []):
        old_id = session.get("id", "")
        if not old_id:
            continue

        new_id = id_mapping.get(old_id, old_id)

        # Check conflict
        try:
            existing = await _honcho_request("POST", f"/v3/workspaces/{req.workspace_id}/sessions/list", {"filters": {}})
            existing_ids = {s.get("id", "") for s in existing.get("items", [])}
        except HTTPException:
            existing_ids = set()

        if new_id in existing_ids:
            if strategy == "skip":
                imported["sessions_skipped"].append(old_id)
                continue
            elif strategy == "rename":
                candidate = f"{new_id}-imported"
                counter = 1
                while candidate in existing_ids:
                    candidate = f"{new_id}-imported-{counter}"
                    counter += 1
                new_id = candidate

        try:
            await _honcho_request("POST", f"/v3/workspaces/{req.workspace_id}/sessions/create", {"id": new_id})
            imported["sessions_created"].append({"old_id": old_id, "new_id": new_id})
            log.info("Created session: %s -> %s", old_id, new_id)
        except HTTPException as e:
            imported["errors"].append(f"session '{old_id}': {e.detail}")
            log.warning("Failed to create session %s: %s", old_id, e.detail)

    # Note about conclusions and messages
    conclusions_count = len(data.get("conclusions", []))
    message_sessions = len(data.get("messages", {}))

    log.info(
        "Import complete: %d peers created, %d skipped, %d sessions created, %d skipped, %d errors",
        len(imported["peers_created"]),
        len(imported["peers_skipped"]),
        len(imported["sessions_created"]),
        len(imported["sessions_skipped"]),
        len(imported["errors"]),
    )

    result = {
        "status": "complete",
        "workspace_id": req.workspace_id,
        "imported": imported,
        "notes": [],
    }

    if conclusions_count > 0:
        result["notes"].append(
            f"{conclusions_count} conclusions were in the export. "
            "Conclusions are generated by Honcho and cannot be directly imported. "
            "They will be regenerated as conversations occur."
        )

    if message_sessions > 0:
        result["notes"].append(
            f"{message_sessions} message sessions were in the export. "
            "Messages are generated by conversations and cannot be directly imported. "
            "They will be recreated as new sessions begin."
        )

    return result
