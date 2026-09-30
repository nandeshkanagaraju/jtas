/**
 * The sweeper — SDD section 5.2.
 *
 * Two steps, run every five minutes:
 *
 *   STEP 1  dispatch notification rows whose time has come
 *   STEP 2  find newly overdue subtasks and queue their escalations
 *
 * Every design choice here is about one property: a sweeper that dies at any
 * point and restarts must not send anything twice, and must not lose anything
 * either. `FOR UPDATE SKIP LOCKED` lets more than one worker run without
 * double-sending, and `ON CONFLICT (dedupeKey) DO NOTHING` makes a half-written
 * batch harmless.
 */
import type { NotifStatus, NotifType, SubtaskStatus } from '@prisma/client';

import { prisma, type Db } from '@/lib/db/prisma';
import { recomputeJobStatus } from '@/lib/services/jobs';
import { writeAudit } from '@/lib/services/audit-service';
import { moduleLogger } from '@/lib/utils/logger';
import { formatElapsed } from '@/lib/utils/duration';
import { hoursBetween } from '@/lib/utils/time';

import { channelFor, isRetryable, ProviderQuotaError } from './channels';
import { loadEscalationConfig, loadSuppressOutsideHours, loadWorkingHours } from './config';
import { isAllowedRecipient, mailGuardConfig, quotaStatus, suppressionReason } from './mail-guard';
import { overdueMdKey, overdueMemberKey } from './dedupe';
import { enqueue } from './notification-service';
import { buildPayload } from './payloads';
import { renderTemplate } from './templates';
import { CHASEABLE_SUBTASK_STATUSES, EXCLUDED_OVERDUE_JOB_STATUSES } from './sweep-filters';
import { isSuppressible, nextWorkingSlot } from './working-hours';

const log = moduleLogger('sweeper');

/** SDD 5.2: 200 rows a pass, so one slow batch cannot starve the next. */
export const BATCH_SIZE = 200;

/** SDD 5.2: 2, 10, 30 minutes, then FAILED after five attempts. */
export const RETRY_BACKOFF_MINUTES = [2, 10, 30, 30, 30];
export const MAX_ATTEMPTS = 5;

/**
 * Subtask states that are still chaseable — SDD section 5.2 step 2.
 *
 * `PROBLEM` is deliberately absent (improvement I-05): a member who has
 * reported a blocker is not nagged, and the pressure has already moved to the
 * MD. `ON_HOLD`, `COMPLETED` and `CANCELLED` are absent because there is
 * nothing to chase.
 */
const CHASEABLE: readonly SubtaskStatus[] = CHASEABLE_SUBTASK_STATUSES;

export interface SweepResult {
  dispatched: number;
  deferred: number;
  failed: number;
  dropped: number;
  escalated: number;
  /** Withheld by the recipient allowlist. Written SUPPRESSED, never sent. */
  suppressed: number;
  /** Left PENDING because the daily cap was reached. Goes out after midnight. */
  quotaHeld: number;
}

interface DueRow {
  id: string;
  userId: string;
  type: NotifType;
  channel: 'EMAIL' | 'IN_APP' | 'WHATSAPP' | 'SMS';
  entityType: string;
  entityId: string;
  attemptCount: number;
  status: NotifStatus;
}

/**
 * STEP 1 — dispatch every row whose `scheduledFor` has arrived.
 *
 * The claim and the send are deliberately *not* in one transaction. Holding a
 * row lock across an SMTP round trip would block a second worker for the length
 * of the network, and a crash mid-send would roll the claim back and resend.
 * Instead each row is claimed with `SKIP LOCKED`, marked, and then sent.
 */
