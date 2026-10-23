import { handler, ok, parseQuery } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { listLiveJobs } from '@/lib/services/live-updates';
import { liveJobsQuerySchema } from '@/lib/live-updates/validation';
export const dynamic = 'force-dynamic';
export const GET = handler(async (request) => {
  const user = await requireActiveSession();
  return ok(await listLiveJobs(user, parseQuery(new URL(request.url), liveJobsQuerySchema)), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
