#!/bin/sh
set -e
if [ -n "$DATABASE_URL" ]; then
  echo "Running database migrations (Kysely)..."
  npx tsx scripts/migrate.ts || echo "Warning: migrations failed — ensure Postgres is reachable."
fi
exec ./node_modules/.bin/next start
