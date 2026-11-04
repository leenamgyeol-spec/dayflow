/* DAYFLOW 서비스 워커 — 오프라인 실행과 알림 클릭 처리
 * 네트워크 우선, 실패하면 캐시. (업데이트가 바로 반영되도록) */
const CACHE = 'dayflow-v5';
const ASSETS = ['./', 'index.html', 'css/style.css?v=5', 'icon.svg', 'manifest.webmanifest',
  'js/time.js?v=5', 'js/db.js?v=5', 'js/store.js?v=5', 'js/nlp.js?v=5', 'js/weather.js?v=5', 'js/brief.js?v=5', 'js/ui.js?v=5', 'js/notify.js?v=5', 'js/chat.js?v=5', 'js/app.js?v=5'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '#/today';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ type: 'navigate', url: target }); return c.focus(); }
    return self.clients.openWindow(self.registration.scope + target);
  }));
});
