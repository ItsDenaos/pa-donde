// Pa' Donde: rutas de bus de Barranquilla.
// - data/rutas.geojson: rutas de OpenStreetMap; de ahí solo se usa Transmetro (scripts/descargar_rutas.py).
// - data/rutas_amb.geojson: buses tradicionales del visor del AMB (scripts/descargar_rutas_amb.py).
// El cálculo de "Cómo llegar" está en planner.js.

const DATA_FILES = ['data/rutas.geojson', 'data/rutas_amb.geojson'];
const PLACES_FILE = 'data/lugares.json'; // barrios, universidades, centros comerciales… (scripts/descargar_lugares.py)
const AMB_URL = 'https://www.ambq.gov.co/transporte/transporte-publico-colectivo/';
const CENTER = [10.9685, -74.7813];
const AREA = L.latLngBounds([10.82, -74.98], [11.11, -74.70]); // misma caja que el script
const NEAR_RADII = [500, 1000]; // metros: primero lo que queda a pocos minutos a pie
const TAP_TOLERANCE_PX = 14; // qué tan cerca de una línea hay que tocar el mapa para elegirla
const VISIBLE_STREETS = 12; // calles que se ven de una en "Por dónde pasa"
const GPS_FRESH_MS = 5 * 60 * 1000; // una ubicación de hace menos de 5 min se reutiliza

// Pasaje vigente desde el 19 de enero de 2026 (AMB), igual en buses tradicionales y Transmetro.
const FARE = { normal: 3700, festivo: 3800 };
// Los domingos y festivos tienen otra tarifa. Festivos de Colombia en 2026 (ley Emiliani);
// para otros años solo se distinguen los domingos hasta actualizar esta lista.
const FESTIVOS = new Set(['2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
  '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17',
  '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25']);

// Secciones de la lista: Transmetro (troncales y alimentadoras) es el sistema masivo; los
// buses del AMB, los tradicionales.
const SECTIONS = [['masivo', 'Sistema masivo'], ['tradicional', 'Buses tradicionales']];
const sectionOf = (r) => (r.group === 'troncal' || r.group === 'alimentadora' ? 'masivo'
  : 'tradicional');
const PALETTE = ['#d6336c', '#1c7ed6', '#2f9e44', '#e8590c', '#7048e8', '#0c8599',
  '#c2255c', '#5c940d', '#f08c00', '#3b5bdb', '#a61e4d', '#087f5b'];

const CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const PIN = '<svg class="pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const WALK = '<svg class="walk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="2"/><path d="m9 21 2.5-6.5L14 17v4M7.5 12.5 10 9l3.5-.5 2.5 3 2.5 1M11.5 14.5 13 9"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
const DEST_PIN = '<svg viewBox="0 0 30 38" aria-hidden="true"><path d="M15 36S3 25.5 3 15a12 12 0 0 1 24 0c0 10.5-12 21-12 21z" fill="#0B3D91" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="15" r="5" fill="#FFD600"/></svg>';
const ICONS = {
  casa: '<svg class="fav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 9.5V20h4.5v-5h3v5H18V9.5"/></svg>',
  trabajo: '<svg class="fav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 12.5h17"/></svg>',
  favorito: '<svg class="fav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/></svg>',
  reciente: '<svg class="fav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};
const LABELS = { casa: 'Casa', trabajo: 'Trabajo' };
const GPS_ICON = '<svg class="fav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/></svg>';
const MAP_ICON = '<svg class="fav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3.5 6.5 5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5zM9 4v13.5M15 6.5V20"/></svg>';
const SWAP_ICON = '<svg class="fav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v15M4.5 7.5 8 4l3.5 3.5M16 20V5M12.5 16.5 16 20l3.5-3.5"/></svg>';
const PLAN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M9 14v-2.5a1.5 1.5 0 0 1 1.5-1.5H15m-2-2 2 2-2 2"/></svg>';
const SHARE_ICON = '<svg class="fav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></svg>';

// Reportes de errores: la app no tiene servidor, así que el reporte se manda por correo o
// por WhatsApp con el mensaje ya escrito. Mientras no haya un destino, el botón no aparece.
// Ejemplos: { email: 'padonde@gmail.com' } o { whatsapp: '573001234567' } (con indicativo, sin +).
const REPORT_TO = { email: '', whatsapp: '' };
const reportEnabled = () => Boolean(REPORT_TO.email || REPORT_TO.whatsapp);

const state = {
  routes: [],
  layers: new Map(), // id de ruta -> L.FeatureGroup (se crea la primera vez que se abre la ruta)
  view: 'browse', // 'browse' | 'route' | 'trip'
  selectedId: null,
  text: '',
  near: null, // { latlng, source: 'gps' | 'punto', radius, dists: Map(id de ruta -> metros) }
  places: [], // lugares para el buscador: data/lugares.json más estaciones y paradas
  placeResults: [], // lugares que se están mostrando en la lista
  trip: null, // viaje en "Cómo llegar": ver newTrip()
  lastGps: null, // { latlng, at }
  openCompanies: new Set(), // carpetas desplegadas en la lista (Transmetro y empresas)
  picking: null, // 'casa' | 'trabajo' mientras se elige ese lugar en el buscador
  highlightedStop: null, // { routeId, stop } la estación o parada resaltada
};
let listScroll = 0;

// ---------- Tus lugares y rutas (se guardan solo en este celular o navegador) ----------

const STORE_KEY = 'padonde:mis-lugares';
const MAX_RECENT = 5;
const store = (() => {
  try {
    return { places: [], routes: [], recent: [], ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return { places: [], routes: [], recent: [] }; // sin almacenamiento (modo privado): funciona sin guardar
  }
})();

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // no se pudo guardar: los favoritos duran hasta cerrar la página
  }
}

const toStored = (place) => ({ name: place.name, detail: place.detail || '', lat: place.latlng.lat, lon: place.latlng.lng });
const fromStored = (s) => ({ name: s.name, detail: s.detail, latlng: L.latLng(s.lat, s.lon), label: s.label || null });
const samePlace = (a, b) => a.name === b.name && Math.abs(a.lat - b.lat) < 0.0005 && Math.abs(a.lon - b.lon) < 0.0005;

function savedPlace(place) {
  const s = toStored(place);
  return store.places.find((p) => samePlace(p, s)) || null;
}

// label: 'casa' | 'trabajo' | null (favorito sin etiqueta). Casa y Trabajo son únicos.
function savePlace(place, label) {
  const s = toStored(place);
  store.places = store.places.filter((p) => !samePlace(p, s) && !(label && p.label === label));
  store.places.push({ ...s, label });
  saveStore();
}

function removePlace(place) {
  const s = toStored(place);
  store.places = store.places.filter((p) => !samePlace(p, s));
  saveStore();
}

function addRecent(place) {
  const s = toStored(place);
  store.recent = [s, ...store.recent.filter((p) => !samePlace(p, s))].slice(0, MAX_RECENT);
  saveStore();
}

const isSavedRoute = (id) => store.routes.includes(id);
function toggleSavedRoute(id) {
  store.routes = isSavedRoute(id) ? store.routes.filter((r) => r !== id) : [...store.routes, id];
  saveStore();
}

// Nombre para mostrar de un lugar guardado: "Casa" (con el lugar como detalle) o su nombre.
function placeTitle(place) {
  return place.label ? LABELS[place.label] : place.name;
}

const $ = (sel) => document.querySelector(sel);
const els = {
  scroll: $('#panel-scroll'),
  status: $('#status'),
  browse: $('#browse'),
  search: $('#search'),
  picking: $('#picking'),
  install: $('#install'),
  near: $('#near'),
  hint: $('#hint'),
  groups: $('#groups'),
  about: $('#about'),
  aboutBody: $('#about-body'),
  route: $('#route'),
  trip: $('#trip'),
  handle: $('#sheet-handle'),
};
const isMobile = window.matchMedia('(max-width: 760px) and (orientation: portrait)'); // igual que en styles.css
const animate = () => document.visibilityState === 'visible'; // la animación espera a que se dibuje un cuadro

// ---------- Mapa ----------

const map = L.map('map', { zoomControl: !isMobile.matches }).setView(CENTER, 12);
map.createPane('red').style.zIndex = 405;
map.createPane('rutas').style.zIndex = 420;
map.createPane('paradas').style.zIndex = 430;
map.createPane('yo').style.zIndex = 440;

// Los tiles de openstreetmap.org sirven para pruebas; si la app tiene mucho tráfico
// hay que usar otro proveedor (ver https://operations.osmfoundation.org/policies/tiles/).
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
  maxZoom: 19,
  className: 'tiles-muted',
}).addTo(map);

// Si el contenedor cambia de tamaño (rotar el teléfono, agrandar la lista…) Leaflet debe volver a medirlo.
new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());

const networkLayer = L.layerGroup().addTo(map);
const selectedLayer = L.layerGroup().addTo(map);
const nearLayer = L.layerGroup().addTo(map);
const highlightLayer = L.layerGroup().addTo(map); // la estación o parada que se tocó
const tripLayer = L.layerGroup();
L.control.scale({ imperial: false }).addTo(map);
map.attributionControl.addAttribution(`<a href="${AMB_URL}">Buses tradicionales: AMB</a>`);

const LocateControl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd() {
    const btn = L.DomUtil.create('button', 'locate');
    btn.type = 'button';
    btn.innerHTML = `${PIN}<span>Cerca de mí</span>`;
    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn, 'click', locateUser);
    return btn;
  },
});
const locateBtn = new LocateControl().addTo(map).getContainer();

// ---------- Utilidades ----------

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const normalize = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// GeoJSON usa [lon, lat]; Leaflet usa [lat, lon].
const toLatLngs = (line) => line.map(([lon, lat]) => [lat, lon]);

const formatDistance = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const formatMinutes = (min) => `${Math.max(1, Math.round(min))} min`;

// Distancia en metros de un punto a la línea de la ruta (proyección local, suficiente a escala de ciudad).
function distanceToRoute(route, { lat, lng }) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (const line of route.lines) {
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][1] - lng) * kx, ay = (line[i - 1][0] - lat) * ky;
      const dx = (line[i][1] - lng) * kx - ax, dy = (line[i][0] - lat) * ky - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

function nearestStop(route, latlng) {
  let best = null;
  for (const s of route.stops) {
    const d = map.distance(latlng, [s.lat, s.lon]);
    if (!best || d < best.d) best = { stop: s, d };
  }
  return best;
}

