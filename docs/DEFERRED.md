# Deferred work

What was consciously left out, and what it would cost in production if it stayed out.
One section per module, newest first.

---

## M3 — Jobs

| Deferred | Why | Production risk if never done |
|---|---|---|
| Job templates (FR-11, `POST /api/jobs/from-template`) | The `JobTemplate` and `JobTemplateItem` rows are seeded and the "Standard CNC Job" template exists, but creating a job from one needs subtasks, which is M4. | **Adoption risk** (PDD I-03): creating eight subtasks by hand for every order is what kills usage. Must land with or immediately after M4. |
| Subtask timeline and activity feed on `/jobs/[id]` | Placeholder cards naming M4 and M9. | The MD cannot see where a job actually stands from the detail page — the core of FR-61. |
| Wizard steps 2 and 3 | Step 1 saves a `DRAFT` and routes to the detail page. Steps 2 (subtasks) and 3 (review/publish) need M4. | The MD creates a draft and then has no way to add subtasks, so no job can be published yet. Expected at this point in the build. |
| Attachments on a job (FR-10) | `Attachment` rows exist; upload is M10. | Drawings and POs stay in email. |
| Changing the overall deadline after publish | The build spec freezes it, and this implementation follows that. FR-12 says deadline changes are "logged and notified", which reads as the *subtask* deadline flow in M4. | **The MD should confirm.** A customer moving a delivery date currently means cancelling and re-creating the job. If that is wrong, the fix is a deadline-change endpoint with a reason and a notification, mirroring the subtask one. |
| `Idempotency-Key` on job mutations | Still outstanding from M1 (SDD §6.1). A double-submitted create now produces **two jobs with two codes**, which is worse than the user case — a duplicate email just conflicted. | A retried create over flaky 4G silently produces a duplicate job. This is the most concrete gap left; it should land with M4. |
| Playwright specs committed | Verified in a real browser during the module (list, filters, wizard with the IST picker, create, publish-blocked, mobile) but as throwaway scripts. The committed suite is M11. | Regressions caught by hand, not CI. |

### Decisions and ambiguities resolved in M3

- **SDD §4.2 line 1 is garbled.** It reads "if any subtask CANCELLED-all -> CANCELLED". Read
  here as **all** subtasks cancelled. The other reading — one cancelled subtask cancels the
  job — would silently kill a live order the moment one department's task was dropped.
  **The MD should confirm.**
- **`DRAFT`, `ON_HOLD` and `CANCELLED` are never overwritten by the ladder.** The SDD's
  pseudocode does not mention them, but FR-14 says a held job's timers pause; without this,
  an overdue subtask would flip a deliberately held job to `DELAYED` and the hold would
  achieve nothing.
- **Unhold recomputes rather than restores.** Time passed while the job was paused, so the
  honest answer may now be `DELAYED`.
- **Cancelling a job cancels its open subtasks.** Otherwise the M7 sweeper would keep
  chasing people for work that has been called off — the exact credibility failure
  improvement I-05 exists to prevent.
- **Job codes use the IST calendar year.** A job created at 02:00 IST on 1 January is
  20:30 UTC on 31 December; numbering it from the UTC year would put it in the wrong year's
  sequence and the wrong year's reports (rule 1).
- **Allocation is one `INSERT … ON CONFLICT DO UPDATE … RETURNING`,** not `SELECT … FOR
  UPDATE` then `UPDATE`. Same row lock, one round trip, and no window between read and
  write. Proved with 20 concurrent transactions and again with 20 concurrent HTTP requests.
- **A member gets `NOT_FOUND`, not `FORBIDDEN`,** for a job they cannot see. Confirming a
  job code exists is itself information.
- **Deadlines cross the wire as naive IST wall-clock strings** (`2027-06-15T16:30`), never
  as instants. The browser may be in any timezone; converting once on the server with
  `fromISTInput` is the only arrangement where what the MD typed is what the scheduler uses.
- **`POST /api/jobs/:id/unhold` added** to the §6.2 table — §6.2 lists `/hold` but nothing
  to reverse it.

### Where M4 plugs in

`publishJob` in `src/lib/services/jobs/lifecycle.ts` carries a marked point inside its
transaction where M4/M7 schedule `SUBTASK_ASSIGNED` and the `DEADLINE_REMINDER` rows, so a
published job and its notifications commit together or not at all.

