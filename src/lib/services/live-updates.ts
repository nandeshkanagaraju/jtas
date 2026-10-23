import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/policy';
import { notFound, validationError } from '@/lib/errors';
import { jobProgress } from '@/lib/domain/job-status';
import { topologicalOrder } from '@/lib/domain/subtask-dependencies';
import { visibilityFilter, getJob } from '@/lib/services/jobs';
import { listJobSubtasks } from '@/lib/services/subtasks';
import { jobActivityFeed } from '@/lib/services/activity-feed';
import { currentStageIds } from '@/lib/live-updates/progress';
import {
  activityCursorSchema,
  type LiveJobsQuery,
  type LiveJobQuery,
} from '@/lib/live-updates/validation';
import type { LiveJobList, LiveJobDetail } from '@/lib/live-updates/types';

export async function listLiveJobs(user: SessionUser, query: LiveJobsQuery): Promise<LiveJobList> {
  const filters: Prisma.JobWhereInput[] = [visibilityFilter(user)];
  if (query.state === 'active')
    filters.push({ status: { in: ['IN_PROGRESS', 'AT_RISK', 'DELAYED', 'ON_HOLD'] } });
  if (query.state === 'completed') filters.push({ status: 'COMPLETED' });
  if (query.q)
    filters.push({
      OR: ['jobCode', 'title', 'customerName', 'partNumber'].map((field) => ({
        [field]: { contains: query.q, mode: 'insensitive' },
      })),
    });
  const where = { AND: filters };
  const [rows, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [{ overallDeadline: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        jobCode: true,
        title: true,
        status: true,
        priority: true,
        overallDeadline: true,
        subtasks: {
          orderBy: [{ department: { sequenceOrder: 'asc' } }, { createdAt: 'asc' }],
          select: {
            id: true,
            status: true,
            deadline: true,
            department: { select: { name: true } },
            _count: {
              select: { problems: { where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } } } },
            },
          },
        },
      },
    }),
    prisma.job.count({ where }),
  ]);
  return {
    data: rows.map((row) => {
      const current = currentStageIds(row.subtasks, row.status);
      return {
        id: row.id,
        jobCode: row.jobCode,
        title: row.title,
        status: row.status,
        priority: row.priority,
        overallDeadline: row.overallDeadline.toISOString(),
        progress: jobProgress(row.subtasks),
        currentDepartments: [
          ...new Set(
            row.subtasks
              .filter((stage) => current.has(stage.id))
              .map((stage) => stage.department.name),
          ),
        ],
        openProblems: row.subtasks.reduce((sum, stage) => sum + stage._count.problems, 0),
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

const SAFE_CHANGES = new Set([
  'status',
  'deadline',
  'overallDeadline',
  'reason',
  'completionNote',
  'mdActionNote',
  'requestedDeadline',
]);
export async function getLiveJob(
  user: SessionUser,
  id: string,
  query: LiveJobQuery,
): Promise<LiveJobDetail> {
  // Prove visibility before reading history. Every poll rechecks membership.
  const job = await getJob(user, id);
  const subtasks = await listJobSubtasks(user, id);
  if (query.taskId && !subtasks.some((task) => task.id === query.taskId))
    throw notFound('Department task');
  let before: { at: Date; id: string } | undefined;
  if (query.cursor) {
    try {
      const parsed = activityCursorSchema.parse(
        JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
      );
      before = { at: new Date(parsed.at), id: parsed.id };
    } catch {
      throw validationError('That update cursor is invalid. Return to live updates.');
    }
  }
  const events = await jobActivityFeed(id, {
    limit: 41,
    before,
    subtaskId: query.taskId,
    kind: query.kind,
  });
  const page = events.slice(0, 40);
  const last = page.at(-1);
  const current = currentStageIds(subtasks, job.status);
  const participants = subtasks.map((task) => task.assignee.id);
  const byId = new Map(subtasks.map((task) => [task.id, task]));
  const ordered = topologicalOrder(
    subtasks.map((task) => ({ id: task.id, dependsOnId: task.dependsOn?.id ?? null })),
  );
  return {
    job: {
      id: job.id,
      jobCode: job.jobCode,
      title: job.title,
      status: job.status,
      priority: job.priority,
      overallDeadline: job.overallDeadline.toISOString(),
      progress: job.progress,
      partNumber: job.partNumber,
      quantity: job.quantity,
      currentDepartments: [
        ...new Set(
          subtasks.filter((task) => current.has(task.id)).map((task) => task.department.name),
        ),
      ],
      openProblems: subtasks.filter((task) => task.openProblem).length,
    },
    stages: ordered.map((node) => {
      const task = byId.get(node.id)!;
      return {
        id: task.id,
        title: task.title,
        department: task.department,
        assignee: { id: task.assignee.id, name: task.assignee.name },
        status: task.status,
        deadline: task.deadline?.toISOString() ?? null,
        commitmentDueAt: task.commitmentDueAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        dependsOnId: task.dependsOn?.id ?? null,
        isOverdue: task.isOverdue,
        current: current.has(task.id),
        problem: task.openProblem
          ? { description: task.openProblem.description, severity: task.openProblem.severity }
          : null,
        canComment: can(user, 'comment:create', {
          id: task.id,
          jobId: id,
          assigneeId: task.assignee.id,
          departmentId: task.department.id,
          jobParticipantIds: participants,
        }),
      };
    }),
    events: page.map((event) => ({
      ...event,
      changes: event.changes.filter((change) => SAFE_CHANGES.has(change.field)),
      attachmentId: event.action === 'ATTACHMENT_DELETED' ? null : event.attachmentId,
    })),
    nextCursor:
      events.length > 40 && last
        ? Buffer.from(JSON.stringify({ at: last.at, id: last.id })).toString('base64url')
        : null,
    checkedAt: new Date().toISOString(),
  };
}
