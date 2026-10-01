#!/usr/bin/env bash
# Deploy JTAS on the VM.
#
#   ./scripts/deploy.sh            pull, build, migrate, rolling restart
#   ./scripts/deploy.sh --rollback previous image, no migration, no pull
#
# Order matters. Migrations run *before* the new image serves traffic, and the
# worker stops first: a schema change applied while the sweeper is mid-batch is
# the one failure mode that writes wrong data rather than merely erroring.
#
# The env file is .env on the server. This script refuses the laptop
# development file, which points at localhost and Colima.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file ${ENV_FILE}"
ROLLBACK=false
[[ "${1:-}" == "--rollback" ]] && ROLLBACK=true

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No ${ENV_FILE}. Copy deploy/server.env.example and fill it in on the server." >&2
  exit 1
fi

if grep -qE 'localhost:5432|JTAS_DOCKER_CONTEXT=colima|APP_BASE_URL="?http://localhost|BACKUP_S3_SECRET_KEY|AWS_SECRET_ACCESS_KEY' "$ENV_FILE"; then
  echo "Refusing: ${ENV_FILE} looks like the laptop file, or it contains AWS keys. Backups use the instance role." >&2
  exit 1
fi

missing=()
for key in JTAS_DOMAIN ACME_EMAIL POSTGRES_PASSWORD JWT_SECRET REFRESH_SECRET MINIO_ROOT_PASSWORD BACKUP_BUCKET; do
  grep -qE "^${key}=.+" "$ENV_FILE" || missing+=("$key")
done
if (( ${#missing[@]} )); then
  echo "Missing in ${ENV_FILE}: ${missing[*]}" >&2
  exit 1
fi

# Fresh production secrets. The example placeholder and a secret shared with
# the refresh token are both refused; the values themselves are not printed.
value_of() {
  grep -E "^${1}=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}
jwt="$(value_of JWT_SECRET)"
refresh="$(value_of REFRESH_SECRET)"
if [[ ${#jwt} -lt 32 || ${#refresh} -lt 32 ]]; then
  echo "JWT_SECRET and REFRESH_SECRET must each be at least 32 characters." >&2
  exit 1
fi
if [[ "$jwt" == "$refresh" || "$jwt" == change-me* || "$refresh" == change-me* ]]; then
  echo "Generate new JWT_SECRET and REFRESH_SECRET. Do not reuse the dev ones." >&2
  exit 1
fi

if $ROLLBACK; then
  say "Rolling back to the previous image"
  if ! docker image inspect jtas:previous >/dev/null 2>&1; then
    echo "No jtas:previous image. Nothing to roll back to." >&2
    exit 1
  fi
  docker tag jtas:previous jtas:latest
  # Deliberately no migration and no git pull: rolling a migration back is a
  # restore, not a deploy. See docs/DEPLOY.md.
  echo "Note: the schema is NOT rolled back. If the bad release migrated, restore instead."
else
  say "Pulling origin/main"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is dirty. Commit or stash on the server before deploying." >&2
    exit 1
  fi
  git pull --ff-only origin main

  say "Keeping the current image as jtas:previous"
  docker image inspect jtas:latest >/dev/null 2>&1 && docker tag jtas:latest jtas:previous || true

  say "Pulling base images"
  $COMPOSE pull caddy db redis minio minio-init

  say "Building app and backup"
  $COMPOSE build app backup
fi

say "Starting database, Redis and MinIO"
$COMPOSE up -d db redis minio
$COMPOSE up -d --no-deps minio-init

say "Stopping the worker"
# First, so no sweep is mid-batch while the schema changes. The worker waits up
# to 30 s for its in-flight batch on SIGTERM.
$COMPOSE stop worker || true

say "Applying migrations"
$COMPOSE run --rm --no-deps app node_modules/.bin/prisma migrate deploy

say "Restarting the app"
# --no-deps so the database is not restarted underneath it.
$COMPOSE up -d --no-deps --force-recreate app

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

say "Starting the worker, Caddy and the backup sidecar"
$COMPOSE up -d --no-deps --force-recreate worker
$COMPOSE up -d caddy backup

say "Done"
$COMPOSE ps
domain="$(value_of JTAS_DOMAIN)"
echo
echo "Health:   curl -s https://${domain}/api/health"
echo "Worker:   look for schedulerHeartbeatAgeSeconds as a small number, not null"
echo "Rollback: ./scripts/deploy.sh --rollback"
