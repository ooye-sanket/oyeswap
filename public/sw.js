const CACHE_NAME = 'const CACHE_NAME = 'oyeswap-v1.0.1';
const urlsToCache = [
  '/',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/media/icon-192.png',
  '/media/icon-512.png',
  '/media/favicon.svg'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch((err) => {
        console.error('[Service Worker] Cache failed:', err);
      })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Skip caching for Socket.IO, uploads, and API calls
  if (url.includes('socket.io') || 
      url.includes('/upload') ||
      url.includes('/health') ||
      event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return cached response
        if (response) {
          console.log('[Service Worker] Serving from cache:', event.request.url);
          return response;
        }
        
        // Not in cache - fetch from network
        return fetch(event.request).then((response) => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Clone and cache the response
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
          
          return response;
        }).catch((error) => {
          console.error('[Service Worker] Fetch failed:', error);
          // Return offline page if you have one
          return caches.match('/');
        });
      })
  );
});
