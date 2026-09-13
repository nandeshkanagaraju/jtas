/**
 * POST /api/problems/:id/resolve — SDD section 6.2, FR-42.
 *
 * One of five named actions with a mandatory note, so the record answers what
 * was done and not merely that something was.
 */
import { resolveProblem } from '@/lib/services/problems';
import { resolveProblemSchema } from '@/lib/validation/problem';

import { problemActionRoute } from '../../problem-action';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = problemActionRoute({
  schema: resolveProblemSchema,
  run: (id, input, actor, ctx) => resolveProblem(id, input, actor, ctx),
});
