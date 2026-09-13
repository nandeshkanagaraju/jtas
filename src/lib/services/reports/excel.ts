/**
 * Excel exports (build spec M8.4).
 *
 * Every timestamp is written as an IST string rather than a spreadsheet date.
 * Excel renders a date cell in the *reader's* locale and timezone, so a
 * deadline of 6 PM in Coimbatore opens as 12:30 PM for anyone whose machine is
 * on UTC — and a report about who missed a deadline cannot afford to be read an
 * hour differently by two people.
 */
import ExcelJS from 'exceljs';

import { formatIST } from '@/lib/utils/time';

import type { JobReport, JobRow, ProblemRow, SubtaskRow } from './queries';

/** Header fill — the same slate the app's headers use. */
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E293B' },
};

interface Column<T> {
  header: string;
  width: number;
  value: (row: T) => string | number | null;
}

const ist = (date: Date | null): string => (date ? formatIST(date) : '');

const JOB_COLUMNS: Column<JobRow>[] = [
  { header: 'Job code', width: 16, value: (r) => r.jobCode },
  { header: 'Title', width: 34, value: (r) => r.title },
  { header: 'Customer', width: 22, value: (r) => r.customerName ?? '' },
  { header: 'Part number', width: 18, value: (r) => r.partNumber ?? '' },
  { header: 'Priority', width: 12, value: (r) => r.priority },
  { header: 'Status', width: 14, value: (r) => r.status },
  { header: 'Overall deadline (IST)', width: 24, value: (r) => ist(r.overallDeadline) },
  { header: 'Published (IST)', width: 24, value: (r) => ist(r.publishedAt) },
  { header: 'Completed (IST)', width: 24, value: (r) => ist(r.completedAt) },
  { header: 'Subtasks', width: 11, value: (r) => r.subtaskCount },
  { header: 'Completed', width: 11, value: (r) => r.completedSubtasks },
  { header: 'Overdue', width: 10, value: (r) => r.overdueSubtasks },
];

const SUBTASK_COLUMNS: Column<SubtaskRow>[] = [
  { header: 'Job code', width: 16, value: (r) => r.jobCode },
  { header: 'Job', width: 30, value: (r) => r.jobTitle },
  { header: 'Department', width: 16, value: (r) => r.department },
  { header: 'Assignee', width: 20, value: (r) => r.assignee },
  { header: 'Subtask', width: 40, value: (r) => r.title },
  { header: 'Status', width: 18, value: (r) => r.status },
  { header: 'Planned (IST)', width: 24, value: (r) => ist(r.plannedDeadline) },
  { header: 'Actual (IST)', width: 24, value: (r) => ist(r.actualCompletion) },
  { header: 'Delay (hours)', width: 14, value: (r) => r.delayHours },
  { header: 'Extensions', width: 12, value: (r) => r.extensions },
  { header: 'Problems', width: 11, value: (r) => r.problems },
];

const PROBLEM_COLUMNS: Column<ProblemRow>[] = [
  { header: 'Job code', width: 16, value: (r) => r.jobCode },
  { header: 'Department', width: 16, value: (r) => r.department },
  { header: 'Subtask', width: 34, value: (r) => r.subtaskTitle },
  { header: 'Raised by', width: 20, value: (r) => r.raisedBy },
  { header: 'Severity', width: 12, value: (r) => r.severity },
  { header: 'Status', width: 14, value: (r) => r.status },
  { header: 'Raised (IST)', width: 24, value: (r) => ist(r.raisedAt) },
  { header: 'Resolved (IST)', width: 24, value: (r) => ist(r.resolvedAt) },
  { header: 'Description', width: 60, value: (r) => r.description },
  { header: 'Resolution', width: 60, value: (r) => r.resolution ?? '' },
];

/** Adds one sheet of rows with a frozen, styled header. */
function addSheet<T>(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Column<T>[],
  rows: readonly T[],
): void {
  const sheet = workbook.addWorksheet(name, {
    // Frozen so the header stays put through two thousand rows, and an
    // autofilter so the reader can narrow it without asking for a new export.
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width }));

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle' };
  header.height = 20;

  for (const row of rows) {
    sheet.addRow(columns.map((column) => column.value(row)));
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
}

function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JTAS — Jaraa Global Engineering Pvt Ltd';
  // Fixed rather than `new Date()` so the same data exports byte-identically,
  // which is what makes an export diffable.
  workbook.created = new Date(0);
  return workbook;
}

export function jobsWorkbook(rows: readonly JobRow[]): ExcelJS.Workbook {
  const workbook = newWorkbook();
  addSheet(workbook, 'Jobs', JOB_COLUMNS, rows);
  return workbook;
}

export function subtasksWorkbook(rows: readonly SubtaskRow[]): ExcelJS.Workbook {
  const workbook = newWorkbook();
  addSheet(workbook, 'Subtasks', SUBTASK_COLUMNS, rows);
  return workbook;
}

export function problemsWorkbook(rows: readonly ProblemRow[]): ExcelJS.Workbook {
  const workbook = newWorkbook();
  addSheet(workbook, 'Problems', PROBLEM_COLUMNS, rows);
  return workbook;
}

/** One job across three sheets: its details, its chain, and its problems. */
export function jobReportWorkbook(report: JobReport): ExcelJS.Workbook {
  const workbook = newWorkbook();
  const summary = workbook.addWorksheet('Job');

  summary.columns = [{ width: 24 }, { width: 60 }];

  const facts: Array<[string, string]> = [
    ['Job code', report.job.jobCode],
    ['Title', report.job.title],
    ['Customer', report.job.customerName ?? '—'],
    [
      'Part / drawing',
      [report.job.partNumber, report.job.drawingNumber].filter(Boolean).join(' / ') || '—',
    ],
    ['Quantity', report.job.quantity === null ? '—' : String(report.job.quantity)],
    ['Priority', report.job.priority],
    ['Status', report.job.status],
    ['Overall deadline', ist(report.job.overallDeadline)],
    ['Published', ist(report.job.publishedAt) || '—'],
    ['Completed', ist(report.job.completedAt) || '—'],
  ];

  for (const [label, value] of facts) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }

  addSheet(workbook, 'Subtasks', SUBTASK_COLUMNS, report.subtasks);
  addSheet(workbook, 'Problems', PROBLEM_COLUMNS, report.problems);

  return workbook;
}
