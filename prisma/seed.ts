/**
 * Seed data for a usable JTAS instance (build spec M0.5).
 *
 * Idempotent: every write is an upsert keyed on a natural unique column, so
 * `pnpm seed` can be re-run against an existing database without duplicating
 * rows or resetting a password someone has already changed.
 *
 * Run with: pnpm seed
 */
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { SEED_DEPARTMENTS } from './seed-data/departments';
import { SEED_SETTINGS } from './seed-data/settings';
import { STANDARD_CNC_TEMPLATE } from './seed-data/template';
import { SEED_USERS, TEMP_PASSWORD } from './seed-data/users';

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

async function seedUsers() {
  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, BCRYPT_COST);
  const departments = await prisma.department.findMany();
  const byCode = new Map(departments.map((d) => [d.code, d.id]));

  for (const user of SEED_USERS) {
    const departmentId = user.departmentCode ? (byCode.get(user.departmentCode) ?? null) : null;

    await prisma.user.upsert({
      where: { email: user.email },
      create: {
        name: user.name,
        email: user.email,
        passwordHash,
        role: user.role as Role,
        departmentId,
        mustChangePassword: true,
      },
      // Never overwrite passwordHash or mustChangePassword on re-seed: a user
      // who has already set a real password must keep it.
      update: { name: user.name, role: user.role as Role, departmentId },
    });
  }
  console.log(`  ✔ ${SEED_USERS.length} users (temporary password "${TEMP_PASSWORD}")`);
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
  console.log('Seeding JTAS…');
  await seedDepartments();
  await seedUsers();
  await seedSettings();
  await seedJobTemplate();
  console.log('Done.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
