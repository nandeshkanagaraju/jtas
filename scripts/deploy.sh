#!/usr/bin/env bash
# Deploy JTAS on the VPS (build spec M11.5).
#
#   ./scripts/deploy.sh            build, migrate, restart
#   ./scripts/deploy.sh --rollback previous image, no migration
#
# Order matters. Migrations run *before* the new image serves traffic, and the
# worker stops first: a schema change applied while the sweeper is mid-batch is
# the one failure mode that writes wrong data rather than merely erroring.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
ROLLBACK=false
[[ "${1:-}" == "--rollback" ]] && ROLLBACK=true

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [[ ! -f .env.production ]]; then
  echo "No .env.production. Copy .env.production.example and fill it in." >&2
  exit 1
fi

# Refuse to deploy a half-configured stack rather than discover it at 6 PM.
missing=()
for key in JTAS_DOMAIN ACME_EMAIL POSTGRES_PASSWORD JWT_SECRET REFRESH_SECRET MINIO_ROOT_PASSWORD; do
  grep -qE "^${key}=.+" .env.production || missing+=("$key")
done
if (( ${#missing[@]} )); then
  echo "Missing in .env.production: ${missing[*]}" >&2
  exit 1
fi

if $ROLLBACK; then
  say "Rolling back to the previous image"
  if ! docker image inspect jtas:previous >/dev/null 2>&1; then
    echo "No jtas:previous image. Nothing to roll back to." >&2
    exit 1
  fi
  docker tag jtas:previous jtas:latest
  # Deliberately no migration: rolling a migration back is a restore, not a
  # deploy, and pretending otherwise loses data. See RUNBOOK.md.
  echo "Note: the schema is NOT rolled back. If the bad release migrated, restore instead."
else
  say "Keeping the current image as jtas:previous"
  docker image inspect jtas:latest >/dev/null 2>&1 && docker tag jtas:latest jtas:previous || true

  say "Building"
  $COMPOSE build app
fi

say "Stopping the worker"
# First, so no sweep is mid-batch while the schema changes. The worker waits up
# to 30 s for its in-flight batch on SIGTERM.
$COMPOSE stop worker || true

say "Applying migrations"
$COMPOSE run --rm --no-deps app node_modules/.bin/prisma migrate deploy

say "Restarting the app"
# --no-deps so the database is not restarted underneath it.
$COMPOSE up -d --no-deps app

say "Waiting for health"
for i in $(seq 1 30); do
  if $COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "healthy after ${i}0s"
    break
  fi
  if (( i == 30 )); then
    echo "App did not become healthy. Logs:" >&2
    $COMPOSE logs --tail 40 app >&2
    exit 1
  fi
  sleep 10
done

say "Starting the worker"
$COMPOSE up -d --no-deps worker

say "Done"
$COMPOSE ps
echo
echo "Health:  curl -s https://\$JTAS_DOMAIN/api/health | jq"
echo "Rollback: ./scripts/deploy.sh --rollback"