function routeColor(id, tags) {
  const c = tags.colour;
  if (c && CSS.supports('color', c) && !/^(white|#fff(fff)?)$/i.test(c)) return c;
  let h = 0;
  for (const ch of tags.ref || String(id)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// "Estación retorno Joe Arroyo" -> "Joe Arroyo", "Barrio Paraíso" -> "Paraíso".
const cleanPlace = (s) => s.replace(/^(estaci[oó]n(\s+(de\s+)?retorno)?|barrio)\s+/i, '').trim();

// Nombre para mostrar: "origen → destino" si se conoce; si no, el nombre sin el prefijo
// repetido ("Ruta A8-1 - Paraíso" -> "Paraíso"). Los buses tradicionales del AMB solo traen la empresa.
function displayName(tags, fuente) {
  if (tags.from && tags.to) return `${cleanPlace(tags.from)} → ${cleanPlace(tags.to)}`;
  if (fuente === 'amb') return tags['amb:sentido'] ? `${tags.operator} (${tags['amb:sentido']})` : tags.operator;
  const name = (tags.name || '')
    .replace(/^(ruta|bus|troncal|parada)\s+\S+\s*([-:]\s*)?/i, '')
    .replace(/\s*=>\s*/g, ' → ')
    .trim();
  if (name) return name;
  return tags.ref ? `Ruta ${tags.ref}` : 'Ruta sin nombre';
}

// Troncal: para casi solo en estaciones. Las alimentadoras pueden pasar por alguna
// estación, pero la mayoría de sus paradas son de calle.
function groupOf(tags, stops, fuente) {
  if (fuente === 'amb') return 'colectivo';
  const stations = stops.filter((s) => s.tipo === 'estacion').length;
  if (/^troncal/i.test(tags.name || '') || (stations >= 3 && stations >= stops.length - stations)) return 'troncal';
  return /transmetro/i.test(`${tags.network} ${tags.operator}`) ? 'alimentadora' : 'otra';
}

// Color de texto legible sobre el color de la ruta (algunas son amarillas o verde claro).
const inkCanvas = document.createElement('canvas').getContext('2d');
function inkFor(color) {
  inkCanvas.fillStyle = '#000';
  inkCanvas.fillStyle = color; // el canvas lo normaliza a #rrggbb
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(inkCanvas.fillStyle.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1F2937' : '#ffffff';
}

const refBadge = (route) => `<span class="ref" style="${escapeHtml(route.style)}">${escapeHtml(route.tags.ref || '·')}</span>`;

// Cómo nombrar una ruta dentro de una frase: "la A8-1", "el bus C1 de Cooasoatlan".
function busPhrase(route) {
  const ref = escapeHtml(route.tags.ref || route.name);
  if (route.group === 'colectivo') return `el bus <strong>${ref}</strong> de ${escapeHtml(route.tags.operator)}`;
  return `la <strong>${ref}</strong>`;
}

function setStatus(kind, html) {
  els.status.hidden = !html;
  els.status.className = `status ${kind}`;
  els.status.innerHTML = html;
}

// Quita la pantalla de carga (con el logo y el eslogan) cuando la app está lista o si falla.
function hideSplash() {
  $('#splash').classList.add('done');
}

// ---------- Datos ----------

async function loadData() {
  setStatus('loading', 'Cargando rutas…');
  const results = await Promise.allSettled(DATA_FILES.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }));
  const files = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (files.length === 0) {
    setStatus('error', `No se pudieron leer los datos de rutas. Genéralos con
      <code>python scripts/descargar_rutas.py</code> y <code>python scripts/descargar_rutas_amb.py</code>.`);
    hideSplash();
    return;
  }

  state.routes = files.flatMap((f) => f.features)
    .map(({ geometry, properties: { osm_id: osmId, id: fileId, fuente = 'osm', tags: osmTags, paradas, calles = [] } }) => {
      const id = String(fileId ?? osmId);
      // Algunas rutas no tienen número (ref) en OSM pero sí en el nombre: "Bus S10: …".
      const tags = osmTags.ref ? osmTags
        : { ...osmTags, ref: (osmTags.name || '').match(/^(?:ruta|bus|troncal)\s+([A-Z]{1,2}\d+[A-Z0-9-]*)\b/i)?.[1] };
      const lines = geometry.coordinates.map(toLatLngs);
      const streets = calles.map((nombre) => ({ nombre, key: normalize(nombre) }));
      const stops = paradas.map((p, i) => {
        // Las estaciones de inicio y fin a veces no tienen nombre: se usa el origen/destino de la ruta.
        const edge = i === 0 ? tags.from : i === paradas.length - 1 ? tags.to : null;
        const nombre = p.nombre || (p.tipo === 'estacion' ? edge || 'Estación sin nombre' : `Parada ${i + 1}`);
        const key = normalize(nombre);
        // Una parada que solo lleva el nombre de la calle no sirve como "lugar" para buscar.
        return { ...p, nombre, key, generic: !p.nombre || streets.some((s) => s.key === key) };
      });
      const name = displayName(tags, fuente);
      const color = routeColor(id, tags);
      return {
        id,
        fuente,
        tags,
        name,
        lines,
        stops,
        streets,
        bounds: L.latLngBounds(lines.flat()),
        color,
        style: `--c:${color};--ink:${inkFor(color)}`, // para las insignias con el número
        group: groupOf(tags, stops, fuente),
        network: fuente === 'amb' ? tags.operator : tags.network || tags.operator || 'Operador desconocido',
        haystack: normalize([tags.ref, name, tags.name, tags.from, tags.to, tags.via, tags.network, tags.operator].join(' ')),
      };
    })
    .sort((a, b) => (!a.tags.ref - !b.tags.ref)
      || (a.tags.ref || '').localeCompare(b.tags.ref || '', 'es', { numeric: true })
      || a.name.localeCompare(b.name, 'es'));

  // De OSM solo se usa Transmetro: las demás rutas de buses están a medio mapear (sin nombre,
  // con trazados incompletos) y los buses tradicionales ya vienen completos del AMB.
  state.routes = state.routes.filter((r) => r.group !== 'otra');

  if (state.routes.length === 0) {
    setStatus('empty', `No hay rutas de bus mapeadas en OpenStreetMap para esta zona.
      <a href="https://wiki.openstreetmap.org/wiki/Public_transport" target="_blank" rel="noopener">Cómo mapearlas</a>.`);
  } else {
    setStatus('', '');
  }
  renderNetwork();
  renderAbout(files);
  renderList();
  applyHash();
  hideSplash();
  maybeShowGuide();

  // Lugares para el buscador (no es indispensable: sin el archivo quedan estaciones y paradas).
  let lugares = [];
  try {
    const res = await fetch(PLACES_FILE);
    if (res.ok) lugares = await res.json();
  } catch {
    // sin data/lugares.json el buscador sigue funcionando con Photon
  }
  buildPlaceIndex(lugares);
  if (state.text) renderList();
}

// Todas las rutas en un azul suave: se ve la cobertura y se pueden tocar para abrirlas.
function renderNetwork() {
  const renderer = L.canvas({ pane: 'red' });
  for (const route of state.routes) {
    L.polyline(route.lines, { renderer, color: '#0B3D91', weight: 3, opacity: 0.3, interactive: false })
      .addTo(networkLayer);
  }
}

function dimNetwork(dim) {
  networkLayer.eachLayer((line) => line.setStyle({ opacity: dim ? 0.07 : 0.3 }));
}

// Línea de una ruta con borde blanco y flechas blancas en el sentido de circulación.
function addRouteLine(group, latlngs, color) {
  L.polyline(latlngs, { pane: 'rutas', color: '#fff', weight: 11, opacity: 0.9, interactive: false }).addTo(group);
  L.polyline(latlngs, { pane: 'rutas', color, weight: 7, opacity: 1, bubblingMouseEvents: false }).addTo(group);
  L.polylineDecorator(latlngs, {
    patterns: [{
      offset: 24,
      repeat: 70,
      symbol: L.Symbol.arrowHead({
        pixelSize: 7,
        headAngle: 80,
        polygon: false,
        pathOptions: { pane: 'rutas', color: '#fff', weight: 2.5, opacity: 1, interactive: false },
      }),
    }],
  }).addTo(group);
}

const stopLabel = (s) => (s.tipo === 'estacion' ? `Estación ${s.nombre.replace(/^estaci[oó]n\s+/i, '')}` : s.nombre);

// Resalta una estación o parada: anillo que late en el mapa, su nombre fijo encima y la
// fila marcada en la lista. Se llama al tocarla en la lista o en el mapa.
function highlightStop(route, stop, { fromMap = false } = {}) {
  highlightLayer.clearLayers();
  state.highlightedStop = { routeId: route.id, stop };
  const latlng = [stop.lat, stop.lon];
  L.circleMarker(latlng, {
    pane: 'yo', radius: 16, color: route.color, weight: 3, fillColor: route.color, fillOpacity: 0.25,
    className: 'stop-pulse', interactive: false,
  }).addTo(highlightLayer);
  L.circleMarker(latlng, { pane: 'yo', radius: 8, color: route.color, weight: 4, fillColor: '#fff', fillOpacity: 1, interactive: false })
    .bindTooltip(escapeHtml(stopLabel(stop)), { permanent: true, direction: 'top', offset: [0, -10], className: 'stop-label' })
    .addTo(highlightLayer);

  if (!fromMap) map.setView(latlng, Math.max(map.getZoom(), 16), { animate: animate() });

  const index = route.stops.indexOf(stop);
  els.route.querySelectorAll('.stops li.active').forEach((li) => li.classList.remove('active'));
  const item = els.route.querySelector(`.stops [data-stop="${index}"]`)?.closest('li');
  if (item) {
    item.classList.add('active');
    if (fromMap) item.scrollIntoView({ block: 'nearest', behavior: animate() ? 'smooth' : 'auto' });
  }
}

function routeLayer(route) {
  if (state.layers.has(route.id)) return state.layers.get(route.id);

  const group = L.featureGroup();
  addRouteLine(group, route.lines, route.color);
  for (const s of route.stops) {
    const station = s.tipo === 'estacion';
    const marker = station
      ? L.marker([s.lat, s.lon], {
        pane: 'paradas',
        icon: L.divIcon({ className: 'station-icon', html: `<span style="--c:${escapeHtml(route.color)}"></span>`, iconSize: [16, 16] }),
      })
      : L.circleMarker([s.lat, s.lon], {
        pane: 'paradas', radius: 4.5, color: route.color, weight: 2.5, fillColor: '#fff', fillOpacity: 1, bubblingMouseEvents: false,
      });
    marker.bindTooltip(escapeHtml(stopLabel(s)), { direction: 'top', offset: [0, -6] }).addTo(group);
    marker.on('click', () => highlightStop(route, s, { fromMap: true }));
  }

  state.layers.set(route.id, group);
  return group;
}

// ---------- Navegación entre la lista, una ruta y "cómo llegar" ----------
// Ir de la lista a una ficha (o de "cómo llegar" a una ruta) agrega un paso al historial,
// para que el botón "atrás" del celular vuelva; cambiar de ruta a ruta lo reemplaza.

function go(hash, { deeper }) {
  if (deeper) history.pushState({ pushed: true }, '', hash);
  else history.replaceState(history.state, '', hash);
  applyHash();
}

const selectRoute = (id) => go(`#ruta/${id}`, { deeper: state.view !== 'route' });

function goBack() {
  if (history.state?.pushed) {
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    applyHash();
  }
}

// Enlace de un viaje: solo el destino ("#viaje/11.00915,-74.82082/C.%20C.%20Viva"). El punto
// de partida no va en el enlace: quien lo abre calcula desde donde esté (y no se comparte,
// por ejemplo, dónde queda la casa de quien lo envió).
const tripHash = (place) =>
  `#viaje/${place.latlng.lat.toFixed(5)},${place.latlng.lng.toFixed(5)}/${encodeURIComponent(place.name)}`;

function applyHash() {
  const match = location.hash.match(/^#ruta\/([\w-]+)$/);
  const route = match && state.routes.find((r) => r.id === match[1]);
  const trip = location.hash.match(/^#viaje\/(-?\d+\.\d+),(-?\d+\.\d+)(?:\/(.*))?$/);
  if (route) {
    showRoute(route);
  } else if (trip) {
    const latlng = L.latLng(Number(trip[1]), Number(trip[2]));
    if (!state.trip?.to || !state.trip.to.latlng.equals(latlng, 1e-5)) {
      // Se abrió un enlace compartido: se arma el viaje a ese destino, desde donde esté quien lo abre.
      let name = 'Destino compartido';
      try { name = decodeURIComponent(trip[3] || '') || name; } catch { /* nombre mal codificado */ }
      state.trip = newTrip(null, { name, detail: '', latlng, source: 'enlace' });
      showTrip();
      autoLocate();
      return;
    }
    showTrip();
  } else if (location.hash === '#viaje' && state.trip) {
    showTrip(); // un viaje que todavía no tiene destino
  } else {
    showBrowse();
  }
}

window.addEventListener('popstate', applyHash);

function setView(view) {
  if (state.view === 'browse' && view !== 'browse') listScroll = els.scroll.scrollTop;
  highlightLayer.clearLayers();
  state.highlightedStop = null;
  state.view = view;
  els.browse.hidden = view !== 'browse';
  els.route.hidden = view !== 'route';
  els.trip.hidden = view !== 'trip';
  if (view === 'trip') tripLayer.addTo(map);
  else tripLayer.remove();
}

function showRoute(route) {
  if (state.view === 'route' && state.selectedId === route.id) return;
  setView('route');
  state.selectedId = route.id;

  map.closePopup();
  selectedLayer.clearLayers();
  selectedLayer.addLayer(routeLayer(route));
  dimNetwork(true);
  setSheet(false);
  if (route.bounds.isValid()) map.fitBounds(route.bounds, { padding: [24, 24], maxZoom: 16, animate: animate() });

  renderRoute(route);
  els.scroll.scrollTop = 0;
}

function showBrowse() {
  const wasOther = state.view !== 'browse';
  setView('browse');
  state.selectedId = null;
  selectedLayer.clearLayers();
  dimNetwork(false);
  if (wasOther) els.scroll.scrollTop = listScroll;
}

function showTrip() {
  setView('trip');
  state.selectedId = null;
  map.closePopup();
  selectedLayer.clearLayers();
  dimNetwork(true);
  setSheet(false);
  drawTrip();
  renderTrip();
  els.scroll.scrollTop = 0;
}

// En móvil el panel ocupa la mitad de abajo; la manija lo agranda para ver más rutas.
function setSheet(expanded) {
  document.body.classList.toggle('sheet-expanded', expanded);
  map.invalidateSize(); // el mapa cambia de alto al instante: medirlo antes de encuadrar
}

// ---------- Tocar el mapa ----------

function routesAt(latlng) {
  const metersPerPixel = (40075016.686 * Math.cos((latlng.lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
  const tolerance = TAP_TOLERANCE_PX * metersPerPixel;
  return state.routes
    .map((r) => ({ r, d: distanceToRoute(r, latlng) }))
    .filter(({ r, d }) => d <= tolerance && r.id !== state.selectedId)
    .sort((a, b) => a.d - b.d)
    .map(({ r }) => r);
}

// Tocar una línea abre esa ruta; si por ahí pasan varias, se pregunta cuál. En "Cómo llegar",
// si se está eligiendo un punto en el mapa, el toque marca ese punto.
map.on('click', (e) => {
  if (state.view === 'trip') {
    if (state.trip?.mapPick) setTripPoint(state.trip.mapPick, mapPlace(e.latlng));
    return;
  }
  const hits = routesAt(e.latlng);
  if (hits.length === 0) return;
  if (hits.length === 1) {
    selectRoute(hits[0].id);
    return;
  }
  const box = L.DomUtil.create('div', 'pick-box');
  box.innerHTML = `<p class="pick-title">Por aquí pasan ${hits.length} rutas:</p>${hits.slice(0, 8).map((r) =>
    `<button type="button" class="pick" data-id="${r.id}">${refBadge(r)}<span>${escapeHtml(r.name)}</span></button>`).join('')}`;
  box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button.pick');
    if (!btn) return;
    map.closePopup();
    selectRoute(btn.dataset.id);
  });
  L.popup({ closeButton: false, offset: [0, -4], className: 'pick-popup' }).setLatLng(e.latlng).setContent(box).openOn(map);
});

// Clic derecho o mantener presionado: menú para salir o llegar a ese punto (y, en la lista,
// ver las rutas que pasan cerca).
map.on('contextmenu', (e) => {
  const inTrip = state.view === 'trip' && state.trip;
  const box = L.DomUtil.create('div', 'pick-box');
  box.innerHTML = `
    <button type="button" class="pick" data-point="from"><span class="od-dot od-from"></span><span>Salir desde aquí</span></button>
    <button type="button" class="pick" data-point="to"><span class="od-dot od-to"></span><span>Llegar aquí</span></button>
    ${inTrip ? '' : `<button type="button" class="pick" data-point="near">${PIN}<span>Rutas que pasan cerca</span></button>`}`;
  box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-point]');
    if (!btn) return;
    map.closePopup();
    const which = btn.dataset.point;
    if (which === 'near') findNearby(e.latlng, 'punto');
    else if (state.view === 'trip' && state.trip) setTripPoint(which, mapPlace(e.latlng));
    else if (which === 'to') startTrip(mapPlace(e.latlng));
    else startTrip(null, { from: mapPlace(e.latlng) });
  });
  L.popup({ closeButton: false, offset: [0, -4], className: 'pick-popup' }).setLatLng(e.latlng).setContent(box).openOn(map);
});

// ---------- Ubicación ----------

function getPosition() {
  return new Promise((resolve, reject) => {
    // Por http:// (salvo localhost) el navegador no deja pedir la ubicación.
    if (!window.isSecureContext) {
      reject(new Error('En esta dirección el navegador no permite pedir la ubicación: necesita HTTPS.'));
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error('Tu navegador no permite obtener la ubicación.'));
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
      if (!AREA.contains(latlng)) {
        reject(new Error('Parece que no estás en Barranquilla.'));
        return;
      }
      state.lastGps = { latlng, at: Date.now() };
      resolve(latlng);
    }, (err) => {
      reject(new Error({
        1: 'Necesitamos permiso para ver tu ubicación: actívalo en el navegador e inténtalo de nuevo.',
        3: 'La ubicación tardó demasiado. Inténtalo de nuevo.',
      }[err.code] || 'No pudimos obtener tu ubicación.'));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

function setLocating(locating) {
  locateBtn.disabled = locating;
  locateBtn.classList.toggle('loading', locating);
  locateBtn.querySelector('span').textContent = locating ? 'Buscando…' : 'Cerca de mí';
}

const LONG_PRESS_HINT = 'También puedes mantener presionado (o hacer clic derecho) en el mapa para elegir un punto.';

async function locateUser() {
  setLocating(true);
  try {
    const latlng = await getPosition();
    if (state.view === 'trip') setTripPoint(state.trip.editing || 'from', gpsPlace(latlng));
    else findNearby(latlng, 'gps');
  } catch (err) {
    if (state.view === 'trip') {
      state.trip.error = err.message;
      if (!state.trip.editing) state.trip.editing = state.trip.from ? 'to' : 'from';
      renderTrip();
    } else {
      if (state.view !== 'browse') goBack();
      renderNear(`${escapeHtml(err.message)} ${LONG_PRESS_HINT}`);
    }
  } finally {
    setLocating(false);
  }
}

// ---------- Cerca de mí ----------

function findNearby(latlng, source) {
  const dists = new Map(state.routes.map((r) => [r.id, distanceToRoute(r, latlng)]));
  const radius = NEAR_RADII.find((r) => [...dists.values()].some((d) => d <= r)) ?? null;
  state.near = { latlng, source, radius, dists };

  nearLayer.clearLayers();
  if (radius) {
    L.circle(latlng, {
      radius, pane: 'red', color: '#0B3D91', weight: 1.5, dashArray: '4 6',
      fillColor: '#00AEEF', fillOpacity: 0.08, interactive: false,
    }).addTo(nearLayer);
  }
  L.circleMarker(latlng, { pane: 'yo', radius: 8, color: '#fff', weight: 3, fillColor: '#00AEEF', fillOpacity: 1 })
    .bindTooltip(source === 'gps' ? 'Estás aquí' : 'Punto elegido')
    .addTo(nearLayer);

  if (state.view !== 'browse') {
    history.replaceState(null, '', location.pathname + location.search);
    showBrowse();
  }
  map.fitBounds(latlng.toBounds((radius || 1000) * 2.2), { animate: animate() });
  renderNear();
  renderList();
  els.scroll.scrollTop = 0;
}

function exitNearby() {
  state.near = null;
  nearLayer.clearLayers();
  renderNear();
  renderList();
}

function renderNear(message = null) {
  if (message) {
    els.near.className = 'near error';
    els.near.innerHTML = `<span>${message}</span><button type="button" class="link-btn" data-action="close-near">Cerrar</button>`;
    els.near.hidden = false;
    return;
  }
  if (!state.near) {
    els.near.hidden = true;
    return;
  }
  const { source, radius } = state.near;
  const where = source === 'gps' ? 'de ti' : 'del punto marcado';
  const text = radius
    ? `${PIN}<span>Rutas a menos de <strong>${formatDistance(radius)}</strong> ${where}</span>`
    : `${PIN}<span>Ninguna ruta mapeada pasa a menos de ${formatDistance(NEAR_RADII.at(-1))} ${where}</span>`;
  els.near.className = 'near';
  els.near.innerHTML = `${text}<button type="button" class="link-btn" data-action="close-near">Salir</button>`;
  els.near.hidden = false;
}

// ---------- Buscar lugares ----------
// Mientras se escribe se muestran los lugares que coinciden: al instante los de la lista
// local (data/lugares.json más las estaciones y paradas) y, apenas se deja de escribir,
// los de Photon, un buscador de OpenStreetMap hecho para buscar mientras se escribe.

const PHOTON_URL = 'https://photon.komoot.io/api/';
const PHOTON_DELAY_MS = 350; // esperar a que se deje de escribir antes de consultar
const MAX_PLACES = 8;
// Al ordenar coincidencias, estos tipos de lugar suelen ser lo que la gente busca.
const PLACE_PRIORITY = {
  Barrio: 3, Universidad: 3, 'Centro comercial': 3, 'Estación de Transmetro': 3, Aeropuerto: 3,
  Municipio: 2, Hospital: 2, Clínica: 2, Estadio: 2, Parque: 2, 'Terminal de buses': 2, Mercado: 2,
};
const remote = { q: null, items: [], loading: false, timer: null, controller: null };

// Para comparar se ignoran prefijos que no dicen nada: "C. C. Viva" se busca como "viva".
const placeKey = (name) => normalize(name).replace(/^(c\.?\s?c\.?|centro comercial|barrio|urb\.?|urbanizacion)\s+/, '');

function buildPlaceIndex(lugares) {
  const seen = new Set();
  const stops = [];
  for (const r of state.routes) {
    for (const s of r.stops) {
      if (s.generic || seen.has(s.key)) continue;
      seen.add(s.key);
      const tipo = s.tipo === 'estacion' ? 'Estación de Transmetro' : 'Parada de bus';
      stops.push({ name: stopLabel(s), detail: tipo, tipo, latlng: L.latLng(s.lat, s.lon), key: placeKey(stopLabel(s)) });
    }
  }
  const all = [
    ...lugares.map((l) => ({
      name: l.nombre, detail: [l.tipo, l.zona].filter(Boolean).join(' · '), tipo: l.tipo,
      latlng: L.latLng(l.lat, l.lon), key: placeKey(l.nombre),
    })),
    ...stops,
  ];
  // En OSM un mismo lugar a veces está dos veces (como punto y como área): se deja uno.
  state.places = all.filter((p, i) => !all.slice(0, i).some((o) =>
    o.key === p.key && o.tipo === p.tipo && o.latlng.distanceTo(p.latlng) < 1000));
}

// Todas las palabras escritas deben aparecer en el nombre; puntúa más si están al comienzo
// de una palabra ("norte" encuentra "Universidad del Norte") y mucho más si es el nombre exacto.
function placeScore(place, q, words) {
  let score = place.key === q ? 50 : 0;
  for (const w of words) {
    const i = place.key.indexOf(w);
    if (i < 0) return 0;
    score += i === 0 || place.key[i - 1] === ' ' ? 30 : 10;
  }
  return score + (PLACE_PRIORITY[place.tipo] || 1);
}

function localPlaceMatches(q) {
  const words = q.split(/\s+/).filter(Boolean);
  return state.places
    .map((p) => ({ p, score: placeScore(p, q, words) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.length - b.p.name.length)
    .slice(0, MAX_PLACES)
    .map((m) => m.p);
}

// Tipo de lugar según OSM, para ordenar lo que devuelve Photon (un centro comercial antes que
// una oficina con el mismo nombre).
const PHOTON_TYPES = {
  mall: 'Centro comercial', university: 'Universidad', college: 'Institución educativa', hospital: 'Hospital',
  clinic: 'Clínica', suburb: 'Barrio', neighbourhood: 'Barrio', quarter: 'Barrio', town: 'Municipio',
  stadium: 'Estadio', park: 'Parque', marketplace: 'Mercado', bus_station: 'Terminal de buses', aerodrome: 'Aeropuerto',
};

function photonPlace(feature) {
  const p = feature.properties;
  const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
  if (!name) return null;
  const tipo = PHOTON_TYPES[p.osm_value];
  const detail = [tipo, p.name && p.street, p.district || p.locality, p.city]
    .filter((v, i, all) => v && all.indexOf(v) === i).join(' · ');
  const [lon, lat] = feature.geometry.coordinates;
  return { name, detail, tipo, latlng: L.latLng(lat, lon), key: placeKey(name) };
}

function scheduleRemoteSearch(text) {
  const query = text.trim();
  const q = normalize(query);
  clearTimeout(remote.timer);
  remote.controller?.abort();
  if (q.length < 3) {
    Object.assign(remote, { q: null, items: [], loading: false });
    return;
  }
  Object.assign(remote, { q, items: [], loading: true });
  remote.timer = setTimeout(async () => {
    remote.controller = new AbortController();
    try {
      const params = new URLSearchParams({ q: query, limit: '12', bbox: '-74.98,10.82,-74.70,11.11' });
      const res = await fetch(`${PHOTON_URL}?${params}`, { signal: remote.controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (remote.q !== q) return;
      // Se respeta el orden de Photon, pero los tipos de lugar más buscados van primero.
      remote.items = json.features.map(photonPlace).filter(Boolean)
        .map((place, i) => ({ place, rank: (PLACE_PRIORITY[place.tipo] || 0) * -100 + i }))
        .sort((a, b) => a.rank - b.rank)
        .map((x) => x.place);
    } catch (err) {
      if (err.name === 'AbortError' || remote.q !== q) return;
      remote.items = []; // sin internet: quedan los lugares de la lista local
    }
    remote.loading = false;
    refreshPlaceViews();
  }, PHOTON_DELAY_MS);
}

// Lugares que coinciden: primero los de la lista local y luego los de Photon (sin repetir).
function placeMatches(q) {
  const local = localPlaceMatches(q);
  const extra = remote.q === q
    ? remote.items.filter((r) => !local.some((l) => l.key === r.key && l.latlng.distanceTo(r.latlng) < 300))
    : [];
  return [...local, ...extra].slice(0, MAX_PLACES);
}

// Cuando llegan resultados de Photon, se actualiza donde se esté buscando.
function refreshPlaceViews() {
  if (state.view === 'trip' && state.trip?.editing) renderTripResults();
  else renderList();
}

function placesHtml(q) {
  state.placeResults = placeMatches(q);
  const pending = remote.loading && remote.q === q;
  if (!state.placeResults.length && !pending) return '';
  const items = state.placeResults.map((p, i) => `<li><button type="button" class="place-item" data-place="${i}">${PIN}
    <span class="txt"><span class="name">${escapeHtml(p.name)}</span>${p.detail ? `<span class="meta">${escapeHtml(p.detail)}</span>` : ''}</span>${CHEVRON}</button></li>`).join('');
  return `<section class="group places"><h3>Lugares</h3>
    ${items ? `<ul class="list">${items}</ul>` : ''}
    ${pending ? '<p class="note">Buscando más lugares…</p>' : ''}
  </section>`;
}

// ---------- Cómo llegar ----------
// Un viaje tiene "Desde" y "Hasta". Cada uno puede ser tu ubicación, un lugar buscado, uno de
// tus lugares guardados o un punto marcado en el mapa (que se puede arrastrar para ajustarlo).

const PHOTON_REVERSE_URL = 'https://photon.komoot.io/reverse';
const TRIP_FIELDS = { from: 'Desde', to: 'Hasta' };
const gpsPlace = (latlng) => ({ name: 'Tu ubicación', detail: '', latlng, source: 'gps' });
const mapPlace = (latlng) => ({ name: 'Punto en el mapa', detail: '', latlng, source: 'mapa' });
const canUseGps = () => window.isSecureContext && 'geolocation' in navigator;
const withLabel = (place) => (place ? { ...place, label: savedPlace(place)?.label || place.label || null } : null);
const isUserPlace = (place) => place.source !== 'mapa' && place.source !== 'gps'; // vale la pena en "Recientes"

function newTrip(from, to) {
  const trip = {
    from: withLabel(from), to: withLabel(to), options: null, selected: 0,
    error: null, editing: null, mapPick: null, text: '', results: [], focusEditor: false, triedGps: false,
  };
  trip.editing = !trip.to ? 'to' : !trip.from ? 'from' : null;
  return trip;
}

function startTrip(to, { from = null } = {}) {
  if (to && isUserPlace(to) && !savedPlace(to)) addRecent(to);
  const fresh = state.lastGps && Date.now() - state.lastGps.at < GPS_FRESH_MS;
  state.trip = newTrip(from || (fresh ? gpsPlace(state.lastGps.latlng) : null), to);
  for (const which of ['from', 'to']) if (state.trip[which]?.source === 'mapa') nameMapPoint(state.trip, which);
  go(to ? tripHash(to) : '#viaje', { deeper: state.view === 'browse' });
  if (state.trip.from && state.trip.to) planIfReady();
  else autoLocate();
}

// Si falta el punto de partida, se intenta una vez con la ubicación del celular.
function autoLocate() {
  const trip = state.trip;
  if (trip.from || !trip.to || trip.triedGps || !canUseGps()) return;
  trip.triedGps = true;
  locateUser();
}

function setTripPoint(which, place) {
  const trip = state.trip;
  trip[which] = withLabel(place);
  Object.assign(trip, { editing: null, mapPick: null, error: null, text: '' });
  map.getContainer().classList.remove('picking-point');
  if (which === 'to' && isUserPlace(place) && !savedPlace(place)) addRecent(place);
  if (place.source === 'mapa') nameMapPoint(trip, which);
  if (!trip.to) trip.editing = 'to';
  else if (!trip.from) trip.editing = 'from';
  updateTripHash();
  planIfReady();
  autoLocate();
}

function updateTripHash() {
  history.replaceState(history.state, '', state.trip.to ? tripHash(state.trip.to) : '#viaje');
}

function swapTrip() {
  const trip = state.trip;
  [trip.from, trip.to] = [trip.to, trip.from];
  Object.assign(trip, { editing: !trip.to ? 'to' : !trip.from ? 'from' : null, mapPick: null });
  updateTripHash();
  planIfReady();
}

function openEditor(which) {
  const trip = state.trip;
  const closing = trip.editing === which && trip[which];
  Object.assign(trip, { editing: closing ? null : which, mapPick: null, text: '', error: null, focusEditor: !closing });
  map.getContainer().classList.remove('picking-point');
  renderTrip();
}

function startMapPick(which) {
  Object.assign(state.trip, { mapPick: which, editing: null });
  map.getContainer().classList.add('picking-point');
  setSheet(false); // en el celular, que se vea el mapa
  renderTrip();
}

// Calcula las opciones cuando están los dos puntos. Puede tardar un momento en un celular:
// primero se muestra "Calculando rutas…".
function planIfReady() {
  const trip = state.trip;
  trip.options = null;
  trip.selected = 0;
  drawTrip();
  renderTrip();
  if (!trip.from || !trip.to) return;
  const { from, to } = trip;
  setTimeout(() => {
    if (state.trip !== trip || trip.from !== from || trip.to !== to) return; // mientras tanto cambió
    trip.options = planTrip(from.latlng, to.latlng);
    drawTrip();
    if (!trip.editing && !trip.mapPick) renderTrip();
  }, 30);
}

// A un punto marcado en el mapa se le pone el nombre de la calle más cercana.
async function nameMapPoint(trip, which) {
  const place = trip[which];
  try {
    const params = new URLSearchParams({ lat: place.latlng.lat, lon: place.latlng.lng, limit: '1' });
    const res = await fetch(`${PHOTON_REVERSE_URL}?${params}`);
    if (!res.ok) return;
    const p = (await res.json()).features?.[0]?.properties;
    if (!p || trip[which] !== place) return;
    const name = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : p.name;
    if (!name) return;
    place.name = name;
    place.detail = [p.district || p.locality, p.city].filter((v, i, all) => v && all.indexOf(v) === i).join(' · ');
    if (state.trip !== trip) return;
    if (which === 'to') updateTripHash();
    if (!trip.editing) renderTrip();
  } catch {
    // sin internet se queda como "Punto en el mapa"
  }
}

function drawTrip() {
  tripLayer.clearLayers();
  const { from, to, options, selected } = state.trip;
  const bounds = L.latLngBounds([]);

  // Salida y llegada se pueden arrastrar para ajustarlas.
  const pointMarker = (which, place, icon, tooltip) => {
    const marker = L.marker(place.latlng, { pane: 'yo', draggable: true, autoPan: true, icon })
      .bindTooltip(escapeHtml(tooltip), { direction: 'top', offset: which === 'to' ? [0, -34] : [0, -12] });
    marker.on('dragend', () => setTripPoint(which, mapPlace(marker.getLatLng())));
    marker.addTo(tripLayer);
    bounds.extend(place.latlng);
  };
  if (to) {
    pointMarker('to', to, L.divIcon({ className: 'dest-icon', html: DEST_PIN, iconSize: [30, 38], iconAnchor: [15, 36] }),
      `Llegada: ${placeTitle(to)}`);
  }
  if (from) {
    pointMarker('from', from, L.divIcon({ className: 'origin-icon', html: '<span></span>', iconSize: [24, 24] }),
      from.source === 'gps' ? 'Estás aquí' : `Salida: ${placeTitle(from)}`);
  }

  const option = options?.[selected];
  for (const leg of option?.legs ?? []) {
    if (leg.type === 'walk') {
      if (leg.meters < 15) continue;
      L.polyline([leg.from, leg.to], {
        pane: 'rutas', color: '#4B5563', weight: 4, opacity: 0.9, dashArray: '1 9', lineCap: 'round', interactive: false,
      }).addTo(tripLayer);
      continue;
    }
    const ref = leg.route.tags.ref || 'ruta';
    addRouteLine(tripLayer, leg.path, leg.route.color);
    for (const [latlng, label] of [[leg.path[0], `Súbete a la ${ref}`], [leg.path[leg.path.length - 1], `Bájate de la ${ref}`]]) {
      L.circleMarker(latlng, { pane: 'paradas', radius: 6, color: leg.route.color, weight: 3, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(escapeHtml(label), { direction: 'top', offset: [0, -6] })
        .addTo(tripLayer);
    }
    leg.path.forEach((pt) => bounds.extend(pt));
  }

  if (from && to) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16, animate: animate() });
  else if (from || to) map.setView((to || from).latlng, Math.max(map.getZoom(), 15), { animate: animate() });
}

function fareToday(date = new Date()) {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const festivo = date.getDay() === 0 || FESTIVOS.has(iso);
  return { value: festivo ? FARE.festivo : FARE.normal, festivo };
}

const formatPesos = (n) => `$${n.toLocaleString('es-CO')}`;

// Pasajes que se pagan en una opción: en Transmetro un solo pago sirve para cambiar de
// ruta (alimentadora ↔ troncal); cada bus tradicional se paga aparte.
function faresFor(option) {
  let count = 0;
  let previousTransmetro = false;
  for (const leg of option.legs) {
    if (leg.type !== 'bus') continue;
    const transmetro = leg.route.group === 'troncal' || leg.route.group === 'alimentadora';
    if (!(transmetro && previousTransmetro)) count += 1;
    previousTransmetro = transmetro;
  }
  return count;
}

// Al ordenar las opciones, cada pasaje adicional cuenta como estos minutos: una opción
// un poco más lenta pero con un solo pasaje queda antes que una de dos pasajes.
const EXTRA_FARE_MINUTES = 10;

function planTrip(from, to) {
  return Planner.plan(state.routes, from, to, {
    extraCost: (option) => Math.max(0, faresFor(option) - 1) * EXTRA_FARE_MINUTES,
  });
}

// Texto de cada paso: "Camina 300 m hasta …", "Toma la A9-3 … Bájate en …".
function stepsHtml(option) {
  const { to } = state.trip;
  const toName = placeTitle(to);
  const steps = [];
  option.legs.forEach((leg, k) => {
    const next = option.legs[k + 1];
    if (leg.type === 'walk') {
      if (leg.meters < 30 && option.legs.length > 1) return;
      const target = !next ? `<strong>${escapeHtml(toName)}</strong>`
        : next.board ? `<strong>${escapeHtml(next.board.nombre)}</strong>`
          : `donde pasa ${busPhrase(next.route)}`;
      steps.push(`<li class="step">${WALK}<span>Camina ${formatDistance(leg.meters)} (${formatMinutes(leg.minutes)}) hasta ${target}.</span></li>`);
      return;
    }
    const r = leg.route;
    const after = option.legs[k + 2]; // el siguiente bus, si hay transbordo
    const off = leg.alight ? `en <strong>${escapeHtml(leg.alight.nombre)}</strong>`
      : after ? `donde pasa ${busPhrase(after.route)}`
        : `cerca de <strong>${escapeHtml(toName)}</strong>`;
    const toward = r.tags.to ? ` hacia ${escapeHtml(cleanPlace(r.tags.to))}` : '';
    const count = leg.stops ? `${leg.stops} ${leg.stops === 1 ? 'parada' : 'paradas'}, ` : '';
    steps.push(`<li class="step" style="${escapeHtml(r.style)}">${refBadge(r)}<span>Toma ${busPhrase(r)}${toward}
      (${count}${formatMinutes(leg.minutes)}). Bájate ${off}.
      <button type="button" class="link-btn" data-route="${r.id}">Ver la ruta</button></span></li>`);
  });
  return steps.join('');
}

function optionHtml(option, i, selected) {
  const buses = option.legs.filter((l) => l.type === 'bus');
  const walked = option.legs.filter((l) => l.type === 'walk').reduce((sum, l) => sum + l.meters, 0);
  const badges = option.kind === 'walk'
    ? `<span class="walk-badge">${WALK}A pie</span>`
    : buses.map((l) => refBadge(l.route)).join('<i class="sep">›</i>');
  const fares = faresFor(option);
  const price = fares ? ` · ${fares} ${fares === 1 ? 'pasaje' : 'pasajes'}: ${formatPesos(fares * fareToday().value)}` : '';
  const kind = option.kind === 'walk' ? `Caminando ${formatDistance(walked)} · sin pasaje`
    : `${option.kind === 'direct' ? 'Directo' : 'Con 1 transbordo'} · caminas ${formatDistance(walked)}${price}`;
  return `<li class="option${selected ? ' selected' : ''}">
    <button type="button" class="option-head" data-option="${i}" aria-expanded="${selected}">
      <span class="opt-badges">${badges}</span>
      <span class="opt-time">${formatMinutes(option.minutes)}</span>
      <span class="opt-meta">${kind}</span>
    </button>
    ${selected ? `<ol class="steps">${stepsHtml(option)}</ol>` : ''}
  </li>`;
}

// Guardar el destino en "Tus lugares" (o ver que ya está guardado y poder quitarlo).
function saveRowHtml(to) {
  const saved = savedPlace(to);
  if (saved) {
    return `<div class="save-row">${ICONS[saved.label || 'favorito']}
      <span>${saved.label ? `Guardado como ${LABELS[saved.label]}` : 'Guardado en tus lugares'}</span>
      <button type="button" class="link-btn" data-action="unsave">Quitar</button></div>`;
  }
  return `<div class="save-row"><span>Guardar este lugar:</span>
    <button type="button" class="chip-btn" data-save="casa">${ICONS.casa}<span>Casa</span></button>
    <button type="button" class="chip-btn" data-save="trabajo">${ICONS.trabajo}<span>Trabajo</span></button>
    <button type="button" class="chip-btn" data-save="favorito">${ICONS.favorito}<span>Favorito</span></button></div>`;
}

// Lista para elegir "Desde" o "Hasta": atajos cuando no se ha escrito nada y lugares que
// coinciden cuando sí (los mismos del buscador principal).
function renderTripResults() {
  const trip = state.trip;
  const box = els.trip.querySelector('#od-results');
  if (!box || !trip.editing) return;
  const row = (attr, icon, title, detail) => `<li><button type="button" class="place-item" ${attr}>${icon}
    <span class="txt"><span class="name">${escapeHtml(title)}</span>${detail ? `<span class="meta">${escapeHtml(detail)}</span>` : ''}</span></button></li>`;
  const other = trip[trip.editing === 'from' ? 'to' : 'from'];
  const q = normalize(trip.text.trim());
  let html = trip.error ? `<p class="note error">${escapeHtml(trip.error)}</p>` : '';

  if (!q) {
    const rows = [
      row('data-od="gps"', GPS_ICON, 'Mi ubicación', canUseGps() ? '' : 'En el celular necesita que la app esté publicada con HTTPS'),
      row('data-od="map"', MAP_ICON, 'Elegir en el mapa', 'Tocas el punto en el mapa'),
    ];
    store.places.forEach((s, i) => {
      if (other && samePlace(s, toStored(other))) return;
      rows.push(row(`data-od-saved="${i}"`, ICONS[s.label || 'favorito'], s.label ? LABELS[s.label] : s.name, s.label ? s.name : s.detail));
    });
    store.recent.forEach((s, i) => {
      if (store.places.some((p) => samePlace(p, s))) return;
      rows.push(row(`data-od-recent="${i}"`, ICONS.reciente, s.name, s.detail));
    });
    html += `<ul class="list">${rows.join('')}</ul>`;
  } else {
    trip.results = placeMatches(q);
    const pending = remote.loading && remote.q === q;
    html += trip.results.length
      ? `<ul class="list">${trip.results.map((p, i) => row(`data-od-place="${i}"`, PIN, p.name, p.detail)).join('')}</ul>`
      : pending ? '' : '<p class="note">No encontramos ese lugar. Prueba con otro nombre, o elige el punto en el mapa.</p>';
    if (pending) html += '<p class="note">Buscando más lugares…</p>';
  }
  box.innerHTML = html;
}

function renderTrip() {
  const trip = state.trip;
  const { from, to, options, selected, editing, mapPick } = trip;

  const field = (which, place) => `<button type="button" class="od-row${editing === which ? ' active' : ''}" data-edit="${which}">
      <span class="od-dot od-${which}" aria-hidden="true"></span>
      <span class="od-text"><span class="od-label">${TRIP_FIELDS[which]}</span>
        <span class="od-value">${place ? escapeHtml(placeTitle(place)) : `<span class="muted">${which === 'from' ? 'Elige desde dónde sales' : 'Elige a dónde vas'}</span>`}</span></span>
    </button>`;

  let body = '';
  if (mapPick) {
    body = `<div class="near">${PIN}<span>Toca el mapa en el punto de <strong>${mapPick === 'from' ? 'salida' : 'llegada'}</strong></span>
      <button type="button" class="link-btn" data-action="cancel-map-pick">Cancelar</button></div>`;
  } else if (editing) {
    body = `<div class="od-editor">
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input id="od-input" type="search" enterkeyhint="search" autocomplete="off"
               placeholder="${editing === 'from' ? 'Busca desde dónde sales' : 'Busca a dónde vas'}"
               aria-label="${editing === 'from' ? 'Punto de salida' : 'Punto de llegada'}">
      </label>
      <div id="od-results"></div>
    </div>`;
  } else if (!from || !to) {
    body = '';
  } else if (!options) {
    body = '<p class="empty-trip">Calculando rutas…</p>';
  } else if (!options.length) {
    body = `<p class="empty-trip">No encontramos una ruta que te lleve, ni con un transbordo. Puede que la que sirve
      no esté en los datos de la app (rutas de Transmetro en OpenStreetMap y buses tradicionales del AMB).</p>`;
  } else {
    const fare = fareToday();
    body = `<ol class="options">${options.map((o, i) => optionHtml(o, i, i === selected)).join('')}</ol>
      <p class="muted small">Pasaje ${fare.festivo ? 'de domingo y festivo' : 'de hoy'}: ${formatPesos(fare.value)}
        (${fare.festivo ? `de lunes a sábado ${formatPesos(FARE.normal)}` : `domingos y festivos ${formatPesos(FARE.festivo)}`}).
        En Transmetro un pasaje sirve para cambiar de ruta y se paga solo con tarjeta; cada bus tradicional se paga aparte,
        aunque con la tarjeta SIBUS algunos transbordos entre buses tradicionales cuestan menos.</p>
      <p class="muted small">Tiempos aproximados, sin contar la espera del bus. Los buses tradicionales no tienen paradas
        publicadas: súbete donde pasa la ruta. Puedes arrastrar los puntos de salida y llegada en el mapa.</p>`;
  }

  els.trip.innerHTML = `
    <div class="route-head">
      <button type="button" class="back" data-action="back" aria-label="Volver">${BACK}</button>
      <div class="route-title"><h2>${to ? `Cómo llegar a ${escapeHtml(placeTitle(to))}` : 'Cómo llegar'}</h2></div>
      ${to ? `<button type="button" class="star" data-action="share-trip" aria-label="Compartir cómo llegar" title="Compartir">${SHARE_ICON}</button>` : ''}
    </div>
    <div class="route-body">
      <div class="od">${field('from', from)}${field('to', to)}
        <button type="button" class="od-swap" data-action="swap" aria-label="Intercambiar salida y llegada" title="Intercambiar">${SWAP_ICON}</button>
      </div>
      ${to && to.source !== 'gps' && !editing && !mapPick ? saveRowHtml(to) : ''}
      ${body}
    </div>`;

  if (editing) {
    const input = els.trip.querySelector('#od-input');
    input.value = trip.text;
    renderTripResults();
    if (trip.focusEditor) {
      input.focus();
      trip.focusEditor = false;
    }
  }
}

// ---------- Lista ----------

function routeItem({ r, note }, title = r.name) {
  return `<li><button type="button" class="route-item" data-id="${r.id}" style="${escapeHtml(r.style)}">
    <span class="ref">${escapeHtml(r.tags.ref || '·')}</span>
    <span class="txt"><span class="name">${escapeHtml(title)}</span>${note ? `<span class="meta">${escapeHtml(note)}</span>` : ''}</span>
    ${CHEVRON}</button></li>`;
}

// El código con el que el AMB lista la ruta en su visor: "A1-4106 A", "C1-B-4186".
function ambCode(r) {
  const t = r.tags;
  const side = { ida: ' A', vuelta: ' B' }[t['amb:sentido']] || '';
  return t['amb:codigo'] ? `${t.ref}-${t['amb:codigo']}${side}` : t.ref;
}

// Carpeta que se despliega al tocarla (Transmetro o una empresa de buses tradicionales).
// Mientras se busca, las carpetas con resultados se muestran abiertas.
function folderHtml(name, count, body, searching) {
  const open = searching || state.openCompanies.has(name);
  return `<details class="company" data-company="${escapeHtml(name)}"${open ? ' open' : ''}>
    <summary><span class="company-name">${escapeHtml(name)}</span>
      <span class="company-count">${count} ${count === 1 ? 'ruta' : 'rutas'}</span>${CHEVRON}</summary>
    <div class="folder-body">${body}</div>
  </details>`;
}

// Transmetro en una carpeta; adentro, troncales y alimentadoras como subgrupos.
function transmetroHtml(items, searching) {
  const body = [['troncal', 'Troncales'], ['alimentadora', 'Alimentadoras']].map(([key, title]) => {
    const list = items.filter((m) => m.r.group === key);
    return list.length
      ? `<h4 class="subgroup">${title} <span>${list.length}</span></h4><ul class="list">${list.map((m) => routeItem(m)).join('')}</ul>`
      : '';
  }).join('');
  return folderHtml('Transmetro', items.length, body, searching);
}

// Buses tradicionales agrupados por empresa, como en el visor del AMB.
function companiesHtml(items, searching) {
  const byCompany = new Map();
  for (const m of items) {
    const company = m.r.tags.operator;
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(m);
  }
  return [...byCompany].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([company, list]) => {
    const routes = list.map((m) => {
      const t = m.r.tags;
      const title = t.from && t.to ? `${t.from} → ${t.to}` : `Ruta ${t.ref}${t['amb:sentido'] ? ` (${t['amb:sentido']})` : ''}`;
      return routeItem({ r: m.r, note: m.note && m.note !== m.r.network ? m.note : ambCode(m.r) }, title);
    }).join('');
    return folderHtml(company, list.length, `<ul class="list">${routes}</ul>`, searching);
  }).join('');
}

function renderList() {
  const q = normalize(state.text.trim());
  const near = state.near?.radius ? state.near : null;

  const matches = [];
  for (const r of state.routes) {
    let note = r.group === 'colectivo' && r.tags.from ? r.network : '';
    if (q && !r.haystack.includes(q)) {
      // También se busca por calle, estación o parada: "¿qué rutas pasan por la 72?"
      const place = r.streets.find((s) => s.key.includes(q)) || r.stops.find((s) => s.key.includes(q));
      if (!place) continue;
      note = `Pasa por ${place.nombre}`;
    }
    if (near) {
      const d = near.dists.get(r.id);
      if (d > near.radius) continue;
      note = [`A ${formatDistance(d)}`, q ? note : ''].filter(Boolean).join(' · ');
    }
    matches.push({ r, note });
  }

  els.hint.hidden = Boolean(q || state.near || state.picking);
  // Primero los lugares que coinciden (para "cómo llegar") y debajo las rutas.
  const places = q.length >= 2 ? placesHtml(q) : '';

  let routesHtml;
  if (matches.length === 0) {
    routesHtml = q && !places ? `<p class="empty">No encontramos lugares ni rutas para «${escapeHtml(state.text.trim())}». Prueba con otro nombre.</p>` : '';
  } else if (near) {
    matches.sort((a, b) => near.dists.get(a.r.id) - near.dists.get(b.r.id));
    routesHtml = `<section class="group"><h3>Cerca <span>${matches.length}</span></h3>
      <ul class="list">${matches.map((m) => routeItem(m)).join('')}</ul></section>`;
  } else {
    const searching = Boolean(q);
    routesHtml = SECTIONS.map(([key, title]) => {
      const items = matches.filter((m) => sectionOf(m.r) === key);
      if (!items.length) return '';
      const body = key === 'masivo' ? transmetroHtml(items, searching)
        : key === 'tradicional' ? companiesHtml(items, searching)
          : `<ul class="list">${items.map((m) => routeItem(m)).join('')}</ul>`;
      return `<section class="group"><h3>${title} <span>${items.length}</span></h3>${body}</section>`;
    }).join('');
  }
  if (state.picking) routesHtml = ''; // eligiendo Casa o Trabajo: solo interesan los lugares
  const mine = !q && !state.near && !state.picking ? mineHtml() : '';
  els.groups.innerHTML = mine + places + routesHtml;
  renderPicking();
}

// "Tus lugares" (Casa, Trabajo y favoritos), "Tus rutas" y "Recientes", arriba de la lista.
function mineHtml() {
  const placeRow = (place, icon, action, title, detail, extra = '') => `<li><button type="button" class="place-item" ${action}>
    ${icon}<span class="txt"><span class="name">${escapeHtml(title)}</span>${detail ? `<span class="meta">${escapeHtml(detail)}</span>` : ''}</span>
    ${extra || CHEVRON}</button></li>`;

  const rows = ['casa', 'trabajo'].map((label) => {
    const p = store.places.find((s) => s.label === label);
    return p
      ? placeRow(p, ICONS[label], `data-saved="${store.places.indexOf(p)}"`, LABELS[label], p.name)
      : placeRow(null, ICONS[label], `data-pick="${label}"`, LABELS[label], `Toca para elegir tu ${label === 'casa' ? 'casa' : 'trabajo'}`, '<span class="add">Agregar</span>');
  });
  store.places.forEach((p, i) => {
    if (!p.label) rows.push(placeRow(p, ICONS.favorito, `data-saved="${i}"`, p.name, p.detail));
  });

  const routes = store.routes.map((id) => state.routes.find((r) => r.id === id)).filter(Boolean);
  // Recientes sin repetir lo que ya está en "Tus lugares".
  const recent = store.recent
    .map((p, i) => (store.places.some((s) => samePlace(s, p)) ? '' : placeRow(p, ICONS.reciente, `data-recent="${i}"`, p.name, p.detail)))
    .join('');

  return `<section class="group mine"><h3>Tus lugares</h3><ul class="list">${rows.join('')}</ul></section>
    ${routes.length ? `<section class="group mine"><h3>Tus rutas <span>${routes.length}</span></h3>
      <ul class="list">${routes.map((r) => routeItem({ r, note: r.group === 'colectivo' ? (r.tags.from ? r.network : ambCode(r)) : '' })).join('')}</ul></section>` : ''}
    ${recent ? `<section class="group mine"><h3>Recientes <button type="button" class="link-btn" data-action="clear-recent">Borrar</button></h3>
      <ul class="list">${recent}</ul></section>` : ''}`;
}

// Mientras se elige Casa o Trabajo, un aviso arriba de los resultados con la opción de cancelar.
function renderPicking() {
  if (!state.picking) {
    els.picking.hidden = true;
    return;
  }
  els.picking.className = 'near';
  els.picking.innerHTML = `${ICONS[state.picking]}<span>Busca y toca tu <strong>${state.picking === 'casa' ? 'casa' : 'trabajo'}</strong>
    (dirección, barrio o lugar)</span><button type="button" class="link-btn" data-action="cancel-pick">Cancelar</button>`;
  els.picking.hidden = false;
}

function startPicking(label) {
  state.picking = label;
  els.search.value = '';
  state.text = '';
  scheduleRemoteSearch('');
  renderList();
  els.search.focus();
}

function stopPicking() {
  state.picking = null;
  els.search.value = '';
  state.text = '';
  scheduleRemoteSearch('');
  renderList();
}

function renderAbout(files) {
  const date = (iso) => (iso
    ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'fecha desconocida');
  const osmFile = files.find((f) => !/rea Metropolitana/.test(f.fuente || ''));
  const ambFile = files.find((f) => /rea Metropolitana/.test(f.fuente || ''));
  const osmCount = state.routes.filter((r) => r.fuente === 'osm').length;
  const ambCount = state.routes.filter((r) => r.fuente === 'amb').length;
  els.aboutBody.innerHTML = `
    ${osmFile ? `<p><strong>${osmCount} recorridos</strong> de Transmetro: © colaboradores de
      OpenStreetMap (ODbL), descargados el ${escapeHtml(date(osmFile.generado))}.</p>` : ''}
    ${ambFile ? `<p><strong>${ambCount} recorridos</strong> de buses tradicionales: © Área Metropolitana de Barranquilla,
      tomados de su <a href="${AMB_URL}" target="_blank" rel="noopener">visor de rutas</a> el ${escapeHtml(date(ambFile.generado))},
      para uso personal y sin fines comerciales. El AMB no publica sus paradas.</p>` : ''}
    <p>Búsqueda de lugares con datos de OpenStreetMap y el buscador Photon.</p>
    <p>¿Falta tu ruta? <a href="https://wiki.openstreetmap.org/wiki/Public_transport" target="_blank" rel="noopener">Ayuda a mapearla en OSM</a>
      y aparecerá aquí en la próxima actualización.</p>`;
  els.about.hidden = false;
}

// ---------- Ficha de una ruta ----------

function stopsSummary(stops) {
  const stations = stops.filter((s) => s.tipo === 'estacion').length;
  const plain = stops.length - stations;
  const parts = [];
  if (plain) parts.push(`${plain} ${plain === 1 ? 'parada' : 'paradas'}`);
  if (stations) parts.push(`${stations} ${stations === 1 ? 'estación' : 'estaciones'}`);
  return parts.join(' y ');
}

function renderRoute(route) {
  const t = route.tags;
  const amb = route.fuente === 'amb';
  const meta = amb
    ? [`Bus tradicional · ${t.operator}`, t['amb:sentido'], t['amb:codigo'] && `código AMB ${t['amb:codigo']}`].filter(Boolean).join(' · ')
    : [route.network, stopsSummary(route.stops)].filter(Boolean).join(' · ');

  let nearHtml = '';
  if (state.near) {
    const closest = nearestStop(route, state.near.latlng);
    const who = state.near.source === 'gps' ? 'de ti' : 'del punto';
    nearHtml = `<p class="near-info">Pasa a <strong>${formatDistance(state.near.dists.get(route.id))}</strong> ${who}.${closest
      ? ` Parada más cercana: <button type="button" class="link-btn" data-stop="${route.stops.indexOf(closest.stop)}">${escapeHtml(closest.stop.nombre)}</button> (a ${formatDistance(closest.d)}).`
      : ''}</p>`;
  }

  // Cada calle una sola vez (en ida y vuelta se repiten), en el orden en que la ruta llega a
  // ella. Se muestran las primeras y el resto al tocar "Ver las N calles".
  const streets = [...new Map(route.streets.map((s) => [s.key, s])).values()];
  const streetsHtml = streets.length
    ? `<h3 class="section">Por dónde pasa</h3>
      <ul class="street-chips">${streets.map((s, i) =>
        `<li${i >= VISIBLE_STREETS ? ' class="extra" hidden' : ''}>${escapeHtml(s.nombre)}</li>`).join('')}</ul>
      ${streets.length > VISIBLE_STREETS
        ? `<button type="button" class="link-btn more-streets" data-action="more-streets">Ver las ${streets.length} calles</button>`
        : ''}`
    : '';

  const stopsHtml = route.stops.length
    ? `<h3 class="section">${stopsSummary(route.stops).replace(/^./, (c) => c.toUpperCase())}</h3><ol class="stops">${route.stops.map((s, i) => {
      const station = s.tipo === 'estacion';
      const edge = i === 0 ? '<span class="tag">Sale</span>' : i === route.stops.length - 1 ? '<span class="tag">Llega</span>' : '';
      return `<li class="${station ? 'is-station' : ''}"><button type="button" data-stop="${i}">${escapeHtml(s.nombre)}</button>${station ? '<span class="tag">Estación</span>' : ''}${edge}</li>`;
    }).join('')}</ol>`
    : amb
      ? ''
      : '<p class="muted">Esta ruta aún no tiene paradas mapeadas. Sigue la línea en el mapa: las flechas indican el sentido.</p>';

  els.route.style.cssText = route.style;
  els.route.innerHTML = `
    <div class="route-head">
      <button type="button" class="back" data-action="back" aria-label="Volver">${BACK}</button>
      <span class="ref">${escapeHtml(t.ref || '·')}</span>
      <div class="route-title">
        <h2>${escapeHtml(route.name)}</h2>
        <p>${escapeHtml(meta)}</p>
      </div>
      <button type="button" class="star" data-action="toggle-route" aria-pressed="${isSavedRoute(route.id)}"
              aria-label="${isSavedRoute(route.id) ? 'Quitar de tus rutas' : 'Guardar en tus rutas'}"
              title="${isSavedRoute(route.id) ? 'Quitar de tus rutas' : 'Guardar en tus rutas'}">${ICONS.favorito}</button>
      <button type="button" class="star" data-action="share-route" aria-label="Compartir esta ruta" title="Compartir">${SHARE_ICON}</button>
    </div>
    <div class="route-body">
      ${nearHtml}
      ${streetsHtml}
      ${stopsHtml}
      <p class="legend">${route.stops.length ? '<span class="lg-stop"></span>Parada <span class="lg-station"></span>Estación ' : ''}<span class="lg-arrow">›</span>Sentido del bus</p>
      <p class="muted small">Datos de la ruta: ${amb ? '© Área Metropolitana de Barranquilla (AMB)' : '© colaboradores de OpenStreetMap'}.</p>
      ${reportEnabled() ? '<button type="button" class="link-btn report-btn" data-action="report">Reportar un error en esta ruta</button>' : ''}
    </div>`;
}

// ---------- Compartir ----------
// En el celular se abre el menú de compartir del sistema (WhatsApp, Telegram…); donde no
// existe (computador, o http sin seguridad), una ventana con WhatsApp y "Copiar enlace".

const shareDialog = $('#share-dialog');

const linkFor = (hash) => `${location.origin}${location.pathname}${hash}`;

async function share({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // la persona cerró el menú
    }
  }
  shareDialog.innerHTML = `
    <h2 id="share-title">Compartir</h2>
    <p class="muted small">${escapeHtml(text)}</p>
    <div class="dialog-actions">
      <a class="primary" href="https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}" target="_blank" rel="noopener">WhatsApp</a>
      <button type="button" class="chip-btn" data-action="copy-link">Copiar enlace</button>
    </div>
    <input class="share-url" type="text" readonly value="${escapeHtml(url)}" aria-label="Enlace para compartir">
    <button type="button" class="link-btn dialog-close" data-action="close-dialog">Cerrar</button>`;
  shareDialog.showModal();
}

shareDialog.addEventListener('click', async (e) => {
  if (e.target === shareDialog || e.target.closest('[data-action="close-dialog"]')) {
    shareDialog.close();
    return;
  }
  const copy = e.target.closest('[data-action="copy-link"]');
  if (!copy) return;
  const input = shareDialog.querySelector('.share-url');
  try {
    await navigator.clipboard.writeText(input.value);
    copy.textContent = 'Enlace copiado';
  } catch {
    input.select(); // sin permiso para copiar: queda seleccionado para copiarlo a mano
    copy.textContent = 'Cópialo de la casilla';
  }
});

function shareRoute(route) {
  const company = route.group === 'colectivo' ? route.tags.operator : 'Transmetro';
  const where = route.name !== company ? ` (${route.name})` : ''; // los buses tradicionales a veces solo traen la empresa
  share({ title: `Ruta ${route.tags.ref} · Pa' Donde`, text: `Mira la ruta ${route.tags.ref} de ${company}${where} en Pa' Donde:`, url: linkFor(`#ruta/${route.id}`) });
}

function shareTrip(trip) {
  share({ title: `Cómo llegar a ${trip.to.name} · Pa' Donde`, text: `Mira cómo llegar en bus a ${trip.to.name} con Pa' Donde:`, url: linkFor(tripHash(trip.to)) });
}

// ---------- Reportar un error ----------

const reportDialog = $('#report-dialog');
const PROBLEMS = [
  'El recorrido está mal o cambió',
  'Falta una parada o una parada está mal',
  'El sentido del bus está mal',
  'Esta ruta ya no existe',
  'Otro',
];

function openReport(route) {
  const stop = state.highlightedStop?.routeId === route.id ? state.highlightedStop.stop : null;
  reportDialog.innerHTML = `
    <h2 id="report-title">Reportar un error</h2>
    <p class="muted small">Ruta ${escapeHtml(route.tags.ref || '')} · ${escapeHtml(route.name)}${stop ? ` · ${escapeHtml(stopLabel(stop))}` : ''}</p>
    <fieldset class="problems">
      <legend>¿Qué está mal?</legend>
      ${PROBLEMS.map((p, i) => `<label><input type="radio" name="problem" value="${escapeHtml(p)}"${i === 0 ? ' checked' : ''}> ${escapeHtml(p)}</label>`).join('')}
    </fieldset>
    <label class="comment">Cuéntanos más (opcional)
      <textarea id="report-comment" rows="3" placeholder="Por ejemplo: desde marzo ya no pasa por la Calle 72"></textarea>
    </label>
    <div class="dialog-actions">
      ${REPORT_TO.whatsapp ? '<button type="button" class="primary" data-send="whatsapp">Enviar por WhatsApp</button>' : ''}
      ${REPORT_TO.email ? `<button type="button" class="${REPORT_TO.whatsapp ? 'chip-btn' : 'primary'}" data-send="email">Enviar por correo</button>` : ''}
    </div>
    <button type="button" class="link-btn dialog-close" data-action="close-dialog">Cancelar</button>`;
  reportDialog.dataset.route = route.id;
  reportDialog.showModal();
}

reportDialog.addEventListener('click', (e) => {
  if (e.target === reportDialog || e.target.closest('[data-action="close-dialog"]')) {
    reportDialog.close();
    return;
  }
  const send = e.target.closest('[data-send]');
  if (!send) return;
  const route = state.routes.find((r) => r.id === reportDialog.dataset.route);
  const stop = state.highlightedStop?.routeId === route.id ? state.highlightedStop.stop : null;
  const problem = reportDialog.querySelector('input[name="problem"]:checked').value;
  const comment = reportDialog.querySelector('#report-comment').value.trim();
  const body = [
    "Reporte de error en Pa' Donde",
    `Ruta: ${route.tags.ref || ''} · ${route.name}${route.group === 'colectivo' ? ` (${route.tags.operator}, código AMB ${ambCode(route)})` : ' (Transmetro)'}`,
    stop ? `Parada: ${stopLabel(stop)}` : null,
    `Problema: ${problem}`,
    comment ? `Comentario: ${comment}` : null,
    `Enlace: ${linkFor(`#ruta/${route.id}`)}`,
  ].filter(Boolean).join('\n');
  const url = send.dataset.send === 'whatsapp'
    ? `https://wa.me/${REPORT_TO.whatsapp}?text=${encodeURIComponent(body)}`
    : `mailto:${REPORT_TO.email}?subject=${encodeURIComponent(`Error en la ruta ${route.tags.ref || ''} · Pa' Donde`)}&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank', 'noopener');
  reportDialog.close();
});

// ---------- Guía de "¿Cómo se usa?" ----------
// IMPORTANTE: al agregar o cambiar una función que la gente tenga que conocer, actualizar estos
// pasos y subir GUIDE_VERSION: así la guía nueva se muestra una vez a quienes ya vieron la anterior.

const guide = $('#guide');
const GUIDE_KEY = 'padonde:guia-vista';
const GUIDE_VERSION = '3';
const guideIcon = (svg) => svg.replace('class="fav-icon"', 'class="guide-icon"');
const GUIDE_STEPS = [
  {
    icon: '<svg class="guide-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    title: 'Busca a dónde vas',
    text: 'Escribe un lugar, un barrio o una dirección: arriba salen los lugares y, debajo, las rutas que pasan por ahí. Para ver el recorrido de una ruta, tócala en la lista o toca su línea en el mapa.',
  },
  {
    icon: '<svg class="guide-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="15" rx="3"/><path d="M5 11h14M8.5 21.5v-3M15.5 21.5v-3M8.5 15h.01M15.5 15h.01"/></svg>',
    title: 'Mira cómo llegar',
    text: 'Toca un lugar, o el botón ◆ junto al buscador, y elige Desde y Hasta: tu ubicación, un lugar o un punto del mapa (⇅ los intercambia). Te mostramos qué buses tomar, dónde subirte y bajarte, cuánto tardas y cuánto cuesta.',
  },
  {
    icon: guideIcon(MAP_ICON),
    title: 'Usa el mapa',
    text: 'Mantén presionado el mapa (clic derecho en el computador) para «Salir desde aquí» o «Llegar aquí». Arrastra los puntos de salida y llegada para ajustarlos. «Cerca de mí» muestra las rutas que pasan cerca.',
  },
  {
    icon: guideIcon(ICONS.favorito),
    title: 'Guarda y comparte',
    text: 'En «Tus lugares» agrega tu Casa y tu Trabajo; guarda otros lugares y tus rutas con la estrella. Comparte una ruta o un viaje por WhatsApp con el botón de compartir. Puedes instalar Pa\' Donde como app en tu celular.',
  },
];

// Portada antes de los pasos: el logo y el eslogan.
function guideCoverHtml() {
  return `
    <div class="guide-strip" aria-hidden="true"></div>
    <img class="guide-logo" src="assets/icono.svg" alt="" width="84" height="84">
    <h2 id="guide-title" class="slogan">Tú dices pa’ dónde.<br><span>Nosotros te llevamos.</span></h2>
    <p>Encuentra qué bus tomar en Barranquilla y su área metropolitana. Te mostramos cómo en ${GUIDE_STEPS.length} pasos.</p>
    <div class="dialog-actions">
      <button type="button" class="link-btn" data-guide="close">Saltar</button>
      <button type="button" class="primary" data-guide="0">Ver cómo se usa</button>
    </div>`;
}

function openGuide(step = 'portada') {
  if (step === 'portada') {
    guide.innerHTML = guideCoverHtml();
    if (!guide.open) guide.showModal();
    return;
  }
  const s = GUIDE_STEPS[step];
  const last = step === GUIDE_STEPS.length - 1;
  guide.innerHTML = `
    ${s.icon}
    <h2 id="guide-title">${escapeHtml(s.title)}</h2>
    <p>${escapeHtml(s.text)}</p>
    <div class="guide-dots" aria-hidden="true">${GUIDE_STEPS.map((_, i) => `<span${i === step ? ' class="on"' : ''}></span>`).join('')}</div>
    <div class="dialog-actions">
      ${last ? '' : '<button type="button" class="link-btn" data-guide="close">Saltar</button>'}
      <button type="button" class="primary" data-guide="${last ? 'close' : step + 1}">${last ? 'Empezar' : 'Siguiente'}</button>
    </div>`;
  if (!guide.open) guide.showModal();
}

function closeGuide() {
  guide.close();
  try { localStorage.setItem(GUIDE_KEY, GUIDE_VERSION); } catch { /* sin almacenamiento: se volverá a mostrar */ }
}

guide.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-guide]');
  if (!btn) return;
  if (btn.dataset.guide === 'close') closeGuide();
  else openGuide(Number(btn.dataset.guide));
});
guide.addEventListener('cancel', () => closeGuide()); // tecla Esc

// La primera vez que se abre la app, o cuando la guía cambió (y no desde un enlace a una ruta o un viaje).
function maybeShowGuide() {
  let seen = false;
  try { seen = localStorage.getItem(GUIDE_KEY) === GUIDE_VERSION; } catch { seen = true; }
  if (!seen && state.view === 'browse') openGuide();
}

// ---------- Eventos ----------

els.groups.addEventListener('click', (e) => {
  // Recordar qué empresas están desplegadas (el clic llega antes de que <details> cambie).
  const summary = e.target.closest('details.company > summary');
  if (summary) {
    const company = summary.parentElement;
    if (company.open) state.openCompanies.delete(company.dataset.company);
    else state.openCompanies.add(company.dataset.company);
    return;
  }
  const routeBtn = e.target.closest('button.route-item');
  if (routeBtn) {
    selectRoute(routeBtn.dataset.id);
    return;
  }
  // Tus lugares, recientes y resultados de búsqueda.
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    startPicking(pick.dataset.pick);
    return;
  }
  const saved = e.target.closest('[data-saved]');
  if (saved) {
    startTrip(fromStored(store.places[Number(saved.dataset.saved)]));
    return;
  }
  const recent = e.target.closest('[data-recent]');
  if (recent) {
    startTrip(fromStored(store.recent[Number(recent.dataset.recent)]));
    return;
  }
  if (e.target.closest('[data-action="clear-recent"]')) {
    store.recent = [];
    saveStore();
    renderList();
    return;
  }
  const placeBtn = e.target.closest('[data-place]');
  if (!placeBtn) return;
  const place = state.placeResults[Number(placeBtn.dataset.place)];
  if (state.picking) {
    savePlace(place, state.picking); // se eligió Casa o Trabajo: se guarda y se vuelve a la lista
    stopPicking();
  } else {
    startTrip(place);
  }
});

// Botón junto al buscador: "Cómo llegar" eligiendo salida y llegada desde cero.
const planBtn = $('#plan');
planBtn.innerHTML = PLAN_ICON;
planBtn.addEventListener('click', () => startTrip(null));

els.picking.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="cancel-pick"]')) stopPicking();
});

