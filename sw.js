// Gleamvault service worker: makes the app installable and opens it even offline.
// The page opens at once from the cache and is refreshed in the background: an update shows on the next launch
// (the network was awaited at every launch before, several seconds on a poor connection). First launch: network.
// The libraries and font served by CDNs are kept too, so the app works offline and does not wait for them.
// The app's code is in versioned files (app.js?v=…, boot.js?v=…, named in the page): a cached page is only replaced once
// the files it names are cached, so an offline launch never finds a page without its code.
const CACHE = 'gleamvault-v9';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const LIBS = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/(@supabase\/supabase-js@2[\d.]*\/|tesseract\.js@5[\d.]*\/dist\/tesseract\.min\.js)|cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/|fonts\.googleapis\.com\/css2|fonts\.gstatic\.com\/)/;

const scriptsOf = html => [...html.matchAll(/<script src="([^"]+)"/g)].map(m => new URL(m[1], self.registration.scope).href);
async function cacheScripts(c, html) {
  for (const u of scriptsOf(html)) {
    if (await c.match(u)) continue;
    const r = await fetch(u);
    if (!r.ok) throw new Error('script ' + r.status);
    await c.put(u, r);
  }
}
async function storePage(res) {          // fresh page: its code files first, then the page itself
  const c = await caches.open(CACHE), html = await res.clone().text();
  await cacheScripts(c, html);
  await c.put('./index.html', res);
  // older versions of the code files are no longer named by the page
  const keep = new Set(scriptsOf(html));
  for (const k of await c.keys()) { const u = new URL(k.url); if (u.origin === self.location.origin && /\.js$/.test(u.pathname) && u.search && !keep.has(k.url)) await c.delete(k); }
}
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL.filter(u => u !== './index.html'));
    const res = await fetch('./index.html', { cache: 'no-cache' });
    if (res.ok) await storePage(res);
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// cached copy right away, fresh copy fetched and stored for next time
function staleWhileRevalidate(e, key, fetchReq, page) {
  const fresh = fetch(fetchReq).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      e.waitUntil((page ? storePage(copy) : caches.open(CACHE).then(c => c.put(key, copy))).catch(() => {}));
    }
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
      e.respondWith(staleWhileRevalidate(e, './index.html', new Request(req.url, { cache: 'no-cache' }), true).catch(() => caches.match('./index.html')));
      return;
    }
    if (url.pathname.includes('/hashes/')) return; // fingerprint tables: kept by the app itself (IndexedDB, 24 h)
    if (/\.js$/.test(url.pathname) && url.search) {   // versioned code file: never changes, kept once fetched
      e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy))); } return res; })));
      return;
    }
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  if (LIBS.test(req.url)) { e.respondWith(staleWhileRevalidate(e, req, req)); return; }
  // APIs, images, Supabase: straight to network
});
