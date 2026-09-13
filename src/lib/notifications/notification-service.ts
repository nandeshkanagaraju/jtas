/**
 * The notification ledger — SDD section 5.1.
 *
 * Notifications are *scheduled at write time*, not discovered at send time.
 * When a job is published or a deadline moves, rows land in the table with a
 * future `scheduledFor`; the sweeper's only job is to send what is due. That is
 * what makes the engine restart-safe: the decision of what to send was already
 * committed, in the same transaction as the change that caused it.
 */
import { Prisma } from '@prisma/client';
import type { NotifChannel, NotifType } from '@prisma/client';

import { prisma, type Db } from '@/lib/db/prisma';
import { moduleLogger } from '@/lib/utils/logger';

import { assignedKey, reminderKey } from './dedupe';

const log = moduleLogger('notifications');

/** Types the sweeper deletes when a subtask's schedule is torn down. */
const RESCHEDULABLE_TYPES: NotifType[] = ['DEADLINE_REMINDER', 'OVERDUE_MEMBER', 'OVERDUE_MD'];

export interface EnqueueInput {
  type: NotifType;
  channel?: NotifChannel;
  userIds: readonly string[];
  entityType: 'SUBTASK' | 'JOB' | 'PROBLEM';
  entityId: string;
  subject: string;
  body: string;
  /** One per recipient; the caller builds it from `./dedupe`. */
  dedupeKeyFor: (userId: string) => string;
  scheduledFor?: Date;
}

/**
 * Inserts notification rows, ignoring any that already exist.
 *
 * `ON CONFLICT (dedupeKey) DO NOTHING` is the idempotency guarantee of SDD 5.2:
 * a sweeper that dies after writing some rows and restarts will try to write
 * them again, and the unique index quietly refuses. Nothing is sent twice.
 *
 * Returns how many rows were actually created, which is what the tests assert
 * on — "enqueue ran twice and the second did nothing" is the property that
 * matters.
 */
export async function enqueue(db: Db, input: EnqueueInput): Promise<number> {
  if (input.userIds.length === 0) return 0;

  const scheduledFor = input.scheduledFor ?? new Date();
  const channel: NotifChannel = input.channel ?? 'EMAIL';

  const values = input.userIds.map(
    (userId) =>
      Prisma.sql`(
      ${crypto.randomUUID()},
      ${userId},
      ${input.type}::"NotifType",
      ${channel}::"NotifChannel",
      ${input.subject},
      ${input.body},
      ${input.entityType},
      ${input.entityId},
      ${input.dedupeKeyFor(userId)},
      ${scheduledFor},
      'PENDING'::"NotifStatus",
      0,
      now()
    )`,
  );

  const inserted = await db.$executeRaw`
    INSERT INTO "Notification"
      ("id", "userId", "type", "channel", "subject", "body",
       "entityType", "entityId", "dedupeKey", "scheduledFor",
       "status", "attemptCount", "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("dedupeKey") DO NOTHING
  `;

  if (inserted !== input.userIds.length) {
    log.debug(
      { type: input.type, entityId: input.entityId, requested: input.userIds.length, inserted },
      'some notifications were already queued',
    );
  }

  return inserted;
}

/** The subtask fields the scheduler needs. */
export interface SchedulableSubtask {
  id: string;
  assigneeId: string;
  deadline: Date;
  reminderLeadMinutes: number;
}

/**
 * Schedules the two rows a live subtask gets — SDD section 5.1.
 *
 *   ASSIGNED  now
 *   REMINDER  deadline − reminderLeadMinutes
 *
 * A reminder whose moment has already passed is skipped rather than queued in
 * the past: it would fire immediately and tell somebody their deadline is in
 * six hours when it is in one.
 */
export async function scheduleForSubtask(
  db: Db,
  subtask: SchedulableSubtask,
  options: { now?: Date; subject?: string; body?: string } = {},
): Promise<void> {
  const now = options.now ?? new Date();

  await enqueue(db, {
    type: 'SUBTASK_ASSIGNED',
    userIds: [subtask.assigneeId],
    entityType: 'SUBTASK',
    entityId: subtask.id,
    subject: '',
    body: '',
    dedupeKeyFor: (userId) => assignedKey(subtask.id, userId),
    scheduledFor: now,
  });

  const remindAt = new Date(subtask.deadline.getTime() - subtask.reminderLeadMinutes * 60_000);

  if (remindAt.getTime() <= now.getTime()) {
    log.debug(
      { subtaskId: subtask.id, remindAt },
      'reminder moment already passed; not scheduling',
    );
    return;
  }

  await enqueue(db, {
    type: 'DEADLINE_REMINDER',
    userIds: [subtask.assigneeId],
    entityType: 'SUBTASK',
    entityId: subtask.id,
    subject: '',
    body: '',
    dedupeKeyFor: () => reminderKey(subtask.id, subtask.deadline),
    scheduledFor: remindAt,
  });
}

/**
 * Tears down a subtask's pending schedule and rebuilds it — SDD section 4.5.
 *
 * Only `PENDING` rows are removed: anything already sent is history and must
 * stay, or the audit trail would lose the fact that somebody was chased.
 */
export async function rescheduleForSubtask(db: Db, subtaskId: string): Promise<void> {
  const subtask = await db.subtask.findUnique({
    where: { id: subtaskId },
    select: { id: true, assigneeId: true, deadline: true, reminderLeadMinutes: true },
  });
  if (!subtask) return;

  await db.notification.deleteMany({
    where: {
      entityType: 'SUBTASK',
      entityId: subtaskId,
      status: 'PENDING',
      type: { in: RESCHEDULABLE_TYPES },
    },
  });

  await scheduleForSubtask(db, subtask);
}

/**
 * Drops every pending row for a subtask.
 *
 * Called when a subtask completes or is cancelled. Chasing somebody for work
 * that is already done is exactly what teaches people to ignore the mails
 * (improvement I-05).
 */
export async function cancelForSubtask(db: Db, subtaskId: string): Promise<number> {
  const { count } = await db.notification.deleteMany({
    where: { entityType: 'SUBTASK', entityId: subtaskId, status: 'PENDING' },
  });

  if (count > 0) log.debug({ subtaskId, count }, 'cancelled pending notifications');
  return count;
}

// ---------------------------------------------------------------------------
// The in-app inbox
// ---------------------------------------------------------------------------

export interface InboxItem {
  id: string;
  type: NotifType;
  subject: string;
  body: string;
  entityType: string;
  entityId: string;
  readAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
}

/**
 * A user's notifications, newest first.
 *
 * Only rows that have actually been sent, or are in-app by nature — a queued
 * email due next Tuesday is not something the recipient should see now.
 */
export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<{ data: InboxItem[]; unreadCount: number }> {
  const where: Prisma.NotificationWhereInput = {
    userId,
    OR: [{ status: 'SENT' }, { channel: 'IN_APP' }],
    ...(options.unreadOnly ? { readAt: null } : {}),
  };

  const [data, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
      select: {
        id: true,
        type: true,
        subject: true,
        body: true,
        entityType: true,
        entityId: true,
        readAt: true,
        sentAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { userId, readAt: null, OR: [{ status: 'SENT' }, { channel: 'IN_APP' }] },
    }),
  ]);

  return { data, unreadCount };
}

/**
 * Marks one notification read.
 *
 * Scoped to the owner in the `where` rather than checked afterwards, so one
 * user cannot mark another's notification read even by guessing an id.
 */
export async function markRead(userId: string, notificationId: string): Promise<boolean> {
  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count > 0;
}

/** Marks everything read — the "clear" action on the inbox. */
export async function markAllRead(userId: string): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}
