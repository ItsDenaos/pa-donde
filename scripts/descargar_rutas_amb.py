"""Descarga los recorridos de los buses colectivos que publica el Área Metropolitana de
Barranquilla (AMB) en su visor de rutas y los guarda en data/rutas_amb.geojson, con el
mismo formato que data/rutas.geojson.

Uso:  python scripts/descargar_rutas_amb.py

Fuente: https://www.ambq.gov.co/transporte/transporte-publico-colectivo/
Según las condiciones de uso del AMB, los datos se pueden usar de forma personal y sin
fines comerciales mencionando que son del AMB; el uso comercial requiere su autorización
escrita.

El AMB no publica paradas: cada archivo trae solo el trazado (ida y vuelta en un solo
recorrido, o en dos archivos "A" y "B"). En una muestra de calles de un solo sentido, el
~90 % de los tramos va a favor del tráfico, así que el orden de los puntos sirve como
sentido de circulación.

"Por dónde pasa" (las calles de cada ruta) se calcula cruzando el trazado con las calles
con nombre de OpenStreetMap, que se descargan de Overpass y se guardan en
data/calles_osm.json por si Overpass no responde la próxima vez.
"""
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

PAGINA = "https://www.ambq.gov.co/transporte/transporte-publico-colectivo/"
BASE_KMZ = "https://www.ambq.gov.co/ruta-de-buses/"
USER_AGENT = "pa-donde-prototipo/0.1"
SALIDA = Path(__file__).resolve().parent.parent / "data" / "rutas_amb.geojson"
CACHE_CALLES = SALIDA.with_name("calles_osm.json")

TOLERANCIA_M = 3  # simplificación del trazado: quita puntos que no cambian la forma
UNION_M = 25  # dos pedazos del trazado se unen si uno empieza donde termina el otro

# Calles de OpenStreetMap para "Por dónde pasa".
OVERPASS_ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
AREA = (10.82, -74.98, 11.11, -74.70)  # sur, oeste, norte, este
TIPOS_DE_VIA = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|busway"
CELDA_M = 60  # cuadrícula para buscar rápido la calle más cercana
DISTANCIA_CALLE_M = 20  # el trazado del AMB no siempre va justo sobre la calle
TRAMO_MINIMO_M = 120  # menos que esto en una calle es un giro en la esquina, no un tramo del recorrido


