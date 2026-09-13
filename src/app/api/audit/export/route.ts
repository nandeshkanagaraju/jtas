/**
 * GET /api/audit/export — the audit log as CSV (build spec M9.4).
 *
 * Same filters as the viewer, so what is exported is what is on screen.
 */
import { NextResponse } from 'next/server';

import { handler } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { auditCsv } from '@/lib/services/audit-query';
import { istDateKey } from '@/lib/utils/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  if (!can(session, 'audit:view', undefined)) throw forbidden();

  const params = new URL(request.url).searchParams;

  const csv = await auditCsv({
    actorId: params.get('actorId') ?? undefined,
    entityType: params.get('entityType') ?? undefined,
    entityId: params.get('entityId') ?? undefined,
    action: params.get('action') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  });

  /*
   * The byte-order mark is what makes Excel on Windows read this as UTF-8.
   * Without it an em dash or a rupee sign in a problem description opens as
   * mojibake, and the export is the artefact somebody files.
   */
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="jtas-audit-${istDateKey(new Date())}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
