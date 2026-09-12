/**
 * Creates the integration-test database if it is missing.
 *
 * Per-worker schemas and their migrations are handled by
 * `tests/integration/setup.ts`, which runs inside Vitest and knows the worker
 * id. This script exists so `pnpm test` works on a clean machine where the
 * database itself does not exist yet.
 *
 * Idempotent — safe to run on every `pnpm test`.
 */
import { Client } from 'pg';

import { toTestDatabaseUrl } from './lib/database-url';

async function main() {
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');

  const testUrl = new URL(toTestDatabaseUrl(configured));
  const name = decodeURIComponent(testUrl.pathname.replace(/^\//, ''));

  const admin = new URL(testUrl);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

    if (rowCount === 0) {
      // Identifier cannot be parameterised; `name` comes from our own
      // DATABASE_URL, not from user input.
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`Created test database "${name}".`);
    } else {
      console.log(`Test database "${name}" already exists.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Could not prepare the test database:', error);
  process.exit(1);
});
