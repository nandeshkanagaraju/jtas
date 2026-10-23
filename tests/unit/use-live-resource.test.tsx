// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiFetch: read,
}));
import { ApiError } from '@/lib/api/client';
import { useLiveResource } from '@/lib/client/use-live-resource';
beforeEach(() => {
  vi.useFakeTimers();
  read.mockReset();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
describe('live read lifecycle', () => {
  it('polls while visible, pauses hidden tabs and cleans up on unmount', async () => {
    read.mockResolvedValue({ value: 1 });
    const hook = renderHook(() => useLiveResource('/live'));
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(read).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(read).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
    hook.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('keeps the last snapshot on network failure but clears it on revoked access', async () => {
    read.mockResolvedValueOnce({ value: 1 });
    const { result } = renderHook(() => useLiveResource('/live'));
    await flush();
    read.mockRejectedValueOnce(new TypeError('offline'));
    act(() => result.current.refresh());
    await flush();
    expect(result.current.data).toEqual({ value: 1 });
    expect(result.current.error).toBe(true);
    read.mockRejectedValueOnce(new ApiError(404, { code: 'NOT_FOUND', message: 'Job not found' }));
    act(() => result.current.refresh());
    await flush();
    expect(result.current.data).toBeNull();
  });
  it('does not present another job or an older filter response as current', async () => {
    let finish!: (data: unknown) => void;
    read
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ value: 'second' });
    const { result, rerender } = renderHook(
      ({ url, identity }) => useLiveResource(url, null, identity),
      { initialProps: { url: '/first?all', identity: 'first' } },
    );
    rerender({ url: '/second?messages', identity: 'second' });
    await flush();
    expect(result.current.data).toEqual({ value: 'second' });
    await act(async () => finish({ value: 'first' }));
    expect(result.current.data).toEqual({ value: 'second' });
    expect(result.current.current).toBe(true);
  });
});
