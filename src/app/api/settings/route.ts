/**
 * GET/PUT /api/settings — build spec M9.1.
 *
 * MD and ADMIN. Write-only keys (the SMTP password) are accepted by PUT and
 * never returned by GET.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { listSettings, updateSettings } from '@/lib/services/settings';
import { clientIp } from '@/lib/utils/request';
import { updateSettingsSchema } from '@/lib/validation/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireActiveSession();
  if (!can(session, 'settings:view', undefined)) throw forbidden();

  return ok({ data: await listSettings() });
});

export const PUT = handler(async (request) => {
  const session = await requireActiveSession();
  if (!can(session, 'settings:manage', undefined)) throw forbidden();

  const body = await parseJson(request, updateSettingsSchema);

  const changes = await updateSettings(body.settings, session, {
    ipAddress: clientIp(request),
  });

  return ok({ changed: changes, data: await listSettings() });
});
