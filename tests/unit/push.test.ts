import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { isPushEndpoint, subscriptionSchema } from '@/lib/push/validation';
import { pushMessage } from '@/lib/push/messages';

describe('push subscription destinations', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/key',
    'https://updates.push.services.mozilla.com/wpush/v2/key',
    'https://web.push.apple.com/key',
    'https://wns2-db5p.notify.windows.com/w/?token=x',
  ])('accepts browser service %s', (url) => expect(isPushEndpoint(url)).toBe(true));
  it.each([
    'http://fcm.googleapis.com/key',
    'https://127.0.0.1/key',
    'https://169.254.169.254/latest/meta-data',
    'https://web.push.apple.com.evil.example/key',
    'https://evil.push.apple.com@localhost/key',
    'https://fcm.googleapis.com:8443/key',
    'https://example.com/key',
  ])('rejects unsafe endpoint %s', (url) => expect(isPushEndpoint(url)).toBe(false));
  it('validates encryption key sizes and language', () => {
    const input = {
      endpoint: 'https://fcm.googleapis.com/key',
      keys: {
        p256dh: Buffer.alloc(65, 1).toString('base64url'),
        auth: Buffer.alloc(16, 1).toString('base64url'),
      },
      locale: 'ta',
    };
    expect(subscriptionSchema.safeParse(input).success).toBe(true);
    expect(
      subscriptionSchema.safeParse({ ...input, keys: { ...input.keys, auth: 'short' } }).success,
    ).toBe(false);
    expect(subscriptionSchema.safeParse({ ...input, locale: 'xx' }).success).toBe(false);
  });
});

describe('push previews', () => {
  it('provides Tamil and Hindi workflow messages', () => {
    expect(pushMessage({ type: 'COMMITMENT_OPEN' }, 'ta').title).toContain('24 மணி');
    expect(pushMessage({ type: 'COMMITMENT_OPEN' }, 'hi').title).toContain('24 घंटे');
  });
  it('uses a useful fallback for future event types', () =>
    expect(pushMessage({ type: 'FUTURE_EVENT' }, 'en').title).toContain('Work update'));
});

describe('service worker push handling', () => {
  function worker() {
    const listeners: Record<string, (event: unknown) => void> = {};
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      URL,
      Response,
      self: {
        location: { origin: 'https://jaraa.test' },
        registration: { showNotification },
        clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow },
        addEventListener: (type: string, fn: (event: unknown) => void) => {
          listeners[type] = fn;
        },
      },
    });
    return { listeners, showNotification, openWindow };
  }
  it('shows a visible fallback for malformed data', async () => {
    const { listeners, showNotification } = worker();
    let done: Promise<unknown> = Promise.resolve();
    listeners.push({
      data: {
        json: () => {
          throw new Error('invalid');
        },
      },
      waitUntil: (p: Promise<unknown>) => {
        done = p;
      },
    });
    await done;
    expect(showNotification).toHaveBeenCalledWith(
      'Jaraa',
      expect.objectContaining({ data: { url: 'https://jaraa.test/notifications' } }),
    );
  });
  it('refuses cross-origin notification clicks', () => {
    const { listeners, openWindow } = worker();
    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url: 'https://evil.example' } },
      waitUntil: vi.fn(),
    });
    expect(openWindow).not.toHaveBeenCalled();
  });
  it('opens a task in the app', async () => {
    const { listeners, openWindow } = worker();
    let done: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url: '/tasks/task-1' } },
      waitUntil: (p: Promise<unknown>) => {
        done = p;
      },
    });
    await done;
    expect(openWindow).toHaveBeenCalledWith('https://jaraa.test/tasks/task-1');
  });
});
