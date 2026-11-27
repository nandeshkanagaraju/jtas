/**
 * GET /api/subtasks/:id/hourly-report?date=YYYY-MM-DD&format=xlsx|pdf — QA's
 * hourly inspection report for one day, as a filled-in file.
 *
 * The MD, the Deputy and the job managers (`shopReport:view`).
 */
import { z } from 'zod';

import { fileResponse, PDF_TYPE, XLSX_TYPE } from '@/lib/api/file-response';
import { handler, parseQuery } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { HOURLY_REPORT_DEPARTMENT_CODE } from '@/lib/domain/department-rules';
import { validationError } from '@/lib/errors';
import { hourlyReportWorkbook } from '@/lib/services/shop-reports/excel';
import { hourlyReport } from '@/lib/services/shop-reports/hourly-report';
import { hourlyReportPdf } from '@/lib/services/shop-reports/pdf';
import { getSubtask } from '@/lib/services/subtasks';
import { istDateKey } from '@/lib/utils/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date.')
    .optional(),
  format: z.enum(['xlsx', 'pdf']).default('pdf'),
});

export async function GET(request: Request, context: RouteContext) {
  return handler(async (req) => {
    const session = await requireActiveSession();
    assertCan(session, 'shopReport:view', undefined);
    const { id } = await context.params;

    const subtask = await getSubtask(session, id);
    if (subtask.department.code !== HOURLY_REPORT_DEPARTMENT_CODE) {
      throw validationError('Only QA tasks have an hourly report.');
    }

    const { date, format } = parseQuery(new URL(req.url), querySchema);
    const day = date ?? istDateKey(new Date());
    const report = await hourlyReport(id, day);
    const name = `QA-hourly-${report.job.jobCode}-${day}`;

    if (format === 'xlsx') {
      const body = await hourlyReportWorkbook(report).xlsx.writeBuffer();
      return fileResponse(new Uint8Array(body), `${name}.xlsx`, XLSX_TYPE);
    }
    return fileResponse(await hourlyReportPdf(report), `${name}.pdf`, PDF_TYPE);
  })(request);
}
