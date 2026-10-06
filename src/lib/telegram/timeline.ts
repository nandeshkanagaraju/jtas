/**
 * The job as a department member needs to see it in a chat: every step, in
 * the order the job was built, with the date, the finish, and any problem.
 *
 * Loaded when the Telegram message is sent, so a notice queued days ago still
 * describes the job as it is now.
 */
import type { ProblemSeverity, ProblemStatus, SubtaskStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { formatIST } from '@/lib/utils/time';

const DATE = 'd MMM yyyy, h:mm a';

export interface TimelineStep {
  id: string;
  assigneeId: string;
  dependsOnId: string | null;
  departmentName: string;
  title: string;
  assigneeName: string;
  status: SubtaskStatus;
  /** Plain sentence, e.g. "Finished 7 Oct 2026, 1:20 AM". */
  statusLine: string;
  /** The date this step is planning against, when one exists. */
  finishDate: string | null;
  /** What they wrote when they finished. Accepted and rejected counts live here. */
  recorded: string | null;
  description: string | null;
  problems: string[];
}

export interface JobTimeline {
  quantity: number | null;
  description: string | null;
  createdByName: string;
  steps: TimelineStep[];
}

function problemLine(problem: {
  severity: ProblemSeverity;
  status: ProblemStatus;
  description: string;
}): string {
  const state =
    problem.status === 'OPEN' || problem.status === 'ACKNOWLEDGED'
      ? 'open'
      : problem.status.toLowerCase();
  const text =
    problem.description.length > 160
      ? `${problem.description.slice(0, 159)}…`
      : problem.description;
  return `Problem (${state}, ${problem.severity.toLowerCase()}): ${text}`;
}

function statusLine(step: {
  status: SubtaskStatus;
  deadline: Date | null;
  completedAt: Date | null;
  commitmentDueAt: Date | null;
}): string {
  switch (step.status) {
    case 'COMPLETED':
      return step.completedAt ? `Finished ${formatIST(step.completedAt, DATE)}` : 'Finished';
    case 'BLOCKED':
      return 'Waiting. They choose their date only after the previous step finishes.';
    case 'PROBLEM':
      return 'Stopped. A problem is open on this step.';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'AWAITING_APPROVAL':
      return 'Marked finished, waiting for approval';
    case 'ON_HOLD':
      return 'On hold';
    case 'CANCELLED':
      return 'Cancelled';
    case 'PENDING':
      if (!step.deadline && step.commitmentDueAt) return 'Choosing a finish date';
      if (!step.deadline) return 'Date not set yet';
      return 'Date set. Work not finished.';
    default:
      return step.status;
  }
}

/** Every step on the job, oldest first, which is the order they were added. */
export async function loadJobTimeline(jobId: string): Promise<JobTimeline | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      quantity: true,
      description: true,
      createdBy: { select: { name: true } },
      subtasks: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          assigneeId: true,
          dependsOnId: true,
          title: true,
          description: true,
          status: true,
          deadline: true,
          completedAt: true,
          commitmentDueAt: true,
          completionNote: true,
          department: { select: { name: true } },
          assignee: { select: { name: true } },
          problems: {
            orderBy: { createdAt: 'asc' },
            select: { severity: true, status: true, description: true },
          },
        },
      },
    },
  });

  if (!job) return null;

  return {
    quantity: job.quantity,
    description: job.description,
    createdByName: job.createdBy.name,
    steps: job.subtasks.map((step) => ({
      id: step.id,
      assigneeId: step.assigneeId,
      dependsOnId: step.dependsOnId,
      departmentName: step.department.name,
      title: step.title,
      assigneeName: step.assignee.name,
      status: step.status,
      statusLine: statusLine(step),
      finishDate: step.deadline ? formatIST(step.deadline, DATE) : null,
      recorded: step.completionNote?.trim() || null,
      description: step.description?.trim() || null,
      problems: step.problems.map(problemLine),
    })),
  };
}
