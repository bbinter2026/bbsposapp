// Service worker opcional: abre a app depressa mesmo com internet lenta.
// Coloque este ficheiro ao lado do index.html.
const V = 'bbs-pos-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));

async function netFirst(req) {
  const c = await caches.open(V);
  const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; });
  net.catch(() => {});
  const hit = await c.match(req);
  if (!hit) return net;
  // Se a rede demorar mais de 2,5 s, abre já a versão guardada
  return Promise.race([net, new Promise(res => setTimeout(() => res(hit), 2500))]).catch(() => hit);
}
async function cacheFirst(req) {
  const c = await caches.open(V), hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r;
}
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) e.respondWith(netFirst(r));
  else if (/(^|\.)(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)$/.test(u.host)) e.respondWith(cacheFirst(r));
});
