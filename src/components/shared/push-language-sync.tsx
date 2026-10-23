'use client';
import { useEffect } from 'react';
import { useLanguage } from '@/lib/i18n/provider';
import { apiFetch } from '@/lib/api/client';

/** Updates only a device already enrolled in this session; never prompts/enrolls. */
export function PushLanguageSync() {
  const { locale } = useLanguage();
  useEffect(() => {
    let cancelled = false;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    )
      return;
    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription || cancelled) return;
      // PATCH cannot transfer ownership or create a subscription.
      await apiFetch('/api/push/subscriptions', {
        method: 'PATCH',
        body: JSON.stringify({ endpoint: subscription.endpoint, locale }),
      });
    })().catch(() => {
      /* Next visit retries; no permission is requested. */
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);
  return null;
}
