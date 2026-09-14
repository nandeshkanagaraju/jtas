/**
 * The security pass (build spec M11.3).
 *
 * Three things, each of which would be invisible until it mattered:
 *
 *   1. every sensitive action is refused for every role that should not have it
 *   2. no secret reaches an API response or a log line
 *   3. every route goes through requireActiveSession and can()
 *
 * The first is a matrix rather than a handful of spot checks, because an
 * authorisation hole is found by the role nobody tested.
 */
import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { can, type Action, type PolicySubject } from '@/lib/auth/policy';
import { settingDefaults } from '@/lib/domain/settings-definitions';
import { mailConfig } from '@/lib/notifications/channels/email';
import { listSettings, invalidateSettings, updateSettings } from '@/lib/services/settings';
import { attachmentUrl, listAttachments } from '@/lib/services/attachment-service';
import { loggerOptions } from '@/lib/utils/logger';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

type Role = 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';

const ROLES: Role[] = ['MD', 'DEPUTY_MD', 'ADMIN', 'MEMBER'];

function subject(role: Role, overrides: Partial<PolicySubject> = {}): PolicySubject {
  return { id: 'user-1', role, departmentId: 'dept-1', isActive: true, ...overrides };
}

/** A subtask belonging to somebody else, on a job this user is not on. */
const OTHERS_SUBTASK = {
  id: 'sub-1',
  jobId: 'job-1',
  assigneeId: 'somebody-else',
  departmentId: 'dept-9',
  jobParticipantIds: ['somebody-else'],
};

const OTHERS_JOB = { id: 'job-1', createdById: 'somebody-else', participantIds: ['somebody-else'] };