export async function dispatchDue(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = {
    dispatched: 0,
    deferred: 0,
    failed: 0,
    dropped: 0,
    escalated: 0,
    suppressed: 0,
    quotaHeld: 0,
  };

  const [workingHours, suppressOutside] = await Promise.all([
    loadWorkingHours(),
    loadSuppressOutsideHours(),
  ]);

  /*
   * The guards are read once per pass, not once per row. The allowlist is
   * static for the life of the process, and the quota is a running count this
   * loop is itself the only writer of — so it is tracked locally as rows are
   * sent rather than re-queried, which would cost a round trip per message to
   * learn a number we already know.
   */
  const { allowlist, cap } = mailGuardConfig();
  const quota = await quotaStatus(prisma, cap, now);
  let sentThisPass = 0;

  /*
   * Claim a batch. FOR UPDATE SKIP LOCKED means a second worker takes the next
   * rows rather than waiting on these, so the pair make progress together
   * instead of serialising.
   */
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<DueRow[]>`
      SELECT "id", "userId", "type", "channel", "entityType", "entityId",
             "attemptCount", "status"
        FROM "Notification"
       WHERE "status" = 'PENDING' AND "scheduledFor" <= ${now}
       ORDER BY "scheduledFor" ASC
       LIMIT ${BATCH_SIZE}
         FOR UPDATE SKIP LOCKED
    `;
    return rows;
  });

  for (const row of claimed) {
    /*
     * SDD 5.3: reminders, assignments and the digest wait for working hours.
     * Overdue mails and problem alerts never do — pushing the row forward is a
     * write, not a send, so nothing is lost if the process dies here.
     */
    if (suppressOutside && isSuppressible(row.type)) {
      const slot = nextWorkingSlot(now, workingHours);
      if (slot.getTime() > now.getTime()) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { scheduledFor: slot },
        });
        result.deferred++;
        continue;
      }
    }

    /*
     * The daily cap. Checked before the send and before the allowlist, because
     * a row held for quota must stay exactly as it is: still PENDING, still
     * unattempted, so the pass after midnight picks it up untouched. Only
     * mail counts against it — an in-app row costs nothing to deliver.
     */
    if (row.channel === 'EMAIL' && quota.sentToday + sentThisPass >= quota.cap) {
      result.quotaHeld++;
      continue;
    }

    const outcome = await deliver(row, now, allowlist);

    /*
     * The provider says its own allowance is gone. Same posture as our cap —
     * the row stays PENDING, untouched — but we only learn it by being told,
     * so the remainder of the batch is held rather than asked one at a time.
     */
    if (outcome === 'providerQuota') {
      result.quotaHeld++;
      log.warn(
        { notificationId: row.id },
        'the mail provider reported its daily quota is exhausted; holding the rest of this pass',
      );
      for (const remaining of claimed.slice(claimed.indexOf(row) + 1)) {
        if (remaining.channel === 'EMAIL') result.quotaHeld++;
      }
      break;
    }

    result[outcome]++;
    if (outcome === 'dispatched' && row.channel === 'EMAIL') sentThisPass++;
  }

  if (result.quotaHeld > 0) {
    log.warn(
      {
        held: result.quotaHeld,
        cap: quota.cap,
        sentToday: quota.sentToday + sentThisPass,
        resetsAt: quota.resetsAt,
      },
      'daily mail cap reached; remaining rows stay PENDING until the IST day rolls over',
    );
  }

  return result;
}

type DeliveryOutcome = 'dispatched' | 'failed' | 'dropped' | 'suppressed' | 'providerQuota';

