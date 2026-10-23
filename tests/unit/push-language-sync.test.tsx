// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushLanguageSync } from '@/components/shared/push-language-sync';
const apiFetch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/api/client', () => ({ apiFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  apiFetch.mockClear();
});

function browser(permission: string) {
  const getSubscription = vi
    .fn()
    .mockResolvedValue({ endpoint: 'https://fcm.googleapis.com/test' });
  const getRegistration = vi.fn().mockResolvedValue({ pushManager: { getSubscription } });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration },
  });
  return { getRegistration, getSubscription };
}

describe('push language synchronization', () => {
  it.each(['default', 'denied'])('does not query native push before consent (%s)', (permission) => {
    const { getRegistration, getSubscription } = browser(permission);
    render(<PushLanguageSync />);
    expect(getRegistration).not.toHaveBeenCalled();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it('updates a granted device through the ownership-scoped PATCH endpoint', async () => {
    browser('granted');
    render(<PushLanguageSync />);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/api/push/subscriptions', {
        method: 'PATCH',
        body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/test', locale: 'en' }),
      }),
    );
  });
});
