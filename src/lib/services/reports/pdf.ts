/**
 * The single-job PDF report (build spec M8.4).
 *
 * Built with pdfkit rather than a headless browser: this runs in the same
 * container as the app, and shipping Chromium to render one A4 page of tables
 * would multiply the image size for no gain.
 *
 * Every timestamp on the page is IST and says so, including the footer — a
 * report printed and filed is read months later by someone who cannot ask which
 * timezone it was generated in.
 */
import PDFDocument from 'pdfkit';

import { formatElapsed } from '@/lib/utils/duration';
import { formatIST } from '@/lib/utils/time';

import type { JobReport, ProblemRow, SubtaskRow } from './queries';

const COMPANY = 'Jaraa Global Engineering Pvt Ltd';
const SYSTEM = 'JTAS — Jaraa Task & Accountability System';

const MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4 portrait, points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** Room reserved at the foot of every page for the generation stamp. */
const FOOTER_HEIGHT = 14;

const INK = '#0f172a';
const MUTED = '#64748b';
const RULE = '#cbd5e1';
const LATE = '#b91c1c';

type Doc = PDFKit.PDFDocument;

interface ColumnSpec<T> {
  header: string;
  width: number;
  value: (row: T) => string;
  align?: 'left' | 'right';
  /** Renders this cell in red — used for delay, which is the point of the page. */
  emphasise?: (row: T) => boolean;
}

const ist = (date: Date | null): string => (date ? formatIST(date) : '—');

const SUBTASK_COLUMNS: ColumnSpec<SubtaskRow>[] = [
  { header: 'Department', width: 76, value: (r) => r.department },
  { header: 'Subtask', width: 150, value: (r) => r.title },
  { header: 'Assignee', width: 78, value: (r) => r.assignee },
  { header: 'Planned', width: 84, value: (r) => ist(r.plannedDeadline) },
  { header: 'Actual', width: 84, value: (r) => ist(r.actualCompletion) },
  {
    header: 'Delay',
    width: 90,
    align: 'right',
    value: (r) => (r.actualCompletion ? formatElapsed(r.delayHours * 60) : '—'),
    emphasise: (r) => r.delayHours > 0,
  },
];

