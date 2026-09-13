/**
 * The dashboard and scorecard numbers, against real rows.
 *
 * The unit tests in tests/unit/metrics.test.ts pin what "on time" means. These
 * pin that the SQL aggregates compute the same thing — the two must never drift,
 * because a dashboard that disagrees with an export is evidence of nothing.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { percentOf, summarise, type MeasurableSubtask } from '@/lib/domain/metrics';
import {
  departmentReport,
  departmentScorecards,
  jobsAtRisk,
  kpiCounts,
  mdDashboard,
  needsAttention,
  onTimeAggregate,
  range,
  trendSeries,
} from '@/lib/services/analytics';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

/** Everything is anchored inside one IST month so the default range covers it. */
const MONTH = range('2026-09-01', '2026-09-30');
const NOW = fromISTInput('2026-09-20T12:00');

let production: Awaited<ReturnType<typeof createTestDepartment>>;
let quality: Awaited<ReturnType<typeof createTestDepartment>>;
let memberA: Awaited<ReturnType<typeof createTestUser>>;
let memberB: Awaited<ReturnType<typeof createTestUser>>;
let jobCounter = 0;

beforeEach(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  jobCounter = 0;

  production = await createTestDepartment({
    code: 'PRODUCTION',
    name: 'Production',
    sequenceOrder: 1,
  });
  quality = await createTestDepartment({ code: 'QUALITY', name: 'Quality', sequenceOrder: 2 });

  memberA = await createTestUser({ email: 'a@jaraaglobal.com', departmentId: production.id });
  memberB = await createTestUser({ email: 'b@jaraaglobal.com', departmentId: quality.id });
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

async function makeJob(status = 'IN_PROGRESS', overallDeadline = '2026-09-30T18:00') {
  jobCounter++;
  return testDb.job.create({
    data: {
      jobCode: `JGE-2026-${String(jobCounter).padStart(4, '0')}`,
      title: `Job ${jobCounter}`,
      overallDeadline: fromISTInput(overallDeadline),
      createdById: memberA.id,
      status: status as never,
      completedAt: status === 'COMPLETED' ? fromISTInput('2026-09-15T12:00') : null,
    },
  });
}

interface SubtaskSpec {
  jobId: string;
  departmentId?: string;
  assigneeId?: string;
  deadline: string;
  completedAt?: string | null;
  status?: string;
  title?: string;
  dependsOnId?: string;
}

async function makeSubtask(spec: SubtaskSpec) {
  return testDb.subtask.create({
    data: {
      jobId: spec.jobId,
      departmentId: spec.departmentId ?? production.id,
      assigneeId: spec.assigneeId ?? memberA.id,
      title: spec.title ?? 'Machining',
      deadline: fromISTInput(spec.deadline),
      completedAt: spec.completedAt ? fromISTInput(spec.completedAt) : null,
      status: (spec.status ?? (spec.completedAt ? 'COMPLETED' : 'IN_PROGRESS')) as never,
      dependsOnId: spec.dependsOnId,
    },
  });
}

// ---------------------------------------------------------------------------

describe('onTimeAggregate', () => {
  it('agrees exactly with the domain definition', async () => {
    const job = await makeJob();

    const rows: Array<[string, string]> = [
      ['2026-09-10T18:00', '2026-09-10T17:00'], // early
      ['2026-09-11T18:00', '2026-09-11T18:00'], // exactly on time
      ['2026-09-12T18:00', '2026-09-13T00:00'], // 6 h late
      ['2026-09-14T18:00', '2026-09-15T18:00'], // 24 h late
    ];

    for (const [deadline, completedAt] of rows) {
      await makeSubtask({ jobId: job.id, deadline, completedAt });
    }

    const sql = await onTimeAggregate(MONTH);

    // The same four rows, measured by the pure function.
    const inMemory = summarise(
      rows.map(([deadline, completedAt]): MeasurableSubtask => ({
        status: 'COMPLETED',
        deadline: fromISTInput(deadline),
        completedAt: fromISTInput(completedAt),
      })),
    );

    expect(sql.completed).toBe(inMemory.completed);
    expect(sql.onTime).toBe(inMemory.onTime);
    expect(percentOf(sql.onTime, sql.completed)).toBe(inMemory.onTimePercent);
    expect(sql.totalDelayHours).toBeCloseTo(30, 5);
  });

  it('ignores work completed outside the range', async () => {
    const job = await makeJob();
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-08-10T18:00',
      completedAt: '2026-08-10T12:00',
    });
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-10T18:00',
      completedAt: '2026-09-10T12:00',
    });

    expect((await onTimeAggregate(MONTH)).completed).toBe(1);
  });

  it('ignores work that is not finished', async () => {
    const job = await makeJob();
    await makeSubtask({ jobId: job.id, deadline: '2026-09-10T18:00' });

    const result = await onTimeAggregate(MONTH);
    expect(result.completed).toBe(0);
    expect(percentOf(result.onTime, result.completed)).toBeNull();
  });

  it('ignores cancelled work, so a cancelled job cannot flatter the rate', async () => {
    const job = await makeJob();
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-10T18:00',
      completedAt: '2026-09-20T18:00',
      status: 'CANCELLED',
    });

    expect((await onTimeAggregate(MONTH)).completed).toBe(0);
  });
});

