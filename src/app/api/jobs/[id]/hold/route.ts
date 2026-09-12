/**
 * POST /api/jobs/:id/hold — pause a live job (FR-14). Reason required.
 */
import { holdJob } from '@/lib/services/jobs';

import { jobLifecycleRoute } from '../../lifecycle-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = jobLifecycleRoute({
  action: 'job:hold',
  requiresReason: true,
  run: (job, reason, actor, ctx) => holdJob(job, reason, actor, ctx),
});