def descargar(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def xy(lon, lat):
    return lon * 111320 * math.cos(math.radians(10.96)), lat * 110540


def simplificar(puntos, tolerancia=TOLERANCIA_M):
    """Douglas-Peucker sobre coordenadas (lon, lat), midiendo en metros."""
    if len(puntos) < 3:
        return puntos
    p = [xy(*q) for q in puntos]
    conservar = [False] * len(p)
    conservar[0] = conservar[-1] = True
    pila = [(0, len(p) - 1)]
    while pila:
        i, j = pila.pop()
        (ax, ay), (bx, by) = p[i], p[j]
        dx, dy = bx - ax, by - ay
        largo = math.hypot(dx, dy)
        lejos, k_lejos = 0.0, None
        for k in range(i + 1, j):
            px, py = p[k]
            d = abs(dy * (px - ax) - dx * (py - ay)) / largo if largo else math.hypot(px - ax, py - ay)
            if d > lejos:
                lejos, k_lejos = d, k
        if k_lejos is not None and lejos > tolerancia:
            conservar[k_lejos] = True
            pila += [(i, k_lejos), (k_lejos, j)]
    return [q for q, c in zip(puntos, conservar) if c]


def unir_pedazos(lineas):
    """Algunos archivos traen el trazado partido en muchos pedazos: se encadenan los que
    empiezan donde termina el anterior (o al revés, volteándolos)."""
    pendientes = sorted((l for l in lineas if len(l) >= 2), key=len, reverse=True)
    tramos = []
    while pendientes:
        actual = list(pendientes.pop(0))
        unido = True
        while unido:
            unido = False
            for k, pedazo in enumerate(pendientes):
                fin, ini = xy(*actual[-1]), xy(*actual[0])
                if math.dist(fin, xy(*pedazo[0])) < UNION_M:
                    actual += pedazo[1:]
                elif math.dist(fin, xy(*pedazo[-1])) < UNION_M:
                    actual += pedazo[::-1][1:]
                elif math.dist(ini, xy(*pedazo[-1])) < UNION_M:
                    actual = pedazo[:-1] + actual
                elif math.dist(ini, xy(*pedazo[0])) < UNION_M:
                    actual = pedazo[::-1][:-1] + actual
                else:
                    continue
                pendientes.pop(k)
                unido = True
                break
        tramos.append(actual)
    return tramos


def nombre_empresa(carpeta, descripcion):
    if descripcion:
        return descripcion.strip()
    return carpeta.replace("-", " ").title()


def a_feature(ruta_kmz, kml):
    carpeta, archivo = ruta_kmz.split("/", 1)
    base = archivo.rsplit(".", 1)[0]  # "B18-4175 A", "C1-B-4186", "A7-4112"
    m = re.match(r"^(.+?)-(\d{4})(?:\s+([AB]))?$", base)
    ref, codigo, sentido = (m.group(1), m.group(2), m.group(3)) if m else (base, None, None)

    lineas = [[tuple(map(float, c.split(",")[:2])) for c in bloque.split()]
              for bloque in re.findall(r"<coordinates>(.*?)</coordinates>", kml, re.S)]
    tramos = [simplificar(t) for t in unir_pedazos(lineas)]

    descripcion = re.search(r'<SimpleData name="descriptio">(.*?)</SimpleData>', kml)
    empresa = nombre_empresa(carpeta, descripcion.group(1) if descripcion else None)
    nombre_kml = re.search(r"<Placemark.*?<name>(.*?)</name>", kml, re.S)
    nombre_kml = nombre_kml.group(1).strip() if nombre_kml else ""

    tags = {
        "type": "route",
        "route": "bus",
        "ref": ref,
        "operator": empresa,
        "network": "Buses colectivos",
        "amb:codigo": codigo,
        "name": f"{empresa} {ref}",
    }
    # Unas pocas rutas traen origen y destino en el nombre: "RUTA B18 MANANTIAL - MURILLO OCTUBRE 28 2025".
    od = re.match(r"^RUTA\s+\S+\s+(.+?)\s+-\s+(.+?)(?:\s+[A-Z]+\s+\d{1,2}\s+\d{4})?$", nombre_kml)
    if od:
        tags["from"], tags["to"] = od.group(1).title(), od.group(2).title()
    if sentido:
        tags["amb:sentido"] = "ida" if sentido == "A" else "vuelta"
    elif len(tramos) == 1 and math.dist(xy(*tramos[0][0]), xy(*tramos[0][-1])) < 200:
        tags["roundtrip"] = "yes"  # un solo trazado que vuelve al inicio: la vuelta completa

    return {
        "type": "Feature",
        "geometry": {
            "type": "MultiLineString",
            "coordinates": [[[round(lon, 5), round(lat, 5)] for lon, lat in t] for t in tramos],
        },
        "properties": {
            "id": "amb-" + re.sub(r"[^A-Za-z0-9]+", "-", base).strip("-"),
            "fuente": "amb",
            "tags": tags,
            "calles": [],
            "paradas": [],
        },
    }


def overpass(query, intentos=3):
    data = urllib.parse.urlencode({"data": query}).encode()
    for intento in range(intentos):
        for url in OVERPASS_ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=200) as res:
                    return json.load(res)["elements"]
            except Exception as err:
                print(f"  {urllib.parse.urlparse(url).hostname}: {err}", file=sys.stderr)
        time.sleep(15 * (intento + 1))
    return None


def nombre_calle(tags):
    """Los carriles exclusivos de Transmetro se llaman "Transmetro" en OSM: para esos se usa
    el nombre oficial ("Troncal Murillo") si lo tienen."""
    if tags.get("name", "").strip().lower() in ("transmetro", "alimentador"):
        return tags.get("official_name")
    return tags.get("name")


