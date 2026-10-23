/**
 * GET /api/jobs/:id/activity — build spec M10.3.
 *
 * The job's story: comments, status changes, deadline changes, problems and
 * attachments, merged and newest first.
 */
import { handler, ok, parseQuery } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { jobActivityFeed } from '@/lib/services/activity-feed';
import { getJob } from '@/lib/services/jobs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    // Scopes to what this session may see; a member on the job qualifies.
    await getJob(session, id);

    const { limit } = parseQuery(
      new URL(req.url),
      z.object({ limit: z.coerce.number().int().min(1).max(200).default(40) }),
    );

    return ok({ data: await jobActivityFeed(id, { limit: limit }) });
  })(request);
}
