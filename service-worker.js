importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const CACHE_NAME = 'nafdac-pms-v7';
const firebaseConfig = {
  apiKey: "AIzaSyC98TWcj1lzG4MtOYpDGt3MxISC5JNW2Yk",
  authDomain: "pms-national.firebaseapp.com",
  projectId: "pms-national",
  storageBucket: "pms-national.firebasestorage.app",
  messagingSenderId: "243598321443",
  appId: "1:243598321443:web:10ad687ac3a3a152f70e96",
  measurementId: "G-1T78ZWE9GB"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || 'NAFDAC PMS Alert';
  const options = {
    body: payload.notification?.body || payload.data?.body || 'New surveillance item requires attention.',
    icon: '/logo.png',
    badge: '/logo.png',
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/constants.js',
  '/db.js',
  '/ui.js',
  '/auth.js',
  '/push.js',
  '/notifications.js',
  '/profile.js',
  '/wizard.js',
  '/team.js',
  '/dashboard.js',
  '/facilities.js',
  '/complaints.js',
  '/particles.js',
  '/manifest.json',
  '/logo.png',
  // External CDNs cached for offline reliability
  'https://cdn.jsdelivr.net/npm/choices.js/public/assets/styles/choices.min.css',
  'https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Pre-caching static assets and CDNs...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Network-First with Cache Fallback for all local & CDN requests
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // If successful and not extension request, clone and save to cache
        if (networkResponse && networkResponse.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline: Fall back to cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If offline and request is HTML, return cached index.html
          if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
            return caches.match('/index.html');
          }
        });
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('[Service Worker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetPage = data.targetPage || 'home';
  const targetId = data.targetId || data.complaintId || '';
  const url = `/?pushTarget=${encodeURIComponent(targetPage)}${targetId ? `&targetId=${encodeURIComponent(targetId)}` : ''}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'PUSH_NAVIGATE', targetPage, targetId });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
