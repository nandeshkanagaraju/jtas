import { describe, expect, it } from 'vitest';

import {
  ALLOWED_DATABASE_SUFFIXES,
  ALLOWED_HOSTS,
  UnsafeDatabaseError,
  assertLocalDisposableDatabase,
  parseDatabaseUrl,
  toTestDatabaseUrl,
  withSchema,
} from '../../scripts/lib/database-url';

/**
 * This guard is the only thing standing between `pnpm db:reset` and a real
 * database. It gets the most direct tests in the repository.
 */
describe('assertLocalDisposableDatabase', () => {
  it('allows a local database whose name marks it disposable', () => {
    for (const host of ALLOWED_HOSTS) {
      for (const suffix of ALLOWED_DATABASE_SUFFIXES) {
        const url = `postgresql://jtas:jtas@${host}:5432/jtas${suffix}`;
        expect(() => assertLocalDisposableDatabase(url), url).not.toThrow();
      }
    }
  });

  it('allows the project defaults', () => {
    expect(() =>
      assertLocalDisposableDatabase('postgresql://jtas:jtas@localhost:5432/jtas_dev?schema=public'),
    ).not.toThrow();
    expect(() =>
      assertLocalDisposableDatabase('postgresql://jtas:jtas@db:5432/jtas_test'),
    ).not.toThrow();
  });

  it('refuses a remote host even when the database name looks disposable', () => {
    const cases = [
      'postgresql://u:p@prod-db.example.com:5432/jtas_dev',
      'postgresql://u:p@10.0.0.5:5432/jtas_test',
      'postgresql://u:p@jtas.internal:5432/jtas_dev',
      // A hostname that merely starts with an allowed value must not pass.
      'postgresql://u:p@localhost.evil.com:5432/jtas_dev',
    ];

    for (const url of cases) {
      expect(() => assertLocalDisposableDatabase(url), url).toThrow(UnsafeDatabaseError);
    }
  });

  it('refuses a local database whose name does not mark it disposable', () => {
    const cases = [
      'postgresql://jtas:jtas@localhost:5432/jtas',
      'postgresql://jtas:jtas@localhost:5432/jtas_production',
      'postgresql://jtas:jtas@127.0.0.1:5432/postgres',
      // `_dev` must be a suffix, not a substring.
      'postgresql://jtas:jtas@localhost:5432/jtas_dev_live',
    ];

    for (const url of cases) {
      expect(() => assertLocalDisposableDatabase(url), url).toThrow(UnsafeDatabaseError);
    }
  });

  it('fails closed on ::1, which is loopback but not on the list', () => {
    // Documented behaviour: the list is exactly the three named hosts. A safe
    // refusal is the correct outcome for anything else.
    expect(() => assertLocalDisposableDatabase('postgresql://u:p@[::1]:5432/jtas_dev')).toThrow(
      UnsafeDatabaseError,
    );
  });

  it('names the rule that failed, so the refusal is actionable', () => {
    try {
      assertLocalDisposableDatabase('postgresql://u:p@prod.example.com:5432/jtas');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeDatabaseError);
      const unsafe = error as UnsafeDatabaseError;
      expect(unsafe.host).toBe('prod.example.com');
      expect(unsafe.database).toBe('jtas');
      expect(unsafe.rule).toMatch(/host must be one of/);
      expect(unsafe.message).toContain('prod.example.com');
    }
  });

  it('checks the host before the database name, so the worst problem is reported', () => {
    try {
      assertLocalDisposableDatabase('postgresql://u:p@prod.example.com:5432/jtas_production');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnsafeDatabaseError).rule).toMatch(/host must be one of/);
    }
  });
});

describe('parseDatabaseUrl', () => {
  it('splits out host, port and database', () => {
    expect(parseDatabaseUrl('postgresql://jtas:jtas@localhost:5432/jtas_dev')).toMatchObject({
      host: 'localhost',
      port: '5432',
      database: 'jtas_dev',
    });
  });

  it('defaults the port to 5432', () => {
    expect(parseDatabaseUrl('postgresql://jtas:jtas@localhost/jtas_dev').port).toBe('5432');
  });

  it('redacts credentials so the URL can be printed', () => {
    const { redacted } = parseDatabaseUrl('postgresql://admin:s3cret@localhost:5432/jtas_dev');
    expect(redacted).not.toContain('s3cret');
    expect(redacted).not.toContain('admin');
    expect(redacted).toContain('jtas_dev');
  });

  it('rejects a URL with no database name', () => {
    expect(() => parseDatabaseUrl('postgresql://jtas:jtas@localhost:5432/')).toThrow(
      /names no database/,
    );
  });

  it('rejects an unparseable URL', () => {
    expect(() => parseDatabaseUrl('not a url')).toThrow(/not a valid URL/);
  });
});

describe('toTestDatabaseUrl', () => {
  it('replaces a _dev suffix rather than appending to it', () => {
    // Without the replacement this would produce `jtas_dev_test`.
    expect(toTestDatabaseUrl('postgresql://jtas:jtas@localhost:5432/jtas_dev')).toBe(
      'postgresql://jtas:jtas@localhost:5432/jtas_test',
    );
  });

  it('appends to a name with no suffix', () => {
    expect(toTestDatabaseUrl('postgresql://jtas:jtas@localhost:5432/jtas')).toBe(
      'postgresql://jtas:jtas@localhost:5432/jtas_test',
    );
  });

  it('preserves credentials, port and query parameters', () => {
    expect(toTestDatabaseUrl('postgresql://user:p%40ss@db:6543/jtas_dev?schema=public')).toBe(
      'postgresql://user:p%40ss@db:6543/jtas_test?schema=public',
    );
  });

  it('is idempotent', () => {
    const already = 'postgresql://jtas:jtas@localhost:5432/jtas_test';
    expect(toTestDatabaseUrl(already)).toBe(already);
  });

  it('never returns the development database', () => {
    const dev = 'postgresql://jtas:jtas@localhost:5432/jtas_dev';
    expect(toTestDatabaseUrl(dev)).not.toBe(dev);
    expect(parseDatabaseUrl(toTestDatabaseUrl(dev)).database).toBe('jtas_test');
  });

  it('refuses a URL with no database name', () => {
    expect(() => toTestDatabaseUrl('postgresql://jtas:jtas@localhost:5432/')).toThrow(
      /no database name/,
    );
  });
});

describe('withSchema', () => {
  it('sets the schema parameter', () => {
    expect(withSchema('postgresql://jtas:jtas@localhost:5432/jtas_test', 'jtas_test_w1')).toContain(
      'schema=jtas_test_w1',
    );
  });

  it('replaces an existing schema rather than adding a second one', () => {
    const url = withSchema(
      'postgresql://jtas:jtas@localhost:5432/jtas_test?schema=public',
      'jtas_test_w2',
    );
    expect(url).toContain('schema=jtas_test_w2');
    expect(url).not.toContain('public');
    expect(url.match(/schema=/g)).toHaveLength(1);
  });
});
