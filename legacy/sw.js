const CACHE_NAME = 'coco-instruments-v5';
const urlsToCache = [
    '/',
    '/index.html',
    '/coco-money.html',
    '/debts.html',
    '/scale-calculator.html',
    '/clothing-size.html',
    '/styles/global.css',
    '/styles/header.css',
    '/styles/home.css',
    '/styles/auth.css',
    '/styles/coco-money.css',
    '/styles/debts.css',
    '/styles/scale-calculator.css',
    '/styles/clothing-size.css',
    '/js/app.js',
    '/js/auth.js',
    '/js/navigation.js',
    '/js/pwa.js',
    '/js/api.js',
    '/js/coco-money.js',
    '/js/debts.js',
    '/js/scale-calculator.js',
    '/js/clothing-size.js',
    '/manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
            .catch(error => {
                console.error('Failed to cache:', error);
            })
    );
});

self.addEventListener('fetch', event => {
    // Skip API requests - don't cache them
    if (event.request.url.includes('/api/')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
            .catch(error => {
                console.error('Fetch failed:', error);
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
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
