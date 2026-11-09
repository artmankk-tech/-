// 更新時はv6をv7などへ変更する。同じドメインの別アプリとキャッシュを区別する。
const PREFIX = 'quest-pwa:' + self.registration.scope + ':';
const CACHE = PREFIX + 'v6';
const ASSETS = ['./', './index.html', './style.css', './game.js', './app.js', './assets/employee-atlas.png', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const ASSET_URLS = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  // 旧画面が開いている間は待機し、HTMLとJSが別バージョンになるのを防ぐ。
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
  // v3以前の共有名キャッシュは別スコープも使う可能性があるため削除しない。
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  url.hash = '';
  if (!ASSET_URLS.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache =>
    (await cache.match(url.href)) || fetch(event.request)
  ));
});
