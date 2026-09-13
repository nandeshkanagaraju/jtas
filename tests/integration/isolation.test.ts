import { Client } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { login } from '@/lib/services/auth';
import { generateTempPassword } from '@/lib/auth/temp-password';

import { workerSchemaName } from './setup';
import { auditActionsFor, createTestUser, resetAuthTables, testDb } from './helpers/db';

/**
 * Proves the suite is independent of ambient database state.
 *
 * The earlier arrangement pointed these tests at the development database and
 * truncated it, which both destroyed seeded data and meant any assertion on a
 * global count was reading whatever a previous run had left behind. Two things
 * fixed that — a separate `_test` database, and a schema per worker inside it —
 * and this file is the evidence that both hold.
 */

const ctx = { ipAddress: '198.51.100.1' };
/** Generated per run — no credential literal lives in this repository. */
const PASSWORD = generateTempPassword();

/**
 * A test user whose password is the one this file signs in with.
 *
 * `createTestUser` generates its own when none is given — there is no fixture
 * credential in this repository — so a file that logs in has to say which value
 * it means.
 */
const createUser: typeof createTestUser = (options = {}) =>
  createTestUser({ password: PASSWORD, ...options });

beforeEach(async () => {
  await resetAuthTables();
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('connection target', () => {
  it('never points at a development database', () => {
    const url = new URL(process.env.DATABASE_URL!);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

    expect(database, 'integration tests must not touch a _dev database').toMatch(/_test$/);
    expect(database).not.toMatch(/_dev$/);
  });

  it('runs inside a per-worker schema, not public', () => {
    const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema');

    expect(schema).toBe(workerSchemaName());
    expect(schema).toMatch(/^jtas_test_w\d+$/);
    expect(schema).not.toBe('public');
  });

  it('writes to that schema and nowhere else', async () => {
    const user = await createUser({ email: 'schema-check@jaraaglobal.com' });

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
      const { rows } = await client.query<{ schema: string }>(
        `SELECT table_schema AS schema
           FROM information_schema.tables
          WHERE table_name = 'User' AND table_schema = $1`,
        [workerSchemaName()],
      );
      expect(rows).toHaveLength(1);

      // The row landed in the worker schema.
      const inWorkerSchema = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${workerSchemaName()}"."User" WHERE id = $1`,
        [user.id],
      );
      expect(Number(inWorkerSchema.rows[0].count)).toBe(1);

      // And not in public, which carries its own copy of the schema.
      const inPublic = await client
        .query<{ count: string }>(
          `SELECT count(*)::text AS count FROM public."User" WHERE id = $1`,
          [user.id],
        )
        .catch(() => ({ rows: [{ count: '0' }] }));
      expect(Number(inPublic.rows[0].count)).toBe(0);
    } finally {
      await client.end();
    }
  });
});

describe('independence from ambient state', () => {
  /**
   * Writes junk directly into the `public` schema of the same database —
   * exactly the kind of residue an interrupted acceptance run leaves behind.
   * Prisma is bound to the worker schema, so none of it should be visible.
   */
  async function pollutePublicSchema(): Promise<void> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
      // Self-sufficient: on a freshly created test database `public` is empty,
      // so the residue this test simulates has to be created before it can be
      // inserted into. A stand-in table with the columns used below is enough —
      // the point is that rows exist in `public` at all.
      await client.query(`
        CREATE TABLE IF NOT EXISTS public."AuditLog" (
          id          text PRIMARY KEY,
          action      text NOT NULL,
          "entityType" text NOT NULL,
          "entityId"  text NOT NULL,
          "ipAddress" text,
          "createdAt" timestamptz NOT NULL DEFAULT now()
        )
      `);

      for (let i = 0; i < 25; i++) {
        await client.query(
          `INSERT INTO public."AuditLog" (id, action, "entityType", "entityId", "ipAddress")
           VALUES ($1, 'LOGIN_SUCCESS', 'SESSION', $2, '203.0.113.99')`,
          [`junk-public-${i}-${Date.now()}`, `junk-entity-${i}`],
        );
      }
    } finally {
      await client.end();
    }
  }

  it('does not see audit rows sitting in the public schema', async () => {
    await pollutePublicSchema();

    // The worker schema was just reset, so this must be exactly zero however
    // much residue exists next door.
    expect(await testDb.auditLog.count()).toBe(0);
  });

  it('produces the same result whether or not the database is dirty', async () => {
    const user = await createUser({ email: 'dirty-check@jaraaglobal.com' });

    // Junk inside the worker's own schema too: audit rows for other entities,
    // other users, and spare refresh tokens.
    const noise = await createUser({ email: 'noise@jaraaglobal.com' });
    for (let i = 0; i < 30; i++) {
      await testDb.auditLog.create({
        data: {
          actorId: noise.id,
          action: 'LOGIN_SUCCESS',
          entityType: 'SESSION',
          entityId: noise.id,
          ipAddress: '203.0.113.50',
        },
      });
    }
    await pollutePublicSchema();

    await login({ email: user.email, password: PASSWORD, rememberDevice: false }, ctx);

    // Scoped by entity id, so the 30 noise rows and the 50 public rows are
    // irrelevant. A test asserting on a global count would fail here.
    expect(await auditActionsFor(user.id)).toEqual(['LOGIN_SUCCESS']);

    const sessions = await testDb.refreshToken.count({ where: { userId: user.id } });
    expect(sessions).toBe(1);
  });

  it('survives residue left by a previous, interrupted run', async () => {
    // Simulate a half-finished run: a user with the same address a later test
    // will create, plus a stale locked account and orphaned tokens.
    const stale = await createUser({
      email: 'interrupted@jaraaglobal.com',
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 60 * 60_000),
    });
    await testDb.refreshToken.create({
      data: {
        userId: stale.id,
        familyId: 'stale-family',
        tokenHash: 'stale-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    // The reset each spec performs in beforeEach is what makes the next test
    // deterministic; prove it clears everything this file created.
    await resetAuthTables();

    expect(await testDb.user.count()).toBe(0);
    expect(await testDb.auditLog.count()).toBe(0);
    expect(await testDb.refreshToken.count()).toBe(0);

    // And a fresh flow behaves exactly as it would on a virgin database.
    const user = await createUser({ email: 'interrupted@jaraaglobal.com' });
    await login({ email: user.email, password: PASSWORD, rememberDevice: false }, ctx);
    expect(await auditActionsFor(user.id)).toEqual(['LOGIN_SUCCESS']);
  });
});
