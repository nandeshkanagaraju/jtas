'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, apiPost } from '@/lib/api/client';
import { endpointHash } from '@/lib/push/client';
import { useLanguage } from '@/lib/i18n/provider';

function publicKeyBytes(value: string) {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (letter) => letter.charCodeAt(0));
}

export function PushSettings() {
  const { locale, t } = useLanguage();
  const [state, setState] = useState('Checking notification support…');
  const [key, setKey] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState(
        'This browser does not support push. On iPhone, install Jaraa on the Home Screen and open it there.',
      );
      return;
    }
    void (async () => {
      try {
        const config = await apiFetch<{ publicKey: string | null; endpointHashes: string[] }>(
          '/api/push/subscriptions',
        );
        if (cancelled) return;
        setKey(config.publicKey);
        if (!config.publicKey) {
          setState('Push notifications are not configured yet.');
          return;
        }
        const registration = await navigator.serviceWorker.register('/sw.js');
        const existing =
          Notification.permission === 'granted'
            ? await registration.pushManager.getSubscription()
            : null;
        if (cancelled) return;
        // Enable always requires a click. Reading a granted browser permission
        // must not silently enroll a different account on a shared terminal.
        const saved =
          existing && config.endpointHashes.includes(await endpointHash(existing.endpoint));
        if (cancelled) return;
        setSubscription(saved ? existing : null);
        setState(
          saved && Notification.permission === 'granted'
            ? 'Enabled'
            : Notification.permission === 'denied'
              ? 'Notifications are blocked. Allow them in your browser or phone settings, then try again.'
              : 'Ready',
        );
      } catch {
        if (!cancelled) setState('Could not check notifications. Reload and try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state !== 'Enabled' || !subscription) return;
    void apiFetch('/api/push/subscriptions', {
      method: 'PATCH',
      body: JSON.stringify({ endpoint: subscription.endpoint, locale }),
    }).catch(() => {
      setMessage('Could not save notification language. Try enabling notifications again.');
    });
  }, [locale, state, subscription]);

  async function enable() {
    if (!key) return;
    setBusy(true);
    setMessage('');
    try {
      // The permission request stays directly in this click, required by Safari.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
        throw new Error(t('Allow notifications in your browser settings to continue.'));
      await navigator.serviceWorker.register('/sw.js');
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      const next =
        current ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKeyBytes(key),
        }));
      await apiPost('/api/push/subscriptions', { ...next.toJSON(), locale });
      setSubscription(next);
      setState('Enabled');
      setMessage('Notifications enabled on this device.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not enable notifications. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    if (!subscription) return;
    setBusy(true);
    setMessage('');
    try {
      // Remove the server subscription before unsubscribing so an API failure
      // can be retried without losing the endpoint needed to delete it.
      await apiFetch('/api/push/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      setSubscription(null);
      setState('Ready');
      setMessage('Notifications are off on this device.');
    } catch {
      setMessage('Could not disable notifications. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function test(delaySeconds = 0) {
    if (!subscription) return;
    setBusy(true);
    setMessage('');
    try {
      // Also saves a language change for this device.
      await apiPost('/api/push/subscriptions', { ...subscription.toJSON(), locale });
      setMessage(
        delaySeconds
          ? 'Test started. Go to your phone’s home screen now. An alert will be sent in 15 seconds.'
          : 'Working…',
      );
      await apiPost('/api/push/test', { endpoint: subscription.endpoint, delaySeconds });
      setMessage(
        'Test sent. Open your phone’s notification panel. If it does not appear, check notification permissions and Do Not Disturb.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send the test. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const enabled = state === 'Enabled' && Boolean(subscription);
  return (
    <section id="push" className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="bg-primary/10 text-action flex size-10 shrink-0 items-center justify-center rounded-xl">
          {enabled ? (
            <BellRing className="size-5" aria-hidden />
          ) : (
            <Bell className="size-5" aria-hidden />
          )}
        </span>
        <p className="font-medium">
          {t(enabled ? 'Jaraa alerts are on' : 'Stay updated with Jaraa')}
        </p>
      </div>
      <p className="text-muted-foreground text-sm">
        {t(
          'Get task assignments, handoffs, reminders and problem alerts even when Jaraa is closed. Enable separately on each device. Email and Telegram continue.',
        )}
      </p>
      <p className="text-sm" role="status">
        {t(
          state === 'Enabled'
            ? 'Notifications enabled on this device.'
            : state === 'Ready'
              ? 'Notifications are off on this device.'
              : state,
        )}
      </p>
      <details className="text-muted-foreground rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">{t('Why does Chrome appear?')}</summary>
        <p className="mt-3">
          {t(
            'Your browser delivers Jaraa alerts, so your phone may show Chrome or another browser name. The alert itself shows Jaraa. For the app experience, install Jaraa and open it from your home screen.',
          )}
        </p>
        <Link
          className="text-action mt-3 inline-flex min-h-11 items-center underline"
          href="/account#install"
        >
          {t('Jaraa installation help')}
        </Link>
      </details>
      {key && (state === 'Ready' || state === 'Enabled') ? (
        <div className="flex flex-wrap gap-2">
          {!enabled ? (
            <Button disabled={busy} onClick={enable}>
              <Bell className="size-4" aria-hidden />
              {t(busy ? 'Working…' : 'Enable notifications')}
            </Button>
          ) : null}
          {subscription ? (
            <>
              <Button disabled={busy} variant="outline" onClick={() => test()}>
                {t('Send test notification')}
              </Button>
              <Button disabled={busy} variant="outline" onClick={() => test(15)}>
                {t('Test with app closed')}
              </Button>
              <Button disabled={busy} variant="ghost" onClick={disable}>
                {t('Disable notifications')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {t(message)}
        </p>
      ) : null}
    </section>
  );
}