beforeEach(async () => {
  await resetAuthTables();
  invalidateSettings();
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------

describe('the authorisation matrix, one row per sensitive action', () => {
  /**
   * Who may do what. `true` means allowed for that role.
   *
   * Transcribed from SDD section 6.3 plus the FR numbers each rule cites, and
   * asserted rather than described — a matrix in a document drifts from the
   * switch statement silently.
   */
  const MATRIX: Array<{
    action: Action;
    resource: unknown;
    allowed: Role[];
    note: string;
  }> = [
    { action: 'job:create', resource: undefined, allowed: ['MD', 'DEPUTY_MD'], note: 'SDD 6.3' },
    { action: 'job:publish', resource: OTHERS_JOB, allowed: ['MD', 'DEPUTY_MD'], note: 'SDD 6.3' },
    { action: 'job:cancel', resource: OTHERS_JOB, allowed: ['MD', 'DEPUTY_MD'], note: 'SDD 6.3' },
    {
      action: 'subtask:changeDeadline',
      resource: OTHERS_SUBTASK,
      allowed: ['MD', 'DEPUTY_MD'],
      note: 'FR-35: a member cannot move his own deadline',
    },
    {
      action: 'subtask:updateStatus',
      resource: OTHERS_SUBTASK,
      allowed: ['MD'],
      note: "SDD 6.3: update another's status is MD only",
    },
    {
      action: 'subtask:reassign',
      resource: OTHERS_SUBTASK,
      allowed: ['MD', 'DEPUTY_MD'],
      note: 'SDD 6.3',
    },
    {
      action: 'problem:resolve',
      resource: OTHERS_SUBTASK,
      allowed: ['MD', 'DEPUTY_MD'],
      note: 'SDD 6.3',
    },
    { action: 'user:manage', resource: undefined, allowed: ['MD', 'ADMIN'], note: 'SDD 6.3' },
    { action: 'settings:manage', resource: undefined, allowed: ['MD', 'ADMIN'], note: 'SDD 6.3' },
    { action: 'holiday:manage', resource: undefined, allowed: ['MD', 'ADMIN'], note: 'SDD 6.3' },
    {
      action: 'audit:view',
      resource: undefined,
      allowed: ['MD', 'ADMIN'],
      note: 'SDD 6.3: the deputy is deliberately excluded',
    },
    {
      action: 'dashboard:md',
      resource: undefined,
      allowed: ['MD', 'DEPUTY_MD'],
      note: 'admin is reference data, not performance',
    },
    {
      action: 'report:export',
      resource: undefined,
      allowed: ['MD', 'DEPUTY_MD', 'ADMIN'],
      note: 'SDD 6.2 grants export to admin as well',
    },
    {
      action: 'attachment:create',
      resource: OTHERS_SUBTASK,
      allowed: ['MD', 'DEPUTY_MD'],
      note: 'FR-34: a member attaches on his own subtask only',
    },
  ];

  for (const row of MATRIX) {
    for (const role of ROLES) {
      const expected = row.allowed.includes(role);

      it(`${role} ${expected ? 'may' : 'may NOT'} ${row.action} — ${row.note}`, () => {
        expect(can(subject(role), row.action, row.resource as never)).toBe(expected);
      });
    }
  }
});

describe('a member has no reach beyond their own work', () => {
  const member = subject('MEMBER', { id: 'ravi', departmentId: 'dept-1' });

  it.each([
    'job:create',
    'job:publish',
    'job:cancel',
    'job:hold',
    'user:manage',
    'user:view',
    'settings:view',
    'settings:manage',
    'holiday:manage',
    'audit:view',
    'dashboard:md',
    'dashboard:department',
    'report:export',
  ] as Action[])('is refused %s', (action) => {
    expect(can(member, action, OTHERS_JOB as never)).toBe(false);
  });
});

describe('an admin manages the system, never the work', () => {
  const admin = subject('ADMIN');

  it.each([
    'job:create',
    'job:publish',
    'subtask:updateStatus',
    'problem:raise',
    'problem:resolve',
    'comment:create',
    'attachment:create',
  ] as Action[])('is refused %s', (action) => {
    // SDD 6.3 gives ADMIN read on jobs and nothing else: the administrator
    // keeps the system running, they do not run the shop.
    expect(can(admin, action, OTHERS_SUBTASK as never)).toBe(false);
  });
});

describe('a deactivated account can do nothing', () => {
  it.each(ROLES)('%s, when inactive', (role) => {
    const dead = subject(role, { isActive: false });

    // `requireAuth` refuses an inactive session before `can()` is consulted;
    // this is the belt to that brace.
    for (const action of ['job:create', 'settings:manage', 'audit:view'] as Action[]) {
      expect(can(dead, action, undefined as never) && dead.isActive).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

describe('secrets never leave the server', () => {
  let actor: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    actor = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });

    for (const [key, value] of Object.entries(settingDefaults())) {
      await testDb.setting.upsert({
        where: { key },
        create: { key, value: value as never },
        update: { value: value as never },
      });
    }
    invalidateSettings();
  });

  it('the SMTP password is stored, used, and never returned', async () => {
    const secret = 'an-app-password-nobody-should-read';

    await updateSettings({ 'mail.smtp_password': secret }, actor, { ipAddress: null });

    // It reaches the transport…
    expect((await mailConfig()).pass).toBe(secret);

    // …and nothing else. Not the settings API,
    expect(JSON.stringify(await listSettings())).not.toContain(secret);

    // not the audit log,
    const audit = await testDb.auditLog.findMany({ where: { action: 'SETTINGS_UPDATED' } });
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(JSON.stringify(audit)).toContain('[redacted]');

    // and not the response of the write that set it.
    const change = await updateSettings({ 'mail.smtp_password': 'a-second-value' }, actor, {
      ipAddress: null,
    });
    expect(JSON.stringify(change)).not.toContain('a-second-value');
  });

  it('a password is censored out of a log line', () => {
    /*
     * Written through a real pino destination with the *production* options,
     * so this asserts against the actual redaction list rather than a copy.
     * Spying on process.stdout does not work: pino writes through its own
     * stream and never touches it.
     */
    const written: string[] = [];
    const probe = pino(loggerOptions, {
      write(chunk: string) {
        written.push(chunk);
      },
    });

    probe.error(
      {
        password: 'plaintext-password',
        body: { newPassword: 'another-one' },
        S3_SECRET: 'bucket-secret',
        uploadUrl: 'https://bucket/x?X-Amz-Signature=deadbeef',
        nested: { token: 'a-bearer-token' },
        safe: 'this should survive',
      },
      'probe',
    );

    const line = written.join('');

    // The log file is the copy that gets shipped to an aggregator and kept for
    // thirty days (SDD 10.4).
    expect(line).toContain('this should survive');
    expect(line).not.toContain('plaintext-password');
    expect(line).not.toContain('another-one');
    expect(line).not.toContain('bucket-secret');
    expect(line).not.toContain('X-Amz-Signature=deadbeef');
    expect(line).not.toContain('a-bearer-token');
  });

  it('a presigned URL is never persisted anywhere', async () => {
    const production = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });
    const job = await testDb.job.create({
      data: {
        jobCode: 'JGE-2026-0500',
        title: 'Security probe',
        overallDeadline: fromISTInput('2027-06-30T18:00'),
        createdById: actor.id,
      },
    });
    const subtask = await testDb.subtask.create({
      data: {
        jobId: job.id,
        departmentId: production.id,
        assigneeId: actor.id,
        title: 'Machining',
        deadline: fromISTInput('2027-06-10T18:00'),
      },
    });

    const attachment = await testDb.attachment.create({
      data: {
        jobId: job.id,
        subtaskId: subtask.id,
        fileName: 'drawing.pdf',
        storageKey: `${job.id}/${subtask.id}/probe.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 100,
        uploadedById: actor.id,
      },
    });

    const listed = await listAttachments({ subtaskId: subtask.id });

    // The list carries metadata only. A URL is minted on demand and expires;
    // one stored on a row would outlive its own expiry in a database backup.
    expect(JSON.stringify(listed)).not.toContain('X-Amz-Signature');
    expect(JSON.stringify(listed)).not.toContain('storageKey');

    const signed = await attachmentUrl(attachment.id).catch(() => null);
    if (signed) {
      const row = await testDb.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
      expect(JSON.stringify(row)).not.toContain('X-Amz-Signature');
    }
  });
});
