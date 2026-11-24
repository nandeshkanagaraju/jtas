// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  apiFetch,
  refreshSession: vi.fn(),
  ApiError: class extends Error {},
}));

import { openAttachment } from '@/components/collaboration/attachment-panel';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('downloads through the same-origin content route and saves the original filename', async () => {
  apiFetch.mockResolvedValue({
    url: 'https://bucket.example/signed',
    fileName: 'drawing.pdf',
    downloadInBrowser: true,
  });
  const blob = new Blob(['drawing']);
  const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
  const create = vi.fn().mockReturnValue('blob:drawing');
  const revoke = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  let savedName = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    savedName = this.download;
  });
  await openAttachment('attachment-1');
  expect(fetch).toHaveBeenCalledWith('/api/attachments/attachment-1/content', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  expect(savedName).toBe('drawing.pdf');
  expect(create).toHaveBeenCalledWith(blob);
  expect(document.querySelector('a')).toBeNull();
  vi.advanceTimersByTime(60_000);
  expect(revoke).toHaveBeenCalledWith('blob:drawing');
});

it('reports a failed signed download without saving an error page as a file', async () => {
  apiFetch.mockResolvedValue({
    url: 'https://bucket.example/expired',
    fileName: 'drawing.pdf',
    downloadInBrowser: true,
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  await expect(openAttachment('attachment-1')).rejects.toThrow('Could not download');
  expect(document.querySelector('a')).toBeNull();
});
