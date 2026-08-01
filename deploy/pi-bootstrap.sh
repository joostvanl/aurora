#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/aurora"
git pull --ff-only origin main

PW="$(openssl rand -hex 24)"
JWT="$(openssl rand -hex 32)"
SITEKEY="$(openssl rand -hex 12)"

cat > deploy/.env <<EOF
POSTGRES_USER=cms
POSTGRES_PASSWORD=${PW}
POSTGRES_DB=cms
CMS_JWT_SECRET=${JWT}
PUBLIC_API_URL=https://aurora-api.joostvanleeuwaarden.com
CORS_ORIGINS=https://aurora-admin.joostvanleeuwaarden.com,https://aurora.joostvanleeuwaarden.com
NEXT_PUBLIC_CMS_API_URL=https://aurora-api.joostvanleeuwaarden.com
NEXT_PUBLIC_CMS_SITE_KEY=${SITEKEY}
CMS_AI_BASE_URL=
CMS_AI_API_KEY=
CMS_AI_MODEL=
CLOUDFLARE_TUNNEL_TOKEN=
EOF
chmod 600 deploy/.env
echo "Wrote deploy/.env"
echo "SITEKEY=${SITEKEY}"

sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak.aurora
sudo tee /etc/cloudflared/config.yml >/dev/null <<'EOF'
tunnel: n8n-tunnel
credentials-file: /home/joostvl/.cloudflared/f80e1671-69a5-4ab5-932f-ca0d9fd14069.json
ingress:
  - hostname: recepten.joostvanleeuwaarden.com
    service: http://localhost:8081
  - hostname: n8n.joostvanleeuwaarden.com
    service: http://localhost:5678
  - hostname: aurora.joostvanleeuwaarden.com
    service: http://localhost:3010
  - hostname: aurora-admin.joostvanleeuwaarden.com
    service: http://localhost:3001
  - hostname: aurora-api.joostvanleeuwaarden.com
    service: http://localhost:4000
  - service: http_status:404
EOF

cloudflared tunnel route dns n8n-tunnel aurora.joostvanleeuwaarden.com || true
cloudflared tunnel route dns n8n-tunnel aurora-admin.joostvanleeuwaarden.com || true
cloudflared tunnel route dns n8n-tunnel aurora-api.joostvanleeuwaarden.com || true

sudo systemctl restart cloudflared.service
sleep 2
systemctl is-active cloudflared.service
echo DONE_SETUP
