# JTAS Runbook

Operating JTAS on the VPS. Everything here assumes you are logged in on the
server, in the directory holding `docker-compose.prod.yml`, and that
`.env.production` is present and filled in.

Every command is safe to paste. Anything destructive says so before you reach
it.

**Contents**

- [The stack](#the-stack)
- [Deploy](#deploy)
- [Roll back](#roll-back)
- [Backups](#backups)
- [Restore](#restore)
- [Triage: mails are not going out](#triage-mails-are-not-going-out)
- [Triage: the scheduler is dead](#triage-the-scheduler-is-dead)
- [Resend a notification](#resend-a-notification)
- [Reset somebody's password](#reset-somebodys-password)
- [Reading the logs](#reading-the-logs)

---

## The stack

Seven containers, one Docker network, one public port set.

| Service      | What it is                          | Reachable from                |
| ------------ | ----------------------------------- | ----------------------------- |
| `caddy`      | TLS termination, reverse proxy      | the internet (80, 443)        |
| `app`        | the Next.js server                  | `caddy` only                  |
| `worker`     | the scheduler — reminders, overdue  | nothing                       |
| `db`         | PostgreSQL 16                       | `app`, `worker`, `backup`     |
| `redis`      | BullMQ broker, rate-limit counters  | `app`, `worker`               |
| `minio`      | attachment storage                  | `app`, `caddy`, `backup`      |
| `backup`     | nightly `pg_dump` to the bucket     | `db`, `minio`                 |

Only `caddy` publishes ports. Postgres and MinIO are not addressable from
outside the host even if their passwords leak.

Two DNS records are required, both A records to the VPS:

- `JTAS_DOMAIN` — the application
- `JTAS_FILES_DOMAIN` — attachments

The second is not optional. Presigned S3 URLs are signed over the host *and*
the path, so attachments cannot be served from a path prefix on the main
domain; the signature would no longer match and MinIO would answer 403. See
the comment block in `Caddyfile` for the full reasoning.

```bash
docker compose -f docker-compose.prod.yml ps
curl -s https://$JTAS_DOMAIN/api/health | jq
```

A healthy response:

```json
{
  "ok": true,
  "dbOk": true,
  "redisOk": true,
  "schedulerHeartbeatAgeSeconds": 143,
  "pendingNotifications": 4,
  "failedNotifications": 0,
  "failedLastHour": 0,
  "staleAfterSeconds": 1200
}
```

`schedulerHeartbeatAgeSeconds` is the number that matters. Past 1200 the
endpoint answers **503** and the alarm fires.

---

## Deploy

```bash
./scripts/deploy.sh
```

What it does, in this order, and why the order is not negotiable:

1. Checks `.env.production` has every required key. A half-configured stack
   fails now rather than at six in the evening.
2. Tags the running image as `jtas:previous`, so a rollback has somewhere to go.
3. Builds the new image.
4. **Stops the worker.** A schema change applied while the sweeper is mid-batch
   is the one failure mode that writes wrong data rather than merely erroring.
5. Runs `prisma migrate deploy`.
6. Restarts `app` and waits for `/api/health` to answer 200 — up to 90 seconds.
7. Starts the worker again.

If the health wait times out it prints the app logs and stops. The old
container is already gone at that point, so read the logs and either fix
forward or roll back.

### Deploying a specific version

```bash
JTAS_VERSION=2026-09-14 ./scripts/deploy.sh
```

---

## Roll back

```bash
./scripts/deploy.sh --rollback
```

Brings back `jtas:previous` and restarts. **It does not roll back the schema.**

Prisma migrations are forward-only here, which is the right default for a
single-tenant system: a down-migration written under pressure is how data gets
lost. If the bad release migrated *and* the migration is the problem, you need
a [restore](#restore), not a rollback.

If the release only broke the UI or a route handler, rollback is correct and
safe — the new schema is almost always readable by the old code, because
migrations here add columns rather than remove them.

---

## Backups

The `backup` container takes one dump on boot and one every night at
`BACKUP_AT_UTC` (default `19:30` UTC = 01:00 IST), uploads it to the
`jtas-backups` bucket, and deletes anything older than
`BACKUP_RETENTION_DAYS` (default 30).

```bash
# What is in the bucket
docker compose -f docker-compose.prod.yml exec backup \
  mc ls store/jtas-backups

# The log of the last few runs
docker compose -f docker-compose.prod.yml logs --tail 50 backup

# Take one right now
docker compose -f docker-compose.prod.yml restart backup
```

The script refuses to upload a dump under 1024 bytes. A dump that small means
`pg_dump` failed and produced a header and nothing else, and uploading it would
overwrite the retention window with rubbish.

---

## Restore

> **This replaces the contents of the live database.** Read the whole section
> before typing anything.

### 1. Stop everything that writes

```bash
docker compose -f docker-compose.prod.yml stop app worker backup
```

Leaving the app running during a restore produces a database that is half old
and half new, which is worse than either.

### 2. Choose a dump

```bash
docker compose -f docker-compose.prod.yml exec backup mc ls store/jtas-backups
```

### 3. Pull it down and apply it

```bash
STAMP=2026-09-13T19-30-00Z   # from the listing above

docker compose -f docker-compose.prod.yml exec backup \
  mc cat "store/jtas-backups/jtas-${STAMP}.sql.gz" \
  | gunzip \
  | docker compose -f docker-compose.prod.yml exec -T db \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

The dump is taken with `--clean --if-exists`, so it drops and recreates each
object as it goes. It can be applied over a live database without dropping it
first, and applying it twice is harmless.

### 4. Bring the stack back

```bash
docker compose -f docker-compose.prod.yml start app worker backup
curl -s https://$JTAS_DOMAIN/api/health | jq
```

### 5. Check the damage

Anything written between the dump and the failure is gone. Ask the MD what was
created that day; the audit log in the restored database tells you what it knew
about.

```sql
SELECT "createdAt", action, "entityType", "entityId"
FROM "AuditLog"
ORDER BY "createdAt" DESC
LIMIT 20;
```

### Restore rehearsal — performed

A backup nobody has restored is a hope, so this was actually done rather than
merely written down.

| | |
| --- | --- |
| **When** | 14 September 2026 |
| **Against** | the production compose stack running locally, not a cloud VPS |
| **Dump** | the `backup` container's own boot dump, taken from the running `db` service |
| **Method** | `TRUNCATE "User" CASCADE` on the live database, then the restore pipeline in step 3 above, verbatim |
| **Result** | the `User` table came back with all 10 rows, matching the pre-truncate count; the app signed in normally afterwards |
| **Time taken** | under a minute end to end |

What the rehearsal proved: the dump is complete, `--clean --if-exists` applies
over a populated database without a manual drop, and the commands in step 3
work as written when piped through `docker compose exec`.

What it did not prove: a restore onto a *fresh* VPS with an empty volume. That
gap is now closed — see the second rehearsal below.

### Restore rehearsal — onto an empty database

The path the first rehearsal left untested, and the one that matters most: a
restore where nothing exists yet, as on a rebuilt VPS or a new volume. It was
worth doing on its own merits, and a live episode made the case — a second
container runtime on the development machine held a volume of the same name, so
the real database appeared to have been destroyed when it had only been looked
for in the wrong place. The question "can we actually get it back" should not
first be asked under that kind of pressure.

| | |
| --- | --- |
| **When** | 28 September 2026 |
| **Against** | `jtas_dev` on the Colima stack — 29 users, 723 jobs, 4,267 subtasks, 1,356 audit rows |
| **Dump** | `pg_dump --clean --if-exists --no-owner --no-privileges -Fp \| gzip -9`, byte for byte what `scripts/backup.sh` runs. 331 KB |
| **Target** | `jtas_restore_test`, created empty — 0 tables before the restore |
| **Method** | `gunzip -c dump.sql.gz \| psql -d jtas_restore_test`, the pipeline from step 3 |
| **Result** | **0 errors.** Every table matched the source exactly |

Row-for-row, source against restored:

| Table | Rows | | Table | Rows |
| --- | --- | --- | --- | --- |
| User | 29 ✓ | | Problem | 371 ✓ |
| Job | 723 ✓ | | Setting | 16 ✓ |
| Subtask | 4,267 ✓ | | Department | 8 ✓ |
| AuditLog | 1,356 ✓ | | RefreshToken | 115 ✓ |
| Notification | 4 ✓ | | Holiday, Comment, Attachment | 3 / 1 / 2 ✓ |

Beyond the counts, which only prove bytes moved:

- **34 constraints and 50 indexes** rebuilt, so referential integrity is real
  rather than a table of orphans that happens to be the right size.
- `prisma migrate status` against the restored database: **"Database schema is
  up to date"** — no drift, no pending migration.
- The application's own Prisma client read it: the MD resolved, the completed
  lifecycle job came back with its subtask, and the demo/real split held at 710
  and 13. A restore the app cannot open is not a restore.

What this closes: `--clean --if-exists` was written for applying over a
populated database, and `DROP ... IF EXISTS` against an empty one is a no-op
rather than an error, so the same dump serves both paths. No separate
empty-target procedure is needed.

What it still does not prove: a restore across machines, where the target
PostgreSQL is a different minor version or a different architecture. Both dumps
here were taken and applied by the same server. Before go-live, take one dump
from the production VPS and apply it locally once.

---

## Triage: mails are not going out

Symptom: somebody says they have stopped getting reminders, or the MD's inbox
has gone quiet.

### 1. Is it the scheduler or the mail?

```bash
curl -s https://$JTAS_DOMAIN/api/health | jq '{schedulerHeartbeatAgeSeconds, pendingNotifications, failedNotifications, failedLastHour}'
```

- `schedulerHeartbeatAgeSeconds` over 1200 → it is the scheduler. Go to
  [the scheduler is dead](#triage-the-scheduler-is-dead).
- `failedLastHour` above 5 → it is the mail. Continue here.
- Both fine and `pendingNotifications` near zero → nothing is being *scheduled*.
  That is a different problem; check that the jobs in question are actually
  published and that their subtasks have assignees.

### 2. Read the actual errors

```sql
SELECT "failedAt", type, "lastError", "attemptCount"
FROM "Notification"
WHERE status = 'FAILED'
ORDER BY "failedAt" DESC
LIMIT 20;
```

`lastError` carries the SMTP response verbatim. The common ones:

| Error contains | What it means | Fix |
| --- | --- | --- |
| `535` / `Invalid login` | wrong SMTP credentials | fix `SMTP_USER` / `SMTP_PASS`, or the values in Settings → Mail |
| `550` / `No such mailbox` | the recipient address is wrong | fix the address on the Users screen |
| `ECONNREFUSED` / `ETIMEDOUT` | the relay is unreachable | check `SMTP_HOST` and `SMTP_PORT`, and whether the VPS provider blocks outbound 25/465/587 |
| `Message rejected` / `SPF` / `DKIM` | your domain is not authorised to send | see the [go-live checklist](GO_LIVE_CHECKLIST.md) — this is the blocking one |

### 3. Where the settings come from

Mail configuration is read from the Settings screen first and falls back to the
environment. A value set in Settings **overrides** `.env.production`, which is
the usual reason a corrected environment variable appears to do nothing.

Settings → Mail, or:

```sql
SELECT key, value FROM "Setting" WHERE key LIKE 'mail.%';
```

`mail.smtp_password` is stored, never displayed, and never logged.

### 4. Retry them

Fix the cause first — retrying into a broken relay just burns the attempt
count. Then see [resend a notification](#resend-a-notification).

---

## Triage: the scheduler is dead

Symptom: `/api/health` answers 503, `schedulerHeartbeatAgeSeconds` is over 1200
or null, and an alert has arrived in Sentry saying so.

### 1. Is the container running?

```bash
docker compose -f docker-compose.prod.yml ps worker
docker compose -f docker-compose.prod.yml logs --tail 100 worker
```

The worker's healthcheck is deliberately disabled — the image's HTTP probe
targets port 3000, which the worker does not serve, so inheriting it would show
the scheduler as unhealthy forever. Its real health is the heartbeat.

### 2. The usual causes

| Log says | Cause | Fix |
| --- | --- | --- |
| `Can't reach database server` | Postgres restarted under it | `docker compose -f docker-compose.prod.yml restart worker` |
| `ECONNREFUSED ... 6379` | Redis is down | `restart redis`, then `restart worker` |
| `React is not defined` | the worker is running under the wrong tsconfig | the command must include `--tsconfig tsconfig.worker.json`; check `docker-compose.prod.yml` has not been edited |
| nothing at all, container exited | it crashed at boot | read the first 30 lines, not the last |

### 3. Restart it

```bash
docker compose -f docker-compose.prod.yml restart worker
sleep 60
curl -s https://$JTAS_DOMAIN/api/health | jq '.schedulerHeartbeatAgeSeconds'
```

The heartbeat updates every `SCHEDULER_INTERVAL_MINUTES` (default 5), so wait a
minute before concluding it did not work.

### 4. What was missed

Nothing is lost. Reminders and escalations are rows with a `scheduledFor` in
the past; the sweeper picks them all up on the next pass. A scheduler that was
down for three hours sends three hours of backlog in one go — which is correct,
but tell the MD before forty mails arrive at once.

If the backlog is genuinely unwanted (say the worker was down for a week),
suppress it before restarting:

```sql
-- Read first. This cancels mail that would otherwise be sent.
UPDATE "Notification"
SET status = 'SUPPRESSED', "lastError" = 'backlog after scheduler outage'
WHERE status = 'PENDING' AND "scheduledFor" < now() - interval '48 hours';
```

---

## Resend a notification

There is no button for this, on purpose — a resend is rare and ought to be
deliberate. Setting a row back to `PENDING` makes the sweeper pick it up on its
next pass.

```sql
-- One specific notification
UPDATE "Notification"
SET status = 'PENDING', "attemptCount" = 0, "lastError" = NULL, "failedAt" = NULL,
    "scheduledFor" = now()
WHERE id = '<notification id>';

-- Everything that failed in the last day, after fixing the cause
UPDATE "Notification"
SET status = 'PENDING', "attemptCount" = 0, "lastError" = NULL, "failedAt" = NULL,
    "scheduledFor" = now()
WHERE status = 'FAILED' AND "failedAt" > now() - interval '1 day';
```

Do **not** clear `dedupeKey`. It is what stops the same reminder being sent
twice, and a row with a fresh key is a second mail rather than a retry.

To send a *new* mail rather than retry an old one, do it through the product —
change the deadline, or reassign the subtask. Both generate their own
notification with their own key.

---

## Reset somebody's password

From the Users screen, as the MD or an admin. From the server, if nobody can
get in:

```bash
docker compose -f docker-compose.prod.yml exec app \
  node_modules/.bin/tsx scripts/reset-password.ts someone@jaraa.example
```

It prints a generated temporary password once and marks the account
`mustChangePassword`. The password is never logged and only a bcrypt hash is
stored — if you lose the output, run it again.

---

## Reading the logs

Logs are JSON, one object per line, from pino.

```bash
# Follow everything
docker compose -f docker-compose.prod.yml logs -f --tail 100

# Just the app, just errors
docker compose -f docker-compose.prod.yml logs app | jq -c 'select(.level >= 50)'

# One request, end to end — the id is in the error response's details
docker compose -f docker-compose.prod.yml logs app | jq -c 'select(.requestId == "abc123")'
```

Secrets are redacted at the logger, not at the call site: passwords, tokens,
SMTP credentials and request bodies never reach a log line regardless of what
the caller passes. That redaction is a security control with its own tests —
if you need a value it hides, get it from the database, do not widen the
redaction list.

Sentry receives server and browser errors when `SENTRY_DSN` is set, plus the
two alerts described above. It gets no PII, no request bodies and no session
replay.
