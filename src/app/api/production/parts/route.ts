/**
 * GET  /api/production/parts?section=CNC — the Cycle Time Master for a book.
 * POST /api/production/parts — adds a part from the floor (flagged for the approver).
 */
import { z } from 'zod';

import { handler, ok, parseJson, parseQuery } from '@/lib/api/respond';
import { addPart, listParts } from '@/lib/services/production/reports';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { assertProductionUser } from '@/lib/services/production/session';
import { addPartSchema } from '@/lib/validation/production';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const query = z.object({ section: z.enum(['CNC', 'VMC']) });

export const GET = handler(async (request) => {
  assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
  const { section } = parseQuery(new URL(request.url), query);
  return ok({ data: await listParts(section) });
});

export const POST = handler(async (request) => {
  const user = assertProductionUser(await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR));
  const input = await parseJson(request, addPartSchema);
  return ok({ data: await addPart(user, input) }, { status: 201 });
});
