/**
 * `pnpm explain:subtask -- <subtask id or job code>`
 *
 * Prints what the next sweep would do to that subtask, and which filter would
 * stop it. Does not send mail and does not write a notification.
 *
 * Local-only, on the same rule as `pnpm db:reset`.
 */
import { PrismaClient } from '@prisma/client';

import { explainSweep } from '@/lib/notifications/explain-sweep';
import { mailGuardConfig, quotaStatus } from '@/lib/notifications/mail-guard';
import {
  loadEscalationConfig,
  loadSuppressOutsideHours,
  loadWorkingHours,
} from '@/lib/notifications/config';
import { STALE_HEARTBEAT_MINUTES } from '@/lib/observability/alerts';
import { env } from '@/lib/utils/env';
import { parseSender } from '@/lib/notifications/channels/brevo';

import { assertLocalDisposableDatabase, UnsafeDatabaseError } from './lib/database-url';

const prisma = new PrismaClient();

async function main() {
  const target = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
  if (!target) {
    throw new Error('Usage: pnpm explain:subtask -- <subtask id or job code>');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  assertLocalDisposableDatabase(databaseUrl);

  const subtasks = await prisma.subtask.findMany({
    where: {
      OR: [{ id: target }, { job: { jobCode: target } }],
    },
    include: {
      job: { select: { jobCode: true, title: true, status: true, isDemo: true } },
      assignee: { select: { name: true, email: true, isActive: true, isDemo: true } },
    },
  });

  if (subtasks.length === 0) {
    throw new Error(`No subtask found for "${target}".`);
  }

  const now = new Date();
  const [workingHours, suppressOutsideHours, escalation, heartbeat, commanders] = await Promise.all(
    [
      loadWorkingHours(prisma),
      loadSuppressOutsideHours(),
      loadEscalationConfig(),
      prisma.setting.findUnique({ where: { key: 'scheduler.heartbeat' } }),
      prisma.user.findMany({
        where: { role: { in: ['MD', 'DEPUTY_MD'] }, isActive: true },
        select: { email: true, isDemo: true, isActive: true },
      }),
    ],
  );

  const guard = mailGuardConfig();
  const quota = await quotaStatus(prisma, guard.cap, now);
  const config = env();
  const sender = parseSender(config.MAIL_FROM, config.MAIL_FROM_NAME);
  const provider = (process.env.MAIL_PROVIDER ?? 'smtp').trim().toLowerCase();

  let heartbeatAt: Date | null = null;
  if (heartbeat && typeof heartbeat.value === 'string') {
    const parsed = new Date(heartbeat.value);
    if (!Number.isNaN(parsed.getTime())) heartbeatAt = parsed;
  }

  for (const subtask of subtasks) {
    const notifications = await prisma.notification.findMany({
      where: { entityType: 'SUBTASK', entityId: subtask.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true } } },
    });

    console.log(
      explainSweep({
        now,
        subtask,
        job: subtask.job,
        assignee: subtask.assignee,
        notifications: notifications.map((row) => ({
          type: row.type,
          status: row.status,
          channel: row.channel,
          scheduledFor: row.scheduledFor,
          attemptCount: row.attemptCount,
          lastError: row.lastError,
          recipientEmail: row.user.email,
        })),
        commanders,
        heartbeatAt,
        schedulerIntervalMinutes: config.SCHEDULER_INTERVAL_MINUTES,
        staleAfterMinutes: STALE_HEARTBEAT_MINUTES,
        escalation,
        workingHours,
        suppressOutsideHours,
        allowlist: guard.allowlist,
        quota: { sentToday: quota.sentToday, cap: quota.cap, exhausted: quota.exhausted },
        provider,
        senderEmail: sender.email,
      }),
    );
    console.log('');
  }
}

main()
  .catch((error) => {
    if (error instanceof UnsafeDatabaseError) {
      console.error(error.message);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
