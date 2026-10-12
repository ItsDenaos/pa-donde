// Planificador de viajes de Pa' Donde: qué rutas sirven para ir de un punto a otro,
// directas o con un transbordo, respetando el sentido en que circula cada bus.
// Son funciones puras (sin mapa ni página) para poder probarlas aparte con Node.
//
// Cada ruta necesita: lines (tramos [[lat, lng], …] en el sentido del bus), stops
// ([{lat, lon, nombre}]) y tags (se usa tags.roundtrip). Los tiempos son estimados.

const Planner = (() => {
  const WALK_M_PER_MIN = 75; // 4,5 km/h
  const BUS_M_PER_MIN = 250; // 15 km/h contando paradas y tráfico
  const WALK_DETOUR = 1.3; // las calles no van en línea recta
  const TRANSFER_PENALTY_MIN = 6; // bajarse, cruzar y esperar el segundo bus
  const MAX_WALK_M = 700; // en línea recta, desde el origen o hasta el destino
  const MAX_TRANSFER_M = 300;
  const MIN_RIDE_M = 150; // menos que esto no vale la pena subirse
  const SAMPLE_M = 40; // separación de los puntos con los que se mide cada recorrido
  const CELL_M = 350; // tamaño de la cuadrícula para buscar puntos cercanos rápido
  const MAX_GAP_M = 300; // un hueco más grande en el trazado no se puede "recorrer" en bus
  const MAX_TRANSFER_ROUTES = 25; // para transbordos, solo las rutas más cercanas al origen y al destino
  const MAX_OPTIONS = 5;
  // Para buscar transbordos basta con menos precisión: se mira cada 2 puntos de la primera ruta
  // y cada 3 de la segunda (unos 80-120 m), lo que hace el cálculo varias veces más rápido.
  const TRANSFER_STEP_A = 2;
  const TRANSFER_STEP_B = 3;
  const SLOWER_FACTOR = 1.6; // no mostrar opciones mucho más lentas que la mejor
  const SLOWER_MARGIN_MIN = 8;

  // Proyección local en metros (suficiente a escala de ciudad).
  const K_LAT = 110540;
  const K_LON = 111320 * Math.cos((10.96 * Math.PI) / 180);
  const toXY = (lat, lng) => [lng * K_LON, lat * K_LAT];
  const cellKey = (cx, cy) => `${cx},${cy}`;
  const walkMinutes = (straightMeters) => (straightMeters * WALK_DETOUR) / WALK_M_PER_MIN;

  const cache = new WeakMap();

  // Puntos cada SAMPLE_M metros a lo largo de la ruta, con su posición acumulada.
  function prepare(route) {
    if (cache.has(route)) return cache.get(route);
    const pts = [];
    const gaps = []; // saltos entre tramos: { idx (primer punto del tramo), meters }
    let pos = 0;
    for (const line of route.lines) {
      let prev = null;
      for (const [lat, lng] of line) {
        const [x, y] = toXY(lat, lng);
        if (!prev) {
          if (pts.length) {
            const last = pts[pts.length - 1];
            const gap = Math.hypot(x - last.x, y - last.y);
            gaps.push({ idx: pts.length, meters: gap });
            pos += gap;
          }
          pts.push({ x, y, lat, lng, pos });
        } else {
          const len = Math.hypot(x - prev.x, y - prev.y);
          const n = Math.ceil(len / SAMPLE_M);
          for (let k = 1; k <= n; k++) {
            const t = k / n;
            pts.push({
              x: prev.x + (x - prev.x) * t,
              y: prev.y + (y - prev.y) * t,
              lat: prev.lat + (lat - prev.lat) * t,
              lng: prev.lng + (lng - prev.lng) * t,
              pos: pos + len * t,
            });
          }
          pos += len;
        }
        prev = { x, y, lat, lng };
      }
    }

    const grid = new Map();
    pts.forEach((p, i) => {
      const key = cellKey(Math.floor(p.x / CELL_M), Math.floor(p.y / CELL_M));
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    });

    const first = pts[0];
    const last = pts[pts.length - 1];
    const prep = {
      pts,
      grid,
      bigGaps: gaps.filter((g) => g.meters > MAX_GAP_M).map((g) => g.idx),
      length: last ? last.pos : 0,
      // Recorrido circular: se puede subir al final de la vuelta y seguir al comienzo.
      loop: route.tags.roundtrip === 'yes'
        || (route.lines.length === 1 && first && Math.hypot(first.x - last.x, first.y - last.y) < 200),
      stopIdx: null,
    };
    prep.stopIdx = route.stops.map((s) => {
      const [x, y] = toXY(s.lat, s.lon);
      const near = nearPoints(prep, x, y, 150);
      return near.length ? near.reduce((a, b) => (b.d < a.d ? b : a)).i : -1;
    });
    cache.set(route, prep);
    return prep;
  }

  // Todos los puntos de la ruta a menos de maxD metros de (x, y).
  function nearPoints(prep, x, y, maxD) {
    const r = Math.ceil(maxD / CELL_M);
    const cx = Math.floor(x / CELL_M);
    const cy = Math.floor(y / CELL_M);
    const out = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const cell = prep.grid.get(cellKey(cx + dx, cy + dy));
        if (!cell) continue;
        for (const i of cell) {
          const d = Math.hypot(prep.pts[i].x - x, prep.pts[i].y - y);
          if (d <= maxD) out.push({ i, d });
        }
      }
    }
    return out;
  }

  // Puntos donde se puede tomar (o dejar) la ruta: el más cercano de cada pasada,
  // porque una ruta puede pasar dos veces cerca del mismo lugar (ida y vuelta).
  function accessPoints(prep, x, y, maxD) {
    const near = nearPoints(prep, x, y, maxD).sort((a, b) => a.i - b.i);
    const best = [];
    for (const p of near) {
      const run = best[best.length - 1];
      if (run && p.i - run.last <= 3) {
        run.last = p.i;
        if (p.d < run.d) Object.assign(run, { i: p.i, d: p.d });
      } else {
        best.push({ i: p.i, d: p.d, last: p.i });
      }
    }
    return best;
  }

  // Metros en bus entre dos puntos de la ruta, o null si van contra el sentido o si en
  // medio hay un hueco grande del trazado (datos partidos: no se sabe por dónde sigue).
  function rideMeters(prep, i, j) {
    const crossesGap = (a, b) => prep.bigGaps.some((g) => g > a && g <= b);
    if (j > i) return crossesGap(i, j) ? null : prep.pts[j].pos - prep.pts[i].pos;
    if (prep.loop && j < i) {
      if (crossesGap(i, prep.pts.length - 1) || crossesGap(-1, j)) return null;
      return prep.length - prep.pts[i].pos + prep.pts[j].pos;
    }
    return null;
  }

  function pathBetween(prep, i, j) {
    const idx = [];
    if (j >= i) for (let k = i; k <= j; k++) idx.push(k);
    else {
      for (let k = i; k < prep.pts.length; k++) idx.push(k);
      for (let k = 0; k <= j; k++) idx.push(k);
    }
    return idx.map((k) => [prep.pts[k].lat, prep.pts[k].lng]);
  }

  // La parada de la ruta más cercana a un punto del recorrido (si hay una a menos de 250 m).
  function stopNear(route, prep, i) {
    let best = null;
    route.stops.forEach((s, k) => {
      const si = prep.stopIdx[k];
      if (si < 0 || Math.abs(si - i) > 6) return;
      const d = Math.hypot(prep.pts[si].x - prep.pts[i].x, prep.pts[si].y - prep.pts[i].y);
      if (d <= 250 && (!best || d < best.d)) best = { stop: s, d };
    });
    return best ? best.stop : null;
  }

  function stopsBetween(prep, i, j) {
    return prep.stopIdx.filter((si) => si >= 0 && (j >= i ? si > i && si <= j : si > i || si <= j)).length;
  }

  const point = (p) => [p.lat, p.lng];

  function walkLeg(from, to, straight) {
    return { type: 'walk', from, to, meters: straight * WALK_DETOUR, minutes: walkMinutes(straight) };
  }

  function busLeg(route, prep, i, j, meters) {
    return {
      type: 'bus',
      route,
      meters,
      minutes: meters / BUS_M_PER_MIN,
      board: stopNear(route, prep, i),
      alight: stopNear(route, prep, j),
      stops: stopsBetween(prep, i, j),
      path: pathBetween(prep, i, j),
    };
  }

  // `extraCost(option)` permite ordenar por algo más que el tiempo (p. ej. sumar minutos por
  // cada pasaje adicional): solo afecta el orden, no los minutos que se muestran.
  function plan(routes, from, to, { extraCost = () => 0 } = {}) {
    const [fx, fy] = toXY(from.lat, from.lng);
    const [tx, ty] = toXY(to.lat, to.lng);
    const origin = [from.lat, from.lng];
    const dest = [to.lat, to.lng];
    const options = [];

    const straight = Math.hypot(tx - fx, ty - fy);
    if (straight <= 2500) options.push({ kind: 'walk', minutes: walkMinutes(straight), legs: [walkLeg(origin, dest, straight)] });

    const boards = new Map();
    const alights = new Map();
    for (const route of routes) {
      const prep = prepare(route);
      if (!prep.pts.length) continue;
      const b = accessPoints(prep, fx, fy, MAX_WALK_M);
      const a = accessPoints(prep, tx, ty, MAX_WALK_M);
      if (b.length) boards.set(route, b);
      if (a.length) alights.set(route, a);
    }

    // Directas: subirse cerca del origen y bajarse más adelante cerca del destino.
    for (const [route, bs] of boards) {
      const as = alights.get(route);
      if (!as) continue;
      const prep = prepare(route);
      let best = null;
      for (const b of bs) {
        for (const a of as) {
          const ride = rideMeters(prep, b.i, a.i);
          if (ride === null || ride < MIN_RIDE_M) continue;
          const minutes = walkMinutes(b.d) + ride / BUS_M_PER_MIN + walkMinutes(a.d);
          if (!best || minutes < best.minutes) best = { minutes, b, a, ride };
        }
      }
      if (best) {
        options.push({
          kind: 'direct',
          minutes: best.minutes,
          legs: [
            walkLeg(origin, point(prep.pts[best.b.i]), best.b.d),
            busLeg(route, prep, best.b.i, best.a.i, best.ride),
            walkLeg(point(prep.pts[best.a.i]), dest, best.a.d),
          ],
        });
      }
    }

    // Con un transbordo: ruta A desde el origen, caminar a lo sumo MAX_TRANSFER_M, ruta B al destino.
    // Solo se prueban las rutas más cercanas al origen y al destino, para que responda rápido.
    const bestDirect = Math.min(Infinity, ...options.filter((o) => o.kind === 'direct').map((o) => o.minutes));
    const nearest = (m) => [...m].sort((x, y) => Math.min(...x[1].map((p) => p.d)) - Math.min(...y[1].map((p) => p.d)))
      .slice(0, MAX_TRANSFER_ROUTES);
    // Los puntos de todas las rutas que llegan cerca del destino van en una sola cuadrícula:
    // al recorrer una ruta desde el origen se encuentran de una vez todos los transbordos
    // posibles, en vez de comparar ruta por ruta (mucho más rápido en celulares sencillos).
    const transferGrid = new Map();
    const alightList = nearest(alights);
    for (const [routeB, asB] of alightList) {
      const pB = prepare(routeB);
      pB.pts.forEach((p, i) => {
        if (i % TRANSFER_STEP_B !== 0) return;
        const key = cellKey(Math.floor(p.x / CELL_M), Math.floor(p.y / CELL_M));
        if (!transferGrid.has(key)) transferGrid.set(key, []);
        transferGrid.get(key).push({ routeB, pB, asB, i });
      });
    }
    const minAlightWalk = Math.min(Infinity, ...alightList.flatMap(([, as]) => as.map((a) => walkMinutes(a.d))));

    let bestTransfer = Infinity;
    const bestByPair = new Map(); // ruta A -> (ruta B -> mejor transbordo entre ambas)
    for (const [routeA, bsA] of nearest(boards)) {
      const pA = prepare(routeA);
      for (const b of bsA) {
        const steps = pA.loop ? pA.pts.length : pA.pts.length - b.i;
        for (let s = 1; s < steps; s += TRANSFER_STEP_A) {
          const iA = (b.i + s) % pA.pts.length;
          const rideA = rideMeters(pA, b.i, iA);
          if (rideA === null) break;
          const base = walkMinutes(b.d) + rideA / BUS_M_PER_MIN + TRANSFER_PENALTY_MIN;
          // De aquí en adelante solo empeora: ya hay una directa más rápida, o queda muy por
          // encima del mejor transbordo encontrado.
          const bound = base + minAlightWalk;
          if (bound >= bestDirect || bound >= bestTransfer * SLOWER_FACTOR + SLOWER_MARGIN_MIN) break;
          if (rideA < MIN_RIDE_M) continue;
          const p = pA.pts[iA];
          const cx = Math.floor(p.x / CELL_M);
          const cy = Math.floor(p.y / CELL_M);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (const c of transferGrid.get(cellKey(cx + dx, cy + dy)) || []) {
                if (c.routeB === routeA) continue;
                const q = c.pB.pts[c.i];
                const dT = Math.hypot(q.x - p.x, q.y - p.y);
                if (dT > MAX_TRANSFER_M) continue;
                for (const a of c.asB) {
                  const rideB = rideMeters(c.pB, c.i, a.i);
                  if (rideB === null || rideB < MIN_RIDE_M) continue;
                  const minutes = base + walkMinutes(dT) + rideB / BUS_M_PER_MIN + walkMinutes(a.d);
                  if (!bestByPair.has(routeA)) bestByPair.set(routeA, new Map());
                  const prev = bestByPair.get(routeA).get(c.routeB);
                  if (!prev || minutes < prev.minutes) {
                    bestByPair.get(routeA).set(c.routeB, { minutes, b, a, iA, t: { i: c.i, d: dT }, rideA, rideB, pB: c.pB });
                    bestTransfer = Math.min(bestTransfer, minutes);
                  }
                }
              }
            }
          }
        }
      }
    }
    for (const [routeA, byB] of bestByPair) {
      const pA = prepare(routeA);
      for (const [routeB, best] of byB) {
        const { pB } = best;
        options.push({
          kind: 'transfer',
          minutes: best.minutes,
          legs: [
            walkLeg(origin, point(pA.pts[best.b.i]), best.b.d),
            busLeg(routeA, pA, best.b.i, best.iA, best.rideA),
            walkLeg(point(pA.pts[best.iA]), point(pB.pts[best.t.i]), best.t.d),
            busLeg(routeB, pB, best.t.i, best.a.i, best.rideB),
            walkLeg(point(pB.pts[best.a.i]), dest, best.a.d),
          ],
        });
      }
    }

    for (const o of options) o.score = o.minutes + extraCost(o);
    options.sort((x, y) => x.score - y.score);
    // Caminar solo se muestra si es de las mejores opciones; los transbordos, si ganan a las
    // directas; y nada que tarde mucho más que la mejor (p. ej. dar casi toda la vuelta).
    const limit = options.length ? Math.min(...options.map((o) => o.minutes)) * SLOWER_FACTOR + SLOWER_MARGIN_MIN : Infinity;
    return options
      .filter((o) => o.minutes <= limit)
      .filter((o) => o.kind !== 'transfer' || o.minutes < bestDirect)
      .filter((o, i, all) => o.kind !== 'walk' || i < 2 || all.length === 1)
      .slice(0, MAX_OPTIONS);
  }

  return { plan, prepare, MAX_WALK_M };
})();

if (typeof module !== 'undefined') module.exports = Planner;
