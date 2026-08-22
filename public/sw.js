// ── AcademAI service worker: push delivery only ──────────────────────────
// Deliberately no caching. A stale cache on a deadline tracker is worse than
// a slow load, and iOS only delivers web push to a page that has one of these.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'AcademAI', body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'AcademAI';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || 'academai',
    renotify: true,
    requireInteraction: !!d.urgent,
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.navigate(url); } catch { /* cross-origin */ } return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
