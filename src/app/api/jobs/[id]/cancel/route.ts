/**
 * POST /api/jobs/:id/cancel — terminal, never a delete (FR-14, rule 6).
 * Reason required; open subtasks are cancelled with the job.
 */
import { cancelJob } from '@/lib/services/jobs';

import { jobLifecycleRoute } from '../../lifecycle-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = jobLifecycleRoute({
  action: 'job:cancel',
  requiresReason: true,
  run: (job, reason, actor, ctx) => cancelJob(job, reason, actor, ctx),
});
