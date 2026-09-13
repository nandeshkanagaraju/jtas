/**
 * Holidays, the audit viewer and template management (build spec M9.3–M9.5).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auditCsv,
  auditFacets,
  diffOf,
  jobAuditTrail,
  listAudit,
} from '@/lib/services/audit-query';
import {
  addHolidays,
  listHolidays,
  parseHolidayCsv,
  removeHoliday,
} from '@/lib/services/holiday-service';
import { createTemplate, setTemplateActive, updateTemplate } from '@/lib/services/templates';
import { createJob, publishJob } from '@/lib/services/jobs';
import { bulkCreateSubtasks } from '@/lib/services/subtasks';
import { settingDefaults } from '@/lib/domain/settings-definitions';
import { updateSettings } from '@/lib/services/settings';
import { loadWorkingHours } from '@/lib/notifications/config';
import { nextWorkingSlot } from '@/lib/notifications/working-hours';
import { invalidateSettings } from '@/lib/services/settings';
import { fromISTInput, istDateKey } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };

let actor: Awaited<ReturnType<typeof createTestUser>>;
let production: Awaited<ReturnType<typeof createTestDepartment>>;
let quality: Awaited<ReturnType<typeof createTestDepartment>>;

beforeEach(async () => {
  await resetAuthTables();
  await testDb.holiday.deleteMany();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.jobTemplateItem.deleteMany();
  await testDb.jobTemplate.deleteMany();
  invalidateSettings();

  actor = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  production = await createTestDepartment({
    code: 'PRODUCTION',
    name: 'Production',
    sequenceOrder: 1,
  });
  quality = await createTestDepartment({ code: 'QUALITY', name: 'Quality', sequenceOrder: 2 });
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.holiday.deleteMany();
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------

describe('the holiday calendar', () => {
  it('adds a holiday and lists it as an IST day', async () => {
    const { added } = await addHolidays([{ date: '2027-01-26', name: 'Republic Day' }], actor, ctx);

    expect(added).toEqual([{ id: expect.any(String), date: '2027-01-26', name: 'Republic Day' }]);

    const [row] = await listHolidays();
    expect(row.date).toBe('2027-01-26');

    // Stored as IST midnight, so the day key round-trips rather than sliding
    // to the 25th for anyone reading it as UTC.
    const stored = await testDb.holiday.findFirstOrThrow();
    expect(istDateKey(stored.date)).toBe('2027-01-26');
  });

  it('is idempotent, so importing the annual list twice leaves one Diwali', async () => {
    await addHolidays([{ date: '2027-11-05', name: 'Diwali' }], actor, ctx);
    const second = await addHolidays([{ date: '2027-11-05', name: 'Diwali' }], actor, ctx);

    expect(second.added).toHaveLength(0);
    expect(second.alreadyPresent).toHaveLength(1);
    expect(await testDb.holiday.count()).toBe(1);
  });

  it('imports a mixed batch, reporting what was new', async () => {
    await addHolidays([{ date: '2027-01-26', name: 'Republic Day' }], actor, ctx);

    const result = await addHolidays(
      [
        { date: '2027-01-26', name: 'Republic Day' },
        { date: '2027-08-15', name: 'Independence Day' },
      ],
      actor,
      ctx,
    );

    // Refusing the whole import over one overlapping fixed date helps nobody.
    expect(result.added.map((row) => row.date)).toEqual(['2027-08-15']);
    expect(result.alreadyPresent.map((row) => row.date)).toEqual(['2027-01-26']);
  });

  it('refuses a date that does not exist', async () => {
    await expect(
      addHolidays([{ date: '2027-02-31', name: 'Nonsense' }], actor, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a holiday with no name', async () => {
    await expect(addHolidays([{ date: '2027-03-01', name: '' }], actor, ctx)).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' },
    );
  });

  it('filters to a range, inclusive of the last day', async () => {
    await addHolidays(
      [
        { date: '2027-01-01', name: 'New Year' },
        { date: '2027-01-26', name: 'Republic Day' },
        { date: '2027-03-01', name: 'Holi' },
      ],
      actor,
      ctx,
    );

    const january = await listHolidays({ from: '2027-01-01', to: '2027-01-26' });
    expect(january.map((row) => row.date)).toEqual(['2027-01-01', '2027-01-26']);
  });

  it('removes a holiday and audits it', async () => {
    const { added } = await addHolidays([{ date: '2027-05-01', name: 'May Day' }], actor, ctx);

    await removeHoliday(added[0].id, actor, ctx);

    expect(await testDb.holiday.count()).toBe(0);
    const rows = await testDb.auditLog.findMany({ where: { action: 'HOLIDAY_REMOVED' } });
    expect(rows[0].entityId).toBe('2027-05-01');
  });

  it('refuses to remove a holiday more than a year old', async () => {
    const old = new Date(Date.now() - 400 * 24 * 3_600_000);
    const row = await testDb.holiday.create({ data: { date: old, name: 'Old shutdown' } });

    // Deleting it would silently change what "working day" meant when last
    // year's on-time figures were computed.
    await expect(removeHoliday(row.id, actor, ctx)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('shifts a reminder that would have landed on a holiday', async () => {
    await addHolidays([{ date: '2027-06-10', name: 'Factory shutdown' }], actor, ctx);
    invalidateSettings();

    const config = await loadWorkingHours(testDb);
    const onTheHoliday = fromISTInput('2027-06-10T11:00');

    // The acceptance criterion: 11 AM on a shutdown day moves to 9 AM the next
    // working morning.
    expect(nextWorkingSlot(onTheHoliday, config).toISOString()).toBe(
      fromISTInput('2027-06-11T09:00').toISOString(),
    );
  });
});

describe('parseHolidayCsv', () => {
  it('reads date,name lines', () => {
    expect(parseHolidayCsv('2027-01-26,Republic Day\n2027-08-15,Independence Day')).toEqual([
      { date: '2027-01-26', name: 'Republic Day' },
      { date: '2027-08-15', name: 'Independence Day' },
    ]);
  });

  it('skips a header row without being told there is one', () => {
    expect(parseHolidayCsv('date,name\n2027-01-26,Republic Day')).toHaveLength(1);
  });

  it('ignores blank lines and comments', () => {
    const rows = parseHolidayCsv('# 2027 list\n\n2027-01-26,Republic Day\n  \n');
    expect(rows).toHaveLength(1);
  });

  it('keeps a name containing a comma', () => {
    expect(parseHolidayCsv('2027-04-14,"Ambedkar Jayanti, half day"')[0].name).toBe(
      'Ambedkar Jayanti, half day',
    );
  });

  it('refuses a file with nothing usable in it', () => {
    expect(() => parseHolidayCsv('nothing here')).toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('the audit viewer', () => {
  async function makeRows(count: number) {
    for (let i = 0; i < count; i++) {
      await testDb.auditLog.create({
        data: {
          actorId: actor.id,
          action: i % 2 === 0 ? 'JOB_CREATED' : 'SUBTASK_COMPLETED',
          entityType: i % 2 === 0 ? 'JOB' : 'SUBTASK',
          entityId: `entity-${i}`,
          before: { status: 'DRAFT' },
          after: { status: 'IN_PROGRESS' },
          ipAddress: '203.0.113.7',
          createdAt: new Date(Date.now() - i * 60_000),
        },
      });
    }
  }

  it('pages newest first without losing or repeating a row', async () => {
    await makeRows(120);

    const first = await listAudit({}, { limit: 50 });
    expect(first.data).toHaveLength(50);
    expect(first.total).toBe(120);
    expect(first.nextCursor).not.toBeNull();

    const second = await listAudit({}, { limit: 50, cursor: first.nextCursor! });
    const third = await listAudit({}, { limit: 50, cursor: second.nextCursor! });

    const ids = [...first.data, ...second.data, ...third.data].map((row) => row.id);

    // Keyset paging, so a row written mid-read cannot shift a page.
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
    expect(third.nextCursor).toBeNull();
  });

  it('filters by action, entity and actor', async () => {
    await makeRows(10);
    const other = await createTestUser({ email: 'admin@jaraaglobal.com', role: 'ADMIN' });
    await testDb.auditLog.create({
      data: { actorId: other.id, action: 'USER_CREATED', entityType: 'USER', entityId: 'u1' },
    });

    expect((await listAudit({ action: 'JOB_CREATED' })).total).toBe(5);
    expect((await listAudit({ entityType: 'SUBTASK' })).total).toBe(5);
    expect((await listAudit({ entityId: 'entity-3' })).total).toBe(1);
    expect((await listAudit({ actorId: other.id })).total).toBe(1);
  });

  it('filters by an IST date range, inclusive of the last day', async () => {
    const day = istDateKey(new Date());
    await makeRows(3);

    expect((await listAudit({ from: day, to: day })).total).toBe(3);
    expect((await listAudit({ from: '2020-01-01', to: '2020-01-02' })).total).toBe(0);
  });

  it('offers the facets the filter dropdowns need', async () => {
    await makeRows(4);

    const facets = await auditFacets();
    expect(facets.actions).toContain('JOB_CREATED');
    expect(facets.entityTypes).toEqual(['JOB', 'SUBTASK']);
    expect(facets.actors.map((row) => row.id)).toContain(actor.id);
  });

  it('has no update or delete path', async () => {
    const query = await import('@/lib/services/audit-query');

    // Improvement I-12: a log with an edit path proves nothing.
    const names = Object.keys(query).join(' ');
    expect(names).not.toMatch(/update|delete|remove/i);
  });
});

describe('diffOf', () => {
  it('reads a status change as one line', () => {
    expect(diffOf({ status: 'PENDING' }, { status: 'IN_PROGRESS' })).toEqual([
      { field: 'status', before: 'PENDING', after: 'IN_PROGRESS', kind: 'changed' },
    ]);
  });

  it('marks an added and a removed field', () => {
    const diff = diffOf({ a: 1 }, { b: 2 });

    expect(diff).toEqual([
      { field: 'a', before: '1', after: '—', kind: 'removed' },
      { field: 'b', before: '—', after: '2', kind: 'added' },
    ]);
  });

  it('leaves unchanged fields out', () => {
    expect(diffOf({ a: 1, b: 2 }, { a: 1, b: 3 }).map((d) => d.field)).toEqual(['b']);
  });

  it('renders null, empty lists and objects readably', () => {
    const diff = diffOf(
      { who: null, days: [], shape: { a: 1 } },
      { who: 'Ravi', days: [1, 2], shape: { a: 2 } },
    );

    expect(diff.find((d) => d.field === 'who')).toMatchObject({ before: 'none', after: 'Ravi' });
    expect(diff.find((d) => d.field === 'days')).toMatchObject({ before: 'empty', after: '1, 2' });
    expect(diff.find((d) => d.field === 'shape')?.after).toBe('{"a":2}');
  });

  it('is empty for two non-objects', () => {
    expect(diffOf(null, null)).toEqual([]);
    expect(diffOf('a', 'b')).toEqual([]);
  });
});

describe('auditCsv', () => {
  it('renders a header and the changes as one column', async () => {
    await testDb.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'SUBTASK_STATUS_CHANGED',
        entityType: 'SUBTASK',
        entityId: 's1',
        before: { status: 'PENDING' },
        after: { status: 'IN_PROGRESS' },
      },
    });

    const csv = await auditCsv();
    const [header, row] = csv.split('\n');

    expect(header).toContain('Timestamp (IST)');
    expect(row).toContain('SUBTASK_STATUS_CHANGED');
    expect(row).toContain('status: PENDING -> IN_PROGRESS');
  });

  it('defuses a cell that Excel would run as a formula', async () => {
    const attacker = await createTestUser({
      email: 'x@jaraaglobal.com',
      name: '=HYPERLINK("http://evil.test","click")',
    });

    await testDb.auditLog.create({
      data: { actorId: attacker.id, action: 'LOGIN_SUCCESS', entityType: 'SESSION', entityId: 's' },
    });

    const csv = await auditCsv();

    // An audit export is attacker-influenced data — a user's name reaches it —
    // and CSV injection turns a compliance record into code on the auditor's
    // machine.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});

// ---------------------------------------------------------------------------

describe('job templates', () => {
  const step = (
    overrides: Partial<{
      departmentId: string;
      title: string;
      offsetHoursBeforeDue: number;
      reminderLeadMinutes: number;
      dependsOnItemOrder: number | null;
    }> = {},
  ) => ({
    departmentId: production.id,
    title: 'Machining and first-piece clearance',
    offsetHoursBeforeDue: 120,
    reminderLeadMinutes: 360,
    dependsOnItemOrder: null,
    ...overrides,
  });

  it('creates a template with its chain and audits it', async () => {
    const template = await createTemplate(
      {
        name: 'Standard CNC job',
        items: [
          step({ title: 'Process plan', offsetHoursBeforeDue: 240 }),
          step({ title: 'Final inspection', departmentId: quality.id, dependsOnItemOrder: 0 }),
        ],
      },
      actor,
      ctx,
    );

    expect(template.name).toBe('Standard CNC job');
    expect(template.items).toHaveLength(2);
    expect(template.items[1].dependsOnItemOrder).toBe(0);
    expect(await testDb.auditLog.count({ where: { action: 'TEMPLATE_CREATED' } })).toBe(1);
  });

  it('refuses a step that waits for itself', async () => {
    await expect(
      createTemplate({ name: 'Broken', items: [step({ dependsOnItemOrder: 0 })] }, actor, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a dependency loop', async () => {
    // Every job from this template would deadlock: each subtask BLOCKED on
    // another that is blocked on it. Cheaper to refuse the template.
    await expect(
      createTemplate(
        {
          name: 'Loop',
          items: [step({ dependsOnItemOrder: 1 }), step({ dependsOnItemOrder: 0 })],
        },
        actor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a step waiting for a later one', async () => {
    await expect(
      createTemplate(
        { name: 'Backwards', items: [step({ dependsOnItemOrder: 1 }), step()] },
        actor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a step pointing at a department that is not active', async () => {
    const gone = await createTestDepartment({ code: 'OLD', name: 'Old', sequenceOrder: 9 });
    await testDb.department.update({ where: { id: gone.id }, data: { isActive: false } });

    await expect(
      createTemplate({ name: 'Stale', items: [step({ departmentId: gone.id })] }, actor, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('replaces the chain on update and leaves existing jobs alone', async () => {
    const template = await createTemplate(
      { name: 'Standard', items: [step({ title: 'Original step' })] },
      actor,
      ctx,
    );

    // A job that was created from the template, before the edit.
    const job = await testDb.job.create({
      data: {
        jobCode: 'JGE-2026-0001',
        title: 'Spindle housing batch',
        overallDeadline: fromISTInput('2027-01-31T18:00'),
        createdById: actor.id,
        status: 'IN_PROGRESS',
      },
    });
    const subtask = await testDb.subtask.create({
      data: {
        jobId: job.id,
        departmentId: production.id,
        assigneeId: actor.id,
        title: 'Original step',
        deadline: fromISTInput('2027-01-20T18:00'),
      },
    });

    await updateTemplate(
      template.id,
      { name: 'Standard', items: [step({ title: 'Completely different step' })] },
      actor,
      ctx,
    );

    // A template is a recipe; the jobs already made from it are meals.
    const after = await testDb.subtask.findUniqueOrThrow({ where: { id: subtask.id } });
    expect(after.title).toBe('Original step');
    expect(after.deadline.toISOString()).toBe(fromISTInput('2027-01-20T18:00').toISOString());
  });

  it('archives rather than deletes', async () => {
    const template = await createTemplate({ name: 'Retired', items: [step()] }, actor, ctx);

    await setTemplateActive(template.id, false, actor, ctx);

    const row = await testDb.jobTemplate.findUniqueOrThrow({ where: { id: template.id } });
    expect(row.isActive).toBe(false);
    // The record of how an old job was laid out survives.
    expect(await testDb.jobTemplateItem.count({ where: { templateId: template.id } })).toBe(1);
  });

  it('refuses to edit an archived template', async () => {
    const template = await createTemplate({ name: 'Retired', items: [step()] }, actor, ctx);
    await setTemplateActive(template.id, false, actor, ctx);

    await expect(
      updateTemplate(template.id, { name: 'Retired', items: [step()] }, actor, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

// ---------------------------------------------------------------------------

describe('changing the default reminder lead time', () => {
  let member: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    member = await createTestUser({
      email: 'ravi@jaraaglobal.com',
      departmentId: production.id,
    });
  });

  /** A published job with one subtask that names no lead time of its own. */
  async function publishJobWithSubtask(code: string) {
    const job = await createJob(
      {
        title: 'Spindle housing batch',
        partNumber: 'SH-4410',
        priority: 'NORMAL',
        overallDeadline: '2027-06-30T18:00',
      },
      { id: actor.id, role: 'MD' },
      ctx,
    );

    const [subtask] = await bulkCreateSubtasks(
      job.id,
      {
        subtasks: [
          {
            departmentId: production.id,
            assigneeId: member.id,
            title: `Machining ${code}`,
            deadline: '2027-06-10T18:00',
            requiresApproval: false,
          },
        ],
      },
      { id: actor.id, role: 'MD' },
      ctx,
    );

    await publishJob(job, { id: actor.id, role: 'MD' }, ctx);
    return subtask;
  }

  it('affects newly published subtasks only', async () => {
    for (const [key, value] of Object.entries(settingDefaults())) {
      await testDb.setting.upsert({
        where: { key },
        create: { key, value: value as never },
        update: { value: value as never },
      });
    }
    invalidateSettings();

    const before = await publishJobWithSubtask('before');
    expect(before.reminderLeadMinutes).toBe(360);

    const deadline = fromISTInput('2027-06-10T18:00');
    const reminderBefore = await testDb.notification.findFirstOrThrow({
      where: { entityId: before.id, type: 'DEADLINE_REMINDER' },
    });
    expect(reminderBefore.scheduledFor.toISOString()).toBe(
      new Date(deadline.getTime() - 360 * 60_000).toISOString(),
    );

    // The operator changes it to four hours.
    await updateSettings({ 'reminder.default_lead_minutes': 240 }, actor, ctx);

    const after = await publishJobWithSubtask('after');
    expect(after.reminderLeadMinutes).toBe(240);

    const reminderAfter = await testDb.notification.findFirstOrThrow({
      where: { entityId: after.id, type: 'DEADLINE_REMINDER' },
    });
    expect(reminderAfter.scheduledFor.toISOString()).toBe(
      new Date(deadline.getTime() - 240 * 60_000).toISOString(),
    );

    /*
     * The acceptance criterion, and the promise the settings screen makes: the
     * subtask published before the change keeps the time it was given. A member
     * told "you will be reminded at noon" is reminded at noon.
     */
    const unchanged = await testDb.notification.findFirstOrThrow({
      where: { id: reminderBefore.id },
    });
    expect(unchanged.scheduledFor.toISOString()).toBe(reminderBefore.scheduledFor.toISOString());

    const stillSix = await testDb.subtask.findUniqueOrThrow({ where: { id: before.id } });
    expect(stillSix.reminderLeadMinutes).toBe(360);
  });

  it('is overridden by a subtask that names its own lead time', async () => {
    await updateSettings({ 'reminder.default_lead_minutes': 240 }, actor, ctx);

    const job = await createJob(
      { title: 'Urgent job', priority: 'URGENT', overallDeadline: '2027-06-30T18:00' },
      { id: actor.id, role: 'MD' },
      ctx,
    );

    const [subtask] = await bulkCreateSubtasks(
      job.id,
      {
        subtasks: [
          {
            departmentId: production.id,
            assigneeId: member.id,
            title: 'Machining',
            deadline: '2027-06-10T18:00',
            reminderLeadMinutes: 60,
            requiresApproval: false,
          },
        ],
      },
      { id: actor.id, role: 'MD' },
      ctx,
    );

    // Improvement I-09 is a lead time *per subtask*; the setting is the default
    // it falls back to, not a ceiling.
    expect(subtask.reminderLeadMinutes).toBe(60);
  });
});

