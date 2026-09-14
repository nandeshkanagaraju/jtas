/**
 * Creates and migrates the end-to-end database.
 *
 * A separate script because `playwright.config.ts` has to do this
 * synchronously, before the web server starts, and it cannot await — so it
 * shells out to this. Uses the `pg` client rather than the `psql` binary,
 * which is not installed on a machine that runs Postgres in Docker.
 */
import { execFileSync } from 'node:child_process';

import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: '.env', quiet: true });

async function main() {
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error('DATABASE_URL is not set.');

  const url = configured.replace(/(_dev|_test)(\?|$)/, '_e2e$2');
  const name = new URL(url).pathname.replace(/^\//, '').split('?')[0];

  if (!/_e2e$/.test(name)) {
    throw new Error(`Refusing to use "${name}": the e2e database must end in _e2e.`);
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();

  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`[e2e] created ${name}`);
    }
  } finally {
    await client.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  console.log(`[e2e] ${name} is migrated`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
