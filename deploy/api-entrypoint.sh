#!/bin/sh
set -e
cd /app
pnpm --filter @cms/api exec prisma migrate deploy
exec node apps/api/dist/index.js
