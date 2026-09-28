/**
 * Integration-test isolation.
 *
 * Two layers, because the earlier arrangement silently deleted a developer's
 * seeded data on its first run:
 *
 *   1. A separate `_test` database, never the `_dev` one.
 *   2. Inside it, a schema per Vitest worker. Tables live in
 *      `jtas_test_w1`, `jtas_test_w2`, … and never in `public`.
 *
 * The second layer is what makes the suite independent of ambient state. Junk
 * left in `public` by a previous run, a manual experiment, or an interrupted
 * acceptance test is in a different namespace and simply invisible — so the
 * tests pass identically against a freshly reset database and a dirty one.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { config } from 'dotenv';
import { Client } from 'pg';

import { toTestDatabaseUrl, withSchema } from '../../scripts/lib/database-url';

config({ path: '.env', quiet: true });

/*
 * Neutralise the mail guards that `.env` may carry.
 *
 * The same argument as the per-worker schema above, applied to the
 * environment. These are operator switches, and a developer who has set them
 * for real — as happens the moment anyone configures Brevo — would otherwise
 * see thirteen unrelated notification tests fail, because every test recipient
 * is suddenly off the allowlist and written SUPPRESSED instead of SENT. That
 * happened, and the failures point nowhere near the cause.
 *
 * So the suite starts from the unguarded baseline and the tests that care —
 * `mail-guards.test.ts` — set these themselves. `MAIL_PROVIDER` is forced back
 * to smtp and the key removed for a stronger reason than tidiness: with
 * `brevo` inherited from `.env`, any test that reached the dispatcher without
 * installing the capturing channel would post to the real API with the real
 * key and spend real credits.
 *
 * Assigned rather than `delete`d, which matters: under Vitest the assignment
 * takes effect and the deletion did not, so a `delete` here looked correct and
 * left the guard live. Every one of these parses to "off" when empty —
 * `parseAllowlist('')` is `[]`. The cap is set to its documented default
 * rather than emptied, because `MAIL_DAILY_CAP=''` coerces to 0 and fails the
 * env schema's `.positive()` — which surfaces as 72 unrelated tests dying on
 * "Invalid environment configuration".
 */
process.env.MAIL_ALLOWLIST = '';
process.env.MAIL_DAILY_CAP = '250';
process.env.BREVO_API_KEY = '';
process.env.MAIL_PROVIDER = 'smtp';

const configured = process.env.DATABASE_URL;

if (!configured) {
  throw new Error(
    'Integration tests need DATABASE_URL. Copy .env.example to .env and run pnpm docker:up.',
  );
}

/** One schema per worker, so enabling file parallelism stays safe. */
export function workerSchemaName(): string {
  const worker = process.env.VITEST_WORKER_ID ?? '1';
  return `jtas_test_w${worker}`;
}

const testDatabaseUrl = toTestDatabaseUrl(configured);
const schema = workerSchemaName();
const schemaUrl = withSchema(testDatabaseUrl, schema);

/**
 * Creates the worker's schema and applies migrations into it.
 *
 * Skipped only when the schema already carries *every* migration on disk. An
 * earlier version skipped as soon as it found any, so adding a migration left
 * every worker schema stale and the whole suite ran against yesterday's tables
 * — which surfaced as "the column isDemo does not exist" in eight tests that
 * had nothing to do with each other. `migrate deploy` is idempotent, so the
 * worst case of getting this wrong is a redundant run.
 */
async function ensureWorkerSchema(): Promise<void> {
  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

    const applied = await client
      .query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM "${schema}"."_prisma_migrations"
          WHERE finished_at IS NOT NULL`,
      )
      .catch(() => null);

    if (applied && Number(applied.rows[0]?.count ?? 0) >= migrationsOnDisk()) return;
  } finally {
    await client.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: schemaUrl },
    stdio: 'pipe',
  });
}

/** How many migrations the repository holds. */
function migrationsOnDisk(): number {
  return readdirSync(join(process.cwd(), 'prisma/migrations'), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  ).length;
}

/** Ensures the `_test` database itself exists before a schema is added to it. */
async function ensureTestDatabase(): Promise<void> {
  const admin = new URL(testDatabaseUrl);
  const name = decodeURIComponent(admin.pathname.replace(/^\//, ''));
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    // Identifier cannot be parameterised; `name` is derived from our own
    // DATABASE_URL, not from user input.
    if (rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

await ensureTestDatabase();
await ensureWorkerSchema();

// Every Prisma client constructed from here on lands in the worker's schema.
process.env.DATABASE_URL = schemaUrl;
