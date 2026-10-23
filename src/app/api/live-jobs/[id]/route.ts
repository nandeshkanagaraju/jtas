import { handler, ok, parseQuery } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { getLiveJob } from '@/lib/services/live-updates';
import { liveJobQuerySchema } from '@/lib/live-updates/validation';
export const dynamic = 'force-dynamic';
export const GET = handler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireActiveSession();
    return ok(
      await getLiveJob(
        user,
        (await context.params).id,
        parseQuery(new URL(request.url), liveJobQuerySchema),
      ),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  },
);
