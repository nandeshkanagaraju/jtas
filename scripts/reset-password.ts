/**
 * `pnpm user:reset-password <email>` — issues one account a fresh temporary
 * password.
 *
 * Uses the same generator as the seed and the admin reset endpoint
 * (`generateTempPassword`), so there is one definition of what a temporary
 * password is and no second implementation to drift.
 *
 * Deliberately local-only, on the same rule as `pnpm db:reset`: production
 * password resets go through the administrator screen, which checks `can()`,
 * writes an audit row and revokes the user's live sessions. A CLI that
 * silently rewrites a hash on a production database has none of that, and a
 * mistyped `DATABASE_URL` would lock somebody out with no record of why.
 */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

import { BCRYPT_COST } from '../src/lib/auth/password';
import { generateTempPassword } from '../src/lib/auth/temp-password';
import {
  assertLocalDisposableDatabase,
  UnsafeDatabaseError,
  type ParsedDatabaseUrl,
} from './lib/database-url';

function usage(): never {
  console.error('\nUsage: pnpm user:reset-password <email> [--yes]\n');
  process.exit(1);
}

async function confirm(email: string): Promise<boolean> {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;

  if (!stdin.isTTY) {
    console.error('\nNot a terminal. Re-run with --yes to reset non-interactively.');
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`\nType the email to confirm the reset: `);
    return answer.trim() === email;
  } finally {
    rl.close();
  }
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || email.startsWith('-') || !email.includes('@')) usage();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  let parsed: ParsedDatabaseUrl;
  try {
    parsed = assertLocalDisposableDatabase(url);
  } catch (error) {
    if (error instanceof UnsafeDatabaseError) {
      console.error(`\n${error.message}\n`);
      console.error(
        'Reset a production password from the Users screen instead: it records\n' +
          'who did it and signs the account out everywhere.\n',
      );
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user) {
      console.error(`\nNo account with the email ${email} on ${parsed.database}.\n`);
      process.exit(1);
    }

    console.log(`\nTarget: ${parsed.host}:${parsed.port}/${parsed.database}`);
    console.log(`  ${user.name} <${user.email}>  ${user.role}${user.isActive ? '' : '  INACTIVE'}`);

    if (!(await confirm(user.email))) {
      console.error('\nThat did not match. Nothing was changed.\n');
      process.exit(1);
    }

    const password = generateTempPassword();

    // Only the two password columns. Sessions, audit history, assignments and
    // the active flag are somebody else's business.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        mustChangePassword: true,
      },
    });

    console.log(`\n  ${user.email}  ${password}`);
    console.log('\nShown once. It is not recoverable — run this again if it is lost.');
    console.log('The account must change it at the next sign-in.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
