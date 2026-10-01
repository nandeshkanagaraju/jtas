/**
 * Seed data for a usable JTAS instance (build spec M0.5).
 *
 * Idempotent: every write is an upsert keyed on a natural unique column, so
 * `pnpm seed` can be re-run against an existing database without duplicating
 * rows or resetting a password someone has already changed.
 *
 * Each account created by a run gets its own random temporary password, printed
 * once at the end. Nothing here ever writes a password in plain text to the
 * database or to a log.
 *
 * Run with: pnpm seed
 * One-shot production override: tsx prisma/seed.ts --allow-email-overrides
 * Without that flag, NODE_ENV=production ignores every SEED_* address.
 */
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { generateTempPassword } from '../src/lib/auth/temp-password';
import { SEED_DEPARTMENTS } from './seed-data/departments';
import { SEED_SETTINGS } from './seed-data/settings';
import { STANDARD_CNC_TEMPLATE } from './seed-data/template';
import { buildSeedUsers, type SeedUser } from './seed-data/users';
import { reportSeedCredentials, type SeedCredential } from './seed-credentials';

const prisma = new PrismaClient();

/** SDD section 8.1: bcrypt cost 12. */
const BCRYPT_COST = 12;

async function seedDepartments() {
  for (const dept of SEED_DEPARTMENTS) {
    await prisma.department.upsert({
      where: { code: dept.code },
      create: dept,
      update: { name: dept.name, sequenceOrder: dept.sequenceOrder },
    });
  }
  console.log(`  ✔ ${SEED_DEPARTMENTS.length} departments`);
}

/**
 * Creates or updates the seeded accounts.
 *
 * @returns the credentials for accounts created by *this* run. An account that
 *          already existed keeps its password — regenerating it would lock out
 *          whoever is using it — and so contributes nothing to report.
 */
async function seedUsers(users: SeedUser[]): Promise<SeedCredential[]> {
  const departments = await prisma.department.findMany();
  const byCode = new Map(departments.map((d) => [d.code, d.id]));

  const created: SeedCredential[] = [];
  let existing = 0;

  for (const user of users) {
    const departmentId = user.departmentCode ? (byCode.get(user.departmentCode) ?? null) : null;

    const alreadyThere = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true },
    });

    if (alreadyThere) {
      // Never touch passwordHash or mustChangePassword on re-seed.
      await prisma.user.update({
        where: { email: user.email },
        data: { name: user.name, role: user.role as Role, departmentId },
      });
      existing++;
      continue;
    }

    const password = generateTempPassword();

    await prisma.user.create({
      data: {
        name: user.name,
        email: user.email,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        role: user.role as Role,
        departmentId,
        mustChangePassword: true,
      },
    });

    created.push({ email: user.email, password });
  }

  console.log(`  ✔ ${users.length} users (${created.length} created, ${existing} already present)`);

  return created;
}

async function seedSettings() {
  for (const [key, value] of Object.entries(SEED_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      // Settings are operator-owned once the system is live; only insert
      // missing keys so a re-seed cannot revert the MD's working hours.
      update: {},
    });
  }
  console.log(`  ✔ ${Object.keys(SEED_SETTINGS).length} settings`);
}

async function seedJobTemplate() {
  const departments = await prisma.department.findMany();
  const byCode = new Map(departments.map((d) => [d.code, d.id]));

  const existing = await prisma.jobTemplate.findFirst({
    where: { name: STANDARD_CNC_TEMPLATE.name },
  });

  const template =
    existing ?? (await prisma.jobTemplate.create({ data: { name: STANDARD_CNC_TEMPLATE.name } }));

  // Items are fully replaced so an edit to the template definition takes
  // effect; already-created jobs copied their values at creation time and are
  // unaffected.
  await prisma.jobTemplateItem.deleteMany({ where: { templateId: template.id } });

  for (const item of STANDARD_CNC_TEMPLATE.items) {
    const departmentId = byCode.get(item.departmentCode);
    if (!departmentId) {
      throw new Error(`Template references unknown department "${item.departmentCode}"`);
    }
    await prisma.jobTemplateItem.create({
      data: {
        templateId: template.id,
        departmentId,
        title: item.title,
        offsetHoursBeforeDue: item.offsetHoursBeforeDue,
        reminderLeadMinutes: item.reminderLeadMinutes,
        dependsOnItemOrder: item.dependsOnItemOrder,
        order: item.order,
      },
    });
  }
  console.log(
    `  ✔ job template "${STANDARD_CNC_TEMPLATE.name}" with ${STANDARD_CNC_TEMPLATE.items.length} items`,
  );
}

async function main() {
  // Opt-in for one command. Absent, NODE_ENV=production still ignores SEED_*.
  const allowEmailOverrides = process.argv.includes('--allow-email-overrides');
  const users = buildSeedUsers(process.env, console.warn, { allowEmailOverrides });

  console.log('Seeding JTAS…');
  await seedDepartments();
  const credentials = await seedUsers(users);
  await seedSettings();
  await seedJobTemplate();
  console.log('Done.');

  reportSeedCredentials(credentials);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
