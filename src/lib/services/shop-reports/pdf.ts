/**
 * PDFs of the QA hourly report and the stock statement — the same tables as
 * the Excel files, laid out for printing on A4 landscape.
 *
 * pdfkit, like reports/pdf.ts, so no headless browser ships in the image.
 */
import PDFDocument from 'pdfkit';

import { formatIST } from '@/lib/utils/time';

import { dayLabel } from './excel';
import type { HourlyReport } from './hourly-report';
import type { StockLedger } from './stock-ledger';

const COMPANY = 'Jaraa Global Engineering Pvt Ltd';
const MARGIN = 32;
const INK = '#0f172a';
const MUTED = '#64748b';
const RULE = '#cbd5e1';
const BAND = '#e2e8f0';
const LATE = '#b91c1c';

type Cell = string | number | null;

interface Col {
  header: string;
  /** Share of the page width; the widths are scaled to fit. */
  weight: number;
  numeric?: boolean;
}

interface Section {
  title?: string;
  columns: Col[];
  rows: Cell[][];
  total?: Cell[];
  /** Column index drawn in red when its number is above zero. */
  alertColumn?: number;
}

interface Page {
  title: string;
  facts: string[];
  sections: Section[];
}

// The built-in Helvetica has no U+2212, so a minus sign is written as a hyphen.
const text = (value: Cell) =>
  value === null
    ? '—'
    : value === ''
      ? ''
      : typeof value === 'number'
        ? value.toLocaleString('en-IN')
        : value;

function render(page: Page, generatedAt: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGIN,
      autoFirstPage: false,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.info.Title = page.title;
    doc.info.Author = COMPANY;

    let pageNo = 0;
    const width = () => doc.page.width - MARGIN * 2;
    const bottom = () => doc.page.height - MARGIN - 20;

    const footer = () => {
      const y = doc.page.height - MARGIN - 10;
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(`Generated ${formatIST(generatedAt)} IST · JTAS`, MARGIN, y, {
          width: width(),
          lineBreak: false,
        })
        .text(`Page ${pageNo}`, MARGIN, y, { width: width(), align: 'right', lineBreak: false });
    };

    const newPage = () => {
      if (pageNo > 0) footer();
      doc.addPage();
      pageNo++;
      doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(COMPANY, MARGIN, MARGIN);
      doc.font('Helvetica-Bold').fontSize(11).text(page.title, MARGIN, MARGIN, {
        width: width(),
        align: 'right',
      });
      doc.y = MARGIN + 20;
      if (pageNo === 1) {
        doc.font('Helvetica').fontSize(9).fillColor(INK);
        for (const line of page.facts) doc.text(line, MARGIN, doc.y, { width: width() });
      }
      const y = doc.y + 4;
      doc
        .strokeColor(RULE)
        .lineWidth(0.5)
        .moveTo(MARGIN, y)
        .lineTo(MARGIN + width(), y)
        .stroke();
      doc.y = y + 8;
    };

    const drawSection = (section: Section) => {
      const scale = width() / section.columns.reduce((t, c) => t + c.weight, 0);
      const widths = section.columns.map((c) => c.weight * scale);
      const PAD = 3;

      const drawRow = (cells: Cell[], kind: 'header' | 'body' | 'total') => {
        const font = kind === 'body' ? 'Helvetica' : 'Helvetica-Bold';
        const size = kind === 'header' ? 7.5 : 8;
        doc.font(font).fontSize(size);
        const height =
          Math.max(
            ...cells.map((cell, i) =>
              doc.heightOfString(text(cell), { width: widths[i]! - PAD * 2 }),
            ),
            9,
          ) +
          PAD * 2;
        if (doc.y + height > bottom()) {
          newPage();
          if (kind !== 'header')
            drawRow(
              section.columns.map((c) => c.header),
              'header',
            );
        }
        const top = doc.y;
        if (kind !== 'body') {
          doc.rect(MARGIN, top, width(), height).fill(kind === 'header' ? '#1e293b' : BAND);
        }
        let x = MARGIN;
        cells.forEach((cell, i) => {
          const alert =
            kind === 'body' && section.alertColumn === i && typeof cell === 'number' && cell > 0;
          doc
            .font(alert ? 'Helvetica-Bold' : font)
            .fontSize(size)
            .fillColor(kind === 'header' ? '#ffffff' : alert ? LATE : INK)
            .text(text(cell), x + PAD, top + PAD, {
              width: widths[i]! - PAD * 2,
              align: section.columns[i]?.numeric ? 'right' : 'left',
            });
          x += widths[i]!;
        });
        doc.strokeColor(RULE).lineWidth(0.4).rect(MARGIN, top, width(), height).stroke();
        doc.y = top + height;
      };

      if (section.title) {
        if (doc.y + 40 > bottom()) newPage();
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(section.title, MARGIN, doc.y);
        doc.moveDown(0.3);
      }
      drawRow(
        section.columns.map((c) => c.header),
        'header',
      );
      if (section.rows.length === 0) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(8.5)
          .fillColor(MUTED)
          .text('Nothing recorded.', MARGIN + 3, doc.y + 4);
        doc.moveDown(0.5);
      }
      for (const row of section.rows) drawRow(row, 'body');
      if (section.total) drawRow(section.total, 'total');
    };

    newPage();
    for (const section of page.sections) drawSection(section);
    footer();
    doc.end();
  });
}

