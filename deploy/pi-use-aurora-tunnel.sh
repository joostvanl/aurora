#!/usr/bin/env bash
set -euo pipefail

TUNNEL_NAME=aurora-cms
TUNNEL_ID=e2ca8d53-7b3a-4377-8444-0e70e6112a6e
HOSTS=(
  aurora.joostvanleeuwaarden.com
  aurora-admin.joostvanleeuwaarden.com
  aurora-api.joostvanleeuwaarden.com
)

echo "==> Ensure aurora-cms config"
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

echo "==> Restore n8n-tunnel local config (no Aurora hosts)"
sudo tee /etc/cloudflared/config.yml >/dev/null <<'EOF'
tunnel: n8n-tunnel
credentials-file: /home/joostvl/.cloudflared/f80e1671-69a5-4ab5-932f-ca0d9fd14069.json
ingress:
  - hostname: recepten.joostvanleeuwaarden.com
    service: http://localhost:8081
  - hostname: n8n.joostvanleeuwaarden.com
    service: http://localhost:5678
  - service: http_status:404
EOF
sudo systemctl restart cloudflared.service

echo "==> Point DNS CNAMEs at aurora-cms (overwrite)"
for h in "${HOSTS[@]}"; do
  echo "routing $h -> $TUNNEL_NAME"
  # Prefer UUID + overwrite flag forms Cloudflare CLI accepts
  cloudflared tunnel route dns --overwrite-dns "$TUNNEL_ID" "$h" \
    || cloudflared tunnel route dns -f "$TUNNEL_ID" "$h" \
    || TUNNEL_FORCE_PROVISIONING_DNS=true cloudflared tunnel route dns -f "$TUNNEL_NAME" "$h" \
    || true
done

echo "==> Restart aurora tunnel service"
sudo systemctl enable cloudflared-aurora.service
sudo systemctl restart cloudflared-aurora.service
sleep 3
systemctl is-active cloudflared-aurora.service
systemctl is-active cloudflared.service

echo "==> Local health"
curl -sS http://127.0.0.1:4000/health || true
echo
echo DONE
