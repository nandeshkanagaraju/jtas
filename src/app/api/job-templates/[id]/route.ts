/**
 * GET/PUT/DELETE /api/job-templates/:id — build spec M9.5.
 *
 * DELETE archives rather than removes (architecture rule 6): a template that
 * shaped forty jobs is the explanation for how they were laid out.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { getJobTemplate, setTemplateActive, updateTemplate } from '@/lib/services/templates';
import { clientIp } from '@/lib/utils/request';
import { templateSchema } from '@/lib/validation/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handler(async (_request, context: Context) => {
  await requireActiveSession();
  const { id } = await context.params;

  return ok({ data: await getJobTemplate(id) });
});

export const PUT = handler(async (request, context: Context) => {
  const session = await requireActiveSession();
  if (!can(session, 'settings:manage', undefined)) throw forbidden();

  const { id } = await context.params;
  const body = await parseJson(request, templateSchema);

  return ok({
    data: await updateTemplate(id, body, session, { ipAddress: clientIp(request) }),
  });
});

export const DELETE = handler(async (request, context: Context) => {
  const session = await requireActiveSession();
  if (!can(session, 'settings:manage', undefined)) throw forbidden();

  const { id } = await context.params;
  await setTemplateActive(id, false, session, { ipAddress: clientIp(request) });

  return ok({ archived: true });
});
