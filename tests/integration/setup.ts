/**
 * Integration-test environment.
 *
 * Redirects `DATABASE_URL` to a sibling `_test` database before any Prisma
 * client is constructed. These suites truncate tables between cases, and
 * pointing them at the development database would silently delete the seeded
 * users a developer is working with.
 *
 * Create and migrate it once with `pnpm db:test:setup`.
 */
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

const configured = process.env.DATABASE_URL;

if (!configured) {
  throw new Error(
    'Integration tests need DATABASE_URL. Copy .env.example to .env and run pnpm docker:up.',
  );
}

/** Appends `_test` to the database name, leaving credentials and params intact. */
export function toTestDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');

  if (!name) throw new Error(`DATABASE_URL has no database name: ${url}`);
  if (name.endsWith('_test')) return url;

  parsed.pathname = `/${name}_test`;
  return parsed.toString();
}

process.env.DATABASE_URL = toTestDatabaseUrl(configured);
