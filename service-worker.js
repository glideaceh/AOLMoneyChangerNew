const CACHE_NAME = 'aol-mc-cache-v1';
const urlsToCache = [
  './',
  './manifest.json'
  // Jika file HTML Anda bernama index.html, Anda bisa menambahkannya di sini: './index.html'
];

// Instalasi Service Worker dan caching aset statis
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Aktivasi dan pembersihan cache lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Intersep permintaan jaringan (Network-First Strategy untuk Admin Panel)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        // Jika offline, coba ambil dari cache
        return caches.match(event.request);
      })
  );
});
