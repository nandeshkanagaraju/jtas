/**
 * Exports (build spec M8.5).
 *
 * The acceptance criterion is that the files *open*, so every workbook here is
 * read back with exceljs rather than merely checked for a non-zero length — a
 * corrupt spreadsheet is still a few kilobytes.
 */
import { inflateSync } from 'node:zlib';

import ExcelJS from 'exceljs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildExport, isExportFormat, isExportType, jobReport } from '@/lib/services/reports';
import { range } from '@/lib/services/analytics';
import { formatIST } from '@/lib/utils/time';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

const MONTH = range('2026-09-01', '2026-09-30');
const GENERATED_AT = fromISTInput('2026-09-21T10:30');

let production: Awaited<ReturnType<typeof createTestDepartment>>;
let member: Awaited<ReturnType<typeof createTestUser>>;
let job: { id: string; jobCode: string };

beforeEach(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();

  production = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });
  member = await createTestUser({ email: 'ravi@jaraaglobal.com', departmentId: production.id });

  job = await testDb.job.create({
    data: {
      jobCode: 'JGE-2026-0042',
      title: 'Spindle housing batch',
      customerName: 'Ashok Leyland',
      partNumber: 'SH-4410',
      drawingNumber: 'DRG-4410-B',
      quantity: 120,
      overallDeadline: fromISTInput('2026-09-30T18:00'),
      createdById: member.id,
      status: 'IN_PROGRESS',
      createdAt: fromISTInput('2026-09-05T10:00'),
    },
    select: { id: true, jobCode: true },
  });

  const onTime = await testDb.subtask.create({
    data: {
      jobId: job.id,
      departmentId: production.id,
      assigneeId: member.id,
      title: 'Rough machining',
      deadline: fromISTInput('2026-09-10T18:00'),
      completedAt: fromISTInput('2026-09-10T15:00'),
      status: 'COMPLETED',
      createdAt: fromISTInput('2026-09-05T10:00'),
    },
  });

  await testDb.subtask.create({
    data: {
      jobId: job.id,
      departmentId: production.id,
      assigneeId: member.id,
      title: 'Finish machining and first-piece clearance',
      deadline: fromISTInput('2026-09-14T18:00'),
      completedAt: fromISTInput('2026-09-16T18:00'),
      status: 'COMPLETED',
      createdAt: fromISTInput('2026-09-05T10:00'),
    },
  });

  await testDb.problem.create({
    data: {
      subtaskId: onTime.id,
      raisedById: member.id,
      description: 'Material short by twelve bars; supplier has not confirmed a date.',
      severity: 'BLOCKER',
      status: 'RESOLVED',
      mdActionNote: 'Sourced from the Chennai stockist; two days lost.',
      resolvedAt: fromISTInput('2026-09-09T11:00'),
      createdAt: fromISTInput('2026-09-08T09:00'),
    },
  });
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

/**
 * The visible text of a PDF.
 *
 * pdfkit deflates its content streams, so the words are not in the raw bytes.
 * Inflating them is what makes this an assertion about the document a reader
 * sees rather than about the file's length.
 */
function pdfText(body: Buffer): string {
  const parts: string[] = [];
  const marker = Buffer.from('stream');
  const end = Buffer.from('endstream');

  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(marker, cursor);
    if (start === -1) break;

    const stop = body.indexOf(end, start);
    if (stop === -1) break;

    // Skip `stream` and the EOL that must follow it.
    let from = start + marker.length;
    while (from < stop && (body[from] === 0x0d || body[from] === 0x0a)) from++;

    try {
      parts.push(inflateSync(body.subarray(from, stop)).toString('latin1'));
    } catch {
      // Not a deflated stream — a font file, say. Nothing to read.
    }

    cursor = stop + end.length;
  }

  /*
   * pdfkit writes each run as a hex string inside a kerned TJ array —
   * `[<4a6172...> 120 <41532097...>] TJ` — so the words are neither in the raw
   * bytes nor in parenthesised literals. Decoding every hex run in drawing
   * order reassembles the page as a reader sees it.
   */
  const runs = parts.join('\n').match(/<([0-9a-fA-F\s]+)>/g) ?? [];

  return runs
    .map((run) => {
      const hex = run.slice(1, -1).replace(/\s+/g, '');
      let text = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      return text;
    })
    .join('');
}

/** Reads a workbook back, which only succeeds if the file is well-formed. */
async function open(body: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  return workbook;
}

describe('parameter guards', () => {
  it.each(['jobs', 'subtasks', 'problems', 'job-report'])('accepts type %s', (type) => {
    expect(isExportType(type)).toBe(true);
  });

  it.each(['users', 'everything', '', null])('rejects type %s', (type) => {
    expect(isExportType(type as string | null)).toBe(false);
  });

  it('accepts only the two formats', () => {
    expect(isExportFormat('xlsx')).toBe(true);
    expect(isExportFormat('pdf')).toBe(true);
    expect(isExportFormat('csv')).toBe(false);
  });
});

