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

# 5. Run the app and the background worker in two terminals
pnpm dev       # http://localhost:3000
pnpm worker
```

Mailpit captures every outbound mail in development — nothing reaches a real inbox.
Its UI is at **http://localhost:8025**.

### Seeded accounts

All seeded users share the temporary password **`Jaraa@2026`** and are forced to change
it at first login.

| Email                                                                                                                   | Role                       |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `md@jaraaglobal.com`                                                                                                    | MD                         |
| `admin@jaraaglobal.com`                                                                                                 | ADMIN                      |
| `planning@` · `purchase@` · `store@` · `production@` · `quality@` · `dispatch@` · `accounts@` · `hr@` `jaraaglobal.com` | MEMBER, one per department |

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
src/lib/notifications/   templates, channels, scheduling
src/lib/validation/      shared Zod schemas
src/lib/utils/           time, logging, env, class names
prisma/                  schema, migrations, seed
worker/                  scheduler and dispatcher process
tests/{unit,integration,e2e}
```
