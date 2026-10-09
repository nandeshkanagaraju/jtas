# JTAS — Jaraa Task & Accountability System

Internal job and accountability tracking for **Jaraa Global Engineering Pvt Ltd**.

> Assign it once, and the system does the following up.

The MD issues a CNC job, breaks it into department subtasks with deadlines, and the
system chases everybody automatically. Nobody has to remember a deadline, and nothing
silently slips.

- **What** it does: [`docs/JARAA_PDD_Product_Design_Document.md`](docs/JARAA_PDD_Product_Design_Document.md)
- **How** it is built: [`docs/JARAA_SDD_Software_Design_Document.md`](docs/JARAA_SDD_Software_Design_Document.md) — authoritative for schema, API, business rules and the notification engine
- Build order: [`docs/JARAA_Module_Wise_Build_Prompts.md`](docs/JARAA_Module_Wise_Build_Prompts.md)
- Known gaps: [`docs/DEFERRED.md`](docs/DEFERRED.md)
- Rebuilding the UI: [`docs/UI_REBUILD_BRIEF.md`](docs/UI_REBUILD_BRIEF.md) — the design brief, and the accessibility, semantic and end-to-end constraints any UI change has to hold

---

## Stack

| Layer           | Choice                                               |
| --------------- | ---------------------------------------------------- |
| Framework       | Next.js 15 (App Router), React 19, TypeScript strict |
| Styling         | Tailwind CSS v4 + shadcn/ui                          |
| Forms           | react-hook-form + Zod (schemas shared client/server) |
| Data            | Prisma + PostgreSQL 16                               |
| Queue           | BullMQ on Redis 7                                    |
| Mail            | Nodemailer (Mailpit locally)                         |
| Tests           | Vitest (unit/integration), Playwright (e2e)          |
| Package manager | pnpm                                                 |

---

## Setup from a clean clone

Requires **Node ≥ 20.11**, **pnpm 11** and **Docker**.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure the environment
cp .env.example .env
#    Then replace JWT_SECRET and REFRESH_SECRET with real values:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Start Postgres, Redis and Mailpit
pnpm docker:up

# 4. Create the schema and seed reference data
pnpm db:migrate
pnpm seed
#    The seed prints a unique temporary password for each account, once.
#    It also writes them to .seed-credentials.txt (mode 0600, git-ignored).