describe('trendSeries', () => {
  it('buckets by the IST day, not the UTC one', async () => {
    const job = await makeJob();

    // 9 PM IST on the 10th is 15:30 UTC on the 10th — but 1 AM IST on the 11th
    // is 19:30 UTC on the *10th*, and grouping by UTC would file it a day early.
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-10T22:00',
      completedAt: '2026-09-10T21:00',
    });
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-11T22:00',
      completedAt: '2026-09-11T01:00',
    });

    const series = await trendSeries(range('2026-09-10', '2026-09-11'));

    expect(series).toEqual([
      { day: '2026-09-10', onTime: 1, late: 0 },
      { day: '2026-09-11', onTime: 1, late: 0 },
    ]);
  });

  it('separates on-time from late', async () => {
    const job = await makeJob();
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-10T18:00',
      completedAt: '2026-09-10T17:00',
    });
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-10T18:00',
      completedAt: '2026-09-10T23:00',
    });

    const [day] = await trendSeries(range('2026-09-10', '2026-09-10'));
    expect(day).toEqual({ day: '2026-09-10', onTime: 1, late: 1 });
  });

  it('includes quiet days as zeroes rather than omitting them', async () => {
    // A gap the chart interpolated across would draw a line through days on
    // which nothing was delivered.
    const series = await trendSeries(range('2026-09-01', '2026-09-05'));

    expect(series).toHaveLength(5);
    expect(series.every((point) => point.onTime === 0 && point.late === 0)).toBe(true);
    expect(series[0].day).toBe('2026-09-01');
    expect(series[4].day).toBe('2026-09-05');
  });
});

