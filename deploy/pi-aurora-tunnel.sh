#!/usr/bin/env bash
set -euo pipefail

TOKEN="$(cloudflared tunnel token aurora-cms)"
ENV_FILE="$HOME/aurora/deploy/.env"
tmp="$(mktemp)"
awk -v token="$TOKEN" '
  BEGIN { done=0 }
  /^CLOUDFLARE_TUNNEL_TOKEN=/ {
    print "CLOUDFLARE_TUNNEL_TOKEN=" token
    done=1
    next
  }
  { print }
  END {
    if (!done) print "CLOUDFLARE_TUNNEL_TOKEN=" token
  }
' "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo token_written

# Re-point DNS to aurora-cms (may already exist from n8n-tunnel — delete/overwrite)
cloudflared tunnel route dns aurora-cms aurora.joostvanleeuwaarden.com || true
cloudflared tunnel route dns aurora-cms aurora-admin.joostvanleeuwaarden.com || true
cloudflared tunnel route dns aurora-cms aurora-api.joostvanleeuwaarden.com || true

TUNNEL_ID="$(cloudflared tunnel list | awk '/aurora-cms/ {print $1; exit}')"
mkdir -p "$HOME/.config/aurora-cms"
cat > "$HOME/.config/aurora-cms/config.yml" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: /home/joostvl/.cloudflared/${TUNNEL_ID}.json
ingress:
  - hostname: aurora.joostvanleeuwaarden.com
    service: http://localhost:3010
  - hostname: aurora-admin.joostvanleeuwaarden.com
    service: http://localhost:3001
  - hostname: aurora-api.joostvanleeuwaarden.com
    service: http://localhost:4000
  - service: http_status:404
EOF

# Prefer host cloudflared for aurora (same pattern as other services),
# so Compose does not need the managed-tunnel profile.
sudo tee /etc/systemd/system/cloudflared-aurora.service >/dev/null <<EOF
[Unit]
Description=cloudflared tunnel for Aurora CMS
After=network-online.target
Wants=network-online.target

[Service]
TimeoutStartSec=15
Type=notify
ExecStart=/usr/bin/cloudflared --no-autoupdate --config /home/joostvl/.config/aurora-cms/config.yml tunnel run
Restart=on-failure
RestartSec=5s
User=joostvl
Group=joostvl

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-aurora.service
sleep 2
systemctl is-active cloudflared-aurora.service
journalctl -u cloudflared-aurora -n 15 --no-pager
echo DONE_AURORA_TUNNEL