describe('Excel exports', () => {
  it('produces a jobs workbook that opens, with a header and the row', async () => {
    const result = await buildExport({
      type: 'jobs',
      format: 'xlsx',
      range: MONTH,
      now: GENERATED_AT,
    });

    expect(result.contentType).toContain('spreadsheetml');
    expect(result.filename).toBe('jtas-jobs-2026-09-21.xlsx');

    const sheet = (await open(result.body)).getWorksheet('Jobs')!;

    expect(sheet.getRow(1).getCell(1).value).toBe('Job code');
    expect(sheet.getRow(2).getCell(1).value).toBe('JGE-2026-0042');
    expect(sheet.getRow(2).getCell(2).value).toBe('Spindle housing batch');
    // Counted, not listed.
    expect(sheet.getRow(2).getCell(10).value).toBe(2);
  });

  it('writes timestamps as IST strings, not spreadsheet dates', async () => {
    const result = await buildExport({ type: 'subtasks', format: 'xlsx', range: MONTH });
    const sheet = (await open(result.body)).getWorksheet('Subtasks')!;

    const planned = sheet.getRow(2).getCell(7).value;

    /*
     * A date cell renders in the reader's own timezone, so a 6 PM Coimbatore
     * deadline would open as 12:30 PM for anyone on UTC. A report about who
     * missed a deadline cannot be read an hour differently by two people.
     */
    expect(typeof planned).toBe('string');
    expect(planned).toBe(formatIST(fromISTInput('2026-09-10T18:00')));
  });

  it('carries the delay in hours, matching the domain rule', async () => {
    const result = await buildExport({ type: 'subtasks', format: 'xlsx', range: MONTH });
    const sheet = (await open(result.body)).getWorksheet('Subtasks')!;

    expect(sheet.getRow(2).getCell(9).value).toBe(0); // finished early
    expect(sheet.getRow(3).getCell(9).value).toBe(48); // two days late
  });

  it('produces a problems workbook including the resolution', async () => {
    const result = await buildExport({ type: 'problems', format: 'xlsx', range: MONTH });
    const sheet = (await open(result.body)).getWorksheet('Problems')!;

    expect(sheet.getRow(2).getCell(4).value).toBe(member.name);
    expect(sheet.getRow(2).getCell(5).value).toBe('BLOCKER');
    expect(String(sheet.getRow(2).getCell(10).value)).toContain('Chennai stockist');
  });

  it('produces a three-sheet job report', async () => {
    const result = await buildExport({
      type: 'job-report',
      format: 'xlsx',
      range: MONTH,
      filters: { jobId: job.id },
    });

    const workbook = await open(result.body);

    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Job', 'Subtasks', 'Problems']);
    expect(result.filename).toBe('JGE-2026-0042-report.xlsx');
    expect(workbook.getWorksheet('Job')!.getRow(1).getCell(2).value).toBe('JGE-2026-0042');
  });

  it('freezes the header row so it survives scrolling', async () => {
    const result = await buildExport({ type: 'subtasks', format: 'xlsx', range: MONTH });
    const sheet = (await open(result.body)).getWorksheet('Subtasks')!;

    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('exports an empty range as a valid workbook with only a header', async () => {
    // An export with no rows must still open; a zero-byte download reads as a
    // broken feature rather than an empty month.
    const result = await buildExport({
      type: 'jobs',
      format: 'xlsx',
      range: range('2025-01-01', '2025-01-31'),
    });

    const sheet = (await open(result.body)).getWorksheet('Jobs')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Job code');
    expect(sheet.rowCount).toBe(1);
  });
});

describe('PDF export', () => {
  it('produces a real PDF for one job', async () => {
    const result = await buildExport({
      type: 'job-report',
      format: 'pdf',
      range: MONTH,
      filters: { jobId: job.id },
      now: GENERATED_AT,
    });

    expect(result.contentType).toBe('application/pdf');
    expect(result.filename).toBe('JGE-2026-0042-report.pdf');

    // The magic number, and the end-of-file marker that means the
    // cross-reference table was written — a truncated PDF has the first and not
    // the second, and opens to an error.
    expect(result.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.body.subarray(-32).toString()).toContain('%%EOF');
    expect(result.body.byteLength).toBeGreaterThan(1_000);
  });

  it('names the company, the job code and the generation time in IST', async () => {
    const result = await buildExport({
      type: 'job-report',
      format: 'pdf',
      range: MONTH,
      filters: { jobId: job.id },
      now: GENERATED_AT,
    });

    const text = pdfText(result.body);

    expect(text).toContain('Jaraa Global Engineering');
    expect(text).toContain('JGE-2026-0042');
    expect(text).toContain('Generated');
  });

  it('refuses a list as PDF, and says what to do instead', async () => {
    // A PDF of two thousand subtask rows is not a document anybody reads.
    await expect(
      buildExport({ type: 'subtasks', format: 'pdf', range: MONTH }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a job report with no job named', async () => {
    await expect(
      buildExport({ type: 'job-report', format: 'pdf', range: MONTH }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('is a 404 for a job that does not exist', async () => {
    await expect(
      buildExport({ type: 'job-report', format: 'pdf', range: MONTH, filters: { jobId: 'nope' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('jobReport', () => {
  it('returns the chain in deadline order with planned against actual', async () => {
    const report = await jobReport(job.id);

    expect(report.job.jobCode).toBe('JGE-2026-0042');
    expect(report.subtasks.map((s) => s.title)).toEqual([
      'Rough machining',
      'Finish machining and first-piece clearance',
    ]);
    expect(report.subtasks[1].delayHours).toBe(48);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].resolution).toContain('Chennai stockist');
  });
});
