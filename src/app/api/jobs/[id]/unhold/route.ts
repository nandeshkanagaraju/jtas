/**
 * POST /api/jobs/:id/unhold — resume a held job.
 *
 * The status is recomputed rather than restored: time passed while the job was
 * paused, and the honest answer may now be DELAYED.
 */
import { unholdJob } from '@/lib/services/jobs';

import { jobLifecycleRoute } from '../../lifecycle-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = jobLifecycleRoute({
  // Resuming is the same capability as pausing.
  action: 'job:hold',
  requiresReason: false,
  run: (job, _reason, actor, ctx) => unholdJob(job, actor, ctx),
});