/** Draws the letterhead. Called once per page. */
function header(doc: Doc, jobCode: string): void {
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(COMPANY, MARGIN, MARGIN, { width: CONTENT_WIDTH });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${SYSTEM}  ·  Job report`, MARGIN, MARGIN + 18);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(INK)
    .text(jobCode, MARGIN, MARGIN + 14, { width: CONTENT_WIDTH, align: 'right' });

  rule(doc, MARGIN + 38);
  doc.y = MARGIN + 50;
}

/**
 * Draws the generation stamp at the foot of every page.
 *
 * Sits *inside* the bottom margin, not below it: pdfkit treats the margin as
 * the edge of the flow area, and text placed past it is reflowed to the top of
 * the page rather than clipped — which silently printed the footer behind the
 * letterhead. `lineBreak: false` stops the two halves wrapping into each other.
 */
function footer(doc: Doc, generatedAt: Date, page: number): void {
  const y = doc.page.height - MARGIN - FOOTER_HEIGHT;

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(`Generated ${formatIST(generatedAt)} IST`, MARGIN, y, {
      width: CONTENT_WIDTH,
      lineBreak: false,
    })
    .text(`Page ${page}`, MARGIN, y, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });
}

function rule(doc: Doc, y: number): void {
  doc
    .strokeColor(RULE)
    .lineWidth(0.5)
    .moveTo(MARGIN, y)
    .lineTo(PAGE_WIDTH - MARGIN, y)
    .stroke();
}

function sectionTitle(doc: Doc, text: string): void {
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(text, MARGIN, doc.y);
  doc.moveDown(0.3);
}

/** The job's identifying facts, two per line. */
function facts(doc: Doc, report: JobReport): void {
  const rows: Array<[string, string]> = [
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
    ['Completed', ist(report.job.completedAt)],
  ];

  doc.fontSize(9);

  const LABEL_WIDTH = 110;

  for (const [label, value] of rows) {
    /*
     * Two calls pinned to the same `top`, not one `continued: true` pair.
     * `continued` resumes immediately where the previous run ended and ignores
     * the width it was given, which ran every label into its value —
     * "TitleBearing carrier ring".
     */
    const top = doc.y;
    const height = Math.max(
      doc.font('Helvetica-Bold').heightOfString(value, { width: CONTENT_WIDTH - LABEL_WIDTH }),
      11,
    );

    doc.font('Helvetica').fillColor(MUTED).text(label, MARGIN, top, { width: LABEL_WIDTH });
    doc
      .font('Helvetica-Bold')
      .fillColor(INK)
      .text(value, MARGIN + LABEL_WIDTH, top, { width: CONTENT_WIDTH - LABEL_WIDTH });

    doc.y = top + height + 2;
  }
}

/**
 * Draws a table, breaking pages as it goes.
 *
 * Returns the page number it finished on, so the caller can keep numbering.
 */
function table<T>(
  doc: Doc,
  columns: ColumnSpec<T>[],
  rows: readonly T[],
  state: { page: number; jobCode: string; generatedAt: Date },
): void {
  const bottom = doc.page.height - MARGIN - FOOTER_HEIGHT - 8;

  const drawHeader = () => {
    let x = MARGIN;
    // Captured once: every `text()` call advances `doc.y`, so reading it inside
    // the loop stepped each heading a line lower than the last.
    const top = doc.y;

    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);

    for (const column of columns) {
      doc.text(column.header.toUpperCase(), x, top, {
        width: column.width,
        align: column.align ?? 'left',
        lineBreak: false,
      });
      x += column.width;
    }

    doc.y = top + 12;
    rule(doc, doc.y);
    doc.moveDown(0.3);
  };

  drawHeader();

  for (const row of rows) {
    const heights = columns.map((column) =>
      doc
        .font('Helvetica')
        .fontSize(8)
        .heightOfString(column.value(row), { width: column.width - 6 }),
    );
    const rowHeight = Math.max(...heights, 11);

    if (doc.y + rowHeight > bottom) {
      footer(doc, state.generatedAt, state.page);
      doc.addPage();
      state.page++;
      header(doc, state.jobCode);
      drawHeader();
    }

    const top = doc.y;
    let x = MARGIN;

    for (const column of columns) {
      const red = column.emphasise?.(row) ?? false;
      doc
        .font(red ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .fillColor(red ? LATE : INK)
        .text(column.value(row), x, top, {
          width: column.width - 6,
          align: column.align ?? 'left',
        });
      x += column.width;
    }

    doc.y = top + rowHeight + 4;
  }
}

/** Problems and what was decided about each. */
function problems(doc: Doc, rows: readonly ProblemRow[]): void {
  if (rows.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(MUTED)
      .text('No problems were raised.', MARGIN);
    return;
  }

  for (const problem of rows) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(problem.severity === 'BLOCKER' || problem.severity === 'HIGH' ? LATE : INK)
      .text(`${problem.severity} · ${problem.status}`, MARGIN, doc.y, { width: CONTENT_WIDTH });

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${problem.department} · ${problem.subtaskTitle} · raised by ${problem.raisedBy}, ${ist(problem.raisedAt)}`,
        { width: CONTENT_WIDTH },
      );

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(INK)
      .text(problem.description, { width: CONTENT_WIDTH });

    if (problem.resolution) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor(INK)
        .text(`Resolution (${ist(problem.resolvedAt)}): ${problem.resolution}`, {
          width: CONTENT_WIDTH,
        });
    }

    doc.moveDown(0.6);
  }
}

/**
 * Renders the report and resolves with the finished PDF.
 *
 * Buffered rather than piped straight to the response: pdfkit writes its
 * cross-reference table at the end, so a failure halfway through a streamed
 * document would leave the reader with a file that opens to an error. One A4
 * report is small enough that holding it in memory costs nothing.
 */
export function jobReportPdf(report: JobReport, generatedAt: Date = new Date()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.info.Title = `${report.job.jobCode} — job report`;
    doc.info.Author = COMPANY;

    const state = { page: 1, jobCode: report.job.jobCode, generatedAt };

    doc.addPage();
    header(doc, report.job.jobCode);

    facts(doc, report);

    sectionTitle(doc, `Subtask chain (${report.subtasks.length})`);
    table(doc, SUBTASK_COLUMNS, report.subtasks, state);

    sectionTitle(doc, `Problems (${report.problems.length})`);
    problems(doc, report.problems);

    footer(doc, generatedAt, state.page);
    doc.end();
  });
}
