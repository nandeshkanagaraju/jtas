/**
 * Job lifecycle: publish, hold, unhold, cancel.
 *
 * These are the transitions a human drives. Everything else about a job's
 * status is derived (SDD section 4.2) and handled by `recomputeJobStatus`.
 *
 * Nothing here deletes a job (architecture rule 6) — cancelling is the terminal
 * state, and the record stays queryable for the accountability the product
 * exists to provide.
 */
import type { JobStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { conflict, invalidTransition, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';

import { initialiseSubtasksOnPublish } from '@/lib/services/subtasks/publish';

import { recomputeJobStatus } from './status';
import { JOB_SELECT, type Actor, type JobRow, type RequestContext } from './types';

/** A job can be held only while it is live. */
const HOLDABLE: readonly JobStatus[] = ['IN_PROGRESS', 'AT_RISK', 'DELAYED'];

/** Cancelling is refused once the job is already finished or abandoned. */
const UNCANCELLABLE: readonly JobStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * Publishes a draft (FR-10, FR-13).
 *
 * Requires at least one subtask: publishing an empty job would announce work to
 * nobody, and the derived status ladder has nothing to measure. Until M4 ships
 * a way to add subtasks, this is the error every publish attempt returns — by
 * design, and the message says so.
 *
 * M4 plugs in at the marked point: the assignment notifications for each
 * subtask are scheduled inside this same transaction, so a published job and
 * its "you have been assigned" mails commit together or not at all.
 *
 * @throws {AppError} `INVALID_TRANSITION`, `VALIDATION_ERROR`
 */
export async function publishJob(job: JobRow, actor: Actor, ctx: RequestContext): Promise<JobRow> {
  // Checked here too so the common case fails fast with a good message, but
  // the claim below is what actually makes publishing safe.
  if (job.status !== 'DRAFT') {
    throw invalidTransition(`${job.jobCode} is already published.`, {
      from: job.status,
      to: 'IN_PROGRESS',
    });
  }

  const subtaskCount = await prisma.subtask.count({ where: { jobId: job.id } });

  if (subtaskCount === 0) {
    throw validationError(
      `${job.jobCode} has no subtasks yet. Add at least one department task before publishing, so the system knows who to chase.`,
      { reason: 'NO_SUBTASKS', subtaskCount: 0 },
    );
  }

  const publishedAt = new Date();

  return prisma.$transaction(async (tx) => {
    /*
     * Claim the job by moving it out of DRAFT conditionally, rather than
     * trusting the `job` the caller read a moment ago. Two people pressing
     * Publish at the same instant both arrive here holding a DRAFT snapshot;
     * the second update blocks on the row lock, re-reads, matches nothing and
     * gets the same error as if it had been late by an hour. Without this the
     * job would be initialised — and announced — twice.
     */
    const claimed = await tx.job.updateMany({
      where: { id: job.id, status: 'DRAFT' },
      data: { status: 'IN_PROGRESS', publishedAt },
    });

    if (claimed.count === 0) {
      throw invalidTransition(`${job.jobCode} is already published.`, {
        from: 'IN_PROGRESS',
        to: 'IN_PROGRESS',
      });
    }

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'JOB_PUBLISHED',
      entityType: 'JOB',
      entityId: job.id,
      before: { status: job.status, publishedAt: null },
      after: { status: 'IN_PROGRESS', publishedAt: publishedAt.toISOString(), subtaskCount },
      ipAddress: ctx.ipAddress,
    });

    /*
     * M4: every subtask becomes PENDING, or BLOCKED when its predecessor is not
     * complete (build spec M4.3), and its notifications are scheduled. Inside
     * this transaction, so a published job and the work it announces commit
     * together or not at all.
     */
    await initialiseSubtasksOnPublish(tx, job.id, actor, ctx);

    // A just-published job may already be at risk if its deadline is close.
    await recomputeJobStatus(tx, job.id, { actor, ctx, now: publishedAt });

    return tx.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_SELECT });
  });
}

