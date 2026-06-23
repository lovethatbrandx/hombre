# Honcho Dashboard

> A self-hosted web UI for Honcho — because the official dashboard isn't self-hostable.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Vibe-coded](https://img.shields.io/badge/Vibe--coded%20with-OpenCode%20%2B%20MiMo-000000?style=for-the-badge)](https://opencode.ai)

## Why This Exists

Honcho is open source. You can run the server yourself. But the dashboard — the thing you actually interact with — is only available on their hosted platform. So if you self-host, you get an API endpoint and nothing else.

This project fixes that. A full GUI for managing workspaces, peers, sessions, chat, and configuration. No accounts, no hosted service, no gatekeeping.

It was built 100% using AI coding tools ([OpenCode](https://opencode.ai) + [MiMo](https://huggingface.co)) — no manual coding, no shame.

## Features

- **Overview** — workspace stats, peer/session/conclusion counts at a glance
- **Peers** — list participants, view representations and peer cards
- **Sessions** — list conversations, view messages and summaries
- **Chat** — dialectic queries against a peer's representation (SSE streaming)
- **Conclusions** — browse and semantic search reasoning/memory
- **Messages** — browse messages across all sessions
- **Settings** — configure LLM providers, embedding models, dialectic levels, and more

## Prerequisites

You need a running Honcho server. This dashboard is a frontend for it — it doesn't include the server itself.

- Honcho server running on `localhost:8000` (configurable via `HONCHO_URL`)
- See [honcho.dev](https://honcho.dev) for server setup instructions

## Quick Start

### Option 1: Python (System Install)

Requires Python 3.12+.

```bash
git clone https://github.com/lovethatbrandx/honcho-dashboard.git
cd honcho-dashboard
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set the required environment variables:

```bash
export HONCHO_ENV_PATH=/path/to/honcho/.env
export HONCHO_COMPOSE_DIR=/path/to/honcho
```

Then run:

```bash
python app.py
```

Dashboard runs at `http://localhost:5000`.

### Option 2: Docker

The repo includes a `docker-compose.yml` ready to go. Just edit the environment variables to match your setup:

```yaml
services:
  honcho-dashboard:
    build: .
    ports:
      - "5000:5000"
    environment:
      - HONCHO_URL=http://host.docker.internal:8000
      - HONCHO_ENV_PATH=/path/to/honcho/.env    # <-- change this
      - HONCHO_COMPOSE_DIR=/path/to/honcho      # <-- and this
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Then run:

```bash
docker compose up -d
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HONCHO_URL` | No | `http://localhost:8000` | Honcho server URL |
| `HONCHO_API_KEY` | No | *(empty)* | API key for Honcho server authentication |
| `HONCHO_ENV_PATH` | No | *(empty)* | Path to Honcho `.env` file (for settings tab) |
| `HONCHO_COMPOSE_DIR` | No | *(empty)* | Docker Compose working directory for Honcho server |
| `DASHBOARD_USER` | No | *(empty)* | HTTP Basic Auth username (empty = no auth) |
| `DASHBOARD_PASSWORD` | No | *(empty)* | HTTP Basic Auth password (empty = no auth) |

> **Note:** `HONCHO_ENV_PATH` and `HONCHO_COMPOSE_DIR` are optional — the app starts without them, but the Settings tab won't work until they're set.

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

## Contributing

Contributions welcome. This project was built entirely with AI coding tools — feel free to use the same approach.

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
