// App shell cache. Bump VERSION with every release, to the newest version in whatsnew.js: a changed sw.js is what tells browsers there is an update (tools/publish.py checks it).
const VERSION = '1.5.07';
const CACHE = `quizaroo-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'style.css',
  'sortable.js',
  'whatsnew.js',
  'sounds.js',
  'modes.js',
  'stats.js',
  'sync-crypto.js',
  'sync.js',
  'sync-panel.js',
  'install.js',
  'app.js',
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'demo-sets.json',
  'assets/rewards/apple.svg',
  'assets/rewards/balloon.svg',
  'assets/rewards/bronze.svg',
  'assets/rewards/cake.svg',
  'assets/rewards/cherries.svg',
  'assets/rewards/clover.svg',
  'assets/rewards/cookie.svg',
  'assets/rewards/crown.svg',
  'assets/rewards/doughnut.svg',
  'assets/rewards/gem.svg',
  'assets/rewards/gift.svg',
  'assets/rewards/glowing-star.svg',
  'assets/rewards/gold.svg',
  'assets/rewards/honey.svg',
  'assets/rewards/hourglass.svg',
  'assets/rewards/icecream.svg',
  'assets/rewards/pear.svg',
  'assets/rewards/rainbow.svg',
  'assets/rewards/ribbon.svg',
  'assets/rewards/rocket.svg',
  'assets/rewards/silver.svg',
  'assets/rewards/star.svg',
  'assets/rewards/strawberry.svg',
  'assets/rewards/sunflower.svg',
  'assets/rewards/trophy.svg',
];

self.addEventListener('install', event => {
  // Straight from the server, not the browser's own cache (GitHub Pages lets browsers keep files for 10 minutes, so a new version could have been stored with old files in it).
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, {cache: 'reload'})))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Only our own caches.
    for (const key of await caches.keys()) { if (key.startsWith('quizaroo-') && key !== CACHE) await caches.delete(key); }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if (event.data === 'skip-waiting') self.skipWaiting(); });

// Cache first for our own files; anything missing from the shell list is fetched and cached on first use.
self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  if (location.hostname === 'localhost') return; // always fresh while developing

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, {ignoreSearch: request.mode === 'navigate'});
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (fetch_err) {
      if (request.mode === 'navigate') return cache.match('index.html');
      throw fetch_err;
    }
  })());
});
