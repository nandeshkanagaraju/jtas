/**
 * `pnpm perf` — the latency budget (build spec M11.2).
 *
 * Measures p95 for the four endpoints the spec names and exits non-zero if any
 * exceeds 500 ms, so CI can run it as a gate rather than as a thing somebody
 * reads.
 *
 * Measured against the service layer rather than over HTTP. That is the honest
 * boundary for a *query* budget: adding Next's router and JSON serialisation
 * would fold framework overhead into a number meant to catch a missing index,
 * and the two move for different reasons.
 */
import { PrismaClient } from '@prisma/client';

import { currentMonth, mdDashboard } from '../src/lib/services/analytics';
import { listJobs } from '../src/lib/services/jobs';
import { getMyTasks } from '../src/lib/services/my-tasks-service';
import { listProblems } from '../src/lib/services/problems';
import { listJobsQuerySchema } from '../src/lib/validation/job';
import { assertLocalDisposableDatabase, UnsafeDatabaseError } from './lib/database-url';

/** SDD 9 / build spec M11.2. */
const BUDGET_MS = 500;

/** The volume the budget is defined at. */
const EXPECTED_JOBS = 500;
const EXPECTED_SUBTASKS = 4_000;

const RUNS = 30;

interface Measurement {
  label: string;
  p50: number;
  p95: number;
}

async function measure(label: string, fn: () => Promise<unknown>): Promise<Measurement> {
  // One warm pass, so the first query's connection setup and plan cache are not
  // counted as latency the shop floor would ever see.
  await fn();

  const times: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    await fn();
    times.push(performance.now() - started);
  }

  times.sort((a, b) => a - b);

  return {
    label,
    p50: times[Math.floor(RUNS / 2)],
    p95: times[Math.ceil(RUNS * 0.95) - 1],
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  try {
    // Read-only, but it hammers the database thirty times per endpoint; that
    // belongs on a disposable one.
    assertLocalDisposableDatabase(url);
  } catch (error) {
    console.error(error instanceof UnsafeDatabaseError ? `\n${error.message}\n` : String(error));
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const [jobs, subtasks, problems] = await Promise.all([
      prisma.job.count(),
      prisma.subtask.count(),
      prisma.problem.count(),
    ]);

    console.log(`\nAgainst ${jobs} jobs, ${subtasks} subtasks, ${problems} problems.`);

    if (jobs < EXPECTED_JOBS || subtasks < EXPECTED_SUBTASKS) {
      // Said plainly rather than failed: a green run on a small dataset would
      // be a budget that means nothing.
      console.log(
        `\n  ! Below the volume the budget is defined at (${EXPECTED_JOBS} jobs, ` +
          `${EXPECTED_SUBTASKS} subtasks).\n  ! Run: pnpm seed:demo 700\n`,
      );
    }

    const md = await prisma.user.findFirst({ where: { role: 'MD', isActive: true } });
    const member = await prisma.user.findFirst({
      where: { role: 'MEMBER', isActive: true, assignedSubtasks: { some: {} } },
    });

    if (!md || !member) {
      console.error('\nNeeds a seeded MD and a member holding subtasks. Run `pnpm seed` first.\n');
      process.exit(1);
    }

    const session = <T extends { id: string }>(user: T) => ({
      ...user,
      isActive: true,
      mustChangePassword: false,
    });

    const query = listJobsQuerySchema.parse({});

    const results = [
      await measure('GET /api/jobs', () => listJobs(session(md) as never, query)),
      await measure('GET /api/my/tasks', () => getMyTasks(member.id)),
      await measure('GET /api/dashboard/md', () => mdDashboard(currentMonth())),
      await measure('GET /api/problems', () => listProblems({ open: true })),
    ];

    console.log(
      `\n  ${'endpoint'.padEnd(24)} ${'p50'.padStart(7)} ${'p95'.padStart(7)}   budget ${BUDGET_MS}ms`,
    );
    console.log(`  ${'-'.repeat(56)}`);

    let over = 0;

    for (const row of results) {
      const ok = row.p95 < BUDGET_MS;
      if (!ok) over++;

      console.log(
        `  ${row.label.padEnd(24)} ${row.p50.toFixed(0).padStart(5)}ms ${row.p95
          .toFixed(0)
          .padStart(5)}ms   ${ok ? 'ok' : '** OVER BUDGET **'}`,
      );
    }

    if (over > 0) {
      console.error(`\n  ${over} endpoint(s) over the ${BUDGET_MS} ms budget.\n`);
      process.exit(1);
    }

    console.log('\n  All within budget.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
