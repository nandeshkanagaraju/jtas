/**
 * Schedules one subtask's notifications against the end-to-end database.
 *
 * Out of process for the same reason as `e2e-sweep.ts`.
 */
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

process.env.DATABASE_URL = (process.env.DATABASE_URL ?? '').replace(/(_dev|_test)(\?|$)/, '_e2e$2');
process.env.MAIL_PROVIDER = 'smtp';
process.env.BREVO_API_KEY = '';
process.env.MAIL_ALLOWLIST = '';
process.env.MAIL_DAILY_CAP = '250';

async function main() {
  const subtaskId = process.argv[2];
  if (!subtaskId) throw new Error('Usage: e2e-schedule.ts <subtaskId>');

  const { prisma } = await import('../src/lib/db/prisma');
  const { scheduleForSubtask } = await import('../src/lib/notifications/notification-service');

  const subtask = await prisma.subtask.findUniqueOrThrow({ where: { id: subtaskId } });

  await scheduleForSubtask(prisma, {
    id: subtask.id,
    assigneeId: subtask.assigneeId,
    deadline: subtask.deadline,
    reminderLeadMinutes: subtask.reminderLeadMinutes,
  });

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
