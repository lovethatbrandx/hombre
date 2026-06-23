# Honcho Dashboard

Web-based GUI for managing a self-hosted [Honcho](https://honcho.dev) AI memory server.

## Features

- **Overview** — workspace stats, peer/session/conclusion counts
- **Peers** — list, view representation and peer card
- **Sessions** — list, view messages and summaries
- **Chat** — dialectic query against a peer's representation (SSE streaming)
- **Conclusions** — browse and semantic search reasoning/memory
- **Messages** — browse messages across sessions
- **Settings** — configure LLM providers, embedding models, dialectic levels, and more

## Requirements

- Python 3.12+
- Honcho server running on `localhost:8000` (configurable via `HONCHO_URL`)
- Docker (for settings tab restart functionality)

## Quick Start

### Local

```bash
cd honcho-dashboard
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Dashboard runs at `http://localhost:5000`.

### Docker

```bash
docker compose up -d
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HONCHO_URL` | No | `http://localhost:8000` | Honcho server URL |
| `HONCHO_API_KEY` | No | *(empty)* | API key for Honcho server authentication |
| `HONCHO_ENV_PATH` | **Yes** | — | Path to Honcho `.env` file (for settings tab) |
| `HONCHO_COMPOSE_DIR` | **Yes** | — | Docker Compose working directory for Honcho server |
| `DASHBOARD_USER` | No | *(empty)* | HTTP Basic Auth username (empty = no auth) |
| `DASHBOARD_PASSWORD` | No | *(empty)* | HTTP Basic Auth password (empty = no auth) |

## Settings Tab

The settings tab reads and writes the Honcho `.env` configuration file. Changes require a Docker container restart to take effect.

### Configurable Sections

- **LLM Provider** — API key
- **Embeddings** — model, base URL, transport, vector dimensions
- **Deriver** — background worker model config
- **Dialectic Levels** — minimal/low/medium/high/max reasoning levels
- **Summary** — summary generation model config
- **Dream** — deduction and induction model configs

### How It Works

1. Settings are read from the `.env` file at `HONCHO_ENV_PATH`
2. Edits are tracked client-side (dirty state with orange dot indicators)
3. "Save Changes" writes to `.env` (creates `.env.bak` backup)
4. "Apply & Restart" writes to `.env` and runs `docker compose up -d --force-recreate`
5. "Restore Backup" reverts to the previous `.env.bak`

## Security

- **Basic Auth** — Set `DASHBOARD_USER` and `DASHBOARD_PASSWORD` to enable HTTP Basic Auth. Without these, the dashboard is unauthenticated.
- **Bind address** — Binds to `0.0.0.0:5000` (all interfaces). Use a firewall or reverse proxy for production.
- **API key exposure** — The LLM API key is visible in the settings tab. Ensure the dashboard is not publicly accessible.
- **Path traversal** — Proxy validates and URL-decodes paths before forwarding.
- **Security headers** — CSP, X-Content-Type-Options, X-Frame-Options.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Honcho server health check |
| `/api/settings/read` | GET | Read `.env` configuration |
| `/api/settings/write` | POST | Write to `.env` (with backup) |
| `/api/settings/restore` | POST | Restore from `.env.bak` |
| `/api/settings/restart` | POST | Restart Docker containers |
| `/api/{path}` | * | Proxy to Honcho `/v3/{path}` |

## Project Structure

```
honcho-dashboard/
├── app.py                 # FastAPI backend (auth, proxy, routes)
├── routes/
│   └── settings.py        # Settings API endpoints
├── static/
│   ├── index.html         # SPA shell
│   ├── style.css          # Dark theme (Honcho design system)
│   └── app.js             # Frontend logic (all tabs, modal, settings)
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

## License

MIT
