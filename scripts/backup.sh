#!/bin/sh
# Nightly pg_dump to S3, with 30-day retention.
#
# Credentials come from the EC2 instance role. This script refuses to run if
# access keys were injected: a key in the environment is how a laptop secret
# ends up in a backup container.
set -eu

RETENTION="${BACKUP_RETENTION_DAYS:-30}"
BUCKET="${BACKUP_BUCKET:-jtas-backups}"
AT="${BACKUP_AT_UTC:-19:30}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup: $*"; }

if [ -n "${AWS_ACCESS_KEY_ID:-}" ] || [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  log "FATAL: AWS access keys are set. Use the instance role."
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  log "FATAL: aws is not in the image"
  exit 1
fi

until aws sts get-caller-identity >/dev/null 2>&1; do
  log "waiting for the instance role"
  sleep 5
done

until aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; do
  log "waiting for s3://$BUCKET"
  sleep 5
done

prune() {
  cutoff="$(date -u -d "-${RETENTION} days" +%s)"
  aws s3 ls "s3://$BUCKET/" | while read -r day time size key; do
    [ -n "${key:-}" ] || continue
    case "$key" in
      *.sql.gz) ;;
      *) continue ;;
    esac
    stamp="$(date -u -d "$day $time" +%s)"
    if [ "$stamp" -lt "$cutoff" ]; then
      aws s3 rm "s3://$BUCKET/$key" >/dev/null
      log "pruned $key"
    fi
  done
}

run_backup() {
  stamp="$(date -u '+%Y-%m-%dT%H-%M-%SZ')"
  file="/tmp/jtas-${stamp}.sql.gz"

  log "dumping $PGDATABASE"
  pg_dump --clean --if-exists --no-owner --no-privileges -Fp | gzip -9 > "$file"

  size="$(wc -c < "$file")"
  if [ "$size" -lt 1024 ]; then
    log "REFUSING to upload: dump is only ${size} bytes"
    rm -f "$file"
    return 1
  fi

  aws s3 cp "$file" "s3://$BUCKET/$(basename "$file")" >/dev/null
  log "uploaded $(basename "$file") (${size} bytes)"
  rm -f "$file"
  prune
  log "pruned anything older than ${RETENTION} days"
}

run_backup || log "initial backup failed"

while true; do
  now="$(date -u '+%H:%M')"
  target_min=$(( ${AT%%:*} * 60 + ${AT##*:} ))
  now_min=$(( ${now%%:*} * 60 + ${now##*:} ))
  wait_min=$(( target_min - now_min ))
  [ "$wait_min" -le 0 ] && wait_min=$(( wait_min + 1440 ))

  log "next backup in ${wait_min} minutes (${AT} UTC)"
  sleep $(( wait_min * 60 ))

  run_backup || log "backup failed; will retry tomorrow"
done
