#!/usr/bin/env bash
# Runs on the Pi: pull latest main and rebuild the stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> git fetch/pull"
git fetch origin main
git checkout main
# Drop local noise on deploy scripts (e.g. chmod) so pull can fast-forward.
git restore --worktree --staged -- deploy/api-entrypoint.sh deploy/remote-update.sh 2>/dev/null \
  || git checkout -- deploy/api-entrypoint.sh deploy/remote-update.sh
git pull --ff-only origin main
chmod +x deploy/remote-update.sh deploy/api-entrypoint.sh

echo "==> docker compose up"
cd "$ROOT/deploy"
docker compose up -d --build --remove-orphans

echo "==> status"
docker compose ps
echo "Deploy finished."
