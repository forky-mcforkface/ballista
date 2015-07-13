// Service Worker

// The name of the cache in the client-side cache database.
var CACHE_NAME = 'my-site-cache-v1';

// The files we want to cache
var urlsToCache = [
  '/',
  '/index.js'
];

// Polyfill Cache.addAll.
if (Cache.prototype.addAll === undefined) {
  Cache.prototype.addAll = function(urls) {
    return Promise.all(urls.map(function(url) {
      return this.add(url);
    }.bind(this)));
  }
}

// Set the callback for the install step
self.addEventListener('install', function(event) {
  // Perform install steps
  console.log('install');

  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    console.log('Opened cache');
    return cache.addAll(urlsToCache);
  }));
});

self.addEventListener('activate', function(event) {
  console.log('activate');
});

self.addEventListener('fetch', function(event) {
  console.log('fetch: ' + event.request.url);
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          console.log('cache hit: ' + event.request.url);
          return response;
        }

        console.log('cache miss: ' + event.request.url);
        return fetch(event.request.url);
      }
    )
  );
});