---

## M2 — Directory: users and departments

| Deferred | Why | Production risk if never done |
|---|---|---|
| Server-side pagination controls in the UI | The API paginates properly (`page`, `pageSize`, `total`); the screen requests `pageSize=100` and renders everything. At 25 named users — 100 with headroom — one request is correct. | None until the directory passes ~100 rows, at which point the page control is a small addition to an API that already supports it. |
| Sortable column headers | The API accepts `sort` and `direction`; no header is wired to them. | None. Search and the three filters cover the real questions. |
| Bulk actions | No multi-select. Deactivation is a per-person decision with a hand-over plan attached. | None. |
| Department CRUD | Departments are reference data, seeded once and never created through the UI (SDD §6.2 exposes `GET` only). Adding a ninth is a migration. | The MD cannot add a department without a developer. Correct for Phase 1. |
| Reassigning to somebody in a *different* department | The target must share the leaver's department. A cross-department hand-over needs an MD decision per subtask, which is M4's reassign endpoint. | The MD must move those subtasks individually after deactivating. |
| `Idempotency-Key` on user mutations | Still outstanding from M1 (SDD §6.1). A double-submitted create returns `CONFLICT` on the duplicate email, so the damage is already bounded. | A retried create over flaky 4G shows a confusing conflict rather than succeeding idempotently. |
| Playwright specs committed for these flows | Verified in a real browser during the module (login → create → one-time password → search, plus the blocked-deactivation dialog), but as throwaway scripts. The committed suite lands in M11. | Regressions in the UI flow are caught by hand, not by CI. |

### Decisions and ambiguities resolved in M2

- **File named `user-service.ts` → `src/lib/services/users/`.** The build spec says
  `userService.ts`; the codebase is kebab-case, and the service grew past the ~300-line
  rule, so it is a directory split by responsibility (`queries`, `mutations`,
  `lifecycle`, `invariants`, `types`) behind a barrel.
- **A reassignment target may not be an ADMIN.** The spec says "active and in the same
  department". An administrator satisfies both but `can()` refuses them
  `subtask:updateStatus`, so a subtask handed to one could never be completed by anybody.
- **"Same department" includes *no* department.** An MD or Deputy has none, so their work
  hands over to another user with none — a peer, not a shop-floor member. That falls out
  of the rule rather than needing a special case.
- **Last-active-MD guard added.** Not in the spec. The MD is the only role that can create
  or publish a job (SDD §6.3); demoting or deactivating the last one would leave a running
  factory unable to issue work, with no route back through the UI.
- **Self-deactivation refused.** It would lock the actor out of the screen they are on.
- **`POST /api/users/:id/reactivate` added** to the §6.2 table. FR-70 forbids hard
  deletes, so without a way back a mistaken deactivation would need a database edit.
- **`DELETE` carries a body.** Unusual for the verb, but deactivation genuinely needs a
  hand-over plan and the SDD assigns the operation to `DELETE`.

### Fixed during M2

- **CSP blocked React hydration in production.** `script-src 'self'` (added in M1) blocked
  the App Router's inline bootstrap scripts. Every page server-rendered and looked
  correct, but React never hydrated — no button, form or dialog worked. `curl` could not
  see it because the HTML was fine; the first real browser run found it immediately. The
  CSP is now built per request in `src/lib/security/csp.ts` with a fresh nonce and
  `'strict-dynamic'`, applied by middleware to both the request (so Next stamps the nonce
  onto its script tags) and the response.
- **`auth-service.ts` split.** 481 lines, over the ~300 rule since M1; now
  `src/lib/services/auth/{tokens,login,password}.ts` behind a barrel.

### Known rule-9 exception

`src/lib/auth/policy.ts` is 423 lines and stays that way. It is a single exhaustive
`switch` over the `Action` union; splitting it would break the `never` guard that makes a
forgotten action a compile error, which is the whole point of the file.

---

## Hardening pass — database reset, seed credentials, test isolation

Three corrections applied after M1, before M2.

