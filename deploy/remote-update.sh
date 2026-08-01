#!/usr/bin/env bash
# Runs on the Pi: pull latest main and rebuild the stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> git fetch/pull"
git fetch origin main
git checkout main
git pull --ff-only origin main

echo "==> docker compose up"
cd "$ROOT/deploy"
docker compose up -d --build --remove-orphans

echo "==> status"
docker compose ps
echo "Deploy finished."
