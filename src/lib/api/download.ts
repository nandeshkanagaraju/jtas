'use client';

import { refreshSession } from '@/lib/api/client';

/**
 * Fetches a file from the API and saves it, refreshing an expired session once
 * on the way (a plain link would show the reader a 401 instead).
 */
export async function downloadFile(path: string): Promise<void> {
  let response = await fetch(path, { credentials: 'same-origin' });
  if (response.status === 401 && (await refreshSession()).ok) {
    response = await fetch(path, { credentials: 'same-origin' });
  }
  if (!response.ok) {
    let message = 'Could not download the file.';
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // Not JSON; keep the generic message.
    }
    throw new Error(message);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