describe('kpiCounts', () => {
  it('counts jobs by state and completions inside the range', async () => {
    await makeJob('IN_PROGRESS');
    await makeJob('AT_RISK');
    await makeJob('AT_RISK');
    await makeJob('DELAYED');
    await makeJob('COMPLETED');
    await makeJob('DRAFT');
    await makeJob('CANCELLED');

    const kpis = await kpiCounts(MONTH, NOW);

    expect(kpis.activeJobs).toBe(4); // in progress + at risk + at risk + delayed
    expect(kpis.atRiskJobs).toBe(2);
    expect(kpis.delayedJobs).toBe(1);
    expect(kpis.completedThisMonth).toBe(1);
  });

  it('counts overdue subtasks but not those on a held or cancelled job', async () => {
    const live = await makeJob('IN_PROGRESS');
    const held = await makeJob('ON_HOLD');

    await makeSubtask({ jobId: live.id, deadline: '2026-09-19T18:00' });
    await makeSubtask({ jobId: held.id, deadline: '2026-09-19T18:00' });
    // Not yet due.
    await makeSubtask({ jobId: live.id, deadline: '2026-09-25T18:00' });

    // Nobody is chased on a held job, so nothing on one is overdue.
    expect((await kpiCounts(MONTH, NOW)).overdueSubtasks).toBe(1);
  });

  it('does not count a subtask in PROBLEM as overdue', async () => {
    const job = await makeJob();
    await makeSubtask({ jobId: job.id, deadline: '2026-09-10T18:00', status: 'PROBLEM' });

    // The blocker is already on the MD's desk; counting it again as an overdue
    // subtask double-reports the same trouble.
    expect((await kpiCounts(MONTH, NOW)).overdueSubtasks).toBe(0);
  });

  it('counts open problems and those waiting more than a day', async () => {
    const job = await makeJob();
    const subtask = await makeSubtask({ jobId: job.id, deadline: '2026-09-10T18:00' });

    await testDb.problem.createMany({
      data: [
        {
          subtaskId: subtask.id,
          raisedById: memberA.id,
          description: 'x'.repeat(25),
          severity: 'HIGH',
          status: 'OPEN',
          createdAt: new Date(NOW.getTime() - 40 * 3_600_000),
        },
        {
          subtaskId: subtask.id,
          raisedById: memberA.id,
          description: 'y'.repeat(25),
          severity: 'LOW',
          status: 'ACKNOWLEDGED',
          createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
        },
        {
          subtaskId: subtask.id,
          raisedById: memberA.id,
          description: 'z'.repeat(25),
          severity: 'LOW',
          status: 'RESOLVED',
          createdAt: new Date(NOW.getTime() - 90 * 3_600_000),
        },
      ],
    });

    const kpis = await kpiCounts(MONTH, NOW);
    expect(kpis.openProblems).toBe(2);
    expect(kpis.openProblemsOlderThan24h).toBe(1);
  });
});

describe('needsAttention', () => {
  it('sorts problems by severity first and age second', async () => {
    const job = await makeJob();
    const subtask = await makeSubtask({ jobId: job.id, deadline: '2026-09-10T18:00' });

    await testDb.problem.createMany({
      data: [
        {
          subtaskId: subtask.id,
          raisedById: memberA.id,
          description: 'old medium'.padEnd(25, '.'),
          severity: 'MEDIUM',
          status: 'OPEN',
          createdAt: new Date(NOW.getTime() - 100 * 3_600_000),
        },
        {
          subtaskId: subtask.id,
          raisedById: memberA.id,
          description: 'new blocker'.padEnd(25, '.'),
          severity: 'BLOCKER',
          status: 'OPEN',
          createdAt: new Date(NOW.getTime() - 1 * 3_600_000),
        },
        {
          subtaskId: subtask.id,
          raisedById: memberA.id,
          description: 'old high'.padEnd(25, '.'),
          severity: 'HIGH',
          status: 'OPEN',
          createdAt: new Date(NOW.getTime() - 50 * 3_600_000),
        },
      ],
    });

    const { problems } = await needsAttention(NOW);

    // A blocker raised an hour ago outranks a medium raised four days ago.
    expect(problems.map((p) => p.severity)).toEqual(['BLOCKER', 'HIGH', 'MEDIUM']);
    expect(problems[0].jobCode).toBe(job.jobCode);
    expect(problems[2].ageHours).toBeCloseTo(100, 0);
  });

  it('leaves resolved and rejected problems out', async () => {
    const job = await makeJob();
    const subtask = await makeSubtask({ jobId: job.id, deadline: '2026-09-10T18:00' });

    await testDb.problem.createMany({
      data: [
        {
          subtaskId: subtask.id,
          raisedById: memberA.id,
          description: 'a'.repeat(25),
          status: 'RESOLVED',
        },
        {
          subtaskId: subtask.id,
          raisedById: memberA.id,
          description: 'b'.repeat(25),
          status: 'REJECTED',
        },
      ],
    });

    expect((await needsAttention(NOW)).problems).toHaveLength(0);
  });

  it('lists the most overdue subtasks first, with who and how late', async () => {
    const job = await makeJob();
    await makeSubtask({ jobId: job.id, deadline: '2026-09-19T12:00', title: 'One day late' });
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-15T12:00',
      title: 'Five days late',
      departmentId: quality.id,
      assigneeId: memberB.id,
    });

    const { overdueSubtasks } = await needsAttention(NOW);

    expect(overdueSubtasks.map((s) => s.title)).toEqual(['Five days late', 'One day late']);
    expect(overdueSubtasks[0].overdueHours).toBe(120);
    expect(overdueSubtasks[0].departmentName).toBe('Quality');
    expect(overdueSubtasks[0].assigneeName).toBe(memberB.name);
  });
});

