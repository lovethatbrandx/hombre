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
python3 -m py_compile routes/security.py
python3 -m py_compile routes/deletes.py
python3 -m py_compile routes/notifications.py
python3 -m py_compile routes/export.py
node --check static/app.js
```

## File Locations

- `app.py` — FastAPI backend (auth, proxy, routes, pagination)
- `routes/__init__.py` — Package marker
- `routes/supabase.py` — Supabase client initialization (optional integration)
- `routes/security.py` — Security middleware (rate limiting, RBAC auth, Supabase JWT auth, request logging, shared user cache)
- `routes/settings.py` — Settings API (read/write `.env`, restart containers, audit logging, user management)
- `routes/deletes.py` — Soft-delete registry (Supabase or JSON file storage)
- `routes/notifications.py` — Notification system (Supabase or JSON file storage)
- `routes/export.py` — Export/Import API (workspace data to/from portable JSON)
- `schema/supabase.sql` — SQL schema for Supabase tables (soft_deletes, notifications, audit_logs)
- `data/deleted.json` — Soft-deleted resource IDs (auto-created, used when Supabase not configured)
- `data/notifications.json` — Recent notifications (auto-created, used when Supabase not configured)
- `static/app.js` — All frontend logic (7 tab modules, Modal, App, notifications, 429 handling, credentials UI)
- `static/style.css` — Dark theme CSS (includes credential row styles)
- `static/index.html` — SPA shell with sidebar nav and notification bell
- `Dockerfile` — Python 3.12-slim, EXPOSE 5000 (built from dev repo, pushed to ghcr.io/lovethatbrandx/hombre/hombre:latest)
- `docker-compose.yml` — Port 5000:5000, healthcheck (also exists in `~/docker/hombre/` deployment folder)
- `docs/API.md` — Complete API reference (all endpoints, request/response formats)
- `docs/FEATURES.md` — Feature documentation (workspace, peers, sessions, chat, conclusions, export/import)
- `docs/DEPLOYMENT.md` — Deployment guide (Docker, local dev, env vars, troubleshooting)

## Delegation Rules (Richard is the Architect, Not the Implementer)

**Richard does NOT write specialist code.** Richard is the conductor, the maestro, the head of the table. His job is to:
1. **Understand the problem** — read files, trace code, identify root causes
2. **Design the solution** — architecture decisions, API contracts, data flow
3. **Delegate to specialists** — assign the right person for each piece
4. **Review and integrate** — make sure everything fits together

**Specialists:**
- **@gilfoyle** — Backend specialist (Python, FastAPI, routes, APIs, infrastructure, security)
- **@dinesh** — Frontend specialist (JavaScript, CSS, HTML, UI/UX, Compose)

**When to delegate:**
- Backend code changes → @gilfoyle
- Frontend code changes → @dinesh
- Finding bugs → @bighead (testing), @jian-yang (slop detection)
- Documentation → @jared
- Business logic → @monica
- Docker/deployment → @docker
- Multi-step complex tasks → @general

**Richard's exceptions (things he can do himself):**
- Reading files to understand the codebase
- Creating todo lists and planning
- Summarizing results back to the user
- Making architecture decisions
- Debugging by reading code (not modifying)
- Writing code ONLY when it's specifically out of any specialist's wheelhouse (e.g., glue code, one-off scripts, things that don't fit backend/frontend)

**If you catch yourself writing more than a few lines of specialist code → STOP and delegate.**

## Conventions

- All API calls go through `/api/{path}` proxy to Honcho `/v3/{path}`
- `App.api()` is the centralized fetch helper (no body on GET/HEAD/DELETE, error parsing)
- XSS prevention: always use `App.escapeHtml()` / `App.escapeAttr()` in templates
- Event delegation pattern for click handlers (no inline onclick)
- Modal utility: `Modal.show()`, `Modal.confirm()`, `Modal.close()`
- Toast notifications: `App.toast(message, type)` for user feedback
- Tabs: `OverviewTab`, `PeersTab`, `SessionsTab`, `ChatTab`, `ConclusionsTab`, `MessagesTab`, `SettingsTab`
- Each tab fetches its own data directly from the API (no shared state dependency)
- OverviewTab fetches peers/sessions/conclusions independently on render

## Honcho API Notes

- Peer card endpoint: `GET /v3/workspaces/{wid}/peers/{pid}/card` (GET only, not POST)
- Chat endpoint: `POST /v3/workspaces/{wid}/peers/{pid}/chat` — queries a peer's representation using natural language; supports `reasoning_level` (minimal/low/medium/high/max) and `stream: true` for SSE
- Summaries endpoint: `GET /v3/workspaces/{wid}/sessions/{sid}/summaries` (GET only)
- Workspace delete: `DELETE /v3/workspaces/{wid}` (requires deleting all sessions first)
- Session delete: `DELETE /v3/workspaces/{wid}/sessions/{sid}`
- No peer delete endpoint exists in Honcho API
- No message delete endpoint exists in Honcho API
- No conclusion delete endpoint exists in Honcho API

## Honcho API Limitations — DELETE Operations

| Resource     | DELETE Supported? | Workaround              |
|-------------|-------------------|-------------------------|
| Workspace   | Yes               | Must delete sessions first |
| Session     | Yes               | None needed             |
| Peer        | No                | Soft-delete locally (`routes/deletes.py`) |
| Message     | No                | Soft-delete locally (`routes/deletes.py`) |
| Conclusion  | No                | Soft-delete locally (`routes/deletes.py`) |

## New API Endpoints (Hombre-specific, not proxied to Honcho)

### Soft Delete (`routes/deletes.py`)
- `POST /api/soft-delete` — Mark resource as deleted (body: `{type, id, workspace_id}`)
- `POST /api/soft-delete/check` — Check if resources are deleted (body: `{type, ids, workspace_id}`)
- `GET /api/soft-delete/list` — List deleted resources (optional `?type=` filter)
- `POST /api/soft-delete/restore` — Restore a deleted resource

### Pagination Helpers (`app.py`)
- `POST /api/workspaces/{wid}/conclusions/list/all` — Fetch ALL conclusions (paginated, up to 5000)
- `POST /api/workspaces/{wid}/sessions/{sid}/messages/list/all` — Fetch ALL messages (paginated, up to 5000)

### Notifications (`routes/notifications.py`)
- `GET /api/notifications` — Get active notifications (optional `?type=`, `?workspace_id=`)
- `POST /api/notifications/dismiss` — Dismiss a notification (body: `{id}`)

### Export/Import (`routes/export.py`)
- `POST /api/export/workspace/{wid}` — Export entire workspace (peers, sessions, conclusions, messages)
- `POST /api/export/peer/{wid}/{pid}` — Export single peer's data (info, representation, card, conclusions)
- `POST /api/export/conclusions/{wid}` — Export all conclusions for workspace
- `POST /api/export/import/workspace` — Upload JSON export file for preview and conflict detection (multipart form)
- `POST /api/export/import/confirm` — Confirm import with conflict resolution (body: `{workspace_id, data, id_mapping, conflict_strategy}`)

### Workspace Merge (`routes/export.py`)
- `POST /api/workspaces/merge/preview` — Preview merge conflicts (body: `{source_workspace_id, target_workspace_id, conflict_strategy}`)
- `POST /api/workspaces/merge` — Execute merge with conflict resolution (body: `{source_workspace_id, target_workspace_id, conflict_strategy}`)

### Supabase Auth (`routes/security.py` — when Supabase configured)
- `GET /api/auth/status` — Check if Supabase is configured and get current user
- `POST /api/auth/login` — Login with email/password (body: `{email, password}`)
- `POST /api/auth/magic-link` — Send magic link (body: `{email}`)
- `POST /api/auth/logout` — Logout current user

### User Management (`routes/settings.py`)
- `GET /api/settings/users` — List dashboard users (cached in memory)
- `POST /api/settings/users` — Update dashboard users (body: `{users: [{username, password, role}, ...]}`)

## Environment

- `HONCHO_URL` — Honcho server URL (default: `http://localhost:8000`)
- `HONCHO_API_KEY` — API key for Honcho auth
- `HONCHO_ENV_PATH` — Path to `.env` file (optional, settings tab returns 403 if unset)
- `HONCHO_COMPOSE_DIR` — Docker Compose dir (optional, settings tab returns 403 if unset)
- `DASHBOARD_USER` / `DASHBOARD_PASSWORD` — Single-user basic auth (backward compat)
- `DASHBOARD_ROLE` — Role for single user (default: `admin`)
- `DASHBOARD_USERS` — Multi-user config: `user1:pass1:admin,user2:pass2:viewer`
- `HOMBRE_LOG_DIR` — Log directory (default: `logs`)
- `SUPABASE_URL` — Supabase project URL (optional, enables Supabase integration)
- `SUPABASE_KEY` — Supabase anon/public key (required with SUPABASE_URL)
- `SUPABASE_SERVICE_KEY` — Supabase service role key (optional, for admin operations)

