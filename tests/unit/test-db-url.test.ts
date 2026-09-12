import { describe, expect, it } from 'vitest';

import { toTestDatabaseUrl } from '../integration/setup';

/**
 * Guards the redirection that keeps integration tests off the development
 * database. A bug here silently deletes a developer's seeded data, so it is
 * worth a test of its own.
 */
describe('toTestDatabaseUrl', () => {
  it('appends _test to the database name', () => {
    expect(toTestDatabaseUrl('postgresql://jtas:jtas@localhost:5432/jtas')).toBe(
      'postgresql://jtas:jtas@localhost:5432/jtas_test',
    );
  });

  it('preserves credentials, port and query parameters', () => {
    expect(toTestDatabaseUrl('postgresql://user:p%40ss@db.internal:6543/jtas?schema=public')).toBe(
      'postgresql://user:p%40ss@db.internal:6543/jtas_test?schema=public',
    );
  });

  it('is idempotent, so a pre-pointed URL is left alone', () => {
    const already = 'postgresql://jtas:jtas@localhost:5432/jtas_test';
    expect(toTestDatabaseUrl(already)).toBe(already);
  });

  it('refuses a URL with no database name rather than guessing', () => {
    expect(() => toTestDatabaseUrl('postgresql://jtas:jtas@localhost:5432/')).toThrow(
      /no database name/,
    );
  });
});
