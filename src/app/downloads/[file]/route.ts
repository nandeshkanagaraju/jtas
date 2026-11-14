import { NextResponse } from 'next/server';

import { presignDownload } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public installers keep their stable address when the app moves off Caddy. */
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (file !== 'jaraa-android.apk' && file !== 'jaraa-android.apk.sha256') {
    return new NextResponse('Not found', { status: 404 });
  }
  const signed = await presignDownload({
    key: `releases/android/${file}`,
    fileName: file,
    contentType: file.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'text/plain',
  });
  const response = NextResponse.redirect(signed.url, 307);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