## Security Notes

### Authentication & RBAC

- **Roles**: `admin` (full), `editor` (create/edit/read), `viewer` (read-only)
- Single-user mode: `DASHBOARD_USER` + `DASHBOARD_PASSWORD` + `DASHBOARD_ROLE`
- Multi-user mode: `DASHBOARD_USERS=user1:pass1:admin,user2:pass2:viewer`
- No auth configured → open access (with startup warning)
- Basic Auth uses `hmac.compare_digest` for timing-safe comparison
- Role checked per-request: settings/write endpoints require `settings` permission, DELETE requires `delete` permission

### Rate Limiting (in-memory, resets on restart)

| Endpoint | Limit |
|---|---|
| `/api/settings/*` | 30 req/min |
| `/api/workspaces/*` | 30 req/min |
| `/api/peers/*` | 30 req/min |
| `/api/sessions/*` | 30 req/min |
| `/api/messages/*` | 30 req/min |
| `/api/chat` | 5 req/min |
| Everything else | 60 req/min |

- Returns `429 Too Many Requests` with `Retry-After` header
- Rate limit key: client IP + auth token prefix
- Frontend gracefully handles 429 responses (preserves existing data, shows toast notification)
- The `/` index route does not require authentication (no Basic auth prompt on page load)

### Request Logging

- All API requests logged to `logs/access.log`
- Format: `ISO_TIMESTAMP METHOD STATUS DURATION path user=NAME detail`
- Rotates at 5 MB, keeps last 5 rotated files
- Static asset requests are not logged

### Audit Logging

- Settings operations logged to `logs/audit.log`
- Tracks: `settings.read`, `settings.write`, `settings.backup`, `settings.restore`, `settings.restart`
- Includes username and changed keys

### Security Headers

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (HTTPS only)
- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src self fonts.googleapis.com fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Path Traversal Protection

- Iterative URL-decoding + `..`/`\x00`/leading-`/` checks

### Settings Write Protection

- `WRITABLE_KEYS` allowlist (only known env keys)
- Newline injection prevention (`sanitize_value`)
- Backup created on every write
- Audit log records who changed what

### Frontend

- `App.escapeHtml()` escapes `'` to `&#39;` (prevents attribute injection)
