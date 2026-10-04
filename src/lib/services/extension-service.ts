/**
 * Extension requests — FR-33, improvement I-11.
 *
 * Only the assignee asks; only the MD or a deputy decides (FR-35: a member
 * cannot move their own deadline). Approving routes through
 * `changeDeadline`, so an approved extension leaves exactly the same trail as
 * any other deadline change — a `DeadlineChange` row, a reset escalation clock
 * and a rescheduled reminder — rather than a second, weaker path to the same
 * effect.
 */
import { prisma } from '@/lib/db/prisma';
import { conflict, notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { notifyExtensionRequested } from '@/lib/services/notification-service';
import { changeDeadline } from '@/lib/services/subtasks';
import type { Actor, RequestContext } from '@/lib/services/subtasks';
import { formatIST, fromISTInput } from '@/lib/utils/time';
import type {
  CreateExtensionRequestInput,
  DecideExtensionRequestInput,
} from '@/lib/validation/extension';

export type ExtensionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ExtensionRequestSummary {
  id: string;
  subtaskId: string;
  requestedById: string;
  requestedDeadline: Date;
  reason: string;
  status: ExtensionStatus;
  decidedById: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/** Statuses in which asking for more time still makes sense. */
const REQUESTABLE = ['PENDING', 'BLOCKED', 'IN_PROGRESS', 'PROBLEM'] as const;

/**
 * Raises a request (FR-33).
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`
 */
export async function requestExtension(
  subtaskId: string,
  input: CreateExtensionRequestInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<ExtensionRequestSummary> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: { id: true, status: true, deadline: true, assigneeId: true, title: true },
  });
  if (!subtask) throw notFound('Subtask');

  if (!(REQUESTABLE as readonly string[]).includes(subtask.status)) {
    throw conflict(
      `This subtask is ${subtask.status.toLowerCase().replace('_', ' ')}; there is nothing to extend.`,
      { reason: 'SUBTASK_NOT_EXTENDABLE' },
    );
  }

  if (!subtask.deadline) {
    throw validationError('Commit a finish date before asking for more time.', {
      reason: 'NO_DEADLINE',
      fields: { requestedDeadline: ['There is no date to extend yet.'] },
    });
  }

  const requestedDeadline = fromISTInput(input.requestedDeadline);

  if (requestedDeadline.getTime() <= subtask.deadline.getTime()) {
    throw validationError(
      `That is not later than the current deadline of ${formatIST(subtask.deadline)}.`,
      { fields: { requestedDeadline: ['Ask for a time after the current deadline.'] } },
    );
  }

  // One open request at a time: a queue of them would leave the MD deciding
  // which of three dates the member actually wants.
  const existing = await prisma.extensionRequest.findFirst({
    where: { subtaskId, status: 'PENDING' },
    select: { id: true },
  });
  if (existing) {
    throw conflict('There is already a pending request for more time on this subtask.', {
      reason: 'REQUEST_ALREADY_PENDING',
      extensionRequestId: existing.id,
    });
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.extensionRequest.create({
      data: {
        subtaskId,
        requestedById: actor.id,
        requestedDeadline,
        reason: input.reason,
        status: 'PENDING',
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'EXTENSION_REQUESTED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      before: { deadline: subtask.deadline?.toISOString() ?? null },
      after: {
        requestedDeadline: requestedDeadline.toISOString(),
        reason: input.reason,
        extensionRequestId: request.id,
      },
      ipAddress: ctx.ipAddress,
    });

    // FR-33: the MD hears about it rather than having to notice it.
    await notifyExtensionRequested(tx, request.id);

    return toSummary(request);
  });
}

/**
 * MD or deputy decides (FR-33).
 *
 * Approval delegates to `changeDeadline` rather than writing the deadline
 * itself, so the audit trail, the `DeadlineChange` row and the reminder
 * rescheduling are identical to every other deadline change.
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`
 */
export async function decideExtensionRequest(
  requestId: string,
  input: DecideExtensionRequestInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<ExtensionRequestSummary> {
  const request = await prisma.extensionRequest.findUnique({
    where: { id: requestId },
    include: { subtask: { select: { id: true, jobId: true } } },
  });
  if (!request) throw notFound('Extension request');

  if (request.status !== 'PENDING') {
    throw conflict(`This request has already been ${request.status.toLowerCase()}.`, {
      reason: 'ALREADY_DECIDED',
      status: request.status,
    });
  }

  const decidedAt = new Date();

  if (input.decision === 'APPROVE') {
    // Runs first and in its own transaction: if moving the deadline fails, the
    // request must stay pending rather than read as granted.
    await changeDeadline(
      request.subtaskId,
      {
        newDeadline: formatIST(request.requestedDeadline, "yyyy-MM-dd'T'HH:mm"),
        reason: `Extension approved: ${request.reason}`,
        // The member's own request cannot override the job deadline; the MD
        // moves that separately if it is really needed.
      },
      actor,
      ctx,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.extensionRequest.update({
      where: { id: requestId },
      data: {
        status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        decidedById: actor.id,
        decidedAt,
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: input.decision === 'APPROVE' ? 'EXTENSION_APPROVED' : 'EXTENSION_REJECTED',
      entityType: 'SUBTASK',
      entityId: request.subtaskId,
      before: { status: 'PENDING' },
      after: {
        status: updated.status,
        requestedDeadline: request.requestedDeadline.toISOString(),
        note: input.note ?? null,
        extensionRequestId: requestId,
      },
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });

    return toSummary(updated);
  });
}

/** Requests on a subtask, newest first — the member's screen shows the latest. */
export async function listExtensionRequests(subtaskId: string): Promise<ExtensionRequestSummary[]> {
  const rows = await prisma.extensionRequest.findMany({
    where: { subtaskId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return rows.map(toSummary);
}

/** @throws {AppError} `NOT_FOUND` */
export async function getExtensionRequest(requestId: string) {
  const request = await prisma.extensionRequest.findUnique({
    where: { id: requestId },
    include: {
      subtask: {
        select: { id: true, jobId: true, assigneeId: true, departmentId: true, title: true },
      },
    },
  });
  if (!request) throw notFound('Extension request');
  return request;
}

function toSummary(row: {
  id: string;
  subtaskId: string;
  requestedById: string;
  requestedDeadline: Date;
  reason: string;
  status: string;
  decidedById: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}): ExtensionRequestSummary {
  return { ...row, status: row.status as ExtensionStatus };
}