# 5. Run the app and the background worker in two terminals
pnpm dev       # http://localhost:3000
pnpm worker
```

Mailpit captures every outbound mail in development — nothing reaches a real inbox.
Its UI is at **http://localhost:8025**.

### Seeded accounts

The seed creates the MD, an administrator, and one member per department:

| Email                                                                                                                   | Role                       |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `md@jaraaglobal.com`                                                                                                    | MD                         |
| `admin@jaraaglobal.com`                                                                                                 | ADMIN                      |
| `planning@` · `purchase@` · `store@` · `production@` · `quality@` · `dispatch@` · `accounts@` · `hr@` `jaraaglobal.com` | MEMBER, one per department |

**There is no shared password.** Each account gets its own 16-character random
temporary password, generated at seed time and printed **once**:

```
============================================================
ONE-TIME TEMPORARY PASSWORDS
============================================================
EMAIL                       TEMPORARY PASSWORD
----------------------------------------------
md@jaraaglobal.com          TmGDWt7BDs382p8z
...
```

Only a bcrypt hash is stored, so a lost password cannot be recovered — reset it from the
Users screen, or re-run `pnpm db:reset`. Every account must change its password at first
sign-in.

The same table is written to **`.seed-credentials.txt`** with mode `0600`. That file is
git-ignored; delete it once the passwords have been handed out. Set
`SEED_CREDENTIALS_FILE=none` to print only and write nothing to disk.

A re-seed never regenerates a password for an account that already exists — that would
lock out whoever is using it — so it reports "no new accounts" instead.

---

## Commands

| Command                               | Purpose                               |
| ------------------------------------- | ------------------------------------- |
| `pnpm dev`                            | Next.js dev server                    |
| `pnpm build` / `pnpm start`           | Production build and serve            |
| `pnpm worker`                         | Scheduler and notification dispatcher |
| `pnpm typecheck`                      | `tsc --noEmit`                        |
| `pnpm lint`                           | ESLint                                |
| `pnpm format` / `pnpm format:check`   | Prettier                              |
| `pnpm test`                           | Vitest unit + integration             |
| `pnpm test:watch`                     | Vitest in watch mode                  |
| `pnpm test:e2e`                       | Playwright                            |
| `pnpm db:migrate`                     | Create and apply a dev migration      |
| `pnpm db:deploy`                      | Apply migrations (production)         |
| `pnpm db:reset`                       | Drop, re-migrate and re-seed          |
| `pnpm db:studio`                      | Prisma Studio                         |
| `pnpm seed`                           | Seed reference data (idempotent)      |
| `pnpm docker:up` / `pnpm docker:down` | Local service stack                   |

---

## Architecture rules

These are enforced in review; breaking one is a defect, not a style preference.

1. **Time.** Every timestamp is stored in UTC. Display and business-hours maths use
   `Asia/Kolkata` via `date-fns-tz`. A deadline is never constructed from a naive local
   string on the server — use `fromISTInput()` from `src/lib/utils/time.ts`.
2. **Layering.** Business logic lives in `src/lib/services/*` and `src/lib/domain/*`.
   Route handlers only authenticate, validate with Zod, call a service, and map errors
   to HTTP. React components never contain business rules.
3. **Authorisation.** Enforced server-side in every route handler through the single
   `can(user, action, resource)` function in `src/lib/auth/policy.ts`. Hiding a UI
   button is never the access control.
4. **Validation.** One Zod schema per shape, in `src/lib/validation/*`, imported by both
   client and server.
5. **Audit.** Every state-changing operation writes an `AuditLog` row inside the same
   transaction as the change.
6. **No hard deletes** on `User`, `Job`, `Subtask` or `Problem`. Deactivate or cancel.
7. **Errors** return `{ error: { code, message, details? } }` using the codes in SDD §6.1.
8. **Tests** ship with the module. `src/lib/domain` and `src/lib/notifications` hold an
   85% coverage floor.

### Resetting the database

`pnpm db:reset` drops every table, re-applies migrations and re-seeds. It refuses to run
unless **both** hold:

- the host is `localhost`, `127.0.0.1` or `db` (the compose service name), and
- the database name ends in `_dev` or `_test`.

There is no override flag and no environment escape hatch. On refusal it exits 1 and
prints the host, the database name and the rule that failed. Without `--yes` it also asks
you to type the database name back.

If you genuinely need to reset something else, run `pnpm exec prisma migrate reset
--force` directly and own that decision.

### Testing

Two projects:

| Command                 | Needs a database? | Covers                                      |
| ----------------------- | ----------------- | ------------------------------------------- |
| `pnpm test:unit`        | no                | pure logic — time, policy, password, tokens |
| `pnpm test:integration` | yes               | services against real PostgreSQL            |
| `pnpm test`             | yes               | both                                        |

Integration tests never touch your development database. They run in a separate
`jtas_test` database, and inside it each Vitest worker gets its own schema
(`jtas_test_w1`, `jtas_test_w2`, …). Rows sitting in `public` — or anywhere else — are in
a different namespace and are invisible to the suite, so the same run passes against a
freshly reset database and a dirty one. `tests/integration/isolation.test.ts` proves this
by deliberately polluting the database first.

---

## Layout

```
src/app/                 App Router routes and /api route handlers
src/components/ui/       shadcn/ui primitives
src/components/shared/   JTAS-specific shared components
src/lib/auth/            session, JWT, password, policy
src/lib/db/              Prisma client singleton
src/lib/domain/          pure business rules (state machine, status derivation)
src/lib/services/        orchestration: transactions, audit, notifications
src/lib/security/        CSP and other per-request security headers
src/lib/notifications/   templates, channels, scheduling
src/lib/validation/      shared Zod schemas
src/lib/utils/           time, logging, env, class names
prisma/                  schema, migrations, seed
worker/                  scheduler and dispatcher process
tests/{unit,integration,e2e}
```
