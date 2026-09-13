/**
 * GET /api/dev/preview-email?type=OVERDUE_MD — build spec M7.5.
 *
 * Renders each template with realistic sample data so the wording and the
 * layout can be checked in a browser, and against Gmail and Outlook, without
 * having to provoke the real event.
 *
 * Development only. It returns 404 in production — not 403 — because the
 * existence of a developer endpoint is itself something a production server
 * should not confirm.
 */
import { NextResponse } from 'next/server';

import { renderTemplate, TEMPLATE_KINDS } from '@/lib/notifications/templates';
import { SAMPLES } from '@/lib/notifications/templates/samples';
import type { TemplateKind } from '@/lib/notifications/templates/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type') as TemplateKind | null;
  const format = url.searchParams.get('format');

  if (!type) {
    // No type given: an index, so the whole set can be walked in a browser.
    const links = TEMPLATE_KINDS.map(
      (kind) =>
        `<li style="margin:4px 0"><a href="/api/dev/preview-email?type=${kind}">${kind}</a>` +
        ` &nbsp;<a style="font-size:12px;color:#64748b" href="/api/dev/preview-email?type=${kind}&format=text">text</a></li>`,
    ).join('');

    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>JTAS email previews</title>` +
        `<body style="font-family:system-ui;padding:24px;max-width:640px">` +
        `<h1 style="font-size:18px">JTAS email previews</h1>` +
        `<p style="color:#64748b;font-size:14px">Development only. Each template with sample data.</p>` +
        `<ul style="padding-left:18px">${links}</ul></body>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  if (!TEMPLATE_KINDS.includes(type)) {
    return new NextResponse(`Unknown template "${type}".`, { status: 400 });
  }

  const rendered = await renderTemplate(SAMPLES[type]);

  if (format === 'text') {
    return new NextResponse(`Subject: ${rendered.subject}\n\n${rendered.text}`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // The subject is prepended so the preview shows what lands in the inbox list,
  // which is half of whether a mail gets opened at all.
  return new NextResponse(
    `<div style="font-family:system-ui;padding:12px 24px;background:#0f172a;color:#fff;font-size:13px">` +
      `<strong>Subject:</strong> ${rendered.subject}</div>${rendered.html}`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
