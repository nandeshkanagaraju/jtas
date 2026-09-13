/**
 * POST /api/extension-requests/:id/decide — SDD section 6.2. MD/Deputy only.
 *
 * Granting time is a deadline change, so it follows that row of the
 * authorisation matrix rather than having a capability of its own.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { decideExtensionRequest, getExtensionRequest } from '@/lib/services/extension-service';
import { clientIp } from '@/lib/utils/request';
import { decideExtensionRequestSchema } from '@/lib/validation/extension';

import { subtaskResource } from '@/app/api/subtasks/subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
    const { id } = await context.params;

    const existing = await getExtensionRequest(id);
    assertCan(session, 'extensionRequest:decide', {
      id: existing.id,
      requestedById: existing.requestedById,
      subtask: subtaskResource(existing.subtask),
    });

    const input = await parseJson(req, decideExtensionRequestSchema);

    const decided = await decideExtensionRequest(
      id,
      input,
      { id: session.id, role: session.role },
      { ipAddress: clientIp(req) },
    );

    return ok({ extensionRequest: decided });
  })(request);
}
