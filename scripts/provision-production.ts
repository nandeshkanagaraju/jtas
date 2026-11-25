/**
 * `pnpm production:provision [--yes] [--reset-passwords]` — sets up the daily
 * production report:
 *
 *   - the machines in each book (CNC book: CNC-01…22, TMC-01, DRILLING-01/02,
 *     THREAD ROLLING-01; VMC book: VMC-01…10)
 *   - the Cycle Time Master from `prisma/seed-data/production-parts.ts`
 *     (a part already there is left alone, so edits made since survive)
 *   - the two test supervisor logins, one per book
 *
 * A supervisor's password is generated when the account is created, printed
 * once and written to `.production-credentials.txt` (mode 0600, git-ignored).
 * Re-running keeps it unless `--reset-passwords` is given.
 *
 * Against anything but a local `_dev`/`_test` database it asks for `--yes`.
 */
import { chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import bcrypt from 'bcryptjs';
import { PrismaClient, type ProductionSection } from '@prisma/client';

import { PRODUCTION_PARTS } from '../prisma/seed-data/production-parts';
import { BOOK_MACHINES } from '../src/lib/domain/production';
import { BCRYPT_COST } from '../src/lib/auth/password';
import { generateTempPassword } from '../src/lib/auth/temp-password';
import { assertLocalDisposableDatabase, parseDatabaseUrl } from './lib/database-url';

const CREDENTIALS_FILE = '.production-credentials.txt';

/** Test logins until the real supervisors' names and addresses are known. */
const TEST_SUPERVISORS: Array<{ name: string; email: string; section: ProductionSection }> = [
  { name: 'CNC Supervisor (test)', email: 'supervisor.cnc@jaraaglobal.in', section: 'CNC' },
  { name: 'VMC Supervisor (test)', email: 'supervisor.vmc@jaraaglobal.in', section: 'VMC' },
];

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function main() {
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
        'Re-run with --yes to set up production reports there.',
    );
  }
  const resetPasswords = process.argv.includes('--reset-passwords');

  const prisma = new PrismaClient();
  try {
    // --- Machines -----------------------------------------------------------
    for (const section of ['CNC', 'VMC'] as const) {
      for (const [index, code] of BOOK_MACHINES[section].entries()) {
        await prisma.productionMachine.upsert({
          where: { code },
          create: { code, section, sortOrder: index + 1 },
          update: { section, sortOrder: index + 1, isActive: true },
        });
      }
    }
    console.log(
      `  machines: ${BOOK_MACHINES.CNC.length} in the CNC book, ${BOOK_MACHINES.VMC.length} in the VMC book`,
    );

    // --- Cycle Time Master --------------------------------------------------
    let added = 0;
    for (const part of PRODUCTION_PARTS) {
      const existing = await prisma.productionPart.findFirst({
        where: {
          section: part.section,
          partName: part.partName,
          partNumber: part.partNumber,
          operation: part.operation,
        },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.productionPart.create({ data: part });
      added += 1;
    }
    console.log(`  parts: ${added} added, ${PRODUCTION_PARTS.length - added} already there`);

    // --- Supervisors --------------------------------------------------------
    const sheet: string[] = [];
    for (const supervisor of TEST_SUPERVISORS) {
      const email = supervisor.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      const common = {
        name: supervisor.name,
        role: 'SUPERVISOR' as const,
        departmentId: null,
        productionSection: supervisor.section,
        isActive: true,
        mustChangePassword: false,
      };

      if (!existing || resetPasswords) {
        const password = generateTempPassword();
        const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
        if (existing) {
          await prisma.$transaction([
            prisma.user.update({
              where: { id: existing.id },
              data: { ...common, passwordHash, failedLoginCount: 0, lockedUntil: null },
            }),
            prisma.refreshToken.updateMany({
              where: { userId: existing.id, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]);
          console.log(`  ~ ${email} password reset`);
        } else {
          await prisma.user.create({ data: { ...common, email, passwordHash } });
          console.log(`  + ${email} created`);
        }
        sheet.push(`${supervisor.name}\t${email}\t${password}`);
      } else {
        await prisma.user.update({ where: { id: existing.id }, data: common });
        console.log(`  = ${email} kept (password unchanged)`);
      }
    }

    if (sheet.length > 0) {
      const path = resolve(process.cwd(), CREDENTIALS_FILE);
      writeFileSync(
        path,
        `Production supervisor logins (${target.host}/${target.database})\n\n${sheet.join('\n')}\n`,
        { mode: 0o600 },
      );
      chmodSync(path, 0o600);
      console.log(`\n  New passwords written to ${CREDENTIALS_FILE} (shown once):\n`);
      for (const row of sheet) console.log(`    ${row}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
