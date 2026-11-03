const CACHE = 'quest-pwa-v3';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('quest-pwa-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// 一つのリリースのHTML・JS・CSSをまとめて保持する。
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  const shell = new URL('./index.html', self.registration.scope).href;
  const requestKey = event.request.mode === 'navigate' && url.pathname.startsWith(new URL(self.registration.scope).pathname) ? shell : event.request;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(requestKey)) || fetch(event.request)));
});
