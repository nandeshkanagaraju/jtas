/**
 * POST /api/problems/:id/acknowledge — SDD section 6.2, FR-42.
 *
 * Tells the member it has been seen. It does not stop the ageing clock: reading
 * a problem is not deciding it.
 */
import { acknowledgeProblem } from '@/lib/services/problems';

import { problemActionRoute } from '../../problem-action';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = problemActionRoute({
  schema: null,
  run: async (id, _input, actor, ctx) => ({
    problem: await acknowledgeProblem(id, actor, ctx),
  }),
});