| Change | Why |
|---|---|
| `scripts/db-reset.ts` replaces the bare `prisma migrate reset` | The old `db:reset` script would have run against whatever `DATABASE_URL` happened to hold. The new one refuses unless the host is `localhost`/`127.0.0.1`/`db` **and** the database name ends in `_dev` or `_test`. No override flag, no env escape hatch. |
| Development database renamed `jtas` → `jtas_dev` | Required by the guard above, and it makes the database self-describing. `docker-compose.yml`, `.env.example` and `.env` all updated; the existing volume was renamed in place with `ALTER DATABASE`, so no data was lost. |
| Per-user random seed passwords | `Jaraa@2026` was a constant in a document that ships to the client, so it was effectively a published credential. Each account now gets a 16-character base58 password from `crypto.randomBytes`, shown once. |
| Integration tests moved to a per-worker schema | They previously truncated the development database. Now they run in `jtas_test.jtas_test_w{N}`, so ambient rows in `public` — or in the dev database — are in a different namespace and invisible. |

### Deferred from this pass

| Deferred | Why | Risk |
|---|---|---|
| Automatic cleanup of `.seed-credentials.txt` | The file is 0600 and git-ignored, and the seed tells you to delete it once the passwords are handed out. Deleting it automatically would defeat its purpose. | A plain-text password file lingers on a developer machine. Mitigated by mode 0600 and the printed warning. |
| Rotating the credentials file per run | Each seed overwrites it. A run that creates no new accounts leaves the previous file untouched, which is correct but could be mistaken for current. | Low — the file carries its generation timestamp. |
| Schema cleanup for retired workers | `jtas_test_w{N}` schemas accumulate if the worker count ever drops. | Negligible: they live only in the test database, and `pnpm db:reset` against `jtas_test` clears them. |
| Parallel integration files | Each worker has its own schema, so it would be safe, but each new worker pays a `prisma migrate deploy`. Serialised until the suite is slow enough to matter. | None. |

---

## M1 — Authentication and RBAC

| Deferred | Why | Production risk if never done |
|---|---|---|
| Redis-backed rate limiter | `RateLimiter` is an interface with an in-memory implementation, as the build spec asked. | **Medium at scale.** In-memory counters are per-process. The moment JTAS runs more than one app container the 10/minute limit becomes 10 × N. The 5-attempt account lockout is unaffected — it lives in the database — so credential stuffing is still bounded. |
| `Idempotency-Key` on auth mutations | SDD §6.1 requires it on state-changing endpoints. Login and change-password are naturally near-idempotent, so this waits for the job and subtask endpoints where a duplicate submit creates a duplicate row. | A retried change-password over a flaky link could rotate tokens twice. Harmless today. |
| CSP `'strict-dynamic'` with a nonce | The production CSP already forbids inline script. Moving to a nonce pipeline needs a middleware-generated nonce threaded into Next's script tags. | Current policy is already strict; this is hardening, not a hole. |
| Rate limit on `/api/auth/refresh` | The endpoint is covered by the same per-IP bucket as the rest of `/api/auth/*` only when called through `guardAuthRate`, which refresh deliberately skips so a legitimate session is never throttled out of rotating. | A stolen refresh token could be rotated rapidly. Reuse detection already revokes the family on the second use, so the window is one rotation. |
| Session list / "sign out everywhere" UI | The data is there — `RefreshToken` rows carry a family id — but there is no screen. | The MD cannot see or revoke a departed employee's sessions without deactivating the account, which does work. |
| Playwright e2e for the auth flow | Verified by hand against a running server (see the M1 summary) and by 25 integration tests. The Playwright suite is wired up in M11. | Regressions in the login → forced change → landing flow are caught by integration tests but not through a real browser. |

### Decisions and ambiguities resolved in M1

- **`DEPUTY_MD` raising a problem on someone else's subtask is denied.** SDD §6.3 lists
  "Raise problem" as ✔ for `DEPUTY_MD` with no qualifier, but the adjacent row
  "Update another's subtask status" is ✖ for the same role. Raising a problem *is* a
  status change to `PROBLEM`, so the two rows conflict. The narrower rule was applied:
  a deputy may raise a problem only on a subtask he holds. **The MD should confirm this.**
  One line in `src/lib/auth/policy.ts` reverses it.
- **An ADMIN may not manage an MD account.** Not in the matrix, but without it
  "Manage users ✔ ADMIN" would let an administrator reset the MD's password and assume
  the top role, making every MD-only column meaningless.
