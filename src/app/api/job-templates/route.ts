/**
 * GET/POST /api/job-templates — build spec M9.5.
 *
 * Reading is open to anyone who can create a job; writing is MD and ADMIN,
 * because a template decides how every future job is laid out.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { createTemplate, listJobTemplates } from '@/lib/services/templates';
import { clientIp } from '@/lib/utils/request';
import { templateSchema } from '@/lib/validation/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  await requireActiveSession();
  return ok({ data: await listJobTemplates() });
});

export const POST = handler(async (request) => {
  const session = await requireActiveSession();
  if (!can(session, 'settings:manage', undefined)) throw forbidden();

  const body = await parseJson(request, templateSchema);

  return ok(
    { data: await createTemplate(body, session, { ipAddress: clientIp(request) }) },
    { status: 201 },
  );
});
