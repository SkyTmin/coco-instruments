const CACHE_NAME = 'coco-instruments-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/coco-money.html',
    '/styles/global.css',
    '/styles/header.css',
    '/styles/home.css',
    '/styles/auth.css',
    '/styles/coco-money.css',
    '/js/app.js',
    '/js/auth.js',
    '/js/navigation.js',
    '/js/pwa.js',
    '/js/coco-money.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
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