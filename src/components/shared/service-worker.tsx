'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (build spec M5.6).
 *
 * Only in production: in development the worker would cache the offline page
 * against a dev server that restarts constantly, and its lifecycle would fight
 * hot reload.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // An unavailable worker costs only the offline page; the app still runs.
      });
    };

    // After load, so registration never competes with the first paint.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
