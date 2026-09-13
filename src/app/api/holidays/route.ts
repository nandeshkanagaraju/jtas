/**
 * GET/POST /api/holidays — build spec M9.3.
 *
 * Every signed-in user may read the calendar: a member deciding when to promise
 * a deadline needs to know the shop is shut. Only MD and ADMIN may change it.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { addHolidays, listHolidays, parseHolidayCsv } from '@/lib/services/holiday-service';
import { clientIp } from '@/lib/utils/request';
import { addHolidaysSchema } from '@/lib/validation/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  await requireActiveSession();

  const params = new URL(request.url).searchParams;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;

  return ok({ data: await listHolidays(from && to ? { from, to } : {}) });
});

export const POST = handler(async (request) => {
  const session = await requireActiveSession();
  if (!can(session, 'holiday:manage', undefined)) throw forbidden();

  const body = await parseJson(request, addHolidaysSchema);

  // Either a list of days or a pasted CSV — the annual calendar arrives as a
  // spreadsheet, and retyping thirty dates is how a calendar goes unmaintained.
  const input = body.csv ? parseHolidayCsv(body.csv) : (body.holidays ?? []);

  const result = await addHolidays(input, session, { ipAddress: clientIp(request) });

  return ok(result, { status: result.added.length > 0 ? 201 : 200 });
});
