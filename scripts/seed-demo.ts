/**
 * `pnpm seed:demo [jobs]` — generates a shop's worth of history.
 *
 * The M8 acceptance criterion is that the dashboard loads in under two seconds
 * with 500 jobs, which cannot be demonstrated against the eleven jobs the
 * ordinary seed leaves behind. This builds jobs spread over the past year with
 * finished, late, open and cancelled subtasks, problems and deadline changes,
 * so the aggregates have something to aggregate.
 *
 * Local-only, on the same rule as `pnpm db:reset`: it writes thousands of rows
 * and is no use whatever against a real database.
 */
import { PrismaClient, type Prisma } from '@prisma/client';

import {
  assertLocalDisposableDatabase,
  UnsafeDatabaseError,
  type ParsedDatabaseUrl,
} from './lib/database-url';

const DEFAULT_JOBS = 500;

/** Deterministic, so two runs produce the same shop and numbers can be compared. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32 — small, fast, and reproducible across machines.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

const TITLES = [
  'Spindle housing batch',
  'Gearbox end cover',
  'Hydraulic manifold block',
  'Turbine shaft sleeve',
  'Pump impeller set',
  'Valve body machining',
  'Bearing carrier ring',
  'Coupling flange batch',
];

const CUSTOMERS = [
  'Ashok Leyland',
  'TVS Group',
  'Lakshmi Machine Works',
  'Roots Industries',
  'Craftsman',
];

const SUBTASK_TITLES: Record<string, string> = {
  PLANNING: 'Process plan and tooling list',
  PURCHASE: 'Raise and follow the material order',
  STORE: 'Receive, inspect and issue material',
  PRODUCTION: 'Machining and first-piece clearance',
  QUALITY: 'Final inspection and report',
  DISPATCH: 'Pack, document and despatch',
  ACCOUNTS: 'Raise the invoice',
  HR: 'Shift cover and manning',
};

const PROBLEM_TEXTS = [
  'Material short by twelve bars; the supplier has not confirmed a date.',
  'Fixture needs re-cutting after the first article came out 0.04 over.',
  'Drawing revision B arrived after the setup was proved; re-proving now.',
  'Coolant pump on the VMC failed; the job is queued on the second machine.',
  'Inspection gauge is out for calibration and due back on Monday.',
];

/**
 * Demo accounts, created on first run.
 *
 * Never the seeded roster and never the two testing mailboxes. On the machine
 * this was written on, `seed:demo` had put 376 overdue subtasks on the real
 * member's account and made the real MD the recipient of every escalation —
 * 870 notification rows aimed at a personal Gmail address. Demo work belongs to
 * demo people.
 *
 * The addresses are on `demo.invalid`, which RFC 6761 reserves and no mail
 * server will ever deliver to, so a misconfigured relay cannot turn this into
 * real mail either.
 */
const DEMO_DOMAIN = 'demo.invalid';
const DEMO_MD_EMAIL = `md@${DEMO_DOMAIN}`;

function demoEmail(departmentCode: string): string {
  return `${departmentCode.toLowerCase()}@${DEMO_DOMAIN}`;
}

