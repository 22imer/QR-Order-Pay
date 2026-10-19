const CACHE_VERSION = 'fantastic-cafe-shell-v13';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/t',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/fonts/be-vietnam-pro.css',
  '/fonts/be-vietnam-pro-400-vietnamese.woff2',
  '/fonts/be-vietnam-pro-400-latin-ext.woff2',
  '/fonts/be-vietnam-pro-400-latin.woff2',
  '/fonts/be-vietnam-pro-500-vietnamese.woff2',
  '/fonts/be-vietnam-pro-500-latin-ext.woff2',
  '/fonts/be-vietnam-pro-500-latin.woff2',
  '/fonts/be-vietnam-pro-600-vietnamese.woff2',
  '/fonts/be-vietnam-pro-600-latin-ext.woff2',
  '/fonts/be-vietnam-pro-600-latin.woff2',
  '/fonts/be-vietnam-pro-700-vietnamese.woff2',
  '/fonts/be-vietnam-pro-700-latin-ext.woff2',
  '/fonts/be-vietnam-pro-700-latin.woff2',
  '/fonts/be-vietnam-pro-800-vietnamese.woff2',
  '/fonts/be-vietnam-pro-800-latin-ext.woff2',
  '/fonts/be-vietnam-pro-800-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(precacheApplication());
  self.skipWaiting();
});

async function precacheApplication() {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(SHELL_URLS);
  const response = await fetch('/asset-manifest.json');
  if (!response.ok) throw new Error(`Asset manifest failed with ${response.status}`);
  const manifest = await response.json();
  const assets = new Set(['/asset-manifest.json']);
  for (const entry of Object.values(manifest)) {
    if (entry.file) assets.add(`/${entry.file}`);
    for (const css of entry.css ?? []) assets.add(`/${css}`);
    for (const asset of entry.assets ?? []) assets.add(`/${asset}`);
  }
  await cache.addAll([...assets]);
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io')
  )
    return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok)
            void caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put('/index.html', response.clone()));
          return response;
        })
        .catch(
          async () => (await caches.match('/index.html', { ignoreVary: true })) ?? Response.error(),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok)
          void caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
        return response;
      });
    }),
  );
});
