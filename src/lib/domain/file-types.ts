/**
 * What may be uploaded, and how to tell (build spec M10.2).
 *
 * SDD section 8 item 6: "allow-list `pdf, png, jpg, jpeg, dxf, dwg, step, stp,
 * xlsx, docx`, 25 MB cap, content-type verified".
 *
 * Three checks, and they catch different things:
 *
 *   1. the extension is on the allow-list          — stops `.exe` outright
 *   2. the declared content type matches it        — stops a mislabelled upload
 *   3. the file's own first bytes match            — stops a renamed one
 *
 * The third is the only one that catches an `.exe` renamed to `.pdf`, which is
 * the acceptance criterion: the extension and the declared type agree with each
 * other and are both lies. Only the bytes disagree.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface FileKind {
  extension: string;
  /** Accepted content types. The first is canonical. */
  mimeTypes: readonly string[];
  label: string;
  /** True for types the UI can show a thumbnail of. */
  previewable?: boolean;
  /**
   * Leading bytes the file must start with, any one of them.
   *
   * Absent for formats with no reliable signature — DXF and STEP are plain
   * text, and a text file can legitimately begin with anything. Those are
   * checked by the first two rules and by a printable-text probe below.
   */
  magic?: readonly (readonly number[])[];
  /** For text-based formats: a string the first kilobyte must contain. */
  contains?: readonly string[];
}

const ZIP: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06], // empty archive
  [0x50, 0x4b, 0x07, 0x08], // spanned
];

