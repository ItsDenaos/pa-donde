// Service worker de Pa' Donde: guarda la app y sus datos para que abra sin internet.
// Con internet siempre se pide la versión nueva (y se actualiza la copia guardada); sin
// internet, o si la red tarda demasiado, se usa la copia guardada.
// Los mapas de fondo (tiles de OpenStreetMap) no se guardan aquí: la política de OSM no
// permite descargarlos por adelantado, solo la caché normal del navegador.

const VERSION = 'pa-donde-v1';
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'planner.js',
  'manifest.webmanifest',
  'assets/icono.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/maskable-512.png',
  'assets/apple-touch-icon.png',
  'data/rutas.geojson',
  'data/rutas_amb.geojson',
  'data/lugares.json',
];
// Librerías y tipografías de otros sitios que también hacen falta sin internet.
const CDN_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    // Versiones fijas (leaflet@1.9.4…): no cambian, se guardan la primera vez.
    event.respondWith(cacheFirst(request));
  }
  // Lo demás (tiles del mapa, buscador Photon) va directo a internet.
});
