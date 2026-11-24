/**
 * `pnpm users:provision-departments [--yes]` — creates or updates the real
 * department logins in `prisma/seed-data/department-accounts.ts` and sets each
 * password to `<Department name><DEPARTMENT_PASSWORD_SUFFIX>`.
 *
 * Passwords are owned by the organisation: nobody is asked to change theirs and
 * self-service change is closed. Safe to re-run — an account whose password
 * already matches keeps its sessions; one whose password changes is signed out
 * everywhere.
 *
 * Writes the full credential sheet to `.department-credentials.txt` (mode
 * 0600, git-ignored) so the organisation has one place to look them up.
 *
 * Against anything but a local `_dev`/`_test` database it asks for `--yes`.
 */
import { chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

import { DEPARTMENT_ACCOUNTS } from '../prisma/seed-data/department-accounts';
import { SEED_DEPARTMENTS } from '../prisma/seed-data/departments';
import { BCRYPT_COST } from '../src/lib/auth/password';
import { assertLocalDisposableDatabase, parseDatabaseUrl } from './lib/database-url';

const CREDENTIALS_FILE = '.department-credentials.txt';

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/**
 * Moves a placeholder account's open tasks to the real person and deactivates
 * the placeholder, in one transaction, with the same audit rows the Users
 * screen writes (actor: none, because a script did it). Re-running finds the
 * placeholder already inactive and does nothing.
 */
async function handOver(
  prisma: PrismaClient,
  placeholderEmail: string,
  person: { id: string; name: string },
) {
  const placeholder = await prisma.user.findUnique({ where: { email: placeholderEmail } });
  if (!placeholder || !placeholder.isActive || placeholder.id === person.id) return;

  const moved = await prisma.$transaction(async (tx) => {
    const open = await tx.subtask.findMany({
      where: { assigneeId: placeholder.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true },
    });

    if (open.length > 0) {
      await tx.subtask.updateMany({
        where: { id: { in: open.map((s) => s.id) } },
        data: { assigneeId: person.id },
      });
      await tx.auditLog.createMany({
        data: open.map((s) => ({
          actorId: null,
          action: 'USER_REASSIGNED' as const,
          entityType: 'SUBTASK' as const,
          entityId: s.id,
          before: { assigneeId: placeholder.id, assigneeName: placeholder.name },
          after: { assigneeId: person.id, assigneeName: person.name },
        })),
      });
    }

    await tx.user.update({ where: { id: placeholder.id }, data: { isActive: false } });
    await tx.refreshToken.updateMany({
      where: { userId: placeholder.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'USER_DEACTIVATED',
        entityType: 'USER',
        entityId: placeholder.id,
        before: { email: placeholder.email, isActive: true },
        after: {
          isActive: false,
          reassignedTo: person.id,
          reassignedSubtaskCount: open.length,
          reason: 'Replaced by the real department account',
        },
      },
    });

    return open.length;
  });

  console.log(
    `    ↳ ${placeholderEmail} deactivated; ${moved} open task${moved === 1 ? '' : 's'} moved to ${person.name}`,
  );
}

async function main() {
  const suffix = process.env.DEPARTMENT_PASSWORD_SUFFIX?.trim();
  if (!suffix) fail('DEPARTMENT_PASSWORD_SUFFIX is not set. Add it to .env.');

  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is not set.');

  let local = true;
  try {
    assertLocalDisposableDatabase(url);
  } catch {
    local = false;
  }
  const target = parseDatabaseUrl(url);
  if (!local && !process.argv.includes('--yes')) {
    fail(
      `DATABASE_URL points at ${target.host}/${target.database}, which is not a local database.\n` +
        'Re-run with --yes to set the department passwords there.',
    );
  }

  const prisma = new PrismaClient();
  const sheet: Array<{ name: string; department: string; email: string; password: string }> = [];

  try {
    // Departments the roster needs, created if this database predates them.
    const codes = new Set(
      DEPARTMENT_ACCOUNTS.flatMap((a) => (a.departmentCode ? [a.departmentCode] : [])),
    );
    for (const dept of SEED_DEPARTMENTS.filter((d) => codes.has(d.code))) {
      await prisma.department.upsert({
        where: { code: dept.code },
        create: dept,
        update: {},
      });
    }
    const departments = await prisma.department.findMany({ where: { code: { in: [...codes] } } });
    const byCode = new Map(departments.map((d) => [d.code, d]));

    for (const account of DEPARTMENT_ACCOUNTS) {
      const department = account.departmentCode ? byCode.get(account.departmentCode) : null;
      if (account.departmentCode && !department) {
        fail(`Unknown department code ${account.departmentCode}.`);
      }

      const email = account.email.toLowerCase();
      const password = `${account.passwordName}${suffix}`;
      const existing = await prisma.user.findUnique({ where: { email } });

      const common = {
        name: account.name,
        role: account.role ?? ('MEMBER' as const),
        departmentId: department?.id ?? null,
        isActive: true,
        mustChangePassword: false,
      };

      if (!existing) {
        await prisma.user.create({
          data: { ...common, email, passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
        });
        console.log(`  + created  ${email}`);
      } else if (await bcrypt.compare(password, existing.passwordHash)) {
        await prisma.user.update({ where: { id: existing.id }, data: common });
        console.log(`  = updated  ${email} (password unchanged)`);
      } else {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: existing.id },
            data: {
              ...common,
              passwordHash: await bcrypt.hash(password, BCRYPT_COST),
              failedLoginCount: 0,
              lockedUntil: null,
            },
          }),
          // Anything signed in with the old password is signed out.
          prisma.refreshToken.updateMany({
            where: { userId: existing.id, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        ]);
        console.log(`  ~ updated  ${email} (password set)`);
      }

      if (account.replaces) {
        const person = await prisma.user.findUniqueOrThrow({ where: { email } });
        await handOver(prisma, account.replaces.toLowerCase(), person);
      }

      sheet.push({
        name: account.name,
        department: department?.name ?? 'Managing Director',
        email,
        password,
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  const widths = {
    name: Math.max(4, ...sheet.map((r) => r.name.length)),
    department: Math.max(10, ...sheet.map((r) => r.department.length)),
    email: Math.max(5, ...sheet.map((r) => r.email.length)),
  };
  const row = (r: { name: string; department: string; email: string; password: string }) =>
    `${r.name.padEnd(widths.name)}  ${r.department.padEnd(widths.department)}  ${r.email.padEnd(widths.email)}  ${r.password}`;
  const header = row({
    name: 'NAME',
    department: 'DEPARTMENT',
    email: 'EMAIL',
    password: 'PASSWORD',
  });

  const path = resolve(process.cwd(), CREDENTIALS_FILE);
  writeFileSync(
    path,
    [
      'JTAS department logins. Passwords are set by the organisation.',
      `Database: ${target.host}/${target.database}`,
      `Written ${new Date().toISOString()}`,
      '',
      header,
      '-'.repeat(header.length),
      ...sheet.map(row),
      '',
    ].join('\n'),
    { encoding: 'utf8', mode: 0o600 },
  );
  chmodSync(path, 0o600);

  console.log(`\n${sheet.length} department accounts ready on ${target.host}/${target.database}.`);
  console.log(`Credential sheet: ${path} (mode 0600, git-ignored).`);
}

main().catch((error) => {
  console.error('Provisioning failed:', error);
  process.exitCode = 1;
});
