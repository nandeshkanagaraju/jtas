/**
 * A known world, rebuilt before every end-to-end run (build spec M11.1).
 *
 * The suite asserts on an on-time percentage and on which mails exist, so it
 * cannot run against whatever the developer's database happens to hold. This
 * truncates and reseeds a small, exact shop: eight departments, one MD, one
 * member per department, and one job template.
 *
 * Against `jtas_e2e`, never `jtas_dev` — the guard below refuses anything else,
 * because a suite that silently truncates a developer's afternoon of test data
 * is a suite people stop running.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/** Everyone signs in with this. Generated per run, never committed. */
export const E2E_PASSWORD = 'E2e#Harness2026!';

export const ACCOUNTS = {
  md: 'md@e2e.invalid',
  planning: 'planning@e2e.invalid',
  purchase: 'purchase@e2e.invalid',
  store: 'store@e2e.invalid',
  production: 'production@e2e.invalid',
  quality: 'quality@e2e.invalid',
} as const;

export const DEPARTMENTS = [
  { code: 'PLANNING', name: 'Planning', sequenceOrder: 1 },
  { code: 'PURCHASE', name: 'Purchase', sequenceOrder: 2 },
  { code: 'STORE', name: 'Store', sequenceOrder: 3 },
  { code: 'PRODUCTION', name: 'Production', sequenceOrder: 4 },
  { code: 'QUALITY', name: 'Quality', sequenceOrder: 5 },
  { code: 'DISPATCH', name: 'Dispatch', sequenceOrder: 6 },
  { code: 'ACCOUNTS', name: 'Accounts', sequenceOrder: 7 },
  { code: 'HR', name: 'HR', sequenceOrder: 8 },
];

/** The template the MD creates a job from in step (a). */
export const TEMPLATE_NAME = 'Standard CNC job';

function assertDisposable(url: string): void {
  const database = new URL(url).pathname.replace(/^\//, '').split('?')[0];

  if (!/_e2e$/.test(database)) {
    throw new Error(
      `Refusing to seed "${database}". The end-to-end suite truncates every table, ` +
        'so it runs only against a database whose name ends in _e2e. ' +
        'Set DATABASE_URL accordingly — see docs/RUNBOOK.md.',
    );
  }
}

export function e2eDatabaseUrl(): string {
  const configured = process.env.DATABASE_URL;
  if (!configured) throw new Error('DATABASE_URL is not set.');

  // `jtas_dev` -> `jtas_e2e`, so a developer needs no extra configuration.
  return configured.replace(/(_dev|_test)(\?|$)/, '_e2e$2');
}

export interface SeededWorld {
  departmentIds: Record<string, string>;
  userIds: Record<string, string>;
  templateId: string;
}

export async function seedE2E(): Promise<SeededWorld> {
  const url = e2eDatabaseUrl();
  assertDisposable(url);

  const prisma = new PrismaClient({ datasourceUrl: url });

  try {
    // Order matters: children before parents. `TRUNCATE ... CASCADE` in one
    // statement is faster and needs no ordering, but naming the tables keeps
    // this honest about what the suite destroys.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "Notification", "AuditLog", "Comment", "Attachment",
        "DeadlineChange", "ExtensionRequest", "Problem", "Subtask",
        "Job", "JobCodeCounter", "RefreshToken", "JobTemplateItem",
        "JobTemplate", "Holiday", "Setting", "User", "Department"
      RESTART IDENTITY CASCADE
    `);

    const departments: Record<string, string> = {};
    for (const department of DEPARTMENTS) {
      const row = await prisma.department.create({ data: { ...department, isActive: true } });
      departments[department.code] = row.id;
    }

    const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);

    const users: Record<string, string> = {};

    const md = await prisma.user.create({
      data: {
        name: 'Managing Director',
        email: ACCOUNTS.md,
        passwordHash,
        role: 'MD',
        // No forced change: the suite is about the work, not the first-login
        // flow, which has its own integration coverage.
        mustChangePassword: false,
      },
    });
    users.md = md.id;

    for (const [key, email] of Object.entries(ACCOUNTS)) {
      if (key === 'md') continue;

      const code = key.toUpperCase();
      const row = await prisma.user.create({
        data: {
          name: `${DEPARTMENTS.find((d) => d.code === code)?.name ?? code} Member`,
          email,
          passwordHash,
          role: 'MEMBER',
          departmentId: departments[code],
          mustChangePassword: false,
        },
      });
      users[key] = row.id;
    }

    // Settings at their documented defaults, so the suite's assertions about
    // reminder timing are about the code rather than about local tinkering.
    const { settingDefaults } = await import('../../../src/lib/domain/settings-definitions');
    for (const [key, value] of Object.entries(settingDefaults())) {
      await prisma.setting.create({ key, value } as never).catch(async () => {
        await prisma.setting.upsert({
          where: { key },
          create: { key, value: value as never },
          update: { value: value as never },
        });
      });
    }

    /*
     * A five-step chain, each waiting on the one before. Step (c) of the
     * scenario — "Purchase, previously BLOCKED, becomes actionable" — depends
     * on Purchase waiting for Planning, so the dependency is the point of the
     * template rather than decoration.
     */
    const template = await prisma.jobTemplate.create({ data: { name: TEMPLATE_NAME } });

    const steps = [
      { code: 'PLANNING', title: 'Process plan, routing and tooling list', offset: 240 },
      { code: 'PURCHASE', title: 'Raise PO for raw material', offset: 192 },
      { code: 'STORE', title: 'Receive, inspect and issue material', offset: 144 },
      { code: 'PRODUCTION', title: 'Machining and first-piece clearance', offset: 72 },
      { code: 'QUALITY', title: 'Final inspection and report', offset: 24 },
    ];

    await prisma.jobTemplateItem.createMany({
      data: steps.map((step, index) => ({
        templateId: template.id,
        order: index,
        departmentId: departments[step.code],
        title: step.title,
        offsetHoursBeforeDue: step.offset,
        reminderLeadMinutes: 360,
        dependsOnItemOrder: index === 0 ? null : index - 1,
      })),
    });

    return { departmentIds: departments, userIds: users, templateId: template.id };
  } finally {
    await prisma.$disconnect();
  }
}

/** A client bound to the end-to-end database, for assertions inside a spec. */
export function e2ePrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: e2eDatabaseUrl() });
}
