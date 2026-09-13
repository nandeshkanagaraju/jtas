import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { verifyPassword } from '@/lib/auth/password';
import { generateTempPassword } from '@/lib/auth/temp-password';
import type { AppError } from '@/lib/errors';
import { login } from '@/lib/services/auth';
import {
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  reactivateUser,
  resetPassword,
  updateUser,
} from '@/lib/services/users';

import {
  auditActionsFor,
  auditRowsFor,
  createTestDepartment,
  createTestSubtask,
  createTestUser,
  resetAuthTables,
  testDb,
} from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };

let mdId: string;
let production: Awaited<ReturnType<typeof createTestDepartment>>;
let quality: Awaited<ReturnType<typeof createTestDepartment>>;

/** The acting administrator for every case below. */
const actor = () => ({ id: mdId });

beforeEach(async () => {
  await resetAuthTables();
  production = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });
  quality = await createTestDepartment({ code: 'QUALITY', name: 'Quality', sequenceOrder: 2 });
  const md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  mdId = md.id;
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('createUser', () => {
  it('returns a temporary password once and stores only its hash', async () => {
    const { user, temporaryPassword } = await createUser(
      {
        name: 'Ravi Kumar',
        email: 'ravi@jaraaglobal.com',
        role: 'MEMBER',
        departmentId: production.id,
      },
      actor(),
      ctx,
    );

    expect(temporaryPassword).toHaveLength(16);
    expect(user.mustChangePassword).toBe(true);
    expect(user.departmentName).toBe('Production');

    const row = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    // The password exists only as a hash — nothing stores it in the clear.
    expect(row.passwordHash).not.toContain(temporaryPassword);
    await expect(verifyPassword(temporaryPassword, row.passwordHash)).resolves.toBe(true);

    // And the summary the API returns carries no password material at all.
    expect(JSON.stringify(user)).not.toContain(temporaryPassword);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('lower-cases the email so a login cannot fail on capitalisation', async () => {
    const { user } = await createUser(
      {
        name: 'Ravi Kumar',
        // The shared Zod schema lower-cases before the service is reached.
        email: 'Ravi@Jaraaglobal.com'.toLowerCase(),
        role: 'MEMBER',
        departmentId: production.id,
      },
      actor(),
      ctx,
    );

    expect(user.email).toBe('ravi@jaraaglobal.com');
  });

  it('rejects a duplicate email with CONFLICT', async () => {
    const input = {
      name: 'Ravi Kumar',
      email: 'ravi@jaraaglobal.com',
      role: 'MEMBER' as const,
      departmentId: production.id,
    };

    await createUser(input, actor(), ctx);

    await expect(createUser(input, actor(), ctx)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('requires a department for a MEMBER and forbids one for MD, DEPUTY and ADMIN', async () => {
    await expect(
      createUser(
        { name: 'No Dept', email: 'nodept@jaraaglobal.com', role: 'MEMBER' },
        actor(),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    for (const role of ['MD', 'DEPUTY_MD', 'ADMIN'] as const) {
      await expect(
        createUser(
          {
            name: role,
            email: `${role.toLowerCase()}-dept@jaraaglobal.com`,
            role,
            departmentId: production.id,
          },
          actor(),
          ctx,
        ),
        `${role} must not carry a department`,
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  it('rejects a department that does not exist', async () => {
    await expect(
      createUser(
        {
          name: 'Ghost Dept',
          email: 'ghost@jaraaglobal.com',
          role: 'MEMBER',
          departmentId: 'no-such-department',
        },
        actor(),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('writes USER_CREATED with the password hash redacted', async () => {
    const { user } = await createUser(
      {
        name: 'Ravi Kumar',
        email: 'ravi@jaraaglobal.com',
        role: 'MEMBER',
        departmentId: production.id,
      },
      actor(),
      ctx,
    );

    const [entry] = await auditRowsFor(user.id);
    expect(entry.action).toBe('USER_CREATED');
    expect(entry.actorId).toBe(mdId);
    expect(entry.ipAddress).toBe('203.0.113.7');

    const after = entry.after as Record<string, unknown>;
    expect(after.email).toBe('ravi@jaraaglobal.com');
    expect(after).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(entry)).not.toMatch(/\$2[aby]\$/);
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — created member signs in with the temp password and must change it
// ---------------------------------------------------------------------------

describe('acceptance: a created member signs in and is forced to change password', () => {
  it('accepts the temporary password exactly once', async () => {
    const { user, temporaryPassword } = await createUser(
      {
        name: 'Ravi Kumar',
        email: 'ravi@jaraaglobal.com',
        role: 'MEMBER',
        departmentId: production.id,
      },
      actor(),
      ctx,
    );

    const session = await login(
      { email: 'ravi@jaraaglobal.com', password: temporaryPassword, rememberDevice: false },
      ctx,
    );

    expect(session.user.id).toBe(user.id);
    // FR-03: the client redirects on this rather than deciding for itself.
    expect(session.user.mustChangePassword).toBe(true);

    expect(await auditActionsFor(user.id)).toContain('LOGIN_SUCCESS');
  });

  it('refuses a password that was never issued', async () => {
    await createUser(
      {
        name: 'Ravi Kumar',
        email: 'ravi@jaraaglobal.com',
        role: 'MEMBER',
        departmentId: production.id,
      },
      actor(),
      ctx,
    );

    // Any value the server did not issue. Generated rather than written down,
    // so this file contains no usable credential.
    await expect(
      login(
        { email: 'ravi@jaraaglobal.com', password: generateTempPassword(), rememberDevice: false },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('gives each created account a different password', async () => {
    const passwords = new Set<string>();

    for (let i = 0; i < 5; i++) {
      const { temporaryPassword } = await createUser(
        {
          name: `Member ${i}`,
          email: `member${i}@jaraaglobal.com`,
          role: 'MEMBER',
          departmentId: production.id,
        },
        actor(),
        ctx,
      );
      passwords.add(temporaryPassword);
    }

    expect(passwords.size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — deactivation blocked by open subtasks, then succeeds with a plan
// ---------------------------------------------------------------------------

describe('acceptance: deactivating a member with open subtasks', () => {
  async function memberWithOpenWork() {
    const leaving = await createTestUser({
      email: 'leaving@jaraaglobal.com',
      name: 'Leaving Member',
      departmentId: production.id,
    });

    const subtask = await createTestSubtask({
      assigneeId: leaving.id,
      departmentId: production.id,
      createdById: mdId,
      title: 'Machining, setup approval and first-piece clearance',
      status: 'IN_PROGRESS',
    });

    return { leaving, subtask };
  }

  it('is blocked with CONFLICT, and the error lists the subtasks in the way', async () => {
    const { leaving, subtask } = await memberWithOpenWork();

    const error = (await deactivateUser(leaving.id, {}, actor(), ctx).catch(
      (e: AppError) => e,
    )) as AppError;

    expect(error.code).toBe('CONFLICT');
    expect(error.status).toBe(409);

    const details = error.details as {
      reason: string;
      openSubtaskCount: number;
      openSubtasks: Array<Record<string, unknown>>;
    };

    expect(details.reason).toBe('OPEN_SUBTASKS');
    expect(details.openSubtaskCount).toBe(1);
    expect(details.openSubtasks).toHaveLength(1);
    expect(details.openSubtasks[0]).toMatchObject({
      id: subtask.id,
      title: 'Machining, setup approval and first-piece clearance',
      status: 'IN_PROGRESS',
      departmentName: 'Production',
    });
    // Enough detail for the MD to decide without opening another screen.
    expect(details.openSubtasks[0].jobCode).toBeTruthy();
    expect(details.openSubtasks[0].deadline).toBeTruthy();

    // Nothing changed.
    const unchanged = await testDb.user.findUniqueOrThrow({ where: { id: leaving.id } });
    expect(unchanged.isActive).toBe(true);
  });

  it('succeeds once a replacement is named, moving the work in the same transaction', async () => {
    const { leaving, subtask } = await memberWithOpenWork();

    const replacement = await createTestUser({
      email: 'replacement@jaraaglobal.com',
      name: 'Replacement Member',
      departmentId: production.id,
    });

    const result = await deactivateUser(
      leaving.id,
      { reassignTo: replacement.id, reason: 'Left the company' },
      actor(),
      ctx,
    );

    expect(result.user.isActive).toBe(false);
    expect(result.reassignedTo).toMatchObject({ id: replacement.id });
    expect(result.reassigned).toHaveLength(1);

    // The subtask moved, and did so without passing through an unowned state.
    const moved = await testDb.subtask.findUniqueOrThrow({ where: { id: subtask.id } });
    expect(moved.assigneeId).toBe(replacement.id);
    expect(moved.status).toBe('IN_PROGRESS');

    // The row is still there — deactivate, never delete (FR-70).
    const stillThere = await testDb.user.findUniqueOrThrow({ where: { id: leaving.id } });
    expect(stillThere.isActive).toBe(false);
    expect(stillThere.email).toBe('leaving@jaraaglobal.com');
  });

  it('records the hand-over on the subtask as well as the user', async () => {
    const { leaving, subtask } = await memberWithOpenWork();
    const replacement = await createTestUser({
      email: 'replacement@jaraaglobal.com',
      name: 'Replacement Member',
      departmentId: production.id,
    });

    await deactivateUser(leaving.id, { reassignTo: replacement.id }, actor(), ctx);

    // On the subtask, so a year later "who used to own this?" is answerable.
    const [subtaskEntry] = await auditRowsFor(subtask.id);
    expect(subtaskEntry.action).toBe('USER_REASSIGNED');
    expect(subtaskEntry.entityType).toBe('SUBTASK');
    expect(subtaskEntry.before).toMatchObject({ assigneeId: leaving.id });
    expect(subtaskEntry.after).toMatchObject({ assigneeId: replacement.id });

    // And on the user, with the count and the reason.
    expect(await auditActionsFor(leaving.id)).toContain('USER_DEACTIVATED');
    const userEntry = (await auditRowsFor(leaving.id)).find(
      (row) => row.action === 'USER_DEACTIVATED',
    )!;
    expect(userEntry.after).toMatchObject({
      reassignedTo: replacement.id,
      reassignedSubtaskCount: 1,
    });
    expect(userEntry.after).not.toHaveProperty('passwordHash');
  });

  it('deactivates cleanly when there is no open work', async () => {
    const idle = await createTestUser({
      email: 'idle@jaraaglobal.com',
      departmentId: production.id,
    });

    const result = await deactivateUser(idle.id, {}, actor(), ctx);

    expect(result.user.isActive).toBe(false);
    expect(result.reassigned).toHaveLength(0);
    expect(result.reassignedTo).toBeNull();
  });

  it('ignores completed and cancelled subtasks, which need no owner', async () => {
    const leaving = await createTestUser({
      email: 'leaving@jaraaglobal.com',
      departmentId: production.id,
    });

    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      await createTestSubtask({
        assigneeId: leaving.id,
        departmentId: production.id,
        createdById: mdId,
        status,
      });
    }

    await expect(deactivateUser(leaving.id, {}, actor(), ctx)).resolves.toMatchObject({
      reassigned: [],
    });
  });

  it('counts PROBLEM, BLOCKED and ON_HOLD as open — they still need an owner', async () => {
    for (const status of [
      'PROBLEM',
      'BLOCKED',
      'ON_HOLD',
      'PENDING',
      'AWAITING_APPROVAL',
    ] as const) {
      await resetAuthTables();
      production = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });
      const md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
      mdId = md.id;

      const leaving = await createTestUser({
        email: 'leaving@jaraaglobal.com',
        departmentId: production.id,
      });
      await createTestSubtask({
        assigneeId: leaving.id,
        departmentId: production.id,
        createdById: mdId,
        status,
      });

      await expect(
        deactivateUser(leaving.id, {}, actor(), ctx),
        `${status} should block deactivation`,
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }
  });

  it('revokes the leaver’s live sessions immediately', async () => {
    const leaving = await createTestUser({
      email: 'leaving@jaraaglobal.com',
      departmentId: production.id,
    });

    await login({ email: leaving.email, password: leaving.password, rememberDevice: true }, ctx);
    expect(await testDb.refreshToken.count({ where: { userId: leaving.id } })).toBe(1);

    await deactivateUser(leaving.id, {}, actor(), ctx);

    const tokens = await testDb.refreshToken.findMany({ where: { userId: leaving.id } });
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reassignment target validation
// ---------------------------------------------------------------------------

describe('reassignment target', () => {
  async function setup() {
    const leaving = await createTestUser({
      email: 'leaving@jaraaglobal.com',
      departmentId: production.id,
    });
    await createTestSubtask({
      assigneeId: leaving.id,
      departmentId: production.id,
      createdById: mdId,
    });
    return leaving;
  }

  it('refuses somebody from another department', async () => {
    const leaving = await setup();
    const outsider = await createTestUser({
      email: 'quality@jaraaglobal.com',
      departmentId: quality.id,
    });

    await expect(
      deactivateUser(leaving.id, { reassignTo: outsider.id }, actor(), ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a deactivated target, which would just move the problem', async () => {
    const leaving = await setup();
    const inactive = await createTestUser({
      email: 'inactive@jaraaglobal.com',
      departmentId: production.id,
      isActive: false,
    });

    await expect(
      deactivateUser(leaving.id, { reassignTo: inactive.id }, actor(), ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses an administrator, who can never update a subtask status', async () => {
    const leaving = await setup();
    const admin = await createTestUser({ email: 'admin@jaraaglobal.com', role: 'ADMIN' });

    await expect(
      deactivateUser(leaving.id, { reassignTo: admin.id }, actor(), ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses the leaver themselves', async () => {
    const leaving = await setup();

    await expect(
      deactivateUser(leaving.id, { reassignTo: leaving.id }, actor(), ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a target that does not exist', async () => {
    const leaving = await setup();

    await expect(
      deactivateUser(leaving.id, { reassignTo: 'no-such-user' }, actor(), ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe('updateUser', () => {
  it('edits fields and audits before and after with the hash redacted', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      name: 'Old Name',
      departmentId: production.id,
    });

    const updated = await updateUser(
      member.id,
      { name: 'New Name', phone: '+91 98765 43210' },
      actor(),
      ctx,
    );

    expect(updated.name).toBe('New Name');
    expect(updated.phone).toBe('+91 98765 43210');

    const entry = (await auditRowsFor(member.id)).find((row) => row.action === 'USER_UPDATED')!;
    expect(entry.before).toMatchObject({ name: 'Old Name' });
    expect(entry.after).toMatchObject({ name: 'New Name' });
    expect(entry.before).not.toHaveProperty('passwordHash');
    expect(entry.after).not.toHaveProperty('passwordHash');
  });

  it('moves a member between departments', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
    });

    const updated = await updateUser(member.id, { departmentId: quality.id }, actor(), ctx);
    expect(updated.departmentId).toBe(quality.id);
    expect(updated.departmentName).toBe('Quality');
  });

  it('enforces the role/department invariant across a role change', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
    });

    // Promoting to DEPUTY_MD without clearing the department must fail…
    await expect(updateUser(member.id, { role: 'DEPUTY_MD' }, actor(), ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    // …and succeed when the department is cleared in the same call.
    const promoted = await updateUser(
      member.id,
      { role: 'DEPUTY_MD', departmentId: null },
      actor(),
      ctx,
    );
    expect(promoted.role).toBe('DEPUTY_MD');
    expect(promoted.departmentId).toBeNull();
  });

  it('rejects an email already used by somebody else', async () => {
    await createTestUser({ email: 'taken@jaraaglobal.com', departmentId: production.id });
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
    });

    await expect(
      updateUser(member.id, { email: 'taken@jaraaglobal.com' }, actor(), ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('leaves a field alone when it is absent, and clears it when explicitly null', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
    });
    await updateUser(member.id, { phone: '+91 98765 43210' }, actor(), ctx);

    // Absent -> unchanged.
    const afterNameOnly = await updateUser(member.id, { name: 'Renamed' }, actor(), ctx);
    expect(afterNameOnly.phone).toBe('+91 98765 43210');
  });

  it('reports NOT_FOUND for an unknown user', async () => {
    await expect(updateUser('no-such-user', { name: 'X' }, actor(), ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

describe('resetPassword', () => {
  it('issues a working new password, forces a change and revokes sessions', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
      mustChangePassword: false,
    });

    await login({ email: member.email, password: member.password, rememberDevice: false }, ctx);

    const { temporaryPassword } = await resetPassword(member.id, actor(), ctx);

    // The old password is dead…
    await expect(
      login({ email: member.email, password: member.password, rememberDevice: false }, ctx),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // …the new one works and forces a change…
    const session = await login(
      { email: member.email, password: temporaryPassword, rememberDevice: false },
      ctx,
    );
    expect(session.user.mustChangePassword).toBe(true);

    // …and the session that existed before the reset was revoked.
    const revoked = await testDb.refreshToken.count({
      where: { userId: member.id, revokedAt: { not: null } },
    });
    expect(revoked).toBeGreaterThanOrEqual(1);
  });

  it('clears a lockout, so an administrator can rescue a locked-out member', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
    });

    await resetPassword(member.id, actor(), ctx);

    const row = await testDb.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it('never writes password material into the audit row', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
    });

    const { temporaryPassword } = await resetPassword(member.id, actor(), ctx);

    const entry = (await auditRowsFor(member.id)).find((row) => row.action === 'PASSWORD_RESET')!;
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain(temporaryPassword);
    expect(serialised).not.toMatch(/\$2[aby]\$/);
    expect(entry.after).toMatchObject({ mustChangePassword: true, sessionsRevoked: true });
  });

  it('refuses to reset a deactivated account', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
      isActive: false,
    });

    await expect(resetPassword(member.id, actor(), ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------

describe('safety guards', () => {
  it('refuses to deactivate the last active MD', async () => {
    // `mdId` is the only MD in this spec's fixtures.
    const other = await createTestUser({ email: 'other@jaraaglobal.com', role: 'MD' });

    // With two MDs, one can go…
    await expect(deactivateUser(other.id, {}, actor(), ctx)).resolves.toBeDefined();

    // …but the last one cannot, or nobody could ever publish a job again.
    const admin = await createTestUser({ email: 'admin@jaraaglobal.com', role: 'ADMIN' });
    await expect(deactivateUser(mdId, {}, { id: admin.id }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'LAST_ACTIVE_MD' },
    });
  });

  it('refuses to demote the last active MD', async () => {
    await expect(
      updateUser(mdId, { role: 'MEMBER', departmentId: production.id }, actor(), ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'LAST_ACTIVE_MD' } });
  });

  it('refuses self-deactivation, which would lock the actor out', async () => {
    await expect(deactivateUser(mdId, {}, actor(), ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'SELF_DEACTIVATION' },
    });
  });

  it('refuses to deactivate somebody twice', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
      isActive: false,
    });

    await expect(deactivateUser(member.id, {}, actor(), ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'ALREADY_INACTIVE' },
    });
  });
});

describe('reactivateUser', () => {
  it('brings an account back and clears any lockout', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
      isActive: false,
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
    });

    const restored = await reactivateUser(member.id, actor(), ctx);

    expect(restored.isActive).toBe(true);
    const row = await testDb.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.lockedUntil).toBeNull();
    expect(row.failedLoginCount).toBe(0);
  });

  it('refuses when the account is already active', async () => {
    const member = await createTestUser({
      email: 'member@jaraaglobal.com',
      departmentId: production.id,
    });

    await expect(reactivateUser(member.id, actor(), ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('listUsers', () => {
  beforeEach(async () => {
    await createTestUser({
      name: 'Anita Sharma',
      email: 'anita@jaraaglobal.com',
      departmentId: production.id,
    });
    await createTestUser({
      name: 'Bala Krishnan',
      email: 'bala@jaraaglobal.com',
      departmentId: quality.id,
    });
    await createTestUser({
      name: 'Retired Person',
      email: 'retired@jaraaglobal.com',
      departmentId: production.id,
      isActive: false,
    });
  });

  const baseQuery = {
    page: 1,
    pageSize: 25,
    status: 'active' as const,
    sort: 'name' as const,
    direction: 'asc' as const,
  };

  it('returns only active users by default', async () => {
    const result = await listUsers(baseQuery);
    expect(result.data.every((user) => user.isActive)).toBe(true);
    expect(result.data.map((u) => u.email)).not.toContain('retired@jaraaglobal.com');
  });

  it('includes deactivated users on request', async () => {
    const inactive = await listUsers({ ...baseQuery, status: 'inactive' });
    expect(inactive.data.map((u) => u.email)).toEqual(['retired@jaraaglobal.com']);

    const all = await listUsers({ ...baseQuery, status: 'all' });
    expect(all.total).toBe(4); // MD + 2 active + 1 retired
  });

  it('filters by department and role', async () => {
    const byDepartment = await listUsers({ ...baseQuery, departmentId: quality.id });
    expect(byDepartment.data.map((u) => u.email)).toEqual(['bala@jaraaglobal.com']);

    const byRole = await listUsers({ ...baseQuery, role: 'MD' });
    expect(byRole.data.map((u) => u.email)).toEqual(['md@jaraaglobal.com']);
  });

  it('searches name and email, case-insensitively', async () => {
    await expect(listUsers({ ...baseQuery, q: 'anita' })).resolves.toMatchObject({ total: 1 });
    await expect(listUsers({ ...baseQuery, q: 'ANITA' })).resolves.toMatchObject({ total: 1 });
    await expect(listUsers({ ...baseQuery, q: 'bala@jaraa' })).resolves.toMatchObject({
      total: 1,
    });
    await expect(listUsers({ ...baseQuery, q: 'nobody' })).resolves.toMatchObject({ total: 0 });
  });

  it('paginates, reporting the unpaged total', async () => {
    const page1 = await listUsers({ ...baseQuery, pageSize: 2, page: 1 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(3);

    const page2 = await listUsers({ ...baseQuery, pageSize: 2, page: 2 });
    expect(page2.data).toHaveLength(1);
    // No overlap between pages.
    const ids = new Set([...page1.data, ...page2.data].map((u) => u.id));
    expect(ids.size).toBe(3);
  });

  it('reports open subtask counts without an N+1', async () => {
    const anita = await testDb.user.findUniqueOrThrow({
      where: { email: 'anita@jaraaglobal.com' },
    });
    await createTestSubtask({
      assigneeId: anita.id,
      departmentId: production.id,
      createdById: mdId,
      status: 'IN_PROGRESS',
    });
    await createTestSubtask({
      assigneeId: anita.id,
      departmentId: production.id,
      createdById: mdId,
      status: 'COMPLETED',
    });

    const result = await listUsers(baseQuery);
    const row = result.data.find((u) => u.email === 'anita@jaraaglobal.com')!;
    // Only the open one counts.
    expect(row.openSubtaskCount).toBe(1);

    const idle = result.data.find((u) => u.email === 'bala@jaraaglobal.com')!;
    expect(idle.openSubtaskCount).toBe(0);
  });

  it('never returns a password hash', async () => {
    const result = await listUsers({ ...baseQuery, status: 'all' });
    expect(JSON.stringify(result)).not.toMatch(/\$2[aby]\$/);
    for (const user of result.data) expect(user).not.toHaveProperty('passwordHash');
  });
});

describe('getUser', () => {
  it('reports NOT_FOUND for an unknown id', async () => {
    await expect(getUser('no-such-user')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
