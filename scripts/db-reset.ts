/**
 * Guarded database reset. Wired to `pnpm db:reset`.
 *
 * Drops every table, re-applies migrations, and re-seeds — which is exactly the
 * command you want during development and exactly the command you must never
 * fire at a real database. Three things stand between the two:
 *
 *   1. The URL must name a local host AND a database whose name ends in `_dev`
 *      or `_test`. There is no override flag and no environment escape hatch.
 *   2. Without `--yes`, it asks you to type the database name back.
 *   3. It prints what it is about to destroy before destroying it.
 *
 * Usage:
 *   pnpm db:reset          interactive, asks for confirmation
 *   pnpm db:reset --yes    non-interactive, for scripts and CI
 */
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { Client } from 'pg';

import {
  UnsafeDatabaseError,
  assertLocalDisposableDatabase,
  type ParsedDatabaseUrl,
} from './lib/database-url';

/** Asks the operator to type the database name back. */
async function confirm(database: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const answer = await rl.question(
      `\nThis will DESTROY ALL DATA in "${database}".\n` +
        `Type the database name to continue (or anything else to abort): `,
    );
    return answer.trim() === database;
  } finally {
    rl.close();
  }
}

/** Row counts before the drop, so the operator sees what is at stake. */
async function summarise(url: string): Promise<string[]> {
  const client = new Client({ connectionString: url });

  try {
    await client.connect();
  } catch {
    return ['  (database does not exist yet — nothing to lose)'];
  }

  try {
    const { rows } = await client.query<{ table: string; count: string }>(`
      SELECT relname AS table, n_live_tup::text AS count
        FROM pg_stat_user_tables
       WHERE schemaname = 'public' AND n_live_tup > 0
       ORDER BY n_live_tup DESC
       LIMIT 10
    `);

    if (rows.length === 0) return ['  (no rows — database is already empty)'];
    return rows.map((row) => `  ${row.count.padStart(6)}  ${row.table}`);
  } finally {
    await client.end();
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(command, args, { stdio: 'inherit', env });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  let parsed: ParsedDatabaseUrl;
  try {
    parsed = assertLocalDisposableDatabase(url);
  } catch (error) {
    if (error instanceof UnsafeDatabaseError) {
      console.error(`\n${error.message}\n`);
      console.error(
        'If you really mean to reset this database, run the Prisma CLI directly\n' +
          'and take responsibility for it:\n' +
          '  pnpm exec prisma migrate reset --force\n',
      );
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }

  console.log(`\nTarget: ${parsed.redacted}`);
  console.log(`  host     ${parsed.host}:${parsed.port}`);
  console.log(`  database ${parsed.database}`);
  console.log('\nCurrent contents:');
  for (const line of await summarise(url)) console.log(line);

  const autoConfirm = process.argv.includes('--yes') || process.argv.includes('-y');

  if (!autoConfirm) {
    if (!stdin.isTTY) {
      console.error('\nNot a terminal. Re-run with --yes to reset non-interactively.');
      process.exit(1);
    }
    if (!(await confirm(parsed.database))) {
      console.log('\nAborted. Nothing was changed.');
      process.exit(1);
    }
  }

  const env = { ...process.env, DATABASE_URL: url };

  // --skip-seed: the seed is run separately below so that its credential output
  // is not swallowed by Prisma's own logging.
  console.log('\nResetting schema…');
  run('pnpm', ['exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed'], env);

  console.log('\nSeeding…');
  run('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], env);

  console.log(`\nDone. "${parsed.database}" is a clean baseline.`);
}

main().catch((error) => {
  console.error('\nReset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
