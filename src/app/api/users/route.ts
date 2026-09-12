/**
 * GET  /api/users — list with filters, search and pagination
 * POST /api/users — create, returning the temporary password once
 *
 * SDD section 6.2: MD and ADMIN only. The role gate is the coarse check at the
 * door; `can()` still decides the object-level question on POST, which is where
 * "an administrator may not create an MD" is enforced.
 */
import { NextResponse } from 'next/server';

import { handler, ok, parseJson, parseQuery } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { createUser, listUsers } from '@/lib/services/users';
import { clientIp } from '@/lib/utils/request';
import { createUserSchema, listUsersQuerySchema } from '@/lib/validation/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession(['MD', 'ADMIN']);
  assertCan(session, 'user:view', undefined);

  const query = parseQuery(new URL(request.url), listUsersQuerySchema);

  return ok(await listUsers(query));
});

export const POST = handler(async (request) => {
  const session = await requireActiveSession(['MD', 'ADMIN']);
  const input = await parseJson(request, createUserSchema);

  // Object-level: an ADMIN may manage members and deputies, but not an MD —
  // otherwise "manage users" would be a route to the top role.
  assertCan(session, 'user:manage', { id: 'new', role: input.role });

  const { user, temporaryPassword } = await createUser(
    input,
    { id: session.id },
    { ipAddress: clientIp(request) },
  );

  return NextResponse.json(
    {
      user,
      /**
       * Shown once and never retrievable again — only a bcrypt hash is stored.
       * The client displays it with a copy button and a warning; nothing logs it.
       */
      temporaryPassword,
    },
    { status: 201 },
  );
});
