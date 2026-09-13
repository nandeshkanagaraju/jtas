/**
 * POST /api/subtasks/:id/status — SDD section 6.2.
 *
 * One endpoint for every transition. Two gates run, in this order:
 *
 *   1. `can()` — may this user perform this kind of action at all? A member
 *      poking at somebody else's subtask is refused before the system reasons
 *      about state.
 *   2. The pure state machine — is the move legal from the current status, and
 *      are its guards satisfied?
 *
 * They answer different questions and neither substitutes for the other.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan, type Action } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { forbidden } from '@/lib/errors';
import { changeStatus, getSubtask, loadSubtaskForWrite } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { subtaskStatusChangeSchema, type SubtaskActionValue } from '@/lib/validation/subtask';

import { subtaskResource } from '../../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Which capability each action needs.
 *
 * `RESOLVE_PROBLEM` is handled separately because `problem:resolve` is decided
 * against the problem, not the subtask.
 */
const CAPABILITY: Record<Exclude<SubtaskActionValue, 'RESOLVE_PROBLEM'>, Action> = {
  START: 'subtask:updateStatus',
  COMPLETE: 'subtask:updateStatus',
  PROBLEM: 'problem:raise',
  APPROVE: 'subtask:approve',
  REJECT: 'subtask:approve',
  // Pausing and stopping are command capabilities, not the assignee's.
  HOLD: 'subtask:edit',
  UNHOLD: 'subtask:edit',
  CANCEL: 'subtask:edit',
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const existing = await loadSubtaskForWrite(id);
    const resource = subtaskResource(existing);

    const input = await parseJson(req, subtaskStatusChangeSchema);

    if (input.action === 'RESOLVE_PROBLEM') {
      const problem = await prisma.problem.findFirst({
        where: { subtaskId: id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, raisedById: true },
      });

      // No open problem is a state question, not a permission one — the state
      // machine returns INVALID_TRANSITION for it. Only guard the capability.
      if (problem) {
        assertCan(session, 'problem:resolve', { ...problem, subtask: resource });
      } else if (session.role !== 'MD' && session.role !== 'DEPUTY_MD') {
        throw forbidden();
      }
    } else {
      assertCan(session, CAPABILITY[input.action], resource);
    }

    const result = await changeStatus(
      id,
      input,
      { id: session.id, role: session.role },
      { ipAddress: clientIp(req) },
    );

    return ok({
      subtask: await getSubtask(session, id),
      previousStatus: result.previousStatus,
      // So the member screen can say "Purchase is now unblocked" rather than
      // leaving the consequence invisible.
      unblocked: result.unblocked,
    });
  })(request);
}
