/**
 * Safety guard for destructive database commands.
 *
 * The rule is deliberately narrow and has **no override flag and no environment
 * escape hatch**. A guard with a bypass is a guard that gets bypassed at 2am.
 * Anyone who genuinely needs to reset a non-local database can invoke the
 * Prisma CLI directly and own that decision explicitly.
 */

/**
 * Hosts a destructive command may target. Exactly the three that can only mean
 * a developer's own machine or the docker-compose network.
 *
 * `::1` is deliberately *not* included: it is loopback, but widening a safety
 * list beyond what was specified is how guards erode. It fails closed.
 */
export const ALLOWED_HOSTS = ['localhost', '127.0.0.1', 'db'] as const;

/** A database name must advertise that it is disposable. */
export const ALLOWED_DATABASE_SUFFIXES = ['_dev', '_test'] as const;

export interface ParsedDatabaseUrl {
  host: string;
  port: string;
  database: string;
  /** The URL with credentials replaced, safe to print. */
  redacted: string;
}

/** Thrown when a URL fails the guard. Carries the parts, for a useful message. */
export class UnsafeDatabaseError extends Error {
  readonly host: string;
  readonly database: string;
  readonly rule: string;

  constructor(parts: { host: string; database: string; rule: string }) {
    super(
      `Refusing to run a destructive command.\n` +
        `  host:     ${parts.host}\n` +
        `  database: ${parts.database}\n` +
        `  rule:     ${parts.rule}`,
    );
    this.name = 'UnsafeDatabaseError';
    this.host = parts.host;
    this.database = parts.database;
    this.rule = parts.rule;
  }
}

/**
 * Splits a PostgreSQL connection URL into the parts the guard checks.
 *
 * @throws {Error} when the URL is unparseable or names no database.
 */
export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error(`DATABASE_URL names no database: ${url}`);
  }

  const redacted = new URL(url);
  if (redacted.username) redacted.username = '***';
  if (redacted.password) redacted.password = '***';

  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database,
    redacted: redacted.toString(),
  };
}

/**
 * Allows a destructive command only against an obviously disposable local
 * database.
 *
 * @throws {UnsafeDatabaseError} naming the exact rule that failed.
 */
export function assertLocalDisposableDatabase(url: string): ParsedDatabaseUrl {
  const parts = parseDatabaseUrl(url);

  if (!(ALLOWED_HOSTS as readonly string[]).includes(parts.host)) {
    throw new UnsafeDatabaseError({
      host: parts.host,
      database: parts.database,
      rule: `host must be one of ${ALLOWED_HOSTS.join(', ')} — "${parts.host}" is not local`,
    });
  }

  const suffixOk = ALLOWED_DATABASE_SUFFIXES.some((suffix) => parts.database.endsWith(suffix));
  if (!suffixOk) {
    throw new UnsafeDatabaseError({
      host: parts.host,
      database: parts.database,
      rule:
        `database name must end in ${ALLOWED_DATABASE_SUFFIXES.join(' or ')} — ` +
        `"${parts.database}" does not`,
    });
  }

  return parts;
}

/**
 * The integration-test database for a given development URL.
 *
 * A trailing `_dev` is replaced rather than appended to, so `jtas_dev` becomes
 * `jtas_test` and not `jtas_dev_test`.
 */
export function toTestDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (!name) throw new Error(`DATABASE_URL has no database name: ${url}`);
  if (name.endsWith('_test')) return url;

  parsed.pathname = `/${name.replace(/_dev$/, '')}_test`;
  return parsed.toString();
}

/** Replaces the `?schema=` parameter, used for per-worker test isolation. */
export function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}
