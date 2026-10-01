#!/usr/bin/env bash
# Deploy JTAS on the VM.
#
#   ./scripts/deploy.sh            pull the Mac-built image, build backup, migrate
#   ./scripts/deploy.sh --rollback pull the previous GHCR digest, no migration
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
for key in JTAS_DOMAIN ACME_EMAIL POSTGRES_PASSWORD JWT_SECRET REFRESH_SECRET MINIO_ROOT_PASSWORD BACKUP_BUCKET GHCR_USER GHCR_PULL_TOKEN JTAS_IMAGE; do
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

# Registry digest of the app image currently running, if there is one.
# Written to .deploy/ so --rollback can pull that exact image later.
PREVIOUS_FILE=".deploy/previous-image"
CURRENT_FILE=".deploy/current-image"
mkdir -p .deploy

is_digest_ref() {
  [[ "$1" =~ ^ghcr\.io/nandeshkanagaraju/jtas@sha256:[0-9a-f]{64}$ ]]
}

ghcr_login() {
  local user token
  user="$(value_of GHCR_USER)"
  token="$(value_of GHCR_PULL_TOKEN)"
  printf '%s' "$token" | docker login ghcr.io -u "$user" --password-stdin >/dev/null
}

repo_digest_of_running_app() {
  local cid image
  cid="$($COMPOSE ps -aq app 2>/dev/null | head -n 1 || true)"
  [[ -z "${cid:-}" ]] && return 0
  image="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || true)"
  [[ -z "${image:-}" ]] && return 0
  docker image inspect -f '{{index .RepoDigests 0}}' "$image" 2>/dev/null || true
}

if $ROLLBACK; then
  if [[ ! -f "$PREVIOUS_FILE" ]]; then
    echo "No ${PREVIOUS_FILE}. Deploy a second release before rolling back." >&2
    exit 1
  fi
  prev="$(tr -d '[:space:]' < "$PREVIOUS_FILE")"
  if ! is_digest_ref "$prev"; then
    echo "Refusing rollback. ${PREVIOUS_FILE} is not a ghcr.io digest." >&2
    exit 1
  fi
  say "Rolling back to ${prev}"
  ghcr_login
  docker pull "$prev"
  export JTAS_IMAGE="$prev"
  if [[ -f "$CURRENT_FILE" ]]; then
    cur="$(tr -d '[:space:]' < "$CURRENT_FILE")"
    if [[ "$cur" != "$prev" ]] && is_digest_ref "$cur"; then
      printf '%s\n' "$cur" > "$PREVIOUS_FILE"
    fi
  fi
  printf '%s\n' "$prev" > "$CURRENT_FILE"
  # Deliberately no git pull and no migration: rolling a migration back is a
  # restore, not a deploy. See docs/DEPLOY.md.
  echo "Note: the schema is NOT rolled back. If the bad release migrated, restore instead."
else
  image="$(value_of JTAS_IMAGE)"
  if [[ "$image" != ghcr.io/nandeshkanagaraju/jtas:* && "$image" != ghcr.io/nandeshkanagaraju/jtas@sha256:* ]]; then
    echo "JTAS_IMAGE must be ghcr.io/nandeshkanagaraju/jtas:<tag> or @sha256:<digest>." >&2
    exit 1
  fi
  export JTAS_IMAGE="$image"

  say "Pulling origin/main"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is dirty. Commit or stash on the server before deploying." >&2
    exit 1
  fi
  git pull --ff-only origin main

  running="$(repo_digest_of_running_app || true)"
  if [[ -n "${running:-}" ]]; then
    if ! is_digest_ref "$running"; then
      echo "The running app image has no GHCR digest (${running}). Refusing to replace it." >&2
      exit 1
    fi
    printf '%s\n' "$running" > "$PREVIOUS_FILE"
    say "Previous image is ${running}"
  fi

  say "Logging in to GHCR and pulling the app image"
  ghcr_login
  $COMPOSE pull caddy db redis minio minio-init app

  pulled="$(docker image inspect "$image" -f '{{index .RepoDigests 0}}' 2>/dev/null || true)"
  if ! is_digest_ref "$pulled"; then
    echo "Pulled image has no GHCR digest. Refusing to continue." >&2
    exit 1
  fi
  printf '%s\n' "$pulled" > "$CURRENT_FILE"
  say "App image is ${pulled}"

  say "Building the backup image"
  $COMPOSE build backup
fi

say "Starting database, Redis and MinIO"
$COMPOSE up -d db redis minio
$COMPOSE up -d --no-deps minio-init

say "Stopping the worker"
# First, so no sweep is mid-batch while the schema changes. The worker waits up
# to 30 s for its in-flight batch on SIGTERM.
$COMPOSE stop worker || true

if $ROLLBACK; then
  say "Skipping migrations"
else
  say "Applying migrations"
  $COMPOSE run --rm --no-deps app node_modules/.bin/prisma migrate deploy
fi

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
if [[ -f "$PREVIOUS_FILE" ]]; then
  echo "Rollback: ./scripts/deploy.sh --rollback"
  echo "          pulls $(tr -d '[:space:]' < "$PREVIOUS_FILE")"
else
  echo "Rollback: unavailable until this box has a previous GHCR digest"
fi
