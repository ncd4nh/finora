// Service worker Finora: mở app nhanh & vẫn mở được khi mất mạng.
// - Trang (navigation): lấy mạng trước, mất mạng thì dùng bản đã lưu
// - File tĩnh có mã băm (/assets/*), icon, font: lưu cache
// - API (/api): KHÔNG cache (dữ liệu luôn lấy từ máy chủ; ghi khi offline đã có hàng chờ trong app)
const CACHE = 'finora-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api')) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put('/', res.clone())); return res; })
        .catch(() => caches.match('/'))
    );
    return;
  }
  const cacheable = url.origin === location.origin
    ? /^\/(assets\/|icon-|favicon|apple-touch)/.test(url.pathname)
    : /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!cacheable) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }))
  );
});
