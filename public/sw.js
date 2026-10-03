// Minimal service worker so the office can be installed as an app.
// It caches nothing: the office is live data from the local server, and a stale copy would be misleading.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // network as usual (SSE /events and the API pass straight through)
// Clicking a desktop notification: focus the open office window and tell it which chat to open (#chat=<w|o>:<id>), or open one.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.hash) || '';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = list.find(x => x.visibilityState === 'visible') || list[0];
    if (c) { try { await c.focus(); } catch (err) {} c.postMessage({ type: 'co-open', hash }); return; }
    if (self.clients.openWindow) await self.clients.openWindow('/' + hash);
  })());
});
