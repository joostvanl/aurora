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

4. Create a Cloudflare Tunnel (Zero Trust → Networks → Tunnels). Put the token in `CLOUDFLARE_TUNNEL_TOKEN`.
5. Public hostnames on that tunnel (service names are Docker DNS names):

| Hostname | Service URL |
|----------|-------------|
| `api.your.domain` | `http://api:4000` |
| `admin.your.domain` | `http://admin:3001` |
| `www.your.domain` | `http://web:3000` |

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

## Manual deploy

```bash
cd ~/aurora/deploy
./remote-update.sh
```

Or in GitHub: **Actions → Deploy to Raspberry Pi → Run workflow**.
