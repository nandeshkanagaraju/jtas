import { NextResponse } from 'next/server';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_TYPE = 'application/pdf';

/** A download: saved, not rendered, and never cached (it is a snapshot). */
export function fileResponse(body: Uint8Array, filename: string, contentType: string) {
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