/**
 * Puts a job on hold (FR-14).
 *
 * `ON_HOLD` is a manual state the status ladder will not overwrite, which is
 * what "all its subtask timers pause" means in practice: an overdue subtask
 * cannot flip a deliberately paused job to `DELAYED`.
 *
 * @throws {AppError} `INVALID_TRANSITION`
 */
export async function holdJob(
  job: JobRow,
  reason: string,
  actor: Actor,
  ctx: RequestContext,
): Promise<JobRow> {
  if (job.status === 'ON_HOLD') {
    throw conflict(`${job.jobCode} is already on hold.`, { reason: 'ALREADY_ON_HOLD' });
  }

  if (!HOLDABLE.includes(job.status)) {
    throw invalidTransition(
      job.status === 'DRAFT'
        ? `${job.jobCode} is still a draft — there is nothing to pause yet.`
        : `${job.jobCode} is ${job.status.toLowerCase().replace('_', ' ')} and cannot be put on hold.`,
      { from: job.status, to: 'ON_HOLD' },
    );
  }

  return prisma.$transaction(async (tx) => {
    const held = await tx.job.update({
      where: { id: job.id },
      data: { status: 'ON_HOLD' },
      select: JOB_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'JOB_HELD',
      entityType: 'JOB',
      entityId: job.id,
      before: { status: job.status },
      after: { status: 'ON_HOLD', reason },
      ipAddress: ctx.ipAddress,
    });

    return held;
  });
}

/**
 * Resumes a held job.
 *
 * The status is not restored to whatever it was before the hold — it is
 * recomputed, because time passed while the job was paused and the honest
 * answer may now be `DELAYED`.
 *
 * @throws {AppError} `INVALID_TRANSITION`
 */
export async function unholdJob(job: JobRow, actor: Actor, ctx: RequestContext): Promise<JobRow> {
  if (job.status !== 'ON_HOLD') {
    throw invalidTransition(`${job.jobCode} is not on hold.`, {
      from: job.status,
      to: 'IN_PROGRESS',
    });
  }

  return prisma.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: job.id },
      data: { status: 'IN_PROGRESS' },
      select: { id: true },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'JOB_UNHELD',
      entityType: 'JOB',
      entityId: job.id,
      before: { status: 'ON_HOLD' },
      after: { status: 'IN_PROGRESS' },
      ipAddress: ctx.ipAddress,
    });

    await recomputeJobStatus(tx, job.id, { actor, ctx });

    return tx.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_SELECT });
  });
}

/**
 * Cancels a job (FR-14). Terminal, and never a delete.
 *
 * Open subtasks are cancelled with it: leaving them active would keep the
 * sweeper chasing people for work that has been called off, which is exactly
 * the credibility problem improvement I-05 exists to prevent.
 *
 * @throws {AppError} `INVALID_TRANSITION`
 */
export async function cancelJob(
  job: JobRow,
  reason: string,
  actor: Actor,
  ctx: RequestContext,
): Promise<JobRow> {
  if (UNCANCELLABLE.includes(job.status)) {
    throw invalidTransition(
      job.status === 'CANCELLED'
        ? `${job.jobCode} is already cancelled.`
        : `${job.jobCode} is already completed and cannot be cancelled.`,
      { from: job.status, to: 'CANCELLED' },
    );
  }

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.subtask.updateMany({
      where: { jobId: job.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'CANCELLED' },
    });

    const cancelled = await tx.job.update({
      where: { id: job.id },
      data: { status: 'CANCELLED' },
      select: JOB_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'JOB_CANCELLED',
      entityType: 'JOB',
      entityId: job.id,
      before: { status: job.status },
      after: { status: 'CANCELLED', reason, cancelledSubtaskCount: count },
      ipAddress: ctx.ipAddress,
    });

    return cancelled;
  });
}
