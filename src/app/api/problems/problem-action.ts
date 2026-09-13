/**
 * The three MD actions on a problem share everything but their service call.
 */
import type { NextResponse } from 'next/server';
import type { ZodTypeAny, TypeOf } from 'zod';

import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import type { SessionUser } from '@/lib/auth/session';
import { loadProblemForWrite } from '@/lib/services/problems';
import { clientIp } from '@/lib/utils/request';

/**
 * Builds a POST handler for one problem action.
 *
 * `problem:resolve` is decided against the loaded problem rather than the role
 * alone, so the object-level rule stays visible at the handler.
 */
export function problemActionRoute<S extends ZodTypeAny | null>(options: {
  schema: S;
  run: (
    problemId: string,
    input: S extends ZodTypeAny ? TypeOf<S> : undefined,
    actor: { id: string; role: SessionUser['role'] },
    ctx: { ipAddress: string },
  ) => Promise<unknown>;
}) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> {
    return handler(async (req) => {
      const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
      const { id } = await context.params;

      const problem = await loadProblemForWrite(id);
      assertCan(session, 'problem:resolve', {
        id: problem.id,
        raisedById: problem.raisedById,
        subtask: {
          id: problem.subtask.id,
          jobId: problem.subtask.job.id,
          assigneeId: problem.subtask.assigneeId,
          departmentId: problem.subtask.department.id,
        },
      });

      const input = options.schema ? await parseJson(req, options.schema) : (undefined as never);

      const result = await options.run(
        id,
        input,
        { id: session.id, role: session.role },
        { ipAddress: clientIp(req) },
      );

      return ok(result as Record<string, unknown>);
    })(request);
  };
}
