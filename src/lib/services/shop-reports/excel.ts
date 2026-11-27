/**
 * Excel files for the QA hourly report and the daily stock ledger.
 *
 * Numbers are numbers (so the reader can add them up); dates and times are
 * IST text, for the reason given in reports/excel.ts.
 */
import ExcelJS from 'exceljs';

import { formatIST, fromISTInput, IST_DATE_PATTERN } from '@/lib/utils/time';

import type { HourlyReport } from './hourly-report';
import type { StockLedger } from './stock-ledger';

const COMPANY = 'Jaraa Global Engineering Pvt Ltd';
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E293B' },
};
const TOTAL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

export const dayLabel = (key: string) => formatIST(fromISTInput(`${key}T00:00`), IST_DATE_PATTERN);

function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `JTAS — ${COMPANY}`;
  workbook.created = new Date(0);
  return workbook;
}

interface Col {
  header: string;
  width: number;
  numeric?: boolean;
}

/** Title lines, then a bordered table whose header row is frozen. */
function tableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  title: string[],
  columns: Col[],
  rows: Array<Array<string | number | null>>,
  total?: Array<string | number | null>,
  landscape = true,
): ExcelJS.Worksheet {
  const headerRow = title.length + 2;
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: headerRow }],
    pageSetup: {
      paperSize: 9,
      orientation: landscape ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.columns = columns.map((c) => ({ width: c.width }));

  title.forEach((line, index) => {
    const row = sheet.getRow(index + 1);
    row.getCell(1).value = line;
    row.getCell(1).font = index === 0 ? { bold: true, size: 14 } : { size: 10 };
    sheet.mergeCells(index + 1, 1, index + 1, columns.length);
  });

  const header = sheet.getRow(headerRow);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.border = THIN;
    cell.alignment = {
      vertical: 'middle',
      wrapText: true,
      horizontal: c.numeric ? 'right' : 'left',
    };
  });
  header.height = 30;

  const write = (values: Array<string | number | null>, bold = false) => {
    const row = sheet.addRow(values.map((v) => v ?? ''));
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      cell.border = THIN;
      if (columns[i - 1]?.numeric) cell.alignment = { horizontal: 'right' };
      if (bold) {
        cell.font = { bold: true };
        cell.fill = TOTAL_FILL;
      }
    });
  };
  rows.forEach((values) => write(values));
  if (total) write(total, true);
  return sheet;
}

const pct = (value: number | null) => (value === null ? '' : value);

export function hourlyReportWorkbook(report: HourlyReport): ExcelJS.Workbook {
  const workbook = newWorkbook();
  const { job } = report;
  tableSheet(
    workbook,
    'Hourly report',
    [
      `${COMPANY} — QA hourly inspection report`,
      `Date: ${dayLabel(report.date)}    Job: ${job.jobCode} · ${job.title}`,
      `Customer: ${job.customerName ?? '—'}    Part no: ${job.partNumber ?? '—'}    Drawing: ${job.drawingNumber ?? '—'}    Job qty: ${job.quantity ?? '—'}`,
      `Inspector: ${report.task.inspector}    Task: ${report.task.title}`,
    ],
    [
      { header: 'Sl.No', width: 7, numeric: true },
      { header: 'From', width: 9 },
      { header: 'To', width: 9 },
      { header: 'Inspected', width: 11, numeric: true },
      { header: 'Accepted', width: 11, numeric: true },
      { header: 'Rejected', width: 11, numeric: true },
      { header: 'Rejection %', width: 12, numeric: true },
      { header: 'Reason / note', width: 40 },
      { header: 'Sent by', width: 18 },
      { header: 'Sent at (IST)', width: 22 },
    ],
    report.rows.map((row, i) => [
      i + 1,
      row.from ?? '—',
      row.to ?? '—',
      row.inspected,
      row.accepted,
      row.rejected,
      pct(row.rejectionPct),
      row.note,
      row.recordedBy,
      formatIST(row.recordedAt),
    ]),
    [
      'Day total',
      '',
      '',
      report.day.inspected,
      report.day.accepted,
      report.day.rejected,
      pct(report.day.rejectionPct),
      `Job to date: inspected ${report.toDate.inspected}, accepted ${report.toDate.accepted}, rejected ${report.toDate.rejected}`,
      '',
      '',
    ],
  );
  return workbook;
}

export function stockWorkbook(ledger: StockLedger): ExcelJS.Workbook {
  const workbook = newWorkbook();
  const period =
    ledger.from === ledger.to
      ? dayLabel(ledger.from)
      : `${dayLabel(ledger.from)} to ${dayLabel(ledger.to)}`;
  const formula =
    'RM balance = opening RM + RM received (Store) − produced − rejected (Production).  FG balance = opening FG + produced − dispatched.';

  tableSheet(
    workbook,
    'Stock summary',
    [`${COMPANY} — Stock statement`, `Period: ${period}`, formula],
    [
      { header: 'Sl.No', width: 7, numeric: true },
      { header: 'Part number', width: 20 },
      { header: 'Part name', width: 30 },
      { header: 'Customer', width: 20 },
      { header: 'Opening RM', width: 12, numeric: true },
      { header: 'RM received (Store)', width: 12, numeric: true },
      { header: 'Produced', width: 12, numeric: true },
      { header: 'Rejected', width: 12, numeric: true },
      { header: 'RM balance', width: 12, numeric: true },
      { header: 'Opening FG', width: 12, numeric: true },
      { header: 'Dispatched', width: 12, numeric: true },
      { header: 'FG balance (made, not sent)', width: 16, numeric: true },
    ],
    ledger.parts.map((p, i) => [
      i + 1,
      p.partNumber ?? '—',
      p.partName,
      p.customer,
      p.opening.rm,
      p.rmReceived,
      p.produced,
      p.rejected,
      p.closing.rm,
      p.opening.fg,
      p.dispatched,
      p.closing.fg,
    ]),
    [
      'Total',
      '',
      '',
      '',
      ledger.totals.opening.rm,
      ledger.totals.rmReceived,
      ledger.totals.produced,
      ledger.totals.rejected,
      ledger.totals.closing.rm,
      ledger.totals.opening.fg,
      ledger.totals.dispatched,
      ledger.totals.closing.fg,
    ],
  );

  const daily = ledger.parts
    .flatMap((p) => p.days.map((d) => ({ p, d })))
    .sort((a, b) => a.d.date.localeCompare(b.d.date) || a.p.partName.localeCompare(b.p.partName));
  tableSheet(
    workbook,
    'Daily movement',
    [`${COMPANY} — Daily stock movement`, `Period: ${period}`, formula],
    [
      { header: 'Date', width: 14 },
      { header: 'Part number', width: 20 },
      { header: 'Part name', width: 30 },
      { header: 'RM received (Store)', width: 12, numeric: true },
      { header: 'Produced', width: 12, numeric: true },
      { header: 'Rejected', width: 12, numeric: true },
      { header: 'Dispatched', width: 12, numeric: true },
      { header: 'RM balance', width: 12, numeric: true },
      { header: 'FG balance', width: 12, numeric: true },
    ],
    daily.map(({ p, d }) => [
      dayLabel(d.date),
      p.partNumber ?? '—',
      p.partName,
      d.rmReceived,
      d.produced,
      d.rejected,
      d.dispatched,
      d.rmBalance,
      d.fgBalance,
    ]),
  );
  return workbook;
}
