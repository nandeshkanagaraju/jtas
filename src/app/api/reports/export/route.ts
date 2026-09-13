/**
 * GET /api/reports/export — build spec M8.5.
 *
 * `?type=jobs|subtasks|problems|job-report&format=xlsx|pdf`, plus the same
 * `from`/`to` range as the dashboard and optional `status`, `departmentId` and
 * `jobId` filters.
 *
 * MD, Deputy MD and Admin only (SDD 6.2): an export is the whole dataset in a
 * file that leaves the building.
 */
import { NextResponse } from 'next/server';

import { handler } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { parseRange } from '@/lib/services/analytics';
import { buildExport, isExportFormat, isExportType } from '@/lib/services/reports';
import { forbidden, validationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  if (!can(session, 'report:export', undefined)) throw forbidden();

  const params = new URL(request.url).searchParams;

  const type = params.get('type');
  const format = params.get('format') ?? 'xlsx';

  if (!isExportType(type)) {
    throw validationError('Choose what to export.', {
      fields: { type: ['One of jobs, subtasks, problems or job-report.'] },
    });
  }

  if (!isExportFormat(format)) {
    throw validationError('Choose a file format.', {
      fields: { format: ['One of xlsx or pdf.'] },
    });
  }

  const { body, filename, contentType } = await buildExport({
    type,
    format,
    range: parseRange({ from: params.get('from'), to: params.get('to') }),
    filters: {
      status: params.get('status') ?? undefined,
      departmentId: params.get('departmentId') ?? undefined,
      jobId: params.get('jobId') ?? undefined,
    },
  });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      // `attachment` so the browser saves it rather than trying to render a
      // spreadsheet, and the filename carries the job code or the date.
      'Content-Disposition': `attachment; filename="${filename}"`,
      // An export is a snapshot of a moving dataset; a cached copy is a lie.
      'Cache-Control': 'no-store',
    },
  });
});
