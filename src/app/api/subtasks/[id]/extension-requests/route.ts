/**
 * GET  /api/subtasks/:id/extension-requests — the request history
 * POST /api/subtasks/:id/extension-requests — ask for more time (FR-33)
 *
 * Only the assignee may ask. FR-35 is explicit that a member cannot edit their
 * own deadline, and improvement I-11 is why there is a path at all: without one
 * the honest member's only options are silence or a problem report that is not
 * really a problem.
 */
import { NextResponse } from 'next/server';

import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listExtensionRequests, requestExtension } from '@/lib/services/extension-service';
import { loadSubtaskForWrite } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { createExtensionRequestSchema } from '@/lib/validation/extension';

import { subtaskResource, subtaskViewResource } from '../../subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const subtask = await loadSubtaskForWrite(id);
    assertCan(session, 'subtask:view', await subtaskViewResource(subtask));

    return ok({ data: await listExtensionRequests(id) });
  })(request);
}

export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const subtask = await loadSubtaskForWrite(id);
    assertCan(session, 'subtask:requestExtension', subtaskResource(subtask));

    const input = await parseJson(req, createExtensionRequestSchema);

    const created = await requestExtension(
      id,
      input,
      { id: session.id, role: session.role },
      { ipAddress: clientIp(req) },
    );

    return NextResponse.json({ extensionRequest: created }, { status: 201 });
  })(request);
}
