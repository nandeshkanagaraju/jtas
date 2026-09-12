/**
 * Creates and migrates the integration-test database.
 *
 * Idempotent, so `pnpm test` can call it on every run: creating the database is
 * skipped when it already exists, and `prisma migrate deploy` is a no-op when
 * the schema is current.
 */
import { execFileSync } from 'node:child_process';

import { Client } from 'pg';

function testDatabaseUrl(): { url: string; name: string; adminUrl: string } {
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');

  const parsed = new URL(configured);
  const baseName = parsed.pathname.replace(/^\//, '');
  const name = baseName.endsWith('_test') ? baseName : `${baseName}_test`;

  parsed.pathname = `/${name}`;
  const url = parsed.toString();

  // Connect to the default `postgres` database to issue CREATE DATABASE.
  const admin = new URL(configured);
  admin.pathname = '/postgres';

  return { url, name, adminUrl: admin.toString() };
}

async function main() {
  const { url, name, adminUrl } = testDatabaseUrl();

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

    if (rowCount === 0) {
      // Identifier cannot be parameterised; `name` is derived from our own
      // DATABASE_URL, not from user input.
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`Created test database "${name}".`);
    }
  } finally {
    await client.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

main().catch((error) => {
  console.error('Could not prepare the test database:', error);
  process.exit(1);
});
