const PREFIX = 'san-marcos-parking:' + self.registration.scope + ':';
const SHELL = PREFIX + 'v2';
const SHELL_FILES = [
  './',
  './index.html',
  './favicon.svg',
  './parking-ui.css',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './data/cityZones.geojson',
  './data/citySpaces.geojson',
  './data/osm.json',
  './data/parkLots.geojson',
  './data/pedestrian.json'
];

self.addEventListener('install', event => {
  const requests = SHELL_FILES.map(file => new Request(new URL(file, self.registration.scope), { cache: 'reload' }));
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(requests)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== SHELL).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(SHELL).then(cache => cache.put('./index.html', copy));
      }
      return response;
    }).catch(() => caches.open(SHELL).then(cache => cache.match('./index.html'))));
    return;
  }
  event.respondWith(caches.open(SHELL).then(cache => cache.match(request)).then(saved => saved || fetch(request)));
});