els.route.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="back"]')) {
    goBack();
    return;
  }
  if (e.target.closest('[data-action="share-route"]')) {
    shareRoute(state.routes.find((r) => r.id === state.selectedId));
    return;
  }
  if (e.target.closest('[data-action="report"]')) {
    openReport(state.routes.find((r) => r.id === state.selectedId));
    return;
  }
  if (e.target.closest('[data-action="toggle-route"]')) {
    toggleSavedRoute(state.selectedId);
    renderRoute(state.routes.find((r) => r.id === state.selectedId));
    return;
  }
  const more = e.target.closest('[data-action="more-streets"]');
  if (more) {
    const extras = els.route.querySelectorAll('.street-chips .extra');
    const showing = !extras[0].hidden;
    extras.forEach((li) => { li.hidden = showing; });
    more.textContent = showing ? `Ver las ${els.route.querySelectorAll('.street-chips li').length} calles` : 'Ver menos';
    return;
  }
  const btn = e.target.closest('[data-stop]');
  if (btn) {
    const route = state.routes.find((r) => r.id === state.selectedId);
    highlightStop(route, route.stops[Number(btn.dataset.stop)]);
  }
});

els.trip.addEventListener('click', (e) => {
  const trip = state.trip;
  const action = e.target.closest('[data-action]')?.dataset.action;
  const closest = (sel) => e.target.closest(sel);
  if (action === 'back') goBack();
  else if (action === 'share-trip') shareTrip(trip);
  else if (action === 'swap') swapTrip();
  else if (action === 'cancel-map-pick') {
    trip.mapPick = null;
    map.getContainer().classList.remove('picking-point');
    renderTrip();
  } else if (closest('[data-edit]')) {
    openEditor(closest('[data-edit]').dataset.edit);
  } else if (closest('[data-od="gps"]')) {
    trip.error = null;
    locateUser();
  } else if (closest('[data-od="map"]')) {
    startMapPick(trip.editing);
  } else if (closest('[data-od-saved]')) {
    setTripPoint(trip.editing, fromStored(store.places[Number(closest('[data-od-saved]').dataset.odSaved)]));
  } else if (closest('[data-od-recent]')) {
    setTripPoint(trip.editing, fromStored(store.recent[Number(closest('[data-od-recent]').dataset.odRecent)]));
  } else if (closest('[data-od-place]')) {
    setTripPoint(trip.editing, trip.results[Number(closest('[data-od-place]').dataset.odPlace)]);
  } else if (action === 'unsave') {
    removePlace(trip.to);
    trip.to.label = null;
    renderTrip();
  } else if (closest('[data-save]')) {
    const label = closest('[data-save]').dataset.save;
    savePlace(trip.to, label === 'favorito' ? null : label);
    trip.to.label = label === 'favorito' ? null : label;
    renderTrip();
  } else if (e.target.closest('[data-route]')) {
    selectRoute(e.target.closest('[data-route]').dataset.route);
  } else if (e.target.closest('[data-option]')) {
    state.trip.selected = Number(e.target.closest('[data-option]').dataset.option);
    drawTrip();
    renderTrip();
  }
});

