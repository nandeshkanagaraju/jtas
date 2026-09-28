/**
 * `pnpm user:rename-email <old> <new>` — moves an account to a new address
 * without creating one.
 *
 * The distinction matters more than it looks. Changing an address by editing
 * the seed roster and re-seeding does **not** rename anybody: `prisma/seed.ts`
 * looks users up by email, finds nothing at the new address, and creates a
 * second account — leaving the original behind, still holding every subtask,
 * every audit row and every notification ever addressed to it. The roster then
 * has two Production Members, one of which receives the mail and the other of
 * which owns the work.
 *
 * So the row is updated in place. The primary key does not change, which is
 * what every foreign key in the schema actually points at, so assignments,
 * comments, attachments, audit history, refresh tokens and queued
 * notifications all follow the account automatically. Only the address moves.
 *
 * The rename is itself audited, because an address is identity: six weeks from
 * now, "who is this account and when did it become this person" has to be
 * answerable from the system.
 *
 * Local-only, on the same rule as `pnpm db:reset`.
 */
import { PrismaClient } from '@prisma/client';

import {
  assertLocalDisposableDatabase,
  UnsafeDatabaseError,
  type ParsedDatabaseUrl,
} from './lib/database-url';

const prisma = new PrismaClient();

export const RENAME_ACTION = 'USER_EMAIL_RENAMED';

/** Matches the Zod rule in `src/lib/validation/auth.ts`: trimmed, lowercased. */
function normalise(address: string): string {
  return address.trim().toLowerCase();
}

async function main() {
  const [rawOld, rawNew, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');

  if (!rawOld || !rawNew) {
    console.error(
      '\nUsage:\n' +
        '  pnpm user:rename-email <oldAddress> <newAddress> [--dry-run]\n\n' +
        'Renames in place. Never creates an account.\n',
    );
    process.exit(1);
  }

  const oldEmail = normalise(rawOld);
  const newEmail = normalise(rawNew);

  if (oldEmail === newEmail) {
    console.error('\n  ✖ The two addresses are the same.\n');
    process.exit(1);
  }

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
      console.error(`\n  ✖ ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  console.log(`\nTarget: ${parsed.host}:${parsed.port}/${parsed.database}`);

  const before = await prisma.user.count();

  const user = await prisma.user.findUnique({
    where: { email: oldEmail },
    select: { id: true, name: true, role: true, department: { select: { code: true } } },
  });

  if (!user) {
    console.error(`\n  ✖ No account has the address "${oldEmail}". Nothing changed.\n`);
    process.exit(1);
  }

  // The unique index would refuse anyway; this says why, before the write.
  const clash = await prisma.user.findUnique({
    where: { email: newEmail },
    select: { id: true, name: true },
  });

  if (clash) {
    console.error(
      `\n  ✖ "${newEmail}" already belongs to ${clash.name} (${clash.id}).\n` +
        `    Renaming would collide. Nothing changed.\n`,
    );
    process.exit(1);
  }

  /** What follows the account because it is keyed on the id, not the address. */
  const [subtasks, notifications, auditRows, tokens, jobs] = await Promise.all([
    prisma.subtask.count({ where: { assigneeId: user.id } }),
    prisma.notification.count({ where: { userId: user.id } }),
    prisma.auditLog.count({ where: { actorId: user.id } }),
    prisma.refreshToken.count({ where: { userId: user.id } }),
    prisma.job.count({ where: { createdById: user.id } }),
  ]);

  console.log(
    `\n  ${user.name} (${user.role}${user.department ? `, ${user.department.code}` : ''})\n` +
      `    from ${oldEmail}\n` +
      `    -> ${newEmail}\n\n` +
      `  Attached to the id, so unaffected by the rename:\n` +
      `    subtasks assigned  ${subtasks}\n` +
      `    notifications      ${notifications}\n` +
      `    audit rows         ${auditRows}\n` +
      `    refresh tokens     ${tokens}\n` +
      `    jobs created       ${jobs}\n`,
  );

  if (dryRun) {
    console.log('  --dry-run: nothing was written.\n');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { email: newEmail } });

    await tx.auditLog.create({
      data: {
        actorId: null,
        action: RENAME_ACTION,
        entityType: 'USER',
        entityId: user.id,
        before: { email: oldEmail },
        after: {
          email: newEmail,
          note:
            'Renamed in place by pnpm user:rename-email. The id is unchanged, so every ' +
            'assignment, comment, attachment, audit row, refresh token and queued ' +
            'notification stays with this account. No account was created.',
        },
        ipAddress: null,
      },
    });
  });

  const after = await prisma.user.count();

  console.log(
    `  ✔ 1 row renamed, ${after - before} created (accounts before ${before}, after ${after}).`,
  );
  console.log(`  ✔ audited as ${RENAME_ACTION} on user ${user.id}.\n`);

  if (after !== before) {
    console.error('  ✖ The account count changed. That should be impossible; investigate.\n');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
