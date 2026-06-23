# Agent Configuration

## Project

Honcho Dashboard — web-based GUI for a self-hosted Honcho AI memory server.

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
- `routes/settings.py` — Settings API (read/write `.env`, restart containers)
- `static/app.js` — All frontend logic (7 tab modules, Modal, App)
- `static/style.css` — Dark theme CSS
- `static/index.html` — SPA shell with sidebar nav

## Conventions

- All API calls go through `/api/{path}` proxy to Honcho `/v3/{path}`
- `App.api()` is the centralized fetch helper (no body on GET, error parsing)
- XSS prevention: always use `App.escapeHtml()` / `App.escapeAttr()` in templates
- Event delegation pattern for click handlers (no inline onclick)
- Modal utility: `Modal.show()`, `Modal.confirm()`, `Modal.close()`
- Tabs: `OverviewTab`, `PeersTab`, `SessionsTab`, `ChatTab`, `ConclusionsTab`, `MessagesTab`, `SettingsTab`

## Honcho API Notes

- Peer card endpoint: `GET /v3/workspaces/{wid}/peers/{pid}/card` (GET only, not POST)
- Summaries endpoint: `GET /v3/workspaces/{wid}/sessions/{sid}/summaries` (GET only)
- Workspace delete: `DELETE /v3/workspaces/{wid}` (requires deleting all sessions first)
- Session delete: `DELETE /v3/workspaces/{wid}/sessions/{sid}`
- No peer delete endpoint exists in Honcho API

## Environment

- `HONCHO_URL` — Honcho server URL (default: `http://localhost:8000`)
- `HONCHO_API_KEY` — API key for Honcho auth
- `HONCHO_ENV_PATH` — Path to `.env` file (default: `/home/reposed/docker/honcho/.env`)
- `HONCHO_COMPOSE_DIR` — Docker Compose dir (default: `/home/reposed/docker/honcho`)
- `DASHBOARD_USER` / `DASHBOARD_PASSWORD` — Optional basic auth
