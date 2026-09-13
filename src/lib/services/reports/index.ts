/**
 * Report exports (build spec M8.5).
 *
 * One entry point so the route handler stays a router: it authenticates,
 * validates, calls `buildExport` and streams the result.
 */
import { validationError } from '@/lib/errors';
import { istDateKey } from '@/lib/utils/time';

import type { DateRange } from '../analytics/range';
import { jobReportWorkbook, jobsWorkbook, problemsWorkbook, subtasksWorkbook } from './excel';
import { jobReportPdf } from './pdf';
import { jobReport, jobRows, problemRows, subtaskRows, type ReportFilters } from './queries';

export const EXPORT_TYPES = ['jobs', 'subtasks', 'problems', 'job-report'] as const;
export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const;

export type ExportType = (typeof EXPORT_TYPES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ExportResult {
  body: Buffer;
  filename: string;
  contentType: string;
}

export function isExportType(value: string | null): value is ExportType {
  return (EXPORT_TYPES as readonly string[]).includes(value ?? '');
}

export function isExportFormat(value: string | null): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value ?? '');
}

export interface ExportRequest {
  type: ExportType;
  format: ExportFormat;
  range: DateRange;
  filters?: ReportFilters;
  now?: Date;
}

/**
 * Builds one export.
 *
 * PDF is offered for a single job only. A PDF of two thousand subtask rows is
 * not a document anybody reads — that is what the spreadsheet is for — and
 * generating one would be the slowest thing in the application.
 */
export async function buildExport(request: ExportRequest): Promise<ExportResult> {
  const { type, format, range, filters = {} } = request;
  const generatedAt = request.now ?? new Date();
  const stamp = istDateKey(generatedAt);

  if (type === 'job-report') {
    if (!filters.jobId) {
      throw validationError('A job report needs a job.', {
        fields: { jobId: ['Choose which job to export.'] },
      });
    }

    const report = await jobReport(filters.jobId);
    const base = `${report.job.jobCode}-report`;

    return format === 'pdf'
      ? {
          body: await jobReportPdf(report, generatedAt),
          filename: `${base}.pdf`,
          contentType: 'application/pdf',
        }
      : {
          body: await toBuffer(jobReportWorkbook(report)),
          filename: `${base}.xlsx`,
          contentType: XLSX_MIME,
        };
  }

  if (format === 'pdf') {
    throw validationError('PDF is available for a single job report only.', {
      fields: { format: ['Choose xlsx for a list, or export a job report as PDF.'] },
    });
  }

  const workbook = await listWorkbook(type, range, filters);

  return {
    body: await toBuffer(workbook),
    filename: `jtas-${type}-${stamp}.xlsx`,
    contentType: XLSX_MIME,
  };
}

async function listWorkbook(
  type: Exclude<ExportType, 'job-report'>,
  range: DateRange,
  filters: ReportFilters,
) {
  switch (type) {
    case 'jobs':
      return jobsWorkbook(await jobRows(range, filters));
    case 'subtasks':
      return subtasksWorkbook(await subtaskRows(range, filters));
    case 'problems':
      return problemsWorkbook(await problemRows(range, filters));
  }
}

/** exceljs returns its own Buffer-alike, which Node has to be told about. */
async function toBuffer(workbook: {
  xlsx: { writeBuffer: () => Promise<unknown> };
}): Promise<Buffer> {
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

export { jobReport, jobRows, problemRows, subtaskRows, EXPORT_ROW_LIMIT } from './queries';
export type { JobReport, JobRow, ProblemRow, ReportFilters, SubtaskRow } from './queries';
export { jobReportPdf } from './pdf';
export { jobReportWorkbook, jobsWorkbook, problemsWorkbook, subtasksWorkbook } from './excel';
