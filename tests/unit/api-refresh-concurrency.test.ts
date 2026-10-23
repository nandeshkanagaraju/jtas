import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
afterEach(() => vi.unstubAllGlobals());
describe('concurrent polling after access-token expiry', () => {
  it('shares one refresh request and retries both reads', async () => {
    let ready = false;
    let complete!: () => void;
    const refreshed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') {
        await refreshed;
        ready = true;
        return new Response(null, { status: 204 });
      }
      if (!ready)
        return Response.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } },
          { status: 401 },
        );
      return Response.json({ url });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = Promise.all([apiFetch('/api/live-jobs'), apiFetch('/api/live-jobs/job')]);
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1),
    );
    complete();
    await expect(result).resolves.toEqual([
      { url: '/api/live-jobs' },
      { url: '/api/live-jobs/job' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
