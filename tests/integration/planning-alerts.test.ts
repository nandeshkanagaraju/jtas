import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { queueDepartmentLookahead } from '@/lib/notifications/digest';
import { buildLookaheadPayload, buildUpstreamDatePayload } from '@/lib/notifications/payloads';
import { renderTemplate } from '@/lib/notifications/templates';
import {
  notifyCommitmentMade,
  notifyPredecessorDateChanged,
} from '@/lib/services/notification-service';
import { invalidateSettings } from '@/lib/services/settings-service';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

type User = Awaited<ReturnType<typeof createTestUser>>;
const ROUTE = ['PURCHASE', 'STORE', 'PRODUCTION', 'QA', 'DISPATCH', 'ACCOUNTS'] as const;

let md: User;
let people: Record<(typeof ROUTE)[number], User>;
let steps: string[];

async function buildJob(isDemo = false) {
  const job = await testDb.job.create({
    data: {
      jobCode: isDemo ? 'JGE-2026-0901' : 'JGE-2026-0900',
      title: 'Coupling flange',
      quantity: 120,
      overallDeadline: fromISTInput('2026-12-20T18:00'),
      createdById: md.id,
      status: 'IN_PROGRESS',
      isDemo,
    },
    select: { id: true },
  });
  const ids: string[] = [];
  for (const [index, code] of ROUTE.entries()) {
    const row = await testDb.subtask.create({
      data: {
        jobId: job.id,
        departmentId: people[code].departmentId!,
        assigneeId: people[code].id,
        title: `${code[0]}${code.slice(1).toLowerCase()} step`,
        status: index === 0 ? 'IN_PROGRESS' : 'BLOCKED',
        dependsOnId: ids[index - 1] ?? null,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return { jobId: job.id, ids };
}

beforeEach(async () => {
  await resetAuthTables();
  await testDb.setting.deleteMany({ where: { key: 'digest.time' } });
  invalidateSettings();
  md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD', name: 'MD' });
  people = {} as typeof people;
  for (const [index, code] of ROUTE.entries()) {
    const dept = await createTestDepartment({
      code,
      name: code[0] + code.slice(1).toLowerCase(),
      sequenceOrder: index + 1,
    });
    people[code] = await createTestUser({
      email: `${code.toLowerCase()}@jaraaglobal.in`,
      name: `${code} lead`,
      departmentId: dept.id,
    });
  }
  ({ ids: steps } = await buildJob());
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

async function queued(type: string) {
  const rows = await testDb.notification.findMany({
    where: { type: type as never },
    select: { userId: true, entityId: true },
  });
  return rows;
}

describe('option A: date heads-up to the next three departments', () => {
  it('tells the next department as before, and the two after it with a heads-up', async () => {
    await testDb.subtask.update({
      where: { id: steps[0] },
      data: { deadline: fromISTInput('2026-12-02T17:00') },
    });
    await notifyCommitmentMade(testDb, steps[0]);

    expect((await queued('COMMITMENT_MADE')).map((r) => r.userId)).toEqual([people.STORE.id]);
    const heads = await queued('UPSTREAM_DATE_UPDATE');
    expect(heads.map((r) => r.userId).sort()).toEqual([people.PRODUCTION.id, people.QA.id].sort());
    expect(heads.every((r) => r.entityId === steps[0])).toBe(true);
  });

  it('also follows an MD date move, and tells each department once per date', async () => {
    await testDb.subtask.update({
      where: { id: steps[1] },
      data: { deadline: fromISTInput('2026-12-04T17:00') },
    });
    await notifyPredecessorDateChanged(testDb, steps[1]);
    await notifyPredecessorDateChanged(testDb, steps[1]); // same date again: no repeat
    const heads = await queued('UPSTREAM_DATE_UPDATE');
    expect(heads.map((r) => r.userId).sort()).toEqual([people.QA.id, people.DISPATCH.id].sort());
  });

  it('skips finished steps and demo jobs', async () => {
    await testDb.subtask.update({ where: { id: steps[2] }, data: { status: 'COMPLETED' } });
    await testDb.subtask.update({
      where: { id: steps[0] },
      data: { deadline: fromISTInput('2026-12-02T17:00') },
    });
    await notifyCommitmentMade(testDb, steps[0]);
    expect((await queued('UPSTREAM_DATE_UPDATE')).map((r) => r.userId)).toEqual([people.QA.id]);

    await testDb.notification.deleteMany();
    const demo = await buildJob(true);
    await testDb.subtask.update({
      where: { id: demo.ids[0] },
      data: { deadline: fromISTInput('2026-12-02T17:00') },
    });
    await notifyCommitmentMade(testDb, demo.ids[0]);
    expect(await queued('UPSTREAM_DATE_UPDATE')).toEqual([]);
  });

  it('builds a mail naming the reader’s own step and the route between', async () => {
    await testDb.subtask.update({
      where: { id: steps[0] },
      data: { deadline: fromISTInput('2026-12-02T17:00') },
    });
    const payload = await buildUpstreamDatePayload(steps[0], people.QA.id);
    expect(payload).toMatchObject({
      kind: 'UPSTREAM_DATE_UPDATE',
      departmentName: 'Purchase',
      readerStepTitle: 'Qa step',
      readerSubtaskId: steps[3],
      stepsBetween: ['Store', 'Production'],
      previousDeadlineIst: null,
    });
    const mail = await renderTemplate(payload!);
    expect(mail.subject).toContain('Plan ahead: JGE-2026-0900');
    expect(mail.text).toContain('Purchase → Store → Production → Qa');
  });
});

describe('option B: morning "coming your way" mail', () => {
  it('queues once per waiting member inside the digest window only', async () => {
    expect(await queueDepartmentLookahead(fromISTInput('2026-12-01T07:00'))).toBe(0);
    const at = fromISTInput('2026-12-01T09:05');
    expect(await queueDepartmentLookahead(at)).toBe(5); // Store..Accounts are waiting
    expect(await queueDepartmentLookahead(at)).toBe(0); // second pass the same morning
  });

  it('shows where each job is now and when it should arrive', async () => {
    await testDb.subtask.update({ where: { id: steps[0] }, data: { status: 'COMPLETED' } });
    await testDb.subtask.update({
      where: { id: steps[1] },
      data: { status: 'IN_PROGRESS', deadline: fromISTInput('2026-12-03T17:00') },
    });

    const production = await buildLookaheadPayload(
      people.PRODUCTION.id,
      fromISTInput('2026-12-01T09:05'),
    );
    expect(production).toMatchObject({
      kind: 'DEPARTMENT_LOOKAHEAD',
      readerDepartmentName: 'Production',
      rows: [
        {
          jobCode: 'JGE-2026-0900',
          nowAt: 'Store · In progress',
          stepsAway: 1,
          expectedIst: expect.stringContaining('3 Dec 2026'),
        },
      ],
    });

    const accounts = await buildLookaheadPayload(people.ACCOUNTS.id);
    expect(accounts).toMatchObject({
      rows: [{ nowAt: 'Store · In progress', stepsAway: 4, expectedIst: 'date not committed yet' }],
    });

    const mail = await renderTemplate(production!);
    expect(mail.subject).toBe('[JTAS] Coming your way – 1 job – 1 Dec 2026');
    expect(await buildLookaheadPayload(people.STORE.id)).toBeNull(); // nothing waiting on Store now
  });
});