// ---------------------------------------------------------------------------

describe('jobAuditTrail', () => {
  it('traces one job from creation to completion, subtasks included', async () => {
    const job = await testDb.job.create({
      data: {
        jobCode: 'JGE-2026-0007',
        title: 'Gearbox end cover',
        overallDeadline: fromISTInput('2027-01-31T18:00'),
        createdById: actor.id,
      },
    });
    const subtask = await testDb.subtask.create({
      data: {
        jobId: job.id,
        departmentId: production.id,
        assigneeId: actor.id,
        title: 'Machining',
        deadline: fromISTInput('2027-01-20T18:00'),
      },
    });
    const problem = await testDb.problem.create({
      data: {
        subtaskId: subtask.id,
        raisedById: actor.id,
        description: 'Material short by twelve bars; supplier unconfirmed.',
      },
    });

    const rows: Array<[string, string, string]> = [
      ['JOB_CREATED', 'JOB', job.id],
      ['JOB_PUBLISHED', 'JOB', job.id],
      ['SUBTASK_CREATED', 'SUBTASK', subtask.id],
      ['PROBLEM_RAISED', 'PROBLEM', problem.id],
      ['PROBLEM_RESOLVED', 'PROBLEM', problem.id],
      ['SUBTASK_STATUS_CHANGED', 'SUBTASK', subtask.id],
      ['JOB_COMPLETED', 'JOB', job.id],
    ];

    for (const [index, [action, entityType, entityId]] of rows.entries()) {
      await testDb.auditLog.create({
        data: {
          actorId: actor.id,
          action,
          entityType,
          entityId,
          createdAt: new Date(Date.now() + index * 1_000),
        },
      });
    }

    const trail = await jobAuditTrail(job.id);

    // Three JOB rows would answer a different question from the one asked.
    expect(trail.map((row) => row.action)).toEqual(rows.map(([action]) => action));
  });
});
