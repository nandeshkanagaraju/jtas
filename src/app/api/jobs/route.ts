/**
 * GET  /api/jobs — list, scoped to what the caller may see
 * POST /api/jobs — create a draft
 *
 * SDD section 6.2: GET is open to any signed-in user but *scoped* — a member
 * sees only jobs they hold a subtask on, enforced in the query rather than by
 * filtering afterwards. POST is MD and Deputy only.
 */
import { NextResponse } from 'next/server';

import { handler, ok, parseJson, parseQuery } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { createJob, listJobs, toJobSummary } from '@/lib/services/jobs';
import { clientIp } from '@/lib/utils/request';
import { createJobSchema, listJobsQuerySchema } from '@/lib/validation/job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  const query = parseQuery(new URL(request.url), listJobsQuerySchema);

  return ok(await listJobs(session, query));
});

export const POST = handler(async (request) => {
  const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
  assertCan(session, 'job:create', undefined);

  const input = await parseJson(request, createJobSchema);

  const job = await createJob(
    input,
    { id: session.id, role: session.role },
    { ipAddress: clientIp(request) },
  );

  return NextResponse.json(
    {
      job: toJobSummary(job, {
        // A new draft has no subtasks yet, so every derived facet is empty.
        progress: { completed: 0, total: 0, percent: 0 },
        departments: [],
        hasOverdueSubtask: false,
      }),
    },
    { status: 201 },
  );
});
