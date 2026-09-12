/**
 * POST /api/jobs/:id/publish — draft → in progress (FR-10).
 *
 * Refuses a job with no subtasks: publishing an empty job would announce work
 * to nobody. M4 is what makes this endpoint succeed.
 */
import { publishJob } from '@/lib/services/jobs';

import { jobLifecycleRoute } from '../../lifecycle-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = jobLifecycleRoute({
  action: 'job:publish',
  requiresReason: false,
  run: (job, _reason, actor, ctx) => publishJob(job, actor, ctx),
});
