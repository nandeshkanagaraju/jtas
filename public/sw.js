/*
 * JTAS service worker — build spec M5.6.
 *
 * Scope is deliberately narrow. It exists to make the app installable and to
 * show a readable page when a navigation fails with no network. It does NOT
 * cache API responses and does NOT queue writes:
 *
 *  - A cached task list is a lie about what is due, and this product's whole
 *    value is that the status on screen is true.
 *  - A queued "completed" tap that syncs an hour later would tell the member
 *    their work was recorded when the MD had not been told.
 *
 * Offline writes are explicitly out of scope in the build spec, and this is why.
 */

const VERSION = 'jtas-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only page navigations. Everything else — API calls, assets — goes straight
  // to the network so nothing is ever served stale.
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(VERSION);
      return (await cache.match(OFFLINE_URL)) ?? Response.error();
    }),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    /* Show a useful fallback. */
  }
  const destination = new URL(data.url || '/notifications', self.location.origin);
  const url = destination.origin === self.location.origin ? destination.href : '/notifications';
  event.waitUntil(
    self.registration.showNotification(data.title || 'Jaraa', {
      body: data.body || 'Open Jaraa to view your work update.',
      icon: '/icons/icon-192.png',
      badge: '/icons/notification-badge.png',
      lang: ['en', 'ta', 'hi'].includes(data.lang) ? data.lang : 'en',
      dir: 'ltr',
      tag: data.tag || 'jaraa-update',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/notifications', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'navigate' in client) {
          await client.navigate(url.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
