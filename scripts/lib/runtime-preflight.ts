/**
 * Refuses to start when the database on :5432 belongs to the wrong container
 * runtime.
 *
 * This exists because of a real and expensive failure. Two container runtimes
 * were installed on the development machine — Docker Desktop and Colima — and
 * `docker` talks to whichever *context* happens to be active. Both name their
 * volumes from the project directory, so both hold a `cnc_jtas-db-data`. The
 * Colima one had a year of seeded history, eleven real jobs and the audit
 * trail; the Docker Desktop one did not exist until `docker compose up`
 * silently created it, empty, and every tool downstream behaved perfectly
 * against the wrong database. Nothing failed. `pnpm seed` succeeded, the tests
 * passed, and a session was spent concluding the data had been destroyed.
 *
 * A wrong-runtime database is indistinguishable from a fresh one, which is
 * exactly why it needs a check rather than attention. The check is not "is a
 * database listening" — one always is — but "is the cluster answering on the
 * TCP port the same cluster as the container the expected runtime is running".
 * PostgreSQL's `system_identifier` settles that: it is generated at initdb and
 * is unique per cluster, so two databases that look alike cannot match.
 */
import { execFileSync } from 'node:child_process';

import { Client } from 'pg';

/** The context this project's stack lives in. Override for a different setup. */
const DEFAULT_CONTEXT = 'colima';

/** The compose service holding the development database. */
const DB_CONTAINER = 'jtas-db';

export class WrongRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrongRuntimeError';
  }
}

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

/**
 * The cluster identifier as seen from inside the expected runtime's container.
 *
 * @returns the identifier, or null when the container is not running there.
 */
function identifierInsideContainer(context: string): string | null {
  try {
    return docker([
      '--context',
      context,
      'exec',
      DB_CONTAINER,
      'psql',
      '-U',
      'jtas',
      '-d',
      'jtas_dev',
      '-tAc',
      'select system_identifier from pg_control_system()',
    ]);
  } catch {
    return null;
  }
}

/** The cluster identifier as seen over the TCP connection the app will use. */
async function identifierOverTcp(databaseUrl: string): Promise<string | null> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });

  try {
    await client.connect();
    const { rows } = await client.query<{ id: string }>(
      'select system_identifier::text as id from pg_control_system()',
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Fails loudly, with the fix, when the wrong runtime is answering.
 *
 * Skipped entirely when `JTAS_DOCKER_CONTEXT` is empty — the documented way for
 * somebody running PostgreSQL natively, or in CI, to opt out. That is a
 * deliberate escape hatch rather than an oversight: unlike the destructive-
 * command guard in `database-url.ts`, being on the wrong runtime destroys
 * nothing. It wastes time, and only for a setup that has two of them.
 */
export async function assertExpectedRuntime(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const expected = env.JTAS_DOCKER_CONTEXT ?? DEFAULT_CONTEXT;
  if (expected === '') return;

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new WrongRuntimeError('DATABASE_URL is not set. Copy .env.example to .env.');
  }

  // Only meaningful for a local stack; a remote database has no docker context.
  const host = new URL(databaseUrl).hostname;
  if (!['localhost', '127.0.0.1', 'db'].includes(host)) return;

  let active: string;
  try {
    active = docker(['context', 'show']);
  } catch {
    throw new WrongRuntimeError(
      'The docker CLI is not available, so the container runtime cannot be checked.\n' +
        '  Fix:  start Docker, or set JTAS_DOCKER_CONTEXT= to skip this check.',
    );
  }

  if (active !== expected) {
    throw new WrongRuntimeError(
      `The active docker context is "${active}", not "${expected}".\n` +
        `  Both runtimes hold a volume of the same name, so this would quietly\n` +
        `  build a second, empty database rather than use the real one.\n` +
        `  Fix:  docker context use ${expected}\n` +
        `  Or:   JTAS_DOCKER_CONTEXT=${active} to declare that ${active} is correct.`,
    );
  }

  const inside = identifierInsideContainer(expected);
  if (inside === null) {
    throw new WrongRuntimeError(
      `The "${DB_CONTAINER}" container is not running in the "${expected}" context.\n` +
        `  Fix:  colima start && docker compose up -d`,
    );
  }

  const overTcp = await identifierOverTcp(databaseUrl);
  if (overTcp === null) {
    throw new WrongRuntimeError(
      `Nothing is answering on ${host}:${new URL(databaseUrl).port || '5432'}, though\n` +
        `  "${DB_CONTAINER}" is running in "${expected}".\n` +
        `  Fix:  docker compose up -d`,
    );
  }

  if (inside !== overTcp) {
    throw new WrongRuntimeError(
      `The database answering on ${host} is NOT the one "${expected}" is running.\n` +
        `  cluster in ${expected}: ${inside}\n` +
        `  cluster on ${host}:      ${overTcp}\n` +
        `  Another runtime — Docker Desktop, OrbStack, or a native PostgreSQL —\n` +
        `  has taken the port. Anything written now goes to the wrong database.\n` +
        `  Fix:  stop the other one, then  docker compose up -d`,
    );
  }
}

/** Runs the check and exits 1 with the message, for use as a CLI step. */
export async function runPreflight(): Promise<void> {
  try {
    await assertExpectedRuntime();
  } catch (error) {
    if (error instanceof WrongRuntimeError) {
      console.error(`\n  ✖ ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
