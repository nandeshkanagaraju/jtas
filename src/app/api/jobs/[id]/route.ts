/**
 * GET   /api/jobs/:id — detail, scoped by the same visibility rule as the list
 * PATCH /api/jobs/:id — edit
 *
 * A member asking for a job they have no subtask on gets NOT_FOUND rather than
 * FORBIDDEN: confirming that a job code exists is itself information.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { getJob, loadJobForWrite, updateJob } from '@/lib/services/jobs';
import { clientIp } from '@/lib/utils/request';
import { updateJobSchema } from '@/lib/validation/job';

import { jobResource } from '../job-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    // The query is already scoped; `can()` is the second, explicit check so the
    // rule is visible at the handler rather than implied by a where clause.
    const job = await getJob(session, id);
    assertCan(session, 'job:view', await jobResource(job.id, job.createdBy.id));

    return ok({ job });
  })(request);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
    const { id } = await context.params;

    const job = await loadJobForWrite(id);
    assertCan(session, 'job:edit', await jobResource(job.id, job.createdById));

    const input = await parseJson(req, updateJobSchema);
    const updated = await updateJob(
      job,
      input,
      { id: session.id, role: session.role },
      { ipAddress: clientIp(req) },
    );

    return ok({ job: await getJob(session, updated.id) });
  })(request);
}
