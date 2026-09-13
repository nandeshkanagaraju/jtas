/**
 * Shared shapes for subtasks.
 */
import type { Prisma, SubtaskStatus } from '@prisma/client';

export interface RequestContext {
  ipAddress: string;
}

export interface Actor {
  id: string;
  role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';
}

export const SUBTASK_SELECT = {
  id: true,
  jobId: true,
  departmentId: true,
  assigneeId: true,
  title: true,
  description: true,
  deadline: true,
  reminderLeadMinutes: true,
  requiresApproval: true,
  dependsOnId: true,
  status: true,
  startedAt: true,
  completedAt: true,
  completionNote: true,
  escalationCount: true,
  lastEscalatedAt: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true, code: true, sequenceOrder: true } },
  assignee: { select: { id: true, name: true, email: true, isActive: true } },
  dependsOn: { select: { id: true, title: true, status: true, deadline: true } },
  // The live problem, if any — so the job timeline can show the amber marker
  // and the drawer can show the member's words without a second query (M6.4).
  problems: {
    where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    select: { id: true, description: true, severity: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  job: {
    select: {
      id: true,
      jobCode: true,
      title: true,
      status: true,
      overallDeadline: true,
      // SDD section 7.2: the member's screen leads with the job code, the part
      // number and the drawing, because that is what identifies the work on a
      // shop floor.
      partNumber: true,
      drawingNumber: true,
      quantity: true,
    },
  },
} satisfies Prisma.SubtaskSelect;

export type SubtaskRow = Prisma.SubtaskGetPayload<{ select: typeof SUBTASK_SELECT }>;

/** What the API returns for a subtask. */
export interface SubtaskSummary {
  id: string;
  jobId: string;
  jobCode: string;
  jobTitle: string;
  partNumber: string | null;
  drawingNumber: string | null;
  quantity: number | null;
  department: { id: string; name: string; code: string; sequenceOrder: number };
  assignee: { id: string; name: string; email: string; isActive: boolean };
  title: string;
  description: string | null;
  deadline: Date;
  reminderLeadMinutes: number;
  requiresApproval: boolean;
  dependsOn: { id: string; title: string; status: SubtaskStatus; deadline: Date } | null;
  status: SubtaskStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  completionNote: string | null;
  escalationCount: number;
  /** Derived, never stored (PDD improvement I-08). */
  isOverdue: boolean;
  /** True when the deadline sits after the job's own (FR-23). */
  exceedsJobDeadline: boolean;
  /** The live problem on this subtask, if one is waiting on the MD (FR-41). */
  openProblem: {
    id: string;
    description: string;
    severity: string;
    status: string;
    createdAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSubtaskSummary(row: SubtaskRow, now: Date = new Date()): SubtaskSummary {
  const terminal = row.status === 'COMPLETED' || row.status === 'CANCELLED';

  return {
    id: row.id,
    jobId: row.jobId,
    jobCode: row.job.jobCode,
    jobTitle: row.job.title,
    partNumber: row.job.partNumber,
    drawingNumber: row.job.drawingNumber,
    quantity: row.job.quantity,
    department: row.department,
    assignee: row.assignee,
    title: row.title,
    description: row.description,
    deadline: row.deadline,
    reminderLeadMinutes: row.reminderLeadMinutes,
    requiresApproval: row.requiresApproval,
    dependsOn: row.dependsOn,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    completionNote: row.completionNote,
    escalationCount: row.escalationCount,
    isOverdue: !terminal && now.getTime() > row.deadline.getTime(),
    openProblem: row.problems[0] ?? null,
    exceedsJobDeadline: row.deadline.getTime() > row.job.overallDeadline.getTime(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The audit snapshot of a subtask — relations dropped, scalars kept. */
export function subtaskSnapshot(row: SubtaskRow): Prisma.InputJsonValue {
  const snapshot: Record<string, unknown> = { ...row };
  for (const relation of ['department', 'assignee', 'dependsOn', 'job', 'problems']) {
    delete snapshot[relation];
  }
  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
}