export const FILE_KINDS: readonly FileKind[] = [
  {
    extension: 'pdf',
    mimeTypes: ['application/pdf'],
    label: 'PDF',
    magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  },
  {
    extension: 'png',
    mimeTypes: ['image/png'],
    label: 'PNG image',
    previewable: true,
    magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  {
    extension: 'jpg',
    mimeTypes: ['image/jpeg'],
    label: 'JPEG image',
    previewable: true,
    magic: [[0xff, 0xd8, 0xff]],
  },
  {
    extension: 'jpeg',
    mimeTypes: ['image/jpeg'],
    label: 'JPEG image',
    previewable: true,
    magic: [[0xff, 0xd8, 0xff]],
  },
  {
    extension: 'dxf',
    // AutoCAD exchange format. Browsers rarely know it, so the generic binary
    // type is accepted alongside the registered one.
    mimeTypes: ['image/vnd.dxf', 'application/dxf', 'application/octet-stream', 'text/plain'],
    label: 'DXF drawing',
    // ASCII DXF opens with a group code 0 then SECTION.
    contains: ['SECTION', 'HEADER'],
  },
  {
    extension: 'dwg',
    mimeTypes: ['image/vnd.dwg', 'application/acad', 'application/octet-stream'],
    label: 'DWG drawing',
    // "AC" plus a four-digit version — AC1027, AC1032 and so on.
    magic: [[0x41, 0x43, 0x31, 0x30]],
  },
  {
    extension: 'step',
    mimeTypes: ['application/step', 'model/step', 'application/octet-stream', 'text/plain'],
    label: 'STEP model',
    contains: ['ISO-10303'],
  },
  {
    extension: 'stp',
    mimeTypes: ['application/step', 'model/step', 'application/octet-stream', 'text/plain'],
    label: 'STEP model',
    contains: ['ISO-10303'],
  },
  {
    extension: 'xlsx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    label: 'Excel workbook',
    magic: ZIP, // OOXML is a zip
  },
  {
    extension: 'docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    label: 'Word document',
    magic: ZIP,
  },
] as const;

export const ALLOWED_EXTENSIONS = FILE_KINDS.map((kind) => kind.extension);

/** The `accept` attribute for a file input. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

/** The extension of a filename, lower-cased, without the dot. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function kindFor(extension: string): FileKind | undefined {
  return FILE_KINDS.find((kind) => kind.extension === extension.toLowerCase());
}

export type RejectionReason =
  | 'EXTENSION_NOT_ALLOWED'
  | 'CONTENT_TYPE_MISMATCH'
  | 'TOO_LARGE'
  | 'EMPTY'
  | 'CONTENT_DOES_NOT_MATCH_EXTENSION'
  | 'NAME_TOO_LONG';

export interface CheckResult {
  ok: boolean;
  reason?: RejectionReason;
  message?: string;
}

const OK: CheckResult = { ok: true };

/**
 * Checks what can be known before the bytes exist: the name, the declared type
 * and the declared size. Run on the client and again at presign time.
 */
export function checkDeclaredFile(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): CheckResult {
  if (input.fileName.length > 255) {
    return { ok: false, reason: 'NAME_TOO_LONG', message: 'That file name is too long.' };
  }

  const extension = extensionOf(input.fileName);
  const kind = kindFor(extension);

  if (!kind) {
    return {
      ok: false,
      reason: 'EXTENSION_NOT_ALLOWED',
      message: `${extension ? `.${extension}` : 'That file type'} cannot be uploaded. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    };
  }

  if (input.sizeBytes <= 0) {
    return { ok: false, reason: 'EMPTY', message: 'That file is empty.' };
  }

  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: 'TOO_LARGE',
      message: `That file is ${formatBytes(input.sizeBytes)}. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
    };
  }

  if (!kind.mimeTypes.includes(input.contentType.toLowerCase().split(';')[0].trim())) {
    return {
      ok: false,
      reason: 'CONTENT_TYPE_MISMATCH',
      message: `A .${extension} file should not be sent as ${input.contentType}.`,
    };
  }

  return OK;
}

/**
 * Checks the file's own first bytes against its extension.
 *
 * This is the one that catches a renamed executable: `virus.exe` copied to
 * `drawing.pdf` has an allowed extension and a plausible declared type, and
 * begins `MZ` instead of `%PDF`.
 *
 * Run after the upload, against bytes read back from the bucket — the object
 * goes straight to S3 through a presigned PUT, so this is the first moment the
 * server can see them.
 */
export function checkFileContents(fileName: string, head: Uint8Array): CheckResult {
  const extension = extensionOf(fileName);
  const kind = kindFor(extension);

  if (!kind) {
    return {
      ok: false,
      reason: 'EXTENSION_NOT_ALLOWED',
      message: 'That file type is not allowed.',
    };
  }

  if (head.length === 0) {
    return { ok: false, reason: 'EMPTY', message: 'That file is empty.' };
  }

  const mismatch: CheckResult = {
    ok: false,
    reason: 'CONTENT_DOES_NOT_MATCH_EXTENSION',
    message: `That file is not really a ${kind.label}. Check that it was not renamed.`,
  };

  if (kind.magic) {
    return kind.magic.some((signature) => startsWith(head, signature)) ? OK : mismatch;
  }

  if (kind.contains) {
    // Text formats: decode the head and look for the marker the format
    // guarantees. A STEP file always names ISO-10303 in its header.
    const text = new TextDecoder('latin1').decode(head.subarray(0, 2048));
    return kind.contains.some((needle) => text.includes(needle)) ? OK : mismatch;
  }

  return OK;
}

function startsWith(head: Uint8Array, signature: readonly number[]): boolean {
  if (head.length < signature.length) return false;
  return signature.every((byte, index) => head[index] === byte);
}

/** How many bytes are worth reading back to make the check. */
export const CONTENT_PROBE_BYTES = 4096;

/** "2.4 MB" — for a limit message somebody has to act on. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The storage key for an object.
 *
 * Built entirely server-side from ids the server already trusts, plus a cuid.
 * A client-supplied path would let somebody write `../../etc/passwd` or, more
 * plausibly, overwrite another job's drawing by guessing its key.
 */
export function storageKeyFor(input: {
  jobId: string;
  subtaskId: string | null;
  id: string;
  fileName: string;
}): string {
  const extension = extensionOf(input.fileName);
  return `${input.jobId}/${input.subtaskId ?? 'job'}/${input.id}.${extension}`;
}
