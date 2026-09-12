# Deferred work

What was consciously left out, and what it would cost in production if it stayed out.
One section per module, newest first.

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
- **`pnpm db:reset` cannot be run by an AI agent.** Prisma refuses destructive migrate
  commands invoked by an agent without explicit human consent. Run it yourself when you
  want a clean database.

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
