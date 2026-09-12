/**
 * Creating and editing a job.
 *
 * Both write their audit row inside the same transaction as the change
 * (architecture rule 5), and the job code is allocated inside that same
 * transaction so a failed insert rolls the number back rather than burning it.
 */
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { formatIST, fromISTInput } from '@/lib/utils/time';
import type { CreateJobInput, UpdateJobInput } from '@/lib/validation/job';

import { allocateJobCode } from './job-code';
import {
  DRAFT_STATUSES,
  EDITABLE_AFTER_PUBLISH,
  JOB_SELECT,
  TERMINAL_JOB_STATUSES,
  jobSnapshot,
  type Actor,
  type JobRow,
  type RequestContext,
} from './types';

/**
 * Converts the naive IST wall-clock string the client sends into a UTC instant
 * and checks it is in the future.
 *
 * This is the only place a job deadline is built, and it goes through
 * `fromISTInput` — never `new Date(string)`, which would resolve against the
 * server's timezone and land the deadline 5.5 hours out in production
 * (architecture rule 1).
 *
 * @throws {AppError} `VALIDATION_ERROR`
 */
export function parseJobDeadline(value: string, now: Date = new Date()): Date {
  let deadline: Date;

  try {
    deadline = fromISTInput(value);
  } catch {
    throw validationError('That is not a valid date and time.', {
      fields: { overallDeadline: ['Choose a date and time.'] },
    });
  }

  if (deadline.getTime() <= now.getTime()) {
    throw validationError('The deadline must be in the future.', {
      fields: {
        overallDeadline: [
          `Choose a time after ${formatIST(now)} — the deadline must be in the future.`,
        ],
      },
    });
  }

  return deadline;
}

export async function createJob(
  input: CreateJobInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<JobRow> {
  const overallDeadline = parseJobDeadline(input.overallDeadline);

  return prisma.$transaction(async (tx) => {
    // Inside the transaction: SDD section 4.1.
    const jobCode = await allocateJobCode(tx, new Date());

    const job = await tx.job.create({
      data: {
        jobCode,
        title: input.title,
        customerName: input.customerName ?? null,
        partNumber: input.partNumber ?? null,
        drawingNumber: input.drawingNumber ?? null,
        quantity: input.quantity ?? null,
        priority: input.priority,
        description: input.description ?? null,
        overallDeadline,
        // FR-10: a job starts as a draft and is reviewed before it is published.
        status: 'DRAFT',
        createdById: actor.id,
      },
      select: JOB_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'JOB_CREATED',
      entityType: 'JOB',
      entityId: job.id,
      after: jobSnapshot(job),
      ipAddress: ctx.ipAddress,
    });

    return job;
  });
}

/**
 * Rejects an edit that touches a field frozen by the job's status.
 *
 * A draft is fully editable. Once published, only title, description, customer
 * and priority move: part number, drawing number, quantity and the overall
 * deadline are what the shop floor has already planned against, and every
 * subtask deadline was derived from them (FR-12).
 *
 * @throws {AppError} `VALIDATION_ERROR` naming the fields and the reason.
 */
function assertEditable(job: JobRow, input: UpdateJobInput): void {
  if (TERMINAL_JOB_STATUSES.includes(job.status)) {
    throw validationError(`${job.jobCode} has been cancelled and can no longer be edited.`, {
      reason: 'JOB_CANCELLED',
    });
  }

  if (DRAFT_STATUSES.includes(job.status)) return;

  const allowed = new Set<string>(EDITABLE_AFTER_PUBLISH);
  const frozen = Object.keys(input).filter(
    (field) => input[field as keyof UpdateJobInput] !== undefined && !allowed.has(field),
  );

  if (frozen.length > 0) {
    const fields = Object.fromEntries(
      frozen.map((field) => [field, ['This cannot be changed after the job has been published.']]),
    );

    throw validationError(
      `${job.jobCode} is already published. Only the title, customer, priority and description can still be changed.`,
      { reason: 'FROZEN_AFTER_PUBLISH', frozenFields: frozen, fields },
    );
  }
}

export async function updateJob(
  job: JobRow,
  input: UpdateJobInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<JobRow> {
  assertEditable(job, input);

  const data: Prisma.JobUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.customerName !== undefined) data.customerName = input.customerName ?? null;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.partNumber !== undefined) data.partNumber = input.partNumber ?? null;
  if (input.drawingNumber !== undefined) data.drawingNumber = input.drawingNumber ?? null;
  if (input.quantity !== undefined) data.quantity = input.quantity ?? null;
  if (input.overallDeadline !== undefined) {
    data.overallDeadline = parseJobDeadline(input.overallDeadline);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.job.update({
      where: { id: job.id },
      data,
      select: JOB_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'JOB_UPDATED',
      entityType: 'JOB',
      entityId: job.id,
      before: jobSnapshot(job),
      after: jobSnapshot(updated),
      ipAddress: ctx.ipAddress,
    });

    return updated;
  });
}
