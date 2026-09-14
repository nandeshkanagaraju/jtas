/**
 * `pnpm seed:showcase` — ten jobs a person can actually be walked through.
 *
 * Distinct from `pnpm seed:demo`, which generates five hundred jobs of noise so
 * the dashboard has something to aggregate. Nobody can be shown five hundred
 * jobs. This is the training set and the MD demo: ten, hand-placed, one of each
 * state worth explaining, with two genuinely overdue and one sitting on an open
 * blocker so the problem inbox is not empty when it is opened on a projector.
 *
 * Local-only, on the same rule as `pnpm db:reset`.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { reportSeedCredentials, type SeedCredential } from '../prisma/seed-credentials';
import { generateTempPassword } from '../src/lib/auth/temp-password';

import {
  assertLocalDisposableDatabase,
  UnsafeDatabaseError,
  type ParsedDatabaseUrl,
} from './lib/database-url';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Showcase accounts live on their own reserved domain.
 *
 * RFC 6761 reserves `.invalid`, so no mail server will ever deliver to these
 * even if a relay is misconfigured. Separate from `demo.invalid` because the
 * two datasets are cleaned up independently, and a trainee signing in as
 * "Priya" should not find four hundred jobs she has never seen.
 */
const DOMAIN = 'showcase.invalid';

const PEOPLE: Array<{
  key: string;
  name: string;
  department: string | null;
  role: 'MD' | 'MEMBER';
}> = [
  { key: 'md', name: 'Showcase MD', department: null, role: 'MD' },
  { key: 'planning', name: 'Arun (Planning)', department: 'PLANNING', role: 'MEMBER' },
  { key: 'purchase', name: 'Priya (Purchase)', department: 'PURCHASE', role: 'MEMBER' },
  { key: 'store', name: 'Ganesh (Store)', department: 'STORE', role: 'MEMBER' },
  { key: 'production', name: 'Ravi (Production)', department: 'PRODUCTION', role: 'MEMBER' },
  { key: 'quality', name: 'Meena (Quality)', department: 'QUALITY', role: 'MEMBER' },
  { key: 'dispatch', name: 'Suresh (Dispatch)', department: 'DISPATCH', role: 'MEMBER' },
];

/**
 * The ten jobs, each chosen for what it shows.
 *
 * `dueInDays` is relative to the run, so the set stays meaningful next month.
 * A negative value is a deadline in the past, which is the whole point of two
 * of them.
 */
const JOBS: Array<{
  title: string;
  customer: string;
  part: string;
  quantity: number;
  priority: Prisma.JobCreateInput['priority'];
  status: Prisma.JobCreateInput['status'];
  dueInDays: number;
  /** How many of the five chain steps are finished. */
  done: number;
  /** Every remaining step is overdue, not just late-looking. */
  overdue?: boolean;
  problem?: { severity: 'BLOCKER' | 'HIGH' | 'MEDIUM'; text: string };
  note: string;
}> = [
  {
    title: 'Spindle housing batch',
    customer: 'Lakshmi Machine Works',
    part: 'SH-4410',
    quantity: 120,
    priority: 'NORMAL',
    status: 'IN_PROGRESS',
    dueInDays: 12,
    done: 2,
    note: 'The ordinary case: running, on time, Store holding the baton.',
  },
  {
    title: 'Gearbox end cover',
    customer: 'Bharat Gears',
    part: 'GC-2208',
    quantity: 60,
    priority: 'HIGH',
    status: 'IN_PROGRESS',
    dueInDays: 9,
    done: 1,
    problem: {
      severity: 'BLOCKER',
      text: 'Material short by twelve bars; the supplier has not confirmed a date.',
    },
    note: 'The open blocker. This is the one to open the problem inbox on.',
  },
  {
    title: 'Hydraulic manifold block',
    customer: 'Sundaram Hydraulics',
    part: 'HM-9001',
    quantity: 25,
    priority: 'URGENT',
    status: 'DELAYED',
    dueInDays: -3,
    done: 3,
    overdue: true,
    note: 'Overdue and urgent: two escalations have already gone to the MD.',
  },
  {
    title: 'Turbine shaft sleeve',
    customer: 'Kirloskar Turbines',
    part: 'TS-1177',
    quantity: 40,
    priority: 'NORMAL',
    status: 'DELAYED',
    dueInDays: -1,
    done: 4,
    overdue: true,
    note: 'Overdue on the last step only — one chase, not a crisis.',
  },
  {
    title: 'Pump impeller set',
    customer: 'Coimbatore Pumps',
    part: 'PI-3320',
    quantity: 200,
    priority: 'NORMAL',
    status: 'AT_RISK',
    dueInDays: 2,
    done: 3,
    note: 'At risk: still inside its deadline, but only just.',
  },
  {
    title: 'Valve body machining',
    customer: 'Chennai Valves',
    part: 'VB-5510',
    quantity: 75,
    priority: 'HIGH',
    status: 'COMPLETED',
    dueInDays: -6,
    done: 5,
    note: 'Finished early. Contributes to the on-time percentage.',
  },
  {
    title: 'Bearing carrier ring',
    customer: 'NBC Bearings',
    part: 'BC-7742',
    quantity: 300,
    priority: 'NORMAL',
    status: 'COMPLETED',
    // Recent on purpose: the dashboard opens on "this month", and a job
    // finished a fortnight ago falls outside it at the start of one — which
    // would quietly make the on-time figure a flat 100.
    dueInDays: -4,
    done: 5,
    note: 'Finished, but one step landed late — so the percentage is not 100.',
  },
  {
    title: 'Coupling flange batch',
    customer: 'Elgi Equipments',
    part: 'CF-6120',
    quantity: 90,
    priority: 'NORMAL',
    status: 'ON_HOLD',
    dueInDays: 20,
    done: 1,
    note: 'On hold: the customer paused it. Nothing is chased while it is here.',
  },
  {
    title: 'Rotor end plate',
    customer: 'ABB India',
    part: 'RE-8830',
    quantity: 150,
    priority: 'NORMAL',
    status: 'DRAFT',
    dueInDays: 25,
    done: 0,
    note: 'A draft: planned but never published, so nobody has been told.',
  },
  {
    title: 'Cylinder head fixture',
    customer: 'Ashok Leyland',
    part: 'CH-4402',
    quantity: 8,
    priority: 'LOW',
    status: 'CANCELLED',
    dueInDays: 30,
    done: 1,
    note: 'Cancelled, not deleted — the record and its audit trail remain.',
  },
];