- **Two error codes added** beyond the six in SDD §6.1: `RATE_LIMITED` (§8.7 requires the
  behaviour but names no code) and `INTERNAL_ERROR` (so an unexpected throw still returns
  the documented envelope instead of an HTML error page).
- **`POST|GET /api/auth/refresh` added** to the §6.2 endpoint table. Rotation is mandated
  by §8.2 and needs somewhere to happen.
- **A member reaching `/dashboard` gets a real 403, not a redirect.** Middleware handles
  only authentication and the forced-password-change gate; authorisation is decided in
  the page through `can()`. This needs Next's `experimental.authInterrupts`, enabled in
  `next.config.ts`, which is what makes `forbidden()` available.
- **`requireAuth()` re-reads the user from the database on every request** rather than
  trusting JWT claims. Without it, deactivating a user (FR-70) or changing a role would
  not take effect for up to 15 minutes. One indexed primary-key lookup per request is the
  right trade at this scale.
- **Integration tests run against a separate `jtas_test` database.** They truncate tables
  between cases; pointed at the development database they would delete the seeded users.
  `pnpm test` creates and migrates it automatically.
- **Prisma 6.19 refuses `migrate reset` when an agent runs it.** Verified in
  `node_modules/prisma/build/index.js`: it checks `CLAUDECODE`, `GEMINI_CLI`,
  `CURSOR_AGENT`, `OR_APP_NAME`, `REPLIT_CLI` and `CODEX_SANDBOX`, and `--force` does
  **not** bypass it — only `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` does. This is
  a Prisma feature, not a Claude Code permission rule; there are no deny rules or hooks
  configured in this repository. It affects agents only: `CLAUDECODE` is unset in a
  normal terminal, so `pnpm db:reset` runs uninterrupted for a human developer.

---

## M0 — Project foundation

| Deferred | Why | Production risk if never done |
|---|---|---|
| S3 / R2 attachment storage | No upload surface exists until M10. `S3_*` keys are documented in `.env.example` but unused. | None yet. Blocks M10. |
| BullMQ queues and the sweeper loop | The worker process, its logging and its signal handling exist; the scheduler itself is M7. | **High** — this is the product's value proposition. Nothing chases anybody until M7 lands. |
| `Idempotency-Key` handling on mutations | SDD §6.1 requires it; there are no mutating endpoints yet. | Duplicate job or subtask creation on a retried request over a flaky 4G link. |
| Sentry wiring | `SENTRY_DSN` is documented but not initialised. | Errors are visible only in container logs. |
| Playwright browser binaries in CI | The CI job runs typecheck, lint, unit tests and build. E2E needs a seeded database and a built app; wired up in M11. | Regressions in the MD→member→MD loop are caught only by hand. |
| Production Dockerfiles for `app` and `worker` | `docker-compose.yml` currently covers the local stateful services only; app and worker run on the host in development. The production topology in SDD §10.2 is built in M11. | No reproducible deploy. |
| Dark mode | Explicitly out of scope for Phase 1 (SDD §7.4). Tokens exist in `globals.css` so it is a stylesheet change later. | None. |

### Known deviations from the documents

- **Docs moved.** The three design documents were at the repository root; they are now
  in `docs/`, as the brief assumed.
- **`lib/*` is `src/lib/*`.** The brief says `lib/services/*`; the build spec mandates
  the `@/* → ./src/*` path alias, so the modules live under `src/lib/` and are imported
  as `@/lib/...`.
- **Tailwind v4.** The SDD predates it and says only "Tailwind CSS". v4 is what
  `create-next-app` and current shadcn/ui produce, and it needs no `tailwind.config.ts`
  — the theme lives in `src/app/globals.css`.
- **Two models added to the SDD §3.3 schema.** Both are additive and required by rules
  the SDD states elsewhere:
  - `RefreshToken` — SDD §8.2 requires refresh rotation with family invalidation, which
    needs storage. The M1 build spec explicitly permits adding it.
  - `JobCodeCounter` — SDD §4.1 requires a per-year counter locked with
    `SELECT … FOR UPDATE` so concurrent job creation cannot collide on a job code.
- **`prisma migrate dev`, not `prisma db push`.** Per SDD §10.4.