async function ensureDemoUsers(
  prisma: PrismaClient,
  departments: Array<{ id: string; code: string }>,
): Promise<Map<string, string>> {
  // Unusable by construction: no plaintext exists that bcrypt-verifies against
  // a string that is not a bcrypt hash, so nobody can sign in as a demo user.
  const passwordHash = 'demo-account-no-login';

  const wanted: Array<{
    email: string;
    name: string;
    role: 'MD' | 'MEMBER';
    departmentId: string | null;
  }> = [
    { email: DEMO_MD_EMAIL, name: 'Demo MD', role: 'MD', departmentId: null },
    ...departments.map((department) => ({
      email: demoEmail(department.code),
      name: `Demo ${department.code.charAt(0)}${department.code.slice(1).toLowerCase()}`,
      role: 'MEMBER' as const,
      departmentId: department.id,
    })),
  ];

  const byEmail = new Map<string, string>();

  for (const user of wanted) {
    const row = await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user, passwordHash, mustChangePassword: true, isActive: true, isDemo: true },
      // `isDemo` is the one thing worth repairing on an existing row: an
      // account seeded before the flag existed is still a demo account, and
      // leaving it false would keep it on the MD mailing list.
      update: { isDemo: true },
      select: { id: true },
    });
    byEmail.set(user.email, row.id);
  }

  return byEmail;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  let parsed: ParsedDatabaseUrl;
  try {
    parsed = assertLocalDisposableDatabase(url);
  } catch (error) {
    console.error(error instanceof UnsafeDatabaseError ? `\n${error.message}\n` : String(error));
    process.exit(1);
  }

  const wanted = Number(process.argv[2] ?? DEFAULT_JOBS);
  if (!Number.isFinite(wanted) || wanted < 1 || wanted > 5_000) {
    console.error('\nUsage: pnpm seed:demo [1..5000]\n');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const departments = await prisma.department.findMany({
      orderBy: { sequenceOrder: 'asc' },
      select: { id: true, code: true },
    });

    if (departments.length === 0) {
      console.error('\nRun `pnpm seed` first — this needs departments to hang work on.\n');
      process.exit(1);
    }

    const members = await ensureDemoUsers(prisma, departments);
    const creator = members.get(DEMO_MD_EMAIL)!;
    const memberFor = (department: { code: string }) =>
      members.get(demoEmail(department.code)) ?? creator;

    const random = makeRandom(20260913);
    const now = Date.now();
    const YEAR = 365 * 24 * 3_600_000;

    console.log(`\nTarget: ${parsed.host}:${parsed.port}/${parsed.database}`);
    console.log(`Generating ${wanted} demo jobs across ${departments.length} departments…\n`);

    // The highest existing demo number, so re-running extends rather than collides.
    const last = await prisma.job.findFirst({
      where: { jobCode: { startsWith: 'JGE-DEMO-' } },
      orderBy: { jobCode: 'desc' },
      select: { jobCode: true },
    });
    let sequence = last ? Number(last.jobCode.slice(-5)) : 0;

    const CHUNK = 50;
    let subtaskCount = 0;
    let problemCount = 0;

    for (let batch = 0; batch < wanted; batch += CHUNK) {
      const size = Math.min(CHUNK, wanted - batch);

      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < size; i++) {
          sequence++;

          // Spread over the past year, weighted towards recent months so the
          // 30-day trend chart has something in it.
          const age = Math.floor(random() ** 1.6 * YEAR);
          const createdAt = new Date(now - age);
          const overallDeadline = new Date(
            createdAt.getTime() + (10 + random() * 25) * 24 * 3_600_000,
          );

          const chain = departments.filter(() => random() > 0.25);
          const used = chain.length > 0 ? chain : departments.slice(0, 4);

          const finished = random() < 0.62;
          const status = finished
            ? 'COMPLETED'
            : random() < 0.12
              ? 'DELAYED'
              : random() < 0.12
                ? 'AT_RISK'
                : random() < 0.06
                  ? 'ON_HOLD'
                  : 'IN_PROGRESS';

          const job = await tx.job.create({
            data: {
              jobCode: `JGE-DEMO-${String(sequence).padStart(5, '0')}`,
              title: TITLES[Math.floor(random() * TITLES.length)],
              customerName: CUSTOMERS[Math.floor(random() * CUSTOMERS.length)],
              partNumber: `PN-${1000 + Math.floor(random() * 9000)}`,
              drawingNumber: `DRG-${1000 + Math.floor(random() * 9000)}-A`,
              quantity: 10 + Math.floor(random() * 400),
              priority: random() < 0.15 ? 'URGENT' : random() < 0.3 ? 'HIGH' : 'NORMAL',
              overallDeadline,
              status: status as Prisma.JobCreateInput['status'],
              publishedAt: createdAt,
              completedAt: finished
                ? new Date(overallDeadline.getTime() - random() * 3 * 86_400_000)
                : null,
              createdById: creator,
              createdAt,
              // The flag the sweeper and the digest filter on.
              isDemo: true,
            },
            select: { id: true },
          });

          let previousId: string | undefined;
          const span = overallDeadline.getTime() - createdAt.getTime();

          for (const [index, department] of used.entries()) {
            const deadline = new Date(createdAt.getTime() + (span * (index + 1)) / used.length);

            // Roughly a quarter of finished work lands late, which is what makes
            // the on-time percentage a number rather than a 100.
            const late = random() < 0.26;
            const completedAt = finished
              ? new Date(deadline.getTime() + (late ? random() * 72 : -random() * 48) * 3_600_000)
              : null;

            const subtaskStatus = finished
              ? 'COMPLETED'
              : random() < 0.08
                ? 'PROBLEM'
                : random() < 0.05
                  ? 'CANCELLED'
                  : deadline.getTime() < now
                    ? 'IN_PROGRESS'
                    : 'PENDING';

            const subtask = await tx.subtask.create({
              data: {
                jobId: job.id,
                departmentId: department.id,
                assigneeId: memberFor(department),
                title: SUBTASK_TITLES[department.code] ?? 'Department task',
                deadline,
                completedAt: subtaskStatus === 'COMPLETED' ? completedAt : null,
                status: subtaskStatus as Prisma.SubtaskCreateInput['status'],
                dependsOnId: previousId,
                createdAt,
                escalationCount:
                  subtaskStatus !== 'COMPLETED' && deadline.getTime() < now
                    ? Math.floor(random() * 3)
                    : 0,
              },
              select: { id: true },
            });

            previousId = subtask.id;
            subtaskCount++;

            if (random() < 0.09) {
              const raisedAt = new Date(deadline.getTime() - random() * 4 * 86_400_000);
              const resolved = random() < 0.7;

              await tx.problem.create({
                data: {
                  subtaskId: subtask.id,
                  raisedById: memberFor(department),
                  description: PROBLEM_TEXTS[Math.floor(random() * PROBLEM_TEXTS.length)],
                  severity: (['LOW', 'MEDIUM', 'HIGH', 'BLOCKER'] as const)[
                    Math.floor(random() * 4)
                  ],
                  status: resolved ? 'RESOLVED' : random() < 0.5 ? 'ACKNOWLEDGED' : 'OPEN',
                  mdActionNote: resolved
                    ? 'Sourced from the Chennai stockist; two days lost.'
                    : null,
                  resolvedAt: resolved
                    ? new Date(raisedAt.getTime() + random() * 3 * 86_400_000)
                    : null,
                  createdAt: raisedAt,
                },
              });
              problemCount++;
            }

            // A deadline move, so extensionCount is not uniformly zero.
            if (random() < 0.07) {
              const oldDeadline = new Date(deadline.getTime() - (1 + random() * 4) * 86_400_000);
              await tx.deadlineChange.create({
                data: {
                  subtaskId: subtask.id,
                  oldDeadline,
                  newDeadline: deadline,
                  reason: 'Material delivery slipped; re-agreed with the customer.',
                  changedById: creator,
                  createdAt: oldDeadline,
                },
              });
            }
          }
        }
      });

      process.stdout.write(`  ${Math.min(batch + CHUNK, wanted)} / ${wanted} jobs\r`);
    }

    console.log(`\n\n  ✔ ${wanted} jobs, ${subtaskCount} subtasks, ${problemCount} problems`);
    console.log('\nRemove them later with:  pnpm seed:demo --clear\n');
  } finally {
    await prisma.$disconnect();
  }
}