def obtener_calles():
    """Calles con nombre del área metropolitana. Se piden en 9 pedazos para no saturar a
    Overpass; si no responde, se usa la descarga anterior."""
    s, w, n, e = AREA
    calles = {}
    for i in range(3):
        for j in range(3):
            bbox = f"{s + (n - s) * i / 3},{w + (e - w) * j / 3},{s + (n - s) * (i + 1) / 3},{w + (e - w) * (j + 1) / 3}"
            print(f"  calles de OSM, pedazo {i * 3 + j + 1}/9")
            elementos = overpass(f'[out:json][timeout:180];way["highway"~"^({TIPOS_DE_VIA})(_link)?$"]["name"]({bbox});out geom;')
            if elementos is None:
                if CACHE_CALLES.exists():
                    print("Overpass no responde: se usan las calles de la descarga anterior", file=sys.stderr)
                    return json.loads(CACHE_CALLES.read_text(encoding="utf-8"))
                print("Overpass no responde: las rutas quedan sin 'Por dónde pasa'", file=sys.stderr)
                return []
            for via in elementos:
                nombre = nombre_calle(via.get("tags", {}))
                if nombre and via.get("geometry"):
                    calles[via["id"]] = {"nombre": nombre, "puntos": [[round(p["lon"], 5), round(p["lat"], 5)] for p in via["geometry"]]}
            time.sleep(2)
    lista = list(calles.values())
    CACHE_CALLES.write_text(json.dumps(lista, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return lista


class IndiceCalles:
    """Segmentos de calle en una cuadrícula, para encontrar rápido la calle bajo un punto."""

    def __init__(self, calles):
        self.celdas = {}
        for calle in calles:
            pts = [xy(*p) for p in calle["puntos"]]
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                largo = math.hypot(bx - ax, by - ay)
                if not largo:
                    continue
                seg = (ax, ay, bx, by, largo, calle["nombre"])
                for cx in range(int(min(ax, bx) // CELDA_M), int(max(ax, bx) // CELDA_M) + 1):
                    for cy in range(int(min(ay, by) // CELDA_M), int(max(ay, by) // CELDA_M) + 1):
                        self.celdas.setdefault((cx, cy), []).append(seg)

    def calle_en(self, px, py, ux, uy):
        """Nombre de la calle más cercana al punto que va en la misma dirección (ux, uy)."""
        mejor_d, mejor = DISTANCIA_CALLE_M, None
        cx, cy = int(px // CELDA_M), int(py // CELDA_M)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for ax, ay, bx, by, largo, nombre in self.celdas.get((cx + dx, cy + dy), ()):
                    vx, vy = (bx - ax) / largo, (by - ay) / largo
                    if abs(vx * ux + vy * uy) < 0.85:  # una calle que cruza no cuenta
                        continue
                    t = max(0.0, min(largo, (px - ax) * vx + (py - ay) * vy))
                    d = math.hypot(ax + vx * t - px, ay + vy * t - py)
                    if d < mejor_d:
                        mejor_d, mejor = d, nombre
        return mejor


def calles_de_ruta(tramos, indice, paso_m=20):
    """Calles por donde pasa la ruta, en orden: se recorre el trazado cada `paso_m` metros
    y se anota la calle bajo cada punto, descartando los pedacitos cortos."""
    secuencia = []  # [nombre, metros]
    for tramo in tramos:
        pts = [xy(*p) for p in tramo]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            largo = math.hypot(bx - ax, by - ay)
            if largo < 1:
                continue
            ux, uy = (bx - ax) / largo, (by - ay) / largo
            n = max(1, int(largo // paso_m))
            for k in range(n):
                t = (k + 0.5) / n
                nombre = indice.calle_en(ax + (bx - ax) * t, ay + (by - ay) * t, ux, uy)
                if nombre is None:
                    continue
                if secuencia and secuencia[-1][0] == nombre:
                    secuencia[-1][1] += largo / n
                else:
                    secuencia.append([nombre, largo / n])
    calles = []
    for nombre, metros in secuencia:
        if metros >= TRAMO_MINIMO_M and (not calles or calles[-1] != nombre):
            calles.append(nombre)
    return calles


def main():
    print("Leyendo el visor de rutas del AMB...")
    html = descargar(PAGINA).decode("utf-8", "replace")
    rutas_kmz = sorted(set(re.findall(r'data-kmz="([^"]+\.kmz)"', html)))
    print(f"{len(rutas_kmz)} archivos de rutas")

    features, fallos = [], []
    for i, ruta_kmz in enumerate(rutas_kmz, 1):
        print(f"[{i}/{len(rutas_kmz)}] {ruta_kmz}")
        try:
            datos = descargar(BASE_KMZ + urllib.parse.quote(ruta_kmz))
            kmz = zipfile.ZipFile(io.BytesIO(datos))
            kml = kmz.read(next(n for n in kmz.namelist() if n.endswith(".kml"))).decode("utf-8")
            features.append(a_feature(ruta_kmz, kml))
        except Exception as err:
            fallos.append(ruta_kmz)
            print(f"  no se pudo leer: {err}", file=sys.stderr)
        time.sleep(0.3)  # sin afanar al servidor del AMB

    if not features:
        raise SystemExit("No se pudo descargar ninguna ruta: se deja el archivo anterior.")

    print("Calculando por dónde pasa cada ruta...")
    calles = obtener_calles()
    if calles:
        indice = IndiceCalles(calles)
        for f in features:
            f["properties"]["calles"] = calles_de_ruta(f["geometry"]["coordinates"], indice)

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    geojson = {
        "type": "FeatureCollection",
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuente": "© Área Metropolitana de Barranquilla (visor de rutas de transporte público colectivo)",
        "features": features,
    }
    SALIDA.write_text(json.dumps(geojson, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Guardado {SALIDA}: {len(features)} rutas, {SALIDA.stat().st_size / 1e6:.2f} MB")
    if fallos:
        print(f"No se pudieron leer {len(fallos)}: {', '.join(fallos)}", file=sys.stderr)


if __name__ == "__main__":
    main()
