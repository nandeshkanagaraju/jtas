/**
 * `pnpm purge:demo` — inventory the seeded demo and showcase data.
 * `pnpm purge:demo -- --apply` — delete it, after you have read the inventory.
 *
 * Without `--apply` this only prints. It never deletes on a plain run, and it
 * refuses any database that is not local and named like a disposable one.
 *
 * What it deletes when applied:
 *   - every job with isDemo = true, and the rows that belong to those jobs
 *     (subtasks, problems, comments, attachments, deadline changes, extension
 *     requests, notifications, audit rows)
 *   - every notification still PENDING, including ones on real jobs, so a
 *     queue left over from testing cannot fire later
 *   - notifications addressed to demonstration users
 *
 * What it keeps:
 *   - every job with isDemo = false, which is how a job created in the UI is
 *     marked. Two of those, JGE-2026-0033 and JGE-2026-9012, are cancelled
 *     rather than deleted: they are test fixtures, and a cancelled job is
 *     off the sweeper's chase list.
 *   - every user account, demo or real
 *
 * isDemo is the marker seed:demo and seed:showcase write. Addresses on
 * demo.invalid and showcase.invalid are that same marker seen from the user
 * side. Nothing is classified by title.
 */
import { PrismaClient } from '@prisma/client';

import { cancelForSubtask } from '@/lib/notifications/notification-service';
import { cancelJob } from '@/lib/services/jobs/lifecycle';
import { JOB_SELECT } from '@/lib/services/jobs/types';

import { assertLocalDisposableDatabase, UnsafeDatabaseError } from './lib/database-url';

const prisma = new PrismaClient();

/**
 * Real jobs that stay in the database but must leave the sweeper's chase list.
 * Cancelling is the terminal state; the rows are not deleted.
 */
const FIXTURES_TO_CANCEL = ['JGE-2026-0033', 'JGE-2026-9012'] as const;

const CANCEL_REASON =
  'Test fixture. Cancelled during demo-data cleanup so the sweeper does not chase it.';

function section(title: string) {
  console.log(`\n${title}`);
}