export function hourlyReportPdf(report: HourlyReport, generatedAt = new Date()): Promise<Buffer> {
  const { job } = report;
  return render(
    {
      title: 'QA hourly inspection report',
      facts: [
        `Date: ${dayLabel(report.date)}      Job: ${job.jobCode} · ${job.title}`,
        `Customer: ${job.customerName ?? '—'}      Part no: ${job.partNumber ?? '—'}      Drawing: ${job.drawingNumber ?? '—'}      Job qty: ${job.quantity ?? '—'}`,
        `Inspector: ${report.task.inspector}      Task: ${report.task.title}`,
        `Job to date — inspected ${report.toDate.inspected}, accepted ${report.toDate.accepted}, rejected ${report.toDate.rejected}`,
      ],
      sections: [
        {
          columns: [
            { header: 'Sl.No', weight: 5, numeric: true },
            { header: 'From', weight: 7 },
            { header: 'To', weight: 7 },
            { header: 'Inspected', weight: 9, numeric: true },
            { header: 'Accepted', weight: 9, numeric: true },
            { header: 'Rejected', weight: 9, numeric: true },
            { header: 'Rejection %', weight: 9, numeric: true },
            { header: 'Reason / note', weight: 30 },
            { header: 'Sent by', weight: 14 },
            { header: 'Sent at (IST)', weight: 16 },
          ],
          alertColumn: 5,
          rows: report.rows.map((row, i) => [
            i + 1,
            row.from,
            row.to,
            row.inspected,
            row.accepted,
            row.rejected,
            row.rejectionPct === null ? null : `${row.rejectionPct}%`,
            row.note,
            row.recordedBy,
            formatIST(row.recordedAt),
          ]),
          total: [
            'Total',
            '',
            '',
            report.day.inspected,
            report.day.accepted,
            report.day.rejected,
            report.day.rejectionPct === null ? '' : `${report.day.rejectionPct}%`,
            '',
            '',
            '',
          ],
        },
      ],
    },
    generatedAt,
  );
}

export function stockPdf(ledger: StockLedger, generatedAt = new Date()): Promise<Buffer> {
  const period =
    ledger.from === ledger.to
      ? dayLabel(ledger.from)
      : `${dayLabel(ledger.from)} to ${dayLabel(ledger.to)}`;
  const daily = ledger.parts
    .flatMap((p) => p.days.map((d) => ({ p, d })))
    .sort((a, b) => a.d.date.localeCompare(b.d.date) || a.p.partName.localeCompare(b.p.partName));

  return render(
    {
      title: 'Stock statement',
      facts: [
        `Period: ${period}`,
        'RM balance = opening RM + RM received (Store) - produced - rejected (Production).   FG balance = opening FG + produced - dispatched.',
      ],
      sections: [
        {
          title: 'Stock by part',
          columns: [
            { header: 'Sl.No', weight: 4, numeric: true },
            { header: 'Part number', weight: 12 },
            { header: 'Part name', weight: 16 },
            { header: 'Opening RM', weight: 8, numeric: true },
            { header: 'RM received (Store)', weight: 8, numeric: true },
            { header: 'Produced', weight: 8, numeric: true },
            { header: 'Rejected', weight: 8, numeric: true },
            { header: 'RM balance', weight: 8, numeric: true },
            { header: 'Opening FG', weight: 8, numeric: true },
            { header: 'Dispatched', weight: 8, numeric: true },
            { header: 'FG balance', weight: 8, numeric: true },
          ],
          rows: ledger.parts.map((p, i) => [
            i + 1,
            p.partNumber,
            p.partName,
            p.opening.rm,
            p.rmReceived,
            p.produced,
            p.rejected,
            p.closing.rm,
            p.opening.fg,
            p.dispatched,
            p.closing.fg,
          ]),
          total: [
            'Total',
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
        },
        {
          title: 'Daily movement',
          columns: [
            { header: 'Date', weight: 9 },
            { header: 'Part number', weight: 12 },
            { header: 'Part name', weight: 16 },
            { header: 'RM received (Store)', weight: 8, numeric: true },
            { header: 'Produced', weight: 8, numeric: true },
            { header: 'Rejected', weight: 8, numeric: true },
            { header: 'Dispatched', weight: 8, numeric: true },
            { header: 'RM balance', weight: 8, numeric: true },
            { header: 'FG balance', weight: 8, numeric: true },
          ],
          rows: daily.map(({ p, d }) => [
            dayLabel(d.date),
            p.partNumber,
            p.partName,
            d.rmReceived,
            d.produced,
            d.rejected,
            d.dispatched,
            d.rmBalance,
            d.fgBalance,
          ]),
        },
      ],
    },
    generatedAt,
  );
}