const CHAIN = [
  { code: 'PLANNING', title: 'Process plan, routing and tooling list', beforeDue: 10 },
  { code: 'PURCHASE', title: 'Raise PO for raw material', beforeDue: 8 },
  { code: 'STORE', title: 'Receive, inspect and issue material', beforeDue: 6 },
  { code: 'PRODUCTION', title: 'Machining and first-piece clearance', beforeDue: 3 },
  { code: 'QUALITY', title: 'Final inspection and report', beforeDue: 1 },
];

/**
 * When a step is due.
 *
 * Unfinished work on a job marked overdue is pushed into the past, staggered so
 * the oldest step has been late longest. Everything else is pulled forward to
 * at least half a day out: the chain's offsets are fixed hours before the job's
 * own deadline, so a job due in two days has its Production step nominally due
 * yesterday — which would quietly make a third job overdue and turn the "at
 * risk" example into a late one.
 */
function stepDeadline(
  spec: { overdue?: boolean },
  step: number,
  finished: boolean,
  nominal: Date,
  now: number,
): Date {
  if (finished) return nominal;
  if (spec.overdue) return new Date(now - (1 + step) * 8 * HOUR);

  const floor = now + (step + 1) * 12 * HOUR;
  return nominal.getTime() > floor ? nominal : new Date(floor);
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

  const prisma = new PrismaClient();

  try {
    const departments = await prisma.department.findMany({ select: { id: true, code: true } });
    if (departments.length === 0) {
      console.error('\nRun `pnpm seed` first — this needs departments to hang work on.\n');
      process.exit(1);
    }

    const departmentId = new Map(departments.map((row) => [row.code, row.id]));
    for (const step of CHAIN) {
      if (!departmentId.has(step.code)) {
        console.error(`\nNo ${step.code} department. Run \`pnpm seed\` first.\n`);
        process.exit(1);
      }
    }

    // Start from a clean showcase, so a second run does not stack twenty jobs
    // on top of ten. Only ever this dataset — `deleteMany` is scoped to the
    // showcase job codes and nothing else in the database is touched.
    const existing = await prisma.job.findMany({
      where: { jobCode: { startsWith: 'JGE-SHOW-' } },
      select: { id: true },
    });
    const ids = existing.map((row) => row.id);

    if (ids.length > 0) {
      await prisma.$transaction([
        prisma.notification.deleteMany({ where: { entityId: { in: ids } } }),
        prisma.problem.deleteMany({ where: { subtask: { jobId: { in: ids } } } }),
        prisma.deadlineChange.deleteMany({ where: { subtask: { jobId: { in: ids } } } }),
        prisma.extensionRequest.deleteMany({ where: { subtask: { jobId: { in: ids } } } }),
        prisma.comment.deleteMany({ where: { subtask: { jobId: { in: ids } } } }),
        prisma.attachment.deleteMany({
          where: { OR: [{ jobId: { in: ids } }, { subtask: { jobId: { in: ids } } }] },
        }),
        prisma.subtask.deleteMany({ where: { jobId: { in: ids } } }),
        prisma.job.deleteMany({ where: { id: { in: ids } } }),
      ]);
    }

    const { userId, credentials } = await ensurePeople(prisma, departmentId);
    const now = Date.now();
    let created = 0;

    for (const [index, spec] of JOBS.entries()) {
      const due = new Date(now + spec.dueInDays * DAY);
      const publishedAt = new Date(due.getTime() - 20 * DAY);

      const job = await prisma.job.create({
        data: {
          jobCode: `JGE-SHOW-${String(index + 1).padStart(3, '0')}`,
          title: spec.title,
          customerName: spec.customer,
          partNumber: spec.part,
          drawingNumber: `DRG-${spec.part.split('-')[1]}-B`,
          quantity: spec.quantity,
          priority: spec.priority,
          overallDeadline: due,
          status: spec.status,
          publishedAt: spec.status === 'DRAFT' ? null : publishedAt,
          completedAt: spec.status === 'COMPLETED' ? new Date(due.getTime() - 2 * DAY) : null,
          createdById: userId.get('md')!,
          createdAt: publishedAt,
          // The flag the sweeper and the digest filter on, so a showcase job
          // never mails anybody. `pnpm seed:demo` learned this the hard way.
          isDemo: true,
        },
        select: { id: true },
      });

      let previousId: string | null = null;

      for (const [step, chain] of CHAIN.entries()) {
        const deadline = new Date(due.getTime() - chain.beforeDue * DAY);
        const finished = step < spec.done;
        const current = step === spec.done;

        // The late one, on the job whose point is that the percentage is not
        // a hundred.
        const late = spec.title === 'Bearing carrier ring' && step === 3;

        const status =
          spec.status === 'CANCELLED' && !finished
            ? 'CANCELLED'
            : finished
              ? 'COMPLETED'
              : spec.status === 'DRAFT'
                ? 'PENDING'
                : current
                  ? spec.problem
                    ? 'PROBLEM'
                    : 'IN_PROGRESS'
                  : 'BLOCKED';

        const subtask: { id: string } = await prisma.subtask.create({
          data: {
            jobId: job.id,
            departmentId: departmentId.get(chain.code)!,
            assigneeId: userId.get(chain.code.toLowerCase())!,
            title: chain.title,
            deadline: stepDeadline(spec, step, finished, deadline, now),
            reminderLeadMinutes: 360,
            status,
            dependsOnId: previousId,
            startedAt: finished || current ? new Date(deadline.getTime() - 3 * DAY) : null,
            completedAt: finished
              ? new Date(deadline.getTime() + (late ? 30 * HOUR : -12 * HOUR))
              : null,
            escalationCount: spec.overdue && !finished ? Math.min(step + 1, 2) : 0,
          },
          select: { id: true },
        });

        if (current && spec.problem) {
          await prisma.problem.create({
            data: {
              subtaskId: subtask.id,
              raisedById: userId.get(chain.code.toLowerCase())!,
              description: spec.problem.text,
              severity: spec.problem.severity,
              status: 'OPEN',
              createdAt: new Date(now - 5 * HOUR),
            },
          });
        }

        previousId = subtask.id;
      }

      created++;
      console.log(
        `  ${String(index + 1).padStart(2)}. JGE-SHOW-${String(index + 1).padStart(3, '0')}  ${spec.title.padEnd(28)} ${spec.note}`,
      );
    }

    console.log(`\nTarget: ${parsed.host}:${parsed.port}/${parsed.database}`);
    console.log(`${created} showcase jobs, ${created * CHAIN.length} subtasks, 1 open problem.`);
    console.log('Re-running replaces them; nothing else in the database is touched.\n');

    reportSeedCredentials(credentials);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * The seven showcase accounts.
 *
 * Real, signable-in accounts with generated one-time passwords — a trainee has
 * to be able to log in as Priya and see what Priya sees, which the `seed:demo`
 * accounts (deliberately unusable) do not allow. Existing accounts keep the
 * password they already have, so a second run does not invalidate the sheet
 * somebody printed.
 */
async function ensurePeople(
  prisma: PrismaClient,
  departmentId: Map<string, string>,
): Promise<{ userId: Map<string, string>; credentials: SeedCredential[] }> {
  const userId = new Map<string, string>();
  const credentials: SeedCredential[] = [];

  for (const person of PEOPLE) {
    const email = `${person.key}@${DOMAIN}`;
    const found = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (found) {
      userId.set(person.key, found.id);
      continue;
    }

    const password = generateTempPassword();
    const row = await prisma.user.create({
      data: {
        email,
        name: person.name,
        role: person.role,
        departmentId: person.department ? departmentId.get(person.department) : null,
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
        isActive: true,
      },
      select: { id: true },
    });

    userId.set(person.key, row.id);
    credentials.push({ email, password });
  }

  return { userId, credentials };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