describe('jobsAtRisk', () => {
  it('names the department furthest past its deadline', async () => {
    const job = await makeJob('DELAYED');

    await makeSubtask({ jobId: job.id, deadline: '2026-09-18T12:00', title: 'Machining' });
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-12T12:00',
      title: 'Final inspection',
      departmentId: quality.id,
      assigneeId: memberB.id,
    });

    const [row] = await jobsAtRisk(NOW);

    expect(row.blockingDepartment).toBe('Quality');
    expect(row.blockingSubtaskTitle).toBe('Final inspection');
    expect(row.overdueSubtasks).toBe(2);
  });

  it('reports a job at risk with nothing yet overdue, naming no department', async () => {
    await makeJob('AT_RISK');

    const [row] = await jobsAtRisk(NOW);
    expect(row.blockingDepartment).toBeNull();
    expect(row.overdueSubtasks).toBe(0);
  });

  it('counts the job’s open problems', async () => {
    const job = await makeJob('DELAYED');
    const subtask = await makeSubtask({ jobId: job.id, deadline: '2026-09-12T12:00' });

    await testDb.problem.create({
      data: {
        subtaskId: subtask.id,
        raisedById: memberA.id,
        description: 'c'.repeat(25),
        status: 'OPEN',
      },
    });

    expect((await jobsAtRisk(NOW))[0].openProblems).toBe(1);
  });

  it('leaves healthy, held and completed jobs out', async () => {
    await makeJob('IN_PROGRESS');
    await makeJob('ON_HOLD');
    await makeJob('COMPLETED');

    expect(await jobsAtRisk(NOW)).toHaveLength(0);
  });
});

