/**
 * The four lifecycle endpoints differ only in which service they call and
 * whether they need a reason, so the shared shape lives here — authenticate,
 * authorise against the loaded job, validate, call, return the refreshed job.
 */
import type { NextResponse } from 'next/server';

import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan, type Action } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import {
  getJob,
  loadJobForWrite,
  type Actor,
  type JobRow,
  type RequestContext,
} from '@/lib/services/jobs';
import { clientIp } from '@/lib/utils/request';
import { jobReasonSchema } from '@/lib/validation/job';

import { jobResource } from './job-resource';

type LifecycleAction = Extract<Action, 'job:publish' | 'job:hold' | 'job:cancel'>;

export function jobLifecycleRoute(options: {
  action: LifecycleAction;
  /** Hold and cancel record a reason in the audit log (build spec M3.1). */
  requiresReason: boolean;
  run: (job: JobRow, reason: string, actor: Actor, ctx: RequestContext) => Promise<JobRow>;
}) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> {
    return handler(async (req) => {
      const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
      const { id } = await context.params;

      const job = await loadJobForWrite(id);
      assertCan(session, options.action, await jobResource(job.id, job.createdById));

      const reason = options.requiresReason ? (await parseJson(req, jobReasonSchema)).reason : '';

      await options.run(
        job,
        reason,
        { id: session.id, role: session.role },
        { ipAddress: clientIp(req) },
      );

      // Re-read through the scoped query so the response carries the derived
      // facets (progress, departments, overdue) the screens render.
      return ok({ job: await getJob(session, id) });
    })(request);
  };
}
