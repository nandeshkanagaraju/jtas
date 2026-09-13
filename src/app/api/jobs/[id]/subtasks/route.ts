/**
 * GET  /api/jobs/:id/subtasks — the job's subtasks, scoped through the job
 * POST /api/jobs/:id/subtasks — add one, or a whole batch from the wizard
 */
import { NextResponse } from 'next/server';

import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { loadJobForWrite } from '@/lib/services/jobs';
import { bulkCreateSubtasks, createSubtask, listJobSubtasks } from '@/lib/services/subtasks';
import { clientIp } from '@/lib/utils/request';
import { bulkCreateSubtasksSchema, createSubtaskSchema } from '@/lib/validation/subtask';
import { z } from 'zod';

import { jobResource } from '../../job-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    // Scoped inside the query: a member cannot enumerate the subtasks of a job
    // they are not part of.
    return ok({ data: await listJobSubtasks(session, id) });
  })(request);
}

/**
 * Accepts either a single subtask or `{ subtasks: [...] }`.
 *
 * The batch form is what the wizard and the template path use, and it is not
 * sugar for looping: the whole set is validated before anything is written, and
 * in-batch dependencies are resolved inside one transaction, so a job never
 * ends up with half a chain.
 */
export async function POST(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
    const { id } = await context.params;

    const job = await loadJobForWrite(id);
    assertCan(session, 'subtask:create', await jobResource(job.id, job.createdById));

    const actor = { id: session.id, role: session.role };
    const ctx = { ipAddress: clientIp(req) };

    const payload = await parseJson(req, z.union([bulkCreateSubtasksSchema, createSubtaskSchema]));

    if ('subtasks' in payload) {
      const created = await bulkCreateSubtasks(id, payload, actor, ctx);
      return NextResponse.json(
        { data: created.map((row) => row.id), count: created.length },
        {
          status: 201,
        },
      );
    }

    const subtask = await createSubtask(id, payload, actor, ctx);
    return NextResponse.json({ subtask: { id: subtask.id } }, { status: 201 });
  })(request);
}
