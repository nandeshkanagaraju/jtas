#!/bin/sh
# Download the newest dump and restore it into a throwaway database.
#
# This never touches the live database. It uses the instance role, the same
# way the nightly backup does.
set -eu

BUCKET="${BACKUP_BUCKET:-jtas-backups}"
PROOF_DB="${PROOF_DB:-jtas_restore_proof}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') restore-proof: $*"; }

if [ "$PROOF_DB" = "$PGDATABASE" ]; then
  log "FATAL: refusing to restore over the live database ($PGDATABASE)"
  exit 1
fi

if [ -n "${AWS_ACCESS_KEY_ID:-}" ] || [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  log "FATAL: AWS access keys are set. Use the instance role."
  exit 1
fi

aws sts get-caller-identity >/dev/null

latest="$(aws s3 ls "s3://$BUCKET/" | awk '{print $4}' | grep '\.sql\.gz$' | sort | tail -n 1)"
if [ -z "$latest" ]; then
  log "FATAL: no dump in s3://$BUCKET"
  exit 1
fi

file="/tmp/$latest"
log "downloading $latest"
aws s3 cp "s3://$BUCKET/$latest" "$file" >/dev/null

log "restoring into $PROOF_DB"
dropdb --if-exists "$PROOF_DB"
createdb "$PROOF_DB"
gunzip -c "$file" | psql -d "$PROOF_DB" -v ON_ERROR_STOP=1 >/dev/null
rm -f "$file"

tables="$(psql -d "$PROOF_DB" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")"
migrations="$(psql -d "$PROOF_DB" -tAc "select to_regclass('public._prisma_migrations') is not null")"

dropdb "$PROOF_DB"

log "public tables: $tables"
log "prisma migrations table present: $migrations"

if [ "$tables" -lt 1 ] || [ "$migrations" != "t" ]; then
  log "FAIL"
  exit 1
fi

log "PASS restored $latest ($tables public tables) and dropped $PROOF_DB"
