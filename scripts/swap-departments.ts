/**
 * `pnpm users:swap-departments <emailA> <emailB> --by <actorEmail> [--apply]`
 *
 * Swaps two people's departments and hands each one's open work in their old
 * department to the other. Built for "Dhiyaneswar does Planning, Chinnarasu
 * does Marketing for now", and reversible by running it again.
 *
 *   1. A moves to B's department and B to A's, audited as USER_UPDATED.
 *   2. Every open task A held in A's old department is reassigned to B, and
 *      vice versa, through the app's own `reassignSubtask`: audited as
 *      SUBTASK_REASSIGNED, pending reminders re-addressed, and the new holder
 *      notified exactly as if the MD had reassigned it on screen.
 *
 * Finished and cancelled tasks stay with whoever did them. Logins, passwords
 * and names do not change.
 *
 * Without `--apply` it only prints the plan. `--by` names the account the audit
 * rows are attributed to (normally the developer).
 */
import type { User } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { writeAudit } from '@/lib/services/audit-service';
import { reassignSubtask } from '@/lib/services/subtasks';

import { parseDatabaseUrl } from './lib/database-url';

const OPEN = { notIn: ['COMPLETED', 'CANCELLED'] as Array<'COMPLETED' | 'CANCELLED'> };

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function argAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : undefined;
}

async function person(email: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { department: true },
  });
  if (!user) fail(`No account for ${email}.`);
  if (!user.isActive) fail(`${email} is deactivated.`);
  if (!user.department) fail(`${email} has no department to swap.`);
  return user as User & { department: NonNullable<typeof user.department> };
}

async function main() {
  const [emailA, emailB] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const byEmail = argAfter('--by');
  if (!emailA || !emailB || !byEmail) {
    fail('Usage: pnpm users:swap-departments <emailA> <emailB> --by <actorEmail> [--apply]');
  }
  const apply = process.argv.includes('--apply');

  const target = parseDatabaseUrl(process.env.DATABASE_URL ?? '');
  console.log(`Database: ${target.host}/${target.database}`);

  const a = await person(emailA);
  const b = await person(emailB);
  if (a.id === b.id) fail('Those are the same account.');
  if (a.departmentId === b.departmentId) fail('They are already in the same department.');
  const actor = await prisma.user.findUnique({ where: { email: byEmail.trim().toLowerCase() } });
  if (!actor) fail(`No account for ${byEmail}.`);

  const openTasks = (holder: typeof a) =>
    prisma.subtask.findMany({
      where: { assigneeId: holder.id, departmentId: holder.departmentId!, status: OPEN },
      select: { id: true, title: true, status: true, job: { select: { jobCode: true } } },
      orderBy: { createdAt: 'asc' },
    });
  const [fromA, fromB] = await Promise.all([openTasks(a), openTasks(b)]);

  console.log(`\n${a.name} <${a.email}>: ${a.department.name} → ${b.department.name}`);
  console.log(`${b.name} <${b.email}>: ${b.department.name} → ${a.department.name}`);
  for (const [tasks, from, to] of [
    [fromA, a, b],
    [fromB, b, a],
  ] as const) {
    console.log(
      `\nOpen ${from.department.name} tasks moving from ${from.name} to ${to.name}: ${tasks.length}`,
    );
    for (const task of tasks) console.log(`  ${task.job.jobCode}  ${task.title}  (${task.status})`);
  }

  // The template picks the first active member of a department, so anyone
  // else still there would compete with the person moving in.
  for (const dept of [a.department, b.department]) {
    const others = await prisma.user.findMany({
      where: { departmentId: dept.id, isActive: true, id: { notIn: [a.id, b.id] } },
      select: { email: true },
    });
    if (others.length) {
      console.log(`\nNote: ${dept.name} also has ${others.map((o) => o.email).join(', ')}`);
    }
  }

  if (!apply) {
    console.log('\nNothing changed. Re-run with --apply to make the swap.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const [user, to] of [
      [a, b.department],
      [b, a.department],
    ] as const) {
      await tx.user.update({ where: { id: user.id }, data: { departmentId: to.id } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'USER_UPDATED',
        entityType: 'USER',
        entityId: user.id,
        before: { departmentId: user.departmentId, department: user.department.name },
        after: { departmentId: to.id, department: to.name, reason: 'Department swap' },
        ipAddress: 'script',
      });
    }
  });
  console.log('\nDepartments swapped.');

  const ctx = { ipAddress: 'script' };
  for (const [tasks, from, to] of [
    [fromA, a, b],
    [fromB, b, a],
  ] as const) {
    for (const task of tasks) {
      await reassignSubtask(
        task.id,
        {
          assigneeId: to.id,
          reason: `Department swap: ${from.department.name} work moves to ${to.name}`,
        },
        { id: actor.id, role: actor.role },
        ctx,
      );
      console.log(`  reassigned ${task.job.jobCode}  ${task.title} → ${to.name}`);
    }
  }
  console.log(`\nDone: ${fromA.length + fromB.length} open task(s) reassigned.`);
}

main()
  .catch((error) => {
    console.error('Swap failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