async function clear() {
  const url = process.env.DATABASE_URL;
  if (!url) process.exit(1);

  try {
    assertLocalDisposableDatabase(url);
  } catch (error) {
    console.error(String(error));
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const jobs = await prisma.job.findMany({ where: { isDemo: true }, select: { id: true } });
    const ids = jobs.map((job) => job.id);

    // The notification rows come first and are scoped to demo subtasks. The
    // earlier version deleted every SUBTASK notification in the database,
    // taking the real ones with it.
    const subtaskIds = (
      await prisma.subtask.findMany({ where: { jobId: { in: ids } }, select: { id: true } })
    ).map((row) => row.id);

    const notifications = await prisma.notification.deleteMany({
      where: { entityType: 'SUBTASK', entityId: { in: subtaskIds } },
    });

    // Children first — these tables are referenced, not cascading.
    await prisma.problem.deleteMany({ where: { subtask: { jobId: { in: ids } } } });
    await prisma.deadlineChange.deleteMany({ where: { subtask: { jobId: { in: ids } } } });
    await prisma.extensionRequest.deleteMany({ where: { subtask: { jobId: { in: ids } } } });
    await prisma.subtask.updateMany({ where: { jobId: { in: ids } }, data: { dependsOnId: null } });
    await prisma.subtask.deleteMany({ where: { jobId: { in: ids } } });
    await prisma.job.deleteMany({ where: { id: { in: ids } } });

    // The demo accounts hold nothing once their subtasks are gone.
    const users = await prisma.user.deleteMany({
      where: { email: { endsWith: `@${DEMO_DOMAIN}` } },
    });

    console.log(`\n  ✔ removed ${ids.length} demo jobs, ${subtaskIds.length} subtasks,`);
    console.log(`    ${notifications.count} notification rows and ${users.count} demo accounts\n`);
  } finally {
    await prisma.$disconnect();
  }
}

const run = process.argv.includes('--clear') ? clear : main;

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
