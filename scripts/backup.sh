#!/bin/sh
# Nightly pg_dump to the object store, with retention (SDD 10.4).
#
# Runs as a long-lived container that sleeps until the next BACKUP_AT_UTC
# rather than as a host cron entry: the backup then ships with the stack and
# cannot be forgotten when the VPS is rebuilt. Restore is documented and
# rehearsed in docs/RUNBOOK.md — a backup nobody has restored is a hope.
set -eu

RETENTION="${BACKUP_RETENTION_DAYS:-30}"
BUCKET="${BACKUP_BUCKET:-jtas-backups}"
AT="${BACKUP_AT_UTC:-19:30}"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup: $*"; }

# `mc` is baked into the image (Dockerfile.backup) rather than fetched at boot.
if ! command -v mc >/dev/null 2>&1; then
  log "FATAL: mc is not in the image"
  exit 1
fi

until mc alias set store "http://minio:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  log "waiting for object storage"
  sleep 5
done

mc mb --ignore-existing "store/$BUCKET" >/dev/null 2>&1 || true

run_backup() {
  stamp="$(date -u '+%Y-%m-%dT%H-%M-%SZ')"
  file="/tmp/jtas-${stamp}.sql.gz"

  log "dumping $PGDATABASE"
  # --clean --if-exists so the dump can be restored over a live database
  # without dropping it first; -Fp because a plain dump can be read and
  # partially applied by a human under pressure.
  pg_dump --clean --if-exists --no-owner --no-privileges -Fp | gzip -9 > "$file"

  size="$(wc -c < "$file")"
  if [ "$size" -lt 1024 ]; then
    log "REFUSING to upload: dump is only ${size} bytes"
    rm -f "$file"
    return 1
  fi

  mc cp "$file" "store/$BUCKET/$(basename "$file")" >/dev/null
  log "uploaded $(basename "$file") (${size} bytes)"
  rm -f "$file"

  # Retention. `--force` is required by mc for an unattended delete.
  mc rm --recursive --force --older-than "${RETENTION}d" "store/$BUCKET/" >/dev/null 2>&1 || true
  log "pruned anything older than ${RETENTION} days"
}

# One on boot, so a fresh deployment has a backup before its first night.
run_backup || log "initial backup failed"

while true; do
  now="$(date -u '+%H:%M')"
  # Seconds until the next occurrence of AT, wrapping past midnight.
  target_min=$(( ${AT%%:*} * 60 + ${AT##*:} ))
  now_min=$(( ${now%%:*} * 60 + ${now##*:} ))
  wait_min=$(( target_min - now_min ))
  [ "$wait_min" -le 0 ] && wait_min=$(( wait_min + 1440 ))

  log "next backup in ${wait_min} minutes (${AT} UTC)"
  sleep $(( wait_min * 60 ))

  run_backup || log "backup failed; will retry tomorrow"
done
