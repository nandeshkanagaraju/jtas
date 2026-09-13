/**
 * Building a template payload from a queued notification row.
 *
 * Payloads are assembled at **send** time, not at enqueue time. A reminder
 * queued ten days ahead would otherwise carry a snapshot of the world as it was
 * then — the old assignee, the old deadline — and mail somebody about work that
 * is no longer theirs. The row records *what* to say; this decides *what is
 * true* when it is said.
 */
import type { Notification, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { formatIST, hoursBetween, istDateKey } from '@/lib/utils/time';

import type { DigestRow, TemplatePayload } from './templates/types';

/** SDD section 5.4: "13 Sep 2026, 6:00 PM". */
export const MAIL_DATE_FORMAT = 'd MMM yyyy, h:mm a';

const ist = (date: Date) => formatIST(date, MAIL_DATE_FORMAT);

const SUBTASK_CONTEXT = {
  id: true,
  jobId: true,
  title: true,
  deadline: true,
  status: true,
  reminderLeadMinutes: true,
  completionNote: true,
  department: { select: { name: true } },
  assignee: { select: { name: true } },
  job: { select: { jobCode: true, title: true, partNumber: true, drawingNumber: true } },
} as const;

async function subtaskContext(subtaskId: string) {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: SUBTASK_CONTEXT,
  });
  if (!subtask) return null;

  return {
    subtaskId: subtask.id,
    jobId: subtask.jobId,
    subtaskTitle: subtask.title,
    departmentName: subtask.department.name,
    assigneeName: subtask.assignee.name,
    deadlineIst: ist(subtask.deadline),
    status: subtask.status.replace(/_/g, ' ').toLowerCase(),
    jobCode: subtask.job.jobCode,
    jobTitle: subtask.job.title,
    partNumber: subtask.job.partNumber,
    drawingNumber: subtask.job.drawingNumber,
    _raw: subtask,
  };
}

/**
 * Assembles the payload for one row, or `null` when the entity has gone.
 *
 * A null means the sweeper should drop the row rather than fail it: a
 * notification about a subtask that no longer exists is not a delivery problem.
 */
export async function buildPayload(
  notification: Pick<Notification, 'id' | 'type' | 'entityId' | 'userId'>,
  now: Date = new Date(),
): Promise<TemplatePayload | null> {
  switch (notification.type) {
    case 'SUBTASK_ASSIGNED': {
      const context = await subtaskContext(notification.entityId);
      if (!context) return null;
      return {
        kind: 'SUBTASK_ASSIGNED',
        ...context,
        reminderLeadHours: Math.round(context._raw.reminderLeadMinutes / 60),
      };
    }

    case 'DEADLINE_REMINDER': {
      const context = await subtaskContext(notification.entityId);
      if (!context) return null;
      return {
        kind: 'DEADLINE_REMINDER',
        ...context,
        hoursLeft: Math.max(0, Math.round(hoursBetween(now, context._raw.deadline))),
      };
    }

    case 'OVERDUE_MEMBER':
    case 'OVERDUE_MD': {
      const context = await subtaskContext(notification.entityId);
      if (!context) return null;
      return {
        kind: notification.type,
        ...context,
        delayHours: Math.max(0, Math.round(hoursBetween(context._raw.deadline, now))),
        escalationNumber: 0,
      };
    }

    case 'PROBLEM_RAISED': {
      const problem = await prisma.problem.findUnique({
        where: { id: notification.entityId },
        select: { id: true, subtaskId: true, severity: true, description: true, raisedById: true },
      });
      if (!problem) return null;

      const context = await subtaskContext(problem.subtaskId);
      if (!context) return null;

      const raisedBy = await prisma.user.findUnique({
        where: { id: problem.raisedById },
        select: { name: true },
      });

      return {
        kind: 'PROBLEM_RAISED',
        ...context,
        problemId: problem.id,
        severity: problem.severity,
        description: problem.description,
        raisedByName: raisedBy?.name ?? 'A member',
      };
    }

    case 'PROBLEM_RESOLVED': {
      const problem = await prisma.problem.findUnique({
        where: { id: notification.entityId },
        select: { id: true, subtaskId: true, mdActionNote: true },
      });
      if (!problem) return null;

      const context = await subtaskContext(problem.subtaskId);
      if (!context) return null;

      // The stored note is prefixed with the action, e.g. "[EXTEND] …".
      const match = /^\[([A-Z_]+)]\s*([\s\S]*)$/.exec(problem.mdActionNote ?? '');

      return {
        kind: 'PROBLEM_RESOLVED',
        ...context,
        problemId: problem.id,
        action: match?.[1] ?? 'RESOLVED',
        mdActionNote: match?.[2] ?? problem.mdActionNote ?? '',
      };
    }

    case 'DEADLINE_CHANGED': {
      const context = await subtaskContext(notification.entityId);
      if (!context) return null;

      const change = await prisma.deadlineChange.findFirst({
        where: { subtaskId: notification.entityId },
        orderBy: { createdAt: 'desc' },
        select: { oldDeadline: true, reason: true },
      });

      return {
        kind: 'DEADLINE_CHANGED',
        ...context,
        oldDeadlineIst: change ? ist(change.oldDeadline) : '—',
        reason: change?.reason ?? '',
      };
    }

    case 'EXTENSION_REQUESTED': {
      const request = await prisma.extensionRequest.findUnique({
        where: { id: notification.entityId },
        select: { subtaskId: true, requestedDeadline: true, reason: true, requestedById: true },
      });
      if (!request) return null;

      const context = await subtaskContext(request.subtaskId);
      if (!context) return null;

      const requestedBy = await prisma.user.findUnique({
        where: { id: request.requestedById },
        select: { name: true },
      });

      return {
        kind: 'EXTENSION_REQUESTED',
        ...context,
        requestedDeadlineIst: ist(request.requestedDeadline),
        reason: request.reason,
        requestedByName: requestedBy?.name ?? 'A member',
      };
    }

    case 'APPROVAL_REQUIRED': {
      const context = await subtaskContext(notification.entityId);
      if (!context) return null;
      return {
        kind: 'APPROVAL_REQUIRED',
        ...context,
        completedByName: context.assigneeName,
        completionNote: context._raw.completionNote,
      };
    }

    case 'JOB_COMPLETED': {
      const job = await prisma.job.findUnique({
        where: { id: notification.entityId },
        select: {
          id: true,
          jobCode: true,
          title: true,
          partNumber: true,
          drawingNumber: true,
          completedAt: true,
          overallDeadline: true,
          _count: { select: { subtasks: true } },
        },
      });
      if (!job) return null;

      const completedAt = job.completedAt ?? now;

      return {
        kind: 'JOB_COMPLETED',
        jobId: job.id,
        jobCode: job.jobCode,
        jobTitle: job.title,
        partNumber: job.partNumber,
        drawingNumber: job.drawingNumber,
        completedIst: ist(completedAt),
        subtaskCount: job._count.subtasks,
        onTime: completedAt.getTime() <= job.overallDeadline.getTime(),
      };
    }

    case 'DAILY_DIGEST_MD':
      return buildDigestPayload(now);

    default:
      return null;
  }
}

