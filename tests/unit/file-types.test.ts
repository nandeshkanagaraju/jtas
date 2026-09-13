import { describe, expect, it } from 'vitest';

import {
  ALLOWED_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  checkDeclaredFile,
  checkFileContents,
  extensionOf,
  formatBytes,
  kindFor,
  storageKeyFor,
} from '@/lib/domain/file-types';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => new TextEncoder().encode(text);

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37); // %PDF-1.7
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00); // MZ — a Windows executable

describe('the allow-list', () => {
  it('is exactly what SDD section 8 names', () => {
    expect([...ALLOWED_EXTENSIONS].sort()).toEqual(
      ['pdf', 'png', 'jpg', 'jpeg', 'dxf', 'dwg', 'step', 'stp', 'xlsx', 'docx'].sort(),
    );
  });

  it('caps uploads at 25 MB', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(26_214_400);
  });
});

describe('extensionOf', () => {
  it.each([
    ['drawing.pdf', 'pdf'],
    ['DRAWING.PDF', 'pdf'],
    ['part.v2.step', 'step'],
    ['noextension', ''],
    ['.hidden', 'hidden'],
  ])('%s -> %s', (name, expected) => {
    expect(extensionOf(name)).toBe(expected);
  });
});

describe('checkDeclaredFile', () => {
  it('accepts an ordinary drawing', () => {
    expect(
      checkDeclaredFile({
        fileName: 'SH-4410.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts a content type carrying a charset', () => {
    expect(
      checkDeclaredFile({
        fileName: 'part.step',
        contentType: 'text/plain; charset=utf-8',
        sizeBytes: 900,
      }).ok,
    ).toBe(true);
  });

  it('rejects an extension that is not on the list', () => {
    const result = checkDeclaredFile({
      fileName: 'payload.exe',
      contentType: 'application/octet-stream',
      sizeBytes: 1024,
    });

    expect(result).toMatchObject({ ok: false, reason: 'EXTENSION_NOT_ALLOWED' });
    expect(result.message).toContain('.exe');
  });

  it('rejects a file with no extension at all', () => {
    expect(
      checkDeclaredFile({ fileName: 'README', contentType: 'text/plain', sizeBytes: 10 }).reason,
    ).toBe('EXTENSION_NOT_ALLOWED');
  });

  it('rejects 30 MB, naming both sizes', () => {
    // The acceptance criterion, checked here and again server-side.
    const result = checkDeclaredFile({
      fileName: 'assembly.dwg',
      contentType: 'image/vnd.dwg',
      sizeBytes: 30 * 1024 * 1024,
    });

    expect(result).toMatchObject({ ok: false, reason: 'TOO_LARGE' });
    expect(result.message).toContain('30.0 MB');
    expect(result.message).toContain('25.0 MB');
  });

  it('accepts exactly 25 MB and rejects one byte more', () => {
    const at = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: MAX_ATTACHMENT_BYTES };

    expect(checkDeclaredFile(at).ok).toBe(true);
    expect(checkDeclaredFile({ ...at, sizeBytes: MAX_ATTACHMENT_BYTES + 1 }).ok).toBe(false);
  });

  it('rejects an empty file', () => {
    expect(
      checkDeclaredFile({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 0 }).reason,
    ).toBe('EMPTY');
  });

  it('rejects a declared type that does not match the extension', () => {
    const result = checkDeclaredFile({
      fileName: 'drawing.pdf',
      contentType: 'application/x-msdownload',
      sizeBytes: 2048,
    });

    expect(result).toMatchObject({ ok: false, reason: 'CONTENT_TYPE_MISMATCH' });
  });

  it('rejects an absurdly long name', () => {
    expect(
      checkDeclaredFile({
        fileName: `${'a'.repeat(300)}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 10,
      }).reason,
    ).toBe('NAME_TOO_LONG');
  });
});

describe('checkFileContents', () => {
  it('accepts a real PDF, PNG, JPEG and OOXML file', () => {
    expect(checkFileContents('a.pdf', PDF).ok).toBe(true);
    expect(checkFileContents('a.png', PNG).ok).toBe(true);
    expect(checkFileContents('a.jpg', JPEG).ok).toBe(true);
    expect(checkFileContents('a.jpeg', JPEG).ok).toBe(true);
    expect(checkFileContents('a.xlsx', ZIP).ok).toBe(true);
    expect(checkFileContents('a.docx', ZIP).ok).toBe(true);
  });

  it('rejects an .exe renamed to .pdf', () => {
    /*
     * The acceptance criterion, and the one the other two checks cannot make:
     * the extension is allowed and the declared type matches it. Both are lies.
     * Only the bytes disagree — MZ, not %PDF.
     */
    const result = checkFileContents('drawing.pdf', EXE);

    expect(result).toMatchObject({ ok: false, reason: 'CONTENT_DOES_NOT_MATCH_EXTENSION' });
    expect(result.message).toContain('renamed');
  });

  it('rejects a PNG renamed to .pdf, and a PDF renamed to .png', () => {
    expect(checkFileContents('a.pdf', PNG).ok).toBe(false);
    expect(checkFileContents('a.png', PDF).ok).toBe(false);
  });

  it('rejects an empty body', () => {
    expect(checkFileContents('a.pdf', bytes()).reason).toBe('EMPTY');
  });

  it('accepts a DWG by its AC version marker', () => {
    expect(checkFileContents('part.dwg', ascii('AC1027')).ok).toBe(true);
    expect(checkFileContents('part.dwg', EXE).ok).toBe(false);
  });

  it('accepts a STEP file by its ISO-10303 header', () => {
    const step = ascii("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('housing'),'2;1');");

    expect(checkFileContents('housing.step', step).ok).toBe(true);
    expect(checkFileContents('housing.stp', step).ok).toBe(true);
    // A text file that is not a STEP file.
    expect(checkFileContents('housing.step', ascii('hello world')).ok).toBe(false);
  });

  it('accepts a DXF by its SECTION marker', () => {
    expect(checkFileContents('part.dxf', ascii('  0\nSECTION\n  2\nHEADER\n')).ok).toBe(true);
    expect(checkFileContents('part.dxf', EXE).ok).toBe(false);
  });

  it('rejects a truncated signature rather than guessing', () => {
    // Two bytes of a PNG header is not a PNG.
    expect(checkFileContents('a.png', bytes(0x89, 0x50)).ok).toBe(false);
  });
});

describe('storageKeyFor', () => {
  it('is built from server-side ids only', () => {
    expect(
      storageKeyFor({
        jobId: 'job-1',
        subtaskId: 'sub-2',
        id: 'att-3',
        fileName: 'Customer Drawing.pdf',
      }),
    ).toBe('job-1/sub-2/att-3.pdf');
  });

  it('files a job-level attachment under `job`', () => {
    expect(storageKeyFor({ jobId: 'job-1', subtaskId: null, id: 'att-3', fileName: 'po.pdf' })).toBe(
      'job-1/job/att-3.pdf',
    );
  });

  it('ignores the path in a client-supplied name', () => {
    /*
     * The name is only ever read for its extension. A client that sends
     * "../../../etc/passwd.pdf" gets its own attachment id as the key, so there
     * is nothing to traverse and no other job's object to overwrite.
     */
    const key = storageKeyFor({
      jobId: 'job-1',
      subtaskId: 'sub-2',
      id: 'att-3',
      fileName: '../../../etc/passwd.pdf',
    });

    expect(key).toBe('job-1/sub-2/att-3.pdf');
    expect(key).not.toContain('..');
  });
});

describe('kindFor and formatBytes', () => {
  it('knows which types can be shown as a thumbnail', () => {
    expect(kindFor('png')?.previewable).toBe(true);
    expect(kindFor('jpg')?.previewable).toBe(true);
    expect(kindFor('pdf')?.previewable).toBeUndefined();
  });

  it('renders a size somebody can act on', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(26_214_400)).toBe('25.0 MB');
  });
});