/** Renders and sends one row, recording the outcome. */
async function deliver(
  row: DueRow,
  now: Date,
  allowlist: readonly string[],
): Promise<DeliveryOutcome> {
  const payload = await buildPayload(row, now);

  if (!payload) {
    // The subject of the mail no longer exists. Not a delivery failure, so the
    // row is retired rather than retried forever.
    await prisma.notification.update({
      where: { id: row.id },
      data: { status: 'SUPPRESSED', lastError: 'The entity this referred to no longer exists.' },
    });
    log.debug({ notificationId: row.id, type: row.type }, 'dropped: entity gone');
    return 'dropped';
  }

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { id: true, name: true, email: true, phone: true, isActive: true },
  });

  if (!user || !user.isActive) {
    await prisma.notification.update({
      where: { id: row.id },
      data: { status: 'SUPPRESSED', lastError: 'The recipient is no longer active.' },
    });
    return 'dropped';
  }

  /*
   * The allowlist. Placed here rather than inside the email channel on
   * purpose: this is the one point every row of every type passes through, so
   * a channel added later — push, WhatsApp — cannot be written in a way that
   * forgets it. The row is still rendered first, so what is stored is exactly
   * what would have been sent, and the in-app inbox shows the real message
   * rather than a placeholder.
   */
  const addressed = row.channel === 'EMAIL' ? user.email : null;

  if (addressed !== null && !isAllowedRecipient(addressed, allowlist)) {
    const rendered = await renderTemplate(payload);

    await prisma.notification.update({
      where: { id: row.id },
      data: {
        status: 'SUPPRESSED',
        // Not sentAt: nothing was sent, and the daily cap counts on sentAt.
        subject: rendered.subject,
        body: rendered.text,
        lastError: suppressionReason(addressed),
      },
    });

    log.info(
      { notificationId: row.id, type: row.type, to: addressed },
      'suppressed: recipient is not on the allowlist',
    );
    return 'suppressed';
  }

  try {
    const rendered = await renderTemplate(payload);

    const { providerId } = await channelFor(row.channel).send(
      {
        id: row.id,
        type: row.type,
        subject: rendered.subject,
        body: rendered.text,
        html: rendered.html,
        entityType: row.entityType,
        entityId: row.entityId,
      },
      user,
    );

    await prisma.notification.update({
      where: { id: row.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        attemptCount: row.attemptCount + 1,
        // Stored so the in-app inbox shows exactly what was mailed.
        subject: rendered.subject,
        body: rendered.text,
        lastError: providerId ? `providerId:${providerId}` : null,
      },
    });

    return 'dispatched';
  } catch (error) {
    /*
     * A provider quota refusal is not this row's fault and must not count
     * against its attempts: left alone, it goes out when the allowance resets.
     * Only the error text is recorded, so the reason is visible without the
     * row looking like it failed.
     */
    if (error instanceof ProviderQuotaError) {
      await prisma.notification.update({
        where: { id: row.id },
        data: { lastError: error.message.slice(0, 500) },
      });
      return 'providerQuota';
    }

    return recordFailure(row, error, now);
  }
}

/**
 * Backs a failed row off, or gives up on it.
 *
 * A permanent failure — a rejected address — is failed immediately rather than
 * retried five times, because retrying it just buries the real failures behind
 * noise.
 */
async function recordFailure(row: DueRow, error: unknown, now: Date): Promise<DeliveryOutcome> {
  const attempts = row.attemptCount + 1;
  const message = error instanceof Error ? error.message : String(error);
  const retryable = isRetryable(error);

  if (!retryable || attempts >= MAX_ATTEMPTS) {
    await prisma.notification.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        attemptCount: attempts,
        lastError: message.slice(0, 500),
        failedAt: now,
      },
    });
    log.error(
      { notificationId: row.id, attempts, retryable, err: message },
      'giving up on a notification',
    );
    return 'failed';
  }

  const backoff = RETRY_BACKOFF_MINUTES[attempts - 1] ?? 30;

  await prisma.notification.update({
    where: { id: row.id },
    data: {
      // Stays PENDING so the next pass picks it up.
      attemptCount: attempts,
      scheduledFor: new Date(now.getTime() + backoff * 60_000),
      lastError: message.slice(0, 500),
    },
  });

  log.warn({ notificationId: row.id, attempts, backoff }, 'delivery failed; will retry');
  return 'failed';
}

/**
 * STEP 2 — find newly overdue subtasks and escalate them.
 *
 * `status = 'PROBLEM'` is deliberately excluded (improvement I-05): a member who
 * has reported a blocker is not nagged, and the pressure has already moved to
 * the MD. Held and cancelled jobs are excluded too — a paused job's timers are
 * paused (FR-14).
 *
 * Demonstration jobs are excluded as well. `pnpm seed:demo` generates a year of
 * history to make the dashboards meaningful, and most of it is overdue by
 * construction — 870 subtasks on the machine this was written on. Chasing it
 * costs nothing while mail goes to Mailpit and becomes thousands of real
 * messages the day SMTP points at a relay, so the filter belongs here in the
 * query rather than in whoever remembers to stop the worker.
 */
