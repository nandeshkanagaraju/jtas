/**
 * Shared shapes for job management.
 *
 * The Prisma select and the mappers live here so every read path returns the
 * same object and no route can accidentally widen it.
 */
import type { JobStatus, Prisma, Priority } from '@prisma/client';

import type { SubtaskSnapshot } from '@/lib/domain/job-status';

export interface RequestContext {
  ipAddress: string;
}

export interface Actor {
  id: string;
  /**
   * Carried through to the subtask service at publish, so a deputy's actions
   * are recorded as a deputy's rather than mislabelled as the MD's.
   */
  role: 'MD' | 'DEPUTY_MD' | 'ADMIN' | 'MEMBER';
}

/**
 * Statuses a job can be edited freely in. Everywhere else only the four "soft"
 * fields are accepted — see `EDITABLE_AFTER_PUBLISH`.
 */
export const DRAFT_STATUSES: readonly JobStatus[] = ['DRAFT'];

/**
 * Fields that stay editable once a job is published (build spec M3.1).
 *
 * Part number, drawing number, quantity and the overall deadline are frozen:
 * they are what the shop floor has already planned against, and changing them
 * silently under a published job would invalidate every subtask deadline
 * derived from them.
 */
export const EDITABLE_AFTER_PUBLISH = ['title', 'description', 'customerName', 'priority'] as const;

export type EditableAfterPublish = (typeof EDITABLE_AFTER_PUBLISH)[number];

/** A job is finished or abandoned; its record stops changing. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['CANCELLED'];

export const JOB_SELECT = {
  id: true,
  jobCode: true,
  title: true,
  customerName: true,
  partNumber: true,
  drawingNumber: true,
  quantity: true,
  priority: true,
  description: true,
  overallDeadline: true,
  status: true,
  publishedAt: true,
  completedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.JobSelect;

export type JobRow = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

/** What the API returns for a job. */
export interface JobSummary {
  id: string;
  jobCode: string;
  title: string;
  customerName: string | null;
  partNumber: string | null;
  drawingNumber: string | null;
  quantity: number | null;
  priority: Priority;
  description: string | null;
  overallDeadline: Date;
  status: JobStatus;
  publishedAt: Date | null;
  completedAt: Date | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
  progress: { completed: number; total: number; percent: number };
  /** Departments with at least one subtask on the job, in shop-flow order. */
  departments: Array<{ id: string; name: string; code: string }>;
  /** True when any active subtask has passed its deadline. */
  hasOverdueSubtask: boolean;
}

export function toJobSummary(
  row: JobRow,
  extras: {
    progress: JobSummary['progress'];
    departments: JobSummary['departments'];
    hasOverdueSubtask: boolean;
  },
): JobSummary {
  return {
    id: row.id,
    jobCode: row.jobCode,
    title: row.title,
    customerName: row.customerName,
    partNumber: row.partNumber,
    drawingNumber: row.drawingNumber,
    quantity: row.quantity,
    priority: row.priority,
    description: row.description,
    overallDeadline: row.overallDeadline,
    status: row.status,
    publishedAt: row.publishedAt,
    completedAt: row.completedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...extras,
  };
}

/** The audit snapshot of a job. */
export function jobSnapshot(row: JobRow): Prisma.InputJsonValue {
  const snapshot: Record<string, unknown> = { ...row };
  delete snapshot.createdBy;
  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
}

/** Narrows loaded subtasks to what the status ladder needs. */
export function toSubtaskSnapshots(
  subtasks: ReadonlyArray<{ status: SubtaskSnapshot['status']; deadline: Date }>,
): SubtaskSnapshot[] {
  return subtasks.map((subtask) => ({ status: subtask.status, deadline: subtask.deadline }));
}
