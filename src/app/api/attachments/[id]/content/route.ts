/**
 * GET /api/attachments/:id/content — same-origin download.
 *
 * Streams the object through the app so the browser never fetches the bucket
 * cross-origin (see ../../upload/route.ts for why). Access rules match
 * GET /api/attachments/:id/url.
 */
import { NextResponse } from 'next/server';

import { handler } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden, notFound } from '@/lib/errors';
import { attachmentUrl, getAttachment } from '@/lib/services/attachment-service';
import { getJob } from '@/lib/services/jobs';
import { getSubtask } from '@/lib/services/subtasks';

import { subtaskViewResource } from '../../../subtasks/subtask-resource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handler(async () => {
    const session = await requireActiveSession();
    const { id } = await context.params;

    const attachment = await getAttachment(id);
    if (!attachment) throw notFound('Attachment');

    if (attachment.subtaskId) {
      const subtask = await getSubtask(session, attachment.subtaskId);
      assertCan(session, 'attachment:view', await subtaskViewResource(subtask));
    } else if (attachment.jobId) {
      await getJob(session, attachment.jobId);
    } else {
      throw forbidden();
    }

    const { url, fileName } = await attachmentUrl(id, { disposition: 'attachment' });
    const upstream = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    if (!upstream.ok || !upstream.body) throw notFound('Attachment');

    const headers = new Headers({
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const length = upstream.headers.get('content-length');
    if (length) headers.set('Content-Length', length);

    return new NextResponse(upstream.body, { status: 200, headers });
  })(request);
}
