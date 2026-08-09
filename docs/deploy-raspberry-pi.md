# Deploy Aurora on a Raspberry Pi 5 (Docker + Cloudflare Tunnel)

Automatic deploys: every push to `main` runs [`.github/workflows/deploy-pi.yml`](../.github/workflows/deploy-pi.yml), which SSHs into the Pi and runs [`deploy/remote-update.sh`](../deploy/remote-update.sh) (`git pull` + `docker compose up -d --build`).

## One-time: Pi

1. Install **64-bit** Raspberry Pi OS, Docker, and Git.
2. Enable SSH; create a deploy user (example: `aurora`).
3. Clone the repo (once):

```bash
git clone https://github.com/joostvanl/aurora.git ~/aurora
cd ~/aurora/deploy
cp .env.example .env
nano .env   # fill secrets and public HTTPS URLs
```

4. **Tunnel:** either use an existing Pi `cloudflared` (recommended if you already have `/etc/cloudflared`), or start Compose with `--profile managed-tunnel` and a `CLOUDFLARE_TUNNEL_TOKEN`.
5. Public hostnames (example with host cloudflared → localhost ports published by Compose):

| Hostname | Service URL |
|----------|-------------|
| `aurora-api.<domain>` | `http://localhost:4000` |
| `aurora-admin.<domain>` | `http://localhost:3001` |
| `aurora.<domain>` | `http://localhost:3010` |

Host `:3000` is avoided (often Grafana). Web listens on **3010** on the Pi loopback.

6. First start (or wait for the first Actions deploy):

```bash
chmod +x remote-update.sh
./remote-update.sh
```

7. In Admin → **Website**, set **Allowed origins** to your public `https://www…` / `https://admin…` URLs (and keep `CORS_ORIGINS` in `.env` in sync).

## One-time: GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Example |
|--------|---------|
| `PI_HOST` | `192.168.1.50` or a public/Tailscale hostname |
| `PI_USER` | `aurora` |
| `PI_SSH_KEY` | Private key (full PEM) whose **public** key is in `~/.ssh/authorized_keys` on the Pi |
| `PI_SSH_PORT` | `22` (optional; defaults to 22) |
| `PI_APP_DIR` | `/home/aurora/aurora` (optional; defaults to `$HOME/aurora`) |

Generate a deploy key on your PC if needed:

```bash
ssh-keygen -t ed25519 -f aurora-pi-deploy -N ""
# public → Pi authorized_keys
# private → GitHub secret PI_SSH_KEY
```

Ensure the Pi user can run Docker without sudo (`usermod -aG docker aurora`, then re-login).

## What gets deployed

From [`deploy/docker-compose.yml`](../deploy/docker-compose.yml):

- `postgres` — data in Docker volume `aurora_pgdata`
- `api` — migrates on start, uploads in `aurora_uploads`
- `admin` / `web` — Next.js standalone
- `cloudflared` — outbound tunnel only (no inbound ports required)

`NEXT_PUBLIC_*` values are **build args**. After changing them in `deploy/.env`, trigger a rebuild (push to `main` or `workflow_dispatch`).

## Logs and observability

API logs are structured JSON (Pino). Set `LOG_LEVEL=info` (or `debug` / `warn`) in `deploy/.env`. Each request has an `X-Request-Id` (also on error JSON as `requestId`) — grep Docker logs with that id:

```bash
cd ~/aurora/deploy
docker compose logs -f api | grep '<requestId>'
```

Scheduled AI tasks (Settings → Taken) run inside the API process. Keep `CMS_SCHEDULED_TASKS=1` (default) or set `CMS_SCHEDULED_TASKS=0` to disable the poller. Grep for `scheduled task` in API logs when diagnosing runs.

There is **no** central log aggregation (Loki/Datadog/Sentry) on the Pi yet; `docker compose logs` is the operator surface.

## Manual deploy

```bash
cd ~/aurora/deploy
./remote-update.sh
```

Or in GitHub: **Actions → Deploy to Raspberry Pi → Run workflow**.