export async function escalateOverdue(now: Date = new Date()): Promise<number> {
  const { intervalMinutes, maxCount } = await loadEscalationConfig();
  // Query bound only: a row is due when lastEscalatedAt is strictly before this.
  // The next chase is lastEscalatedAt + interval, which is what the explainer prints.
  const cutoff = new Date(now.getTime() - intervalMinutes * 60_000);

  const overdue = await prisma.subtask.findMany({
    where: {
      deadline: { lt: now },
      status: { in: [...CHASEABLE] },
      job: {
        status: { notIn: [...EXCLUDED_OVERDUE_JOB_STATUSES] },
        isDemo: false,
      },
      escalationCount: { lt: maxCount },
      OR: [{ lastEscalatedAt: null }, { lastEscalatedAt: { lt: cutoff } }],
    },
    select: {
      id: true,
      jobId: true,
      assigneeId: true,
      deadline: true,
      escalationCount: true,
      title: true,
    },
    take: BATCH_SIZE,
  });

  if (overdue.length === 0) return 0;

  const commanders = await prisma.user.findMany({
    where: { role: { in: ['MD', 'DEPUTY_MD'] }, isActive: true },
    select: { id: true },
  });
  const commanderIds = commanders.map((row) => row.id);

  let escalated = 0;

  for (const subtask of overdue) {
    const n = subtask.escalationCount + 1;
    const delayHours = Math.max(0, Math.round(hoursBetween(subtask.deadline, now)));

    await prisma.$transaction(async (tx) => {
      // FR-52: the member is asked to finish the work.
      await enqueue(tx, {
        type: 'OVERDUE_MEMBER',
        userIds: [subtask.assigneeId],
        entityType: 'SUBTASK',
        entityId: subtask.id,
        subject: 'Please complete the work',
        body: `${subtask.title} is ${formatElapsed(delayHours * 60)} past its deadline.`,
        dedupeKeyFor: () => overdueMemberKey(subtask.id, n),
        scheduledFor: now,
      });

      // FR-53: the MD and every deputy are told who has not delivered.
      await enqueue(tx, {
        type: 'OVERDUE_MD',
        userIds: commanderIds,
        entityType: 'SUBTASK',
        entityId: subtask.id,
        subject: 'A task has crossed its deadline',
        body: `${subtask.title} is ${formatElapsed(delayHours * 60)} past its deadline.`,
        dedupeKeyFor: (userId) => overdueMdKey(subtask.id, n, userId),
        scheduledFor: now,
      });

      await tx.subtask.update({
        where: { id: subtask.id },
        data: { escalationCount: n, lastEscalatedAt: now },
      });

      await writeAudit(tx, {
        actorId: null,
        action: 'SUBTASK_OVERDUE_ESCALATED',
        entityType: 'SUBTASK',
        entityId: subtask.id,
        before: { escalationCount: subtask.escalationCount },
        after: { escalationCount: n, delayHours, recipients: commanderIds.length + 1 },
        ipAddress: null,
      });

      // An overdue subtask makes its job DELAYED (SDD 4.2).
      await recomputeJobStatus(tx, subtask.jobId, { now });
    });

    escalated++;
  }

  log.info({ escalated }, 'overdue escalations queued');
  return escalated;
}

/** Records that the worker completed a pass, so a stall becomes observable. */
export async function writeHeartbeat(db: Db = prisma, at: Date = new Date()): Promise<void> {
  const value = at.toISOString();
  await db.setting.upsert({
    where: { key: 'scheduler.heartbeat' },
    create: { key: 'scheduler.heartbeat', value },
    update: { value },
  });
}

/** One full pass: dispatch, escalate, heartbeat. */
export async function runSweep(now: Date = new Date()): Promise<SweepResult> {
  const result = await dispatchDue(now);
  result.escalated = await escalateOverdue(now);
  await writeHeartbeat(prisma, now);
  return result;
}
