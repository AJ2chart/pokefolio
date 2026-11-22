// Gleamvault service worker: makes the app installable and opens it even offline.
// The page opens at once from the cache and is refreshed in the background: an update shows on the next launch
// (the network was awaited at every launch before, several seconds on a poor connection). First launch: network.
// The libraries and font served by CDNs are kept too, so the app works offline and does not wait for them.
const CACHE = 'gleamvault-v7';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const LIBS = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/(@supabase\/supabase-js@2|tesseract\.js@5\/dist\/tesseract\.min\.js)|cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/|fonts\.googleapis\.com\/css2|fonts\.gstatic\.com\/)/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// cached copy right away, fresh copy fetched and stored for next time
function staleWhileRevalidate(e, key, fetchReq) {
  const fresh = fetch(fetchReq).then(res => {
    if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  return caches.match(key).then(hit => hit || fresh);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(staleWhileRevalidate(e, './index.html', new Request(req.url, { cache: 'no-cache' })).catch(() => caches.match('./index.html')));
      return;
    }
    if (url.pathname.includes('/hashes/')) return; // fingerprint tables: kept by the app itself (IndexedDB, 24 h)
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  if (LIBS.test(req.url)) { e.respondWith(staleWhileRevalidate(e, req, req)); return; }
  // APIs, images, Supabase: straight to network
});
