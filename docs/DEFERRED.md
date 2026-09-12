# Deferred work

What was consciously left out, and what it would cost in production if it stayed out.
One section per module, newest first.

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
