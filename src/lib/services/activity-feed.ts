/**
 * The job activity feed (build spec M10.3).
 *
 * One chronological story of a job: comments, status changes, deadline changes,
 * problems raised and resolved, attachments added.
 *
 * Built on the audit log rather than beside it. Every one of those events
 * already writes an audit row inside its own transaction (architecture rule 5),
 * so reading the feed from anywhere else would mean two sources that can
 * disagree — and the one people would trust is the one that is wrong. Comment
 * bodies and attachment names are joined on afterwards, because the audit row
 * deliberately records that a comment happened rather than a second copy of it.
 */
import { prisma } from '@/lib/db/prisma';
import { jobAuditTrail, type AuditEntry } from '@/lib/services/audit-query';

export interface ActivityItem {
  id: string;
  at: string;
  kind:
    'comment' | 'status' | 'deadline' | 'problem' | 'attachment' | 'assignment' | 'job' | 'other';
  action: string;
  actor: { id: string; name: string } | null;
  /** Which subtask it happened on, when it was not the job itself. */
  subtask: { id: string; title: string; department: string } | null;
  /** The comment text, or the attachment's file name. */
  body: string | null;
  /** `status PENDING → IN_PROGRESS`, already rendered. */
  changes: Array<{ field: string; before: string; after: string }>;
  /** Set for an attachment, so the feed can link to it. */
  attachmentId: string | null;
}

/** What each audit action means to a reader. */
function kindOf(action: string): ActivityItem['kind'] {
  if (action === 'COMMENT_ADDED') return 'comment';
  if (action.startsWith('ATTACHMENT_')) return 'attachment';
  if (action.startsWith('PROBLEM_')) return 'problem';
  if (action.includes('DEADLINE') || action.startsWith('EXTENSION_')) return 'deadline';
  if (action === 'SUBTASK_REASSIGNED') return 'assignment';
  if (action.startsWith('SUBTASK_')) return 'status';
  if (action.startsWith('JOB_')) return 'job';
  return 'other';
}

/**
 * Rows that would drown the story.
 *
 * `JOB_STATUS_RECOMPUTED` fires whenever any subtask moves, so a busy job
 * accumulates dozens of them saying the same thing the subtask row above
 * already said. They stay in the audit log, which is the record; the feed is
 * the story.
 */
const NOISE = new Set(['JOB_STATUS_RECOMPUTED']);

export async function jobActivityFeed(
  jobId: string,
  options: { limit?: number } = {},
): Promise<ActivityItem[]> {
  const trail = await jobAuditTrail(jobId);
  const meaningful = trail.filter((entry) => !NOISE.has(entry.action));

  const commentIds = meaningful
    .filter((entry) => entry.action === 'COMMENT_ADDED')
    .map((entry) => (entry.after as { commentId?: string } | null)?.commentId)
    .filter((id): id is string => Boolean(id));

  const subtaskIds = [
    ...new Set(meaningful.filter((e) => e.entityType === 'SUBTASK').map((e) => e.entityId)),
  ];

  const problemIds = [
    ...new Set(meaningful.filter((e) => e.entityType === 'PROBLEM').map((e) => e.entityId)),
  ];

  const [comments, subtasks, problems] = await Promise.all([
    commentIds.length > 0
      ? prisma.comment.findMany({
          where: { id: { in: commentIds } },
          select: { id: true, body: true },
        })
      : [],
    subtaskIds.length > 0
      ? prisma.subtask.findMany({
          where: { id: { in: subtaskIds } },
          select: { id: true, title: true, department: { select: { name: true } } },
        })
      : [],
    problemIds.length > 0
      ? prisma.problem.findMany({
          where: { id: { in: problemIds } },
          select: {
            id: true,
            description: true,
            subtask: {
              select: { id: true, title: true, department: { select: { name: true } } },
            },
          },
        })
      : [],
  ]);

  const commentById = new Map(comments.map((row) => [row.id, row.body]));
  const subtaskById = new Map(
    subtasks.map((row) => [
      row.id,
      { id: row.id, title: row.title, department: row.department.name },
    ]),
  );
  const problemById = new Map(problems.map((row) => [row.id, row]));

  const items = meaningful.map((entry): ActivityItem => {
    const after = (entry.after ?? {}) as Record<string, unknown>;
    const before = (entry.before ?? {}) as Record<string, unknown>;

    let subtask = subtaskById.get(entry.entityId) ?? null;
    let body: string | null = null;

    if (entry.action === 'COMMENT_ADDED') {
      body = commentById.get(String(after.commentId ?? '')) ?? null;
    }

    if (entry.action.startsWith('ATTACHMENT_')) {
      body = String(after.fileName ?? before.fileName ?? '') || null;
    }

    if (entry.entityType === 'PROBLEM') {
      const problem = problemById.get(entry.entityId);
      if (problem) {
        body = problem.description;
        subtask = {
          id: problem.subtask.id,
          title: problem.subtask.title,
          department: problem.subtask.department.name,
        };
      }
    }

    return {
      id: entry.id,
      at: entry.createdAt,
      kind: kindOf(entry.action),
      action: entry.action,
      actor: entry.actor ? { id: entry.actor.id, name: entry.actor.name } : null,
      subtask,
      body,
      changes: entry.diff.map((change) => ({
        field: change.field,
        before: change.before,
        after: change.after,
      })),
      attachmentId:
        entry.action.startsWith('ATTACHMENT_') && typeof after.attachmentId === 'string'
          ? after.attachmentId
          : null,
    };
  });

  // Newest first for the screen; `jobAuditTrail` reads oldest first because it
  // is a trace rather than a feed.
  items.reverse();

  return options.limit ? items.slice(0, options.limit) : items;
}

export type { AuditEntry };
