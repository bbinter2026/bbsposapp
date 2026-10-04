/* Service Worker BBS POS: recebe push com a app FECHADA e mostra notificação com som do sistema */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '💬 Suporte BBS POS', {
    body: d.body || 'Tem uma nova mensagem', tag: 'bbs-support', renotify: true,
    vibrate: [200, 100, 200, 100, 200], data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(e.notification.data.url || './');
  }));
});
