#!/bin/sh
# Migrate then start API (prod entrypoint).
set -e

echo "[entrypoint] Running database migrations..."
node scripts/migrate.js

echo "[entrypoint] Starting api-service..."
exec node dist/index.js
