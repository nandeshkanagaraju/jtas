/**
 * The daily MD digest — FR-56.
 *
 * "Daily 9:00 AM IST digest to MD: overdue, due today, open problems."
 *
 * PDD section 12 gives the reason it exists: without it the problem inbox
 * becomes a graveyard, because nothing pulls the MD back to it. The digest is
 * the pull.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAudit } from '@/lib/services/audit-service';
import { moduleLogger } from '@/lib/utils/logger';
import { istDateKey, istMinutesOfDay, parseClockTime } from '@/lib/utils/time';

import { loadDigestTime } from './config';
import { digestKey } from './dedupe';
import { enqueue } from './notification-service';

const log = moduleLogger('digest');

/**
 * How long after the configured time the digest may still be queued.
 *
 * The sweeper runs every five minutes, so it will not land exactly on 09:00.
 * A window rather than an equality means a pass that is a few minutes late
 * still sends — and the dedupe key means a second pass inside the window does
 * not send again.
 */
export const DIGEST_WINDOW_MINUTES = 60;

/** True when `now` is inside today's digest window. */
export function isWithinDigestWindow(now: Date, digestTime: string): boolean {
  let target: number;
  try {
    target = parseClockTime(digestTime);
  } catch {
    target = 9 * 60;
  }

  const minutes = istMinutesOfDay(now);
  return minutes >= target && minutes < target + DIGEST_WINDOW_MINUTES;
}

/**
 * Queues today's digest for the MD and every deputy, at most once each.
 *
 * The dedupe key is `digest:{userId}:{IST date}`, so the sweeper can call this
 * on every pass inside the window and only the first one writes anything.
 *
 * @returns how many digest rows were actually created.
 */
export async function queueDailyDigest(now: Date = new Date()): Promise<number> {
  const digestTime = await loadDigestTime();
  if (!isWithinDigestWindow(now, digestTime)) return 0;

  const recipients = await prisma.user.findMany({
    where: { role: { in: ['MD', 'DEPUTY_MD'] }, isActive: true },
    select: { id: true },
  });
  if (recipients.length === 0) return 0;

  const dateKey = istDateKey(now);

  const created = await enqueue(prisma, {
    type: 'DAILY_DIGEST_MD',
    userIds: recipients.map((row) => row.id),
    entityType: 'JOB',
    // The digest is about everything, not one record; the date is its identity.
    entityId: dateKey,
    subject: `Daily summary – ${dateKey}`,
    body: 'Overdue work, what is due today, and the problems waiting on you.',
    dedupeKeyFor: (userId) => digestKey(userId, dateKey),
    scheduledFor: now,
  });

  if (created > 0) {
    await writeAudit(prisma, {
      actorId: null,
      action: 'DIGEST_SENT',
      entityType: 'SETTING',
      entityId: 'digest.time',
      after: { dateKey, recipients: created },
      ipAddress: null,
    });

    log.info({ dateKey, recipients: created }, 'daily digest queued');
  }

  return created;
}
