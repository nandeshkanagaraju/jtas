/**
 * Comments on a subtask (build spec M10.1).
 *
 * Plain text, stored as written. Nothing here produces HTML and nothing renders
 * it as HTML — SDD section 8 item 5 is explicit that comment text is escaped on
 * render and `dangerouslySetInnerHTML` is never used. The mention parser splits
 * a body into segments the renderer emits as React nodes, which escape by
 * construction.
 *
 * A resolvable `@mention` notifies that person in-app. Unresolvable text stays
 * text: a notification to the wrong Ravi is worse than no notification.
 */
import { prisma } from '@/lib/db/prisma';
import { mentionedUserIds, type MentionCandidate } from '@/lib/domain/mentions';
import { notFound, validationError } from '@/lib/errors';
import { enqueue } from '@/lib/notifications/notification-service';
import { commentMentionKey } from '@/lib/notifications/dedupe';
import { writeAudit } from '@/lib/services/audit-service';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('comments');

export const COMMENT_MAX_LENGTH = 2000;

export interface CommentActor {
  id: string;
  name: string;
}

export interface CommentContext {
  ipAddress: string | null;
}

export interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; email: string } | null;
  /** Who this comment mentions, so the renderer can mark the names. */
  mentions: MentionCandidate[];
}

/**
 * The people a comment on this subtask may mention.
 *
 * Everyone on the job plus the commanders — the set that can already see the
 * subtask. Mentioning somebody who cannot open the thing being discussed would
 * send them a notification to a 403.
 */
export async function mentionCandidates(subtaskId: string): Promise<MentionCandidate[]> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: { jobId: true },
  });

  if (!subtask) return [];

  const [participants, commanders] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, assignedSubtasks: { some: { jobId: subtask.jobId } } },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: ['MD', 'DEPUTY_MD'] } },
      select: { id: true, name: true },
    }),
  ]);

  const byId = new Map<string, MentionCandidate>();
  for (const user of [...participants, ...commanders]) byId.set(user.id, user);

  return [...byId.values()];
}

/** Comments on a subtask, oldest first — a conversation reads downward. */
export async function listComments(subtaskId: string): Promise<CommentRow[]> {
  const rows = await prisma.comment.findMany({
    where: { subtaskId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, body: true, createdAt: true, userId: true },
  });

  if (rows.length === 0) return [];

  // `Comment.userId` carries no relation on the model, so the authors come from
  // one keyed query rather than a join — and one query, not one per comment.
  const authors = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
    select: { id: true, name: true, email: true },
  });

  const byId = new Map(authors.map((user) => [user.id, user]));
  const candidates = await mentionCandidates(subtaskId);

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: byId.get(row.userId) ?? null,
    mentions: candidates,
  }));
}

/** Adds a comment, notifying anyone it mentions. */
export async function addComment(
  subtaskId: string,
  body: string,
  actor: CommentActor,
  ctx: CommentContext,
): Promise<CommentRow> {
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    throw validationError('Write something first.', {
      fields: { body: ['A comment cannot be empty.'] },
    });
  }

  if (trimmed.length > COMMENT_MAX_LENGTH) {
    throw validationError('That comment is too long.', {
      fields: { body: [`Use at most ${COMMENT_MAX_LENGTH} characters.`] },
    });
  }

  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: {
      id: true,
      title: true,
      jobId: true,
      job: { select: { jobCode: true } },
    },
  });

  if (!subtask) throw notFound('Subtask');

  const candidates = await mentionCandidates(subtaskId);
  // Nobody is notified of their own mention.
  const mentioned = mentionedUserIds(trimmed, candidates).filter((id) => id !== actor.id);

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { subtaskId, userId: actor.id, body: trimmed },
      select: { id: true, body: true, createdAt: true, userId: true },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'COMMENT_ADDED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      // The body is in the Comment row; the audit row records that it happened
      // and to whom, not a second copy of the text.
      after: { commentId: created.id, length: trimmed.length, mentioned: mentioned.length },
      ipAddress: ctx.ipAddress,
    });

    if (mentioned.length > 0) {
      await enqueue(tx, {
        type: 'COMMENT_MENTION',
        channel: 'IN_APP',
        userIds: mentioned,
        entityType: 'SUBTASK',
        entityId: subtaskId,
        subject: `${actor.name} mentioned you on ${subtask.job.jobCode}`,
        body: trimmed.slice(0, 240),
        dedupeKeyFor: (userId) => commentMentionKey(created.id, userId),
        scheduledFor: new Date(),
      });
    }

    return created;
  });

  if (mentioned.length > 0) {
    log.info({ commentId: comment.id, mentioned: mentioned.length }, 'mentions notified');
  }

  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    author: { id: actor.id, name: actor.name, email: '' },
    mentions: candidates,
  };
}