// Escribir en "Desde" o "Hasta": solo se actualiza la lista de abajo, para no perder el cursor.
els.trip.addEventListener('input', (e) => {
  if (e.target.id !== 'od-input') return;
  state.trip.text = e.target.value;
  state.trip.error = null;
  scheduleRemoteSearch(e.target.value);
  renderTripResults();
});
els.trip.addEventListener('keydown', (e) => {
  if (e.target.id !== 'od-input' || e.key !== 'Enter') return;
  e.preventDefault();
  const first = state.trip.results[0];
  if (state.trip.text.trim() && first) setTripPoint(state.trip.editing, first); // Enter elige el primer lugar
});

els.search.addEventListener('input', () => {
  state.text = els.search.value;
  scheduleRemoteSearch(state.text);
  renderList();
});
els.search.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  els.search.blur(); // en el celular, esconde el teclado para ver los resultados
});
els.search.addEventListener('focus', () => {
  if (isMobile.matches) setSheet(true);
});

els.hint.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="open-guide"]')) openGuide();
});

els.near.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-near"]')) exitNearby();
});

els.handle.addEventListener('click', () => setSheet(!document.body.classList.contains('sheet-expanded')));

// ---------- Instalar como app ----------
// Chrome y Edge avisan cuando la página se puede instalar: se muestra el botón "Instalar".
// (En iPhone se instala desde Safari: Compartir → Agregar a inicio.)
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  els.install.hidden = false;
});
els.install.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  els.install.hidden = true;
});
window.addEventListener('appinstalled', () => {
  els.install.hidden = true;
});
// El service worker guarda la app para abrirla sin internet (solo funciona con HTTPS o en localhost).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

loadData().finally(hideSplash);