describe('departmentScorecards', () => {
  it('scores each department separately', async () => {
    const job = await makeJob();

    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-10T18:00',
      completedAt: '2026-09-10T12:00',
    });
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-11T18:00',
      completedAt: '2026-09-12T18:00',
    });
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-12T18:00',
      completedAt: '2026-09-12T12:00',
      departmentId: quality.id,
      assigneeId: memberB.id,
    });

    const cards = await departmentScorecards(MONTH);
    const prod = cards.find((c) => c.code === 'PRODUCTION')!;
    const qual = cards.find((c) => c.code === 'QUALITY')!;

    expect(prod.subtasksCompleted).toBe(2);
    expect(prod.onTime).toBe(1);
    expect(prod.late).toBe(1);
    expect(prod.onTimePercent).toBe(50);
    expect(prod.averageDelayHours).toBe(12); // (0 + 24) / 2

    expect(qual.onTimePercent).toBe(100);
    expect(qual.averageDelayHours).toBe(0);
  });

  it('reports null rather than zero for a department that has completed nothing', async () => {
    const cards = await departmentScorecards(MONTH);

    // Zero would rank a department that has done no work below one that is
    // genuinely missing deadlines.
    expect(cards.every((card) => card.onTimePercent === null)).toBe(true);
  });

  it('counts work in hand now, regardless of the range', async () => {
    const job = await makeJob();
    await makeSubtask({ jobId: job.id, deadline: '2026-11-10T18:00' });
    await makeSubtask({ jobId: job.id, deadline: '2026-11-11T18:00', status: 'BLOCKED' });
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-11-12T18:00',
      completedAt: '2026-11-12T12:00',
    });

    const prod = (await departmentScorecards(MONTH)).find((c) => c.code === 'PRODUCTION')!;

    // A backlog that has since been cleared must not still show; a backlog
    // outside the range still exists.
    expect(prod.currentOpen).toBe(2);
    expect(prod.subtasksCompleted).toBe(0);
  });

  it('counts problems raised, and separately those that blocked someone else', async () => {
    const job = await makeJob();

    const blocking = await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-10T18:00',
      title: 'Machining',
    });
    // A dependent subtask makes the problem on `blocking` a root cause.
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-12T18:00',
      title: 'Inspection',
      departmentId: quality.id,
      assigneeId: memberB.id,
      dependsOnId: blocking.id,
    });
    const isolated = await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-13T18:00',
      title: 'Packing',
    });

    await testDb.problem.createMany({
      data: [
        {
          subtaskId: blocking.id,
          raisedById: memberA.id,
          description: 'blocked'.padEnd(25, '.'),
          status: 'OPEN',
          createdAt: fromISTInput('2026-09-10T10:00'),
        },
        {
          subtaskId: isolated.id,
          raisedById: memberA.id,
          description: 'isolated'.padEnd(25, '.'),
          status: 'OPEN',
          createdAt: fromISTInput('2026-09-11T10:00'),
        },
      ],
    });

    const prod = (await departmentScorecards(MONTH)).find((c) => c.code === 'PRODUCTION')!;

    // Raising a problem is not a fault. Blocking the next bench is the number
    // that separates a hard job from a bottleneck.
    expect(prod.problemsRaised).toBe(2);
    expect(prod.problemsAsRootCause).toBe(1);
  });

  it('counts deadline moves, so an extension cannot launder a delay', async () => {
    const job = await makeJob();
    const subtask = await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-20T18:00',
      completedAt: '2026-09-20T12:00',
    });

    await testDb.deadlineChange.createMany({
      data: [
        {
          subtaskId: subtask.id,
          oldDeadline: fromISTInput('2026-09-12T18:00'),
          newDeadline: fromISTInput('2026-09-16T18:00'),
          reason: 'Material delay',
          changedById: memberA.id,
          createdAt: fromISTInput('2026-09-11T10:00'),
        },
        {
          subtaskId: subtask.id,
          oldDeadline: fromISTInput('2026-09-16T18:00'),
          newDeadline: fromISTInput('2026-09-20T18:00'),
          reason: 'Tooling',
          changedById: memberA.id,
          createdAt: fromISTInput('2026-09-15T10:00'),
        },
      ],
    });

    const prod = (await departmentScorecards(MONTH)).find((c) => c.code === 'PRODUCTION')!;

    // 100% on time — having moved the goalposts twice. Both numbers are shown.
    expect(prod.onTimePercent).toBe(100);
    expect(prod.extensionCount).toBe(2);
  });
});

describe('departmentReport', () => {
  it('returns the one department alongside every department', async () => {
    const report = await departmentReport(production.id, MONTH);

    expect(report.department.code).toBe('PRODUCTION');
    expect(report.comparison).toHaveLength(2);
    expect(report.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('is a 404 for a department that does not exist', async () => {
    await expect(departmentReport('no-such-id', MONTH)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('mdDashboard', () => {
  it('assembles the whole payload', async () => {
    const job = await makeJob('DELAYED');
    await makeSubtask({
      jobId: job.id,
      deadline: '2026-09-10T18:00',
      completedAt: '2026-09-10T12:00',
    });
    await makeSubtask({ jobId: job.id, deadline: '2026-09-12T18:00' });

    const dashboard = await mdDashboard(MONTH, NOW);

    expect(dashboard.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(dashboard.kpis.delayedJobs).toBe(1);
    expect(dashboard.onTimeCompletionPercent).toBe(100);
    expect(dashboard.completedInRange).toBe(1);
    expect(dashboard.trend).toHaveLength(30);
    expect(dashboard.jobsAtRisk[0].blockingDepartment).toBe('Production');
    expect(dashboard.attention.overdueSubtasks).toHaveLength(1);
  });
});