async function inventory() {
  const [jobs, users, problems, notifications] = await Promise.all([
    prisma.job.groupBy({ by: ['isDemo'], _count: true }),
    prisma.user.groupBy({ by: ['isDemo'], _count: true }),
    prisma.problem.findMany({
      select: { id: true, subtask: { select: { job: { select: { isDemo: true } } } } },
    }),
    prisma.notification.groupBy({ by: ['status'], _count: true }),
  ]);

  const demoJobs = await prisma.job.findMany({
    where: { isDemo: true },
    select: { id: true, jobCode: true, title: true, status: true },
    orderBy: { jobCode: 'asc' },
  });
  const realJobs = await prisma.job.findMany({
    where: { isDemo: false },
    select: {
      id: true,
      jobCode: true,
      title: true,
      status: true,
      createdAt: true,
      createdBy: { select: { email: true, isDemo: true } },
    },
    orderBy: { jobCode: 'asc' },
  });

  const demoJobIds = demoJobs.map((job) => job.id);
  const demoSubtasks = await prisma.subtask.findMany({
    where: { jobId: { in: demoJobIds } },
    select: { id: true },
  });
  const demoSubtaskIds = demoSubtasks.map((row) => row.id);
  const demoProblems = await prisma.problem.findMany({
    where: { subtaskId: { in: demoSubtaskIds } },
    select: { id: true },
  });
  const demoProblemIds = demoProblems.map((row) => row.id);
  const demoEntityIds = [...demoJobIds, ...demoSubtaskIds, ...demoProblemIds];

  const [
    demoComments,
    demoDeadlineChanges,
    demoExtensions,
    demoAttachments,
    demoAudit,
    pending,
    demoUserNotifications,
    entityNotifications,
  ] = await Promise.all([
    prisma.comment.count({ where: { subtaskId: { in: demoSubtaskIds } } }),
    prisma.deadlineChange.count({ where: { subtaskId: { in: demoSubtaskIds } } }),
    prisma.extensionRequest.count({ where: { subtaskId: { in: demoSubtaskIds } } }),
    prisma.attachment.count({
      where: { OR: [{ jobId: { in: demoJobIds } }, { subtaskId: { in: demoSubtaskIds } }] },
    }),
    prisma.auditLog.count({ where: { entityId: { in: demoEntityIds } } }),
    prisma.notification.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        type: true,
        status: true,
        scheduledFor: true,
        entityType: true,
        entityId: true,
        user: { select: { email: true, isDemo: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.notification.count({ where: { user: { isDemo: true } } }),
    prisma.notification.count({ where: { entityId: { in: demoEntityIds } } }),
  ]);

  const realSubtaskCount = await prisma.subtask.count({ where: { job: { isDemo: false } } });
  const realProblemCount = problems.filter((row) => !row.subtask.job.isDemo).length;

  section('How a row is classified');
  console.log(
    '  Demo/test job:   Job.isDemo = true (written by pnpm seed:demo and pnpm seed:showcase).',
  );
  console.log(
    '  Real job:        Job.isDemo = false. Jobs created in the UI land here, and they are kept.',
  );
  console.log(
    '  Demo/test user:  User.isDemo = true (demo.invalid and showcase.invalid). Accounts are kept.',
  );
  console.log('  Real user:       User.isDemo = false. Kept.');
  console.log('  Titles are not used. A real job with "test" in the name stays.');

  section('Inventory');
  console.log(`  jobs:          demo ${countOf(jobs, true)}   real ${countOf(jobs, false)}`);
  console.log(`  subtasks:      demo ${demoSubtaskIds.length}   real ${realSubtaskCount}`);
  console.log(`  problems:      demo ${demoProblemIds.length}   real ${realProblemCount}`);
  console.log(`  users:         demo ${countOf(users, true)}   real ${countOf(users, false)}`);
  console.log(
    `  notifications: ${notifications.map((row) => `${row.status} ${row._count}`).join(', ') || 'none'}`,
  );

  section('Real jobs that will be kept');
  for (const job of realJobs) {
    console.log(
      `  KEEP  ${job.jobCode}  ${job.status}  ${job.title}  created by ${job.createdBy.email}`,
    );
  }

  section('Demo jobs that will be deleted');
  console.log(`  ${demoJobs.length} jobs. Full list:`);
  for (const job of demoJobs) {
    console.log(`  DELETE JOB  ${job.jobCode}  ${job.status}  ${job.title}`);
  }

  section('Rows belonging to those demo jobs');
  console.log(`  subtasks ${demoSubtaskIds.length}`);
  console.log(`  problems ${demoProblemIds.length}`);
  console.log(`  comments ${demoComments}`);
  console.log(`  deadline changes ${demoDeadlineChanges}`);
  console.log(`  extension requests ${demoExtensions}`);
  console.log(
    `  attachments ${demoAttachments} (database rows only; object storage is not touched)`,
  );
  console.log(`  audit rows ${demoAudit}`);
  console.log(
    `  notifications whose entity is one of those jobs, subtasks or problems: ${entityNotifications}`,
  );
  console.log(`  notifications addressed to a demonstration user: ${demoUserNotifications}`);

  section('Pending notifications that will be deleted, on any job');
  if (pending.length === 0) console.log('  none');
  for (const row of pending) {
    console.log(
      `  DELETE PENDING  ${row.id}  ${row.type}  ${row.entityType}:${row.entityId}  to ${row.user.email}  scheduled ${row.scheduledFor.toISOString()}`,
    );
  }

  section('Real jobs that will be cancelled, not deleted');
  console.log(`  ${FIXTURES_TO_CANCEL.join(', ')}`);
  console.log(`  Reason recorded on the audit row: ${CANCEL_REASON}`);

  section('User accounts');
  console.log('  None. Real and demonstration accounts both stay.');

  return {
    demoJobIds,
    demoSubtaskIds,
    demoProblemIds,
    demoEntityIds,
  };
}

function countOf(rows: Array<{ isDemo: boolean; _count: number }>, isDemo: boolean): number {
  return rows.find((row) => row.isDemo === isDemo)?._count ?? 0;
}

async function cancelFixtures() {
  for (const jobCode of FIXTURES_TO_CANCEL) {
    const job = await prisma.job.findUnique({ where: { jobCode }, select: JOB_SELECT });
    if (!job) throw new Error(`Cannot cancel ${jobCode}: no such job.`);

    const creator = await prisma.user.findUniqueOrThrow({
      where: { id: job.createdById },
      select: { id: true, role: true },
    });

    if (job.status === 'CANCELLED') {
      console.log(`  ${jobCode} is already cancelled.`);
    } else {
      await cancelJob(
        job,
        CANCEL_REASON,
        { id: creator.id, role: creator.role },
        { ipAddress: '127.0.0.1' },
      );
      console.log(`  CANCELLED ${jobCode}`);
    }

    const subtasks = await prisma.subtask.findMany({
      where: { jobId: job.id },
      select: { id: true },
    });
    for (const subtask of subtasks) {
      const cleared = await cancelForSubtask(prisma, subtask.id);
      if (cleared > 0) console.log(`  cleared ${cleared} pending notification(s) for ${jobCode}`);
    }
  }
}

async function apply(plan: Awaited<ReturnType<typeof inventory>>) {
  section('Cancelling fixture jobs');
  await cancelFixtures();

  const demoUserIds = (
    await prisma.user.findMany({ where: { isDemo: true }, select: { id: true } })
  ).map((row) => row.id);

  await prisma.$transaction(
    async (tx) => {
      if (plan.demoSubtaskIds.length > 0) {
        await tx.subtask.updateMany({
          where: { id: { in: plan.demoSubtaskIds } },
          data: { dependsOnId: null },
        });
      }

      await tx.notification.deleteMany({
        where: {
          OR: [
            { status: 'PENDING' },
            { entityId: { in: plan.demoEntityIds } },
            { userId: { in: demoUserIds } },
          ],
        },
      });
      await tx.auditLog.deleteMany({ where: { entityId: { in: plan.demoEntityIds } } });
      await tx.extensionRequest.deleteMany({ where: { subtaskId: { in: plan.demoSubtaskIds } } });
      await tx.deadlineChange.deleteMany({ where: { subtaskId: { in: plan.demoSubtaskIds } } });
      await tx.comment.deleteMany({ where: { subtaskId: { in: plan.demoSubtaskIds } } });
      await tx.problem.deleteMany({ where: { subtaskId: { in: plan.demoSubtaskIds } } });
      await tx.attachment.deleteMany({
        where: {
          OR: [{ jobId: { in: plan.demoJobIds } }, { subtaskId: { in: plan.demoSubtaskIds } }],
        },
      });
      await tx.subtask.deleteMany({ where: { id: { in: plan.demoSubtaskIds } } });
      await tx.job.deleteMany({ where: { id: { in: plan.demoJobIds } } });
    },
    { timeout: 120_000 },
  );
}

async function main() {
  const applyRequested = process.argv.includes('--apply');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const target = assertLocalDisposableDatabase(databaseUrl);

  console.log(`Database ${target.database} on ${target.host}.`);
  console.log(
    applyRequested
      ? 'Mode: APPLY. Rows will be deleted.'
      : 'Mode: inventory only. Nothing will be deleted.',
  );

  const plan = await inventory();

  if (!applyRequested) {
    section('Not deleted');
    console.log('  Re-run with --apply after you have confirmed this list.');
    return;
  }

  await apply(plan);

  const [jobs, subtasks, problems, users, notifications, pending] = await Promise.all([
    prisma.job.groupBy({ by: ['isDemo'], _count: true }),
    prisma.subtask.count(),
    prisma.problem.count(),
    prisma.user.groupBy({ by: ['isDemo'], _count: true }),
    prisma.notification.groupBy({ by: ['status'], _count: true }),
    prisma.notification.count({ where: { status: 'PENDING' } }),
  ]);

  section('After');
  console.log(`  jobs:          demo ${countOf(jobs, true)}   real ${countOf(jobs, false)}`);
  console.log(`  subtasks left: ${subtasks}`);
  console.log(`  problems left: ${problems}`);
  console.log(`  users:         demo ${countOf(users, true)}   real ${countOf(users, false)}`);
  console.log(
    `  notifications: ${notifications.map((row) => `${row.status} ${row._count}`).join(', ') || 'none'}`,
  );
  console.log(`  pending left:  ${pending}`);

  const fixtures = await prisma.job.findMany({
    where: { jobCode: { in: [...FIXTURES_TO_CANCEL] } },
    select: {
      jobCode: true,
      status: true,
      subtasks: { select: { status: true, escalationCount: true } },
    },
  });
  section('Fixture jobs');
  for (const job of fixtures) {
    const sub = job.subtasks
      .map((row) => `${row.status} escalation ${row.escalationCount}`)
      .join(', ');
    console.log(`  ${job.jobCode}  ${job.status}  subtasks: ${sub || 'none'}`);
  }
}

main()
  .catch((error) => {
    if (error instanceof UnsafeDatabaseError) console.error(error.message);
    else console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
