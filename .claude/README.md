# Claude Code settings for this repository

## Why `pnpm db:reset` is on the allow list

`pnpm db:reset` runs `scripts/db-reset.ts`, which **cannot** target anything but a
throwaway local database. Before it does anything it calls
`assertLocalDisposableDatabase()` from `scripts/lib/database-url.ts`, which requires
**both**:

- the host to be exactly `localhost`, `127.0.0.1` or `db` (the docker-compose service
  name) — a remote host is refused, and so is `::1`, because the list is closed; and
- the database name to end in `_dev` or `_test`.

There is **no override flag and no environment escape hatch**. A guard with a bypass is
a guard that gets bypassed. Anyone who genuinely needs to reset a different database
runs `pnpm exec prisma migrate reset --force` themselves and owns that decision.

The guard fails closed, exits 1, and prints the parsed host, the database name and the
specific rule that failed. It has direct unit tests in `tests/unit/database-url.test.ts`,
including the cases that matter most: a remote host with a permissive-looking name, a
local host with a production name, and `localhost.evil.com`, which must not pass merely
because it starts with `localhost`.

Given that, the command is no more dangerous than `rm -rf node_modules`, and prompting
for it on every run adds friction without adding safety.

## Note on Prisma's own AI-agent guard

Prisma 6.19 refuses `migrate reset`, `migrate dev` and `db push` when it detects an
agent, by checking environment variables — `CLAUDECODE`, `GEMINI_CLI`, `CURSOR_AGENT`
and others (see `node_modules/prisma/build/index.js`). `--force` does **not** bypass it;
only `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` does, and Prisma requires its value to
be the user's own words of consent.

This affects an agent only. `CLAUDECODE` is unset in a normal terminal, so
`pnpm db:reset` runs without interruption for a human developer.
