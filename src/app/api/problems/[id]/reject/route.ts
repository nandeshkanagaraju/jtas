/**
 * POST /api/problems/:id/reject — SDD section 6.2, FR-42.
 *
 * The subtask returns to the member with a mandatory explanation; a bare
 * rejection is how somebody learns to stop reporting things.
 */
import { rejectProblem } from '@/lib/services/problems';
import { rejectProblemSchema } from '@/lib/validation/problem';

import { problemActionRoute } from '../../problem-action';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = problemActionRoute({
  schema: rejectProblemSchema,
  run: async (id, input, actor, ctx) => ({
    problem: await rejectProblem(id, input, actor, ctx),
  }),
});