/**
 * The 9 AM digest — FR-56.
 *
 * Overdue, due today, and open problems with their age. Assembled fresh each
 * morning rather than accumulated, so a problem resolved overnight does not
 * appear in it.
 */
export async function buildDigestPayload(now: Date = new Date()): Promise<TemplatePayload> {
  const startOfToday = new Date(`${istDateKey(now)}T00:00:00+05:30`);
  const endOfToday = new Date(startOfToday.getTime() + 24 * 3_600_000);

  // Not `as const`: Prisma's filter types reject readonly arrays.
  const liveJob: Prisma.JobWhereInput = {
    status: { notIn: ['CANCELLED', 'ON_HOLD', 'DRAFT'] },
  };
  const liveSubtask: Prisma.SubtaskWhereInput = {
    status: { notIn: ['COMPLETED', 'CANCELLED', 'ON_HOLD'] },
  };

  const [overdue, dueToday, problems] = await Promise.all([
    prisma.subtask.findMany({
      where: { ...liveSubtask, deadline: { lt: now }, job: liveJob },
      select: {
        title: true,
        deadline: true,
        department: { select: { name: true } },
        assignee: { select: { name: true } },
        job: { select: { jobCode: true } },
      },
      orderBy: { deadline: 'asc' },
      take: 50,
    }),
    prisma.subtask.findMany({
      where: { ...liveSubtask, deadline: { gte: now, lt: endOfToday }, job: liveJob },
      select: {
        title: true,
        deadline: true,
        department: { select: { name: true } },
        assignee: { select: { name: true } },
        job: { select: { jobCode: true } },
      },
      orderBy: { deadline: 'asc' },
      take: 50,
    }),
    prisma.problem.findMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      select: {
        severity: true,
        description: true,
        createdAt: true,
        subtask: {
          select: {
            title: true,
            deadline: true,
            department: { select: { name: true } },
            assignee: { select: { name: true } },
            job: { select: { jobCode: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
  ]);

  const toRow = (
    row: {
      title: string;
      deadline: Date;
      department: { name: string };
      assignee: { name: string };
      job: { jobCode: string };
    },
    hours: number,
  ): DigestRow => ({
    jobCode: row.job.jobCode,
    departmentName: row.department.name,
    assigneeName: row.assignee.name,
    subtaskTitle: row.title,
    deadlineIst: ist(row.deadline),
    hours: Math.max(0, Math.round(hours)),
  });

  return {
    kind: 'DAILY_DIGEST_MD',
    dateIst: formatIST(now, 'd MMM yyyy'),
    overdue: overdue.map((row) => toRow(row, hoursBetween(row.deadline, now))),
    dueToday: dueToday.map((row) => toRow(row, hoursBetween(now, row.deadline))),
    openProblems: problems.map((problem) => ({
      ...toRow(problem.subtask, hoursBetween(problem.createdAt, now)),
      severity: problem.severity,
      description: problem.description,
    })),
  };
}
