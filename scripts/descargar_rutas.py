"""Descarga las rutas de bus de Barranquilla desde OpenStreetMap y las guarda en
data/rutas.geojson para que la app las sirva como archivo estático.

  1. Overpass API: qué relaciones de ruta de bus hay en la zona, y todas las paradas sueltas.
  2. API principal de OSM: cada ruta completa (vías, nodos, estaciones y paradas).
  3. Orienta los tramos en el sentido de circulación y asocia a las alimentadoras las
     paradas de Transmetro que están sobre su recorrido pero no dentro de la relación.

Uso:  python scripts/descargar_rutas.py

Los datos de OSM están bajo licencia ODbL: la app debe mostrar
"© colaboradores de OpenStreetMap".
"""
import json
import math
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Barranquilla, Soledad, Malambo, Galapa y Puerto Colombia (sur, oeste, norte, este).
BBOX = "10.82,-74.98,11.11,-74.70"
ROUTE_FILTER = '["type"="route"]["route"~"^(bus|trolleybus|minibus|share_taxi)$"]'

# Servidores públicos de Overpass: si uno falla o está saturado se prueba el siguiente.
OVERPASS_ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
OSM_API = "https://api.openstreetmap.org/api/0.6"
USER_AGENT = "pa-donde-prototipo/0.1"
SALIDA = Path(__file__).resolve().parent.parent / "data" / "rutas.geojson"
CACHE_PARADAS = SALIDA.with_name("paradas_osm.json")  # respaldo por si Overpass no responde

RADIO_PARADA_SUELTA = 30  # metros entre una parada suelta y el recorrido para asociarla
REDES_TRANSMETRO = {"transmetro", "alimentador"}


# ---------- Descargas ----------

def get_json(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.load(res)


def overpass(query, intentos=3):
    data = urllib.parse.urlencode({"data": query}).encode()
    for intento in range(intentos):
        for url in OVERPASS_ENDPOINTS:
            try:
                return get_json(url, data)["elements"]
            except Exception as err:
                print(f"  {urllib.parse.urlparse(url).hostname}: {err}", file=sys.stderr)
        time.sleep(15 * (intento + 1))
    return None


def buscar_ids():
    elementos = overpass(f"[out:json][timeout:60];rel{ROUTE_FILTER}({BBOX});out ids;")
    if elementos is not None:
        return [e["id"] for e in elementos]
    # Los servidores públicos de Overpass a veces están saturados: en ese caso se
    # actualizan al menos las rutas que ya teníamos.
    if SALIDA.exists():
        print("Overpass no responde: se actualizan las rutas del archivo existente", file=sys.stderr)
        return [f["properties"]["osm_id"] for f in json.loads(SALIDA.read_text(encoding="utf-8"))["features"]]
    raise RuntimeError("Ningun servidor de Overpass respondio")


def buscar_paradas_sueltas():
    elementos = overpass(f'[out:json][timeout:50];node["highway"="bus_stop"]({BBOX});out;')
    if elementos is not None:
        CACHE_PARADAS.write_text(json.dumps(elementos, ensure_ascii=False), encoding="utf-8")
        return elementos
    if CACHE_PARADAS.exists():
        print("Overpass no responde: se usan las paradas de la descarga anterior", file=sys.stderr)
        return json.loads(CACHE_PARADAS.read_text(encoding="utf-8"))
    print("Overpass no responde: las alimentadoras quedan solo con las paradas de su relacion", file=sys.stderr)
    return []


def descargar_relacion(rel_id):
    for intento in range(3):
        try:
            return get_json(f"{OSM_API}/relation/{rel_id}/full.json")["elements"]
        except urllib.error.HTTPError as err:
            if err.code == 410:  # la relación fue borrada de OSM
                return None
            print(f"  relacion {rel_id}: {err}", file=sys.stderr)
        except Exception as err:
            print(f"  relacion {rel_id}: {err}", file=sys.stderr)
        time.sleep(5 * (intento + 1))
    return None


# ---------- Geometría (proyección local en metros, suficiente a escala de ciudad) ----------

def xy(lat, lon):
    return lon * 111320 * math.cos(math.radians(10.96)), lat * 110540


def distancia(a, b):
    (ax, ay), (bx, by) = xy(a["lat"], a["lon"]), xy(b["lat"], b["lon"])
    return math.hypot(bx - ax, by - ay)


def distancia_a_segmento(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    largo2 = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / largo2)) if largo2 else 0.0
    return math.hypot(ax + t * dx - px, ay + t * dy - py)


def segmentos(tramos):
    """Segmentos del recorrido con su posición acumulada (metros desde el inicio)."""
    segs, recorrido = [], 0.0
    for tramo in tramos:
        puntos = [xy(lat, lon) for lat, lon in tramo]
        for (ax, ay), (bx, by) in zip(puntos, puntos[1:]):
            largo = math.hypot(bx - ax, by - ay)
            if largo:
                segs.append((ax, ay, bx, by, recorrido, largo))
                recorrido += largo
    return segs


def ubicar(segs, lat, lon, radio, preferir_derecha=False):
    """Punto del recorrido más cercano a (lat, lon) dentro de `radio` metros.

    Con preferir_derecha se eligen primero los segmentos que dejan el punto a su derecha:
    en Colombia se circula por la derecha, así que una parada al otro lado de la calle es
    del sentido contrario. Devuelve (distancia, a_la_derecha, posicion) o None.
    """
    px, py = xy(lat, lon)
    mejor = None
    for ax, ay, bx, by, inicio, largo in segs:
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / largo ** 2))
        d = math.hypot(ax + t * dx - px, ay + t * dy - py)
        if d > radio:
            continue
        derecha = d < 5 or dx * (py - ay) - dy * (px - ax) < 0
        clave = (preferir_derecha and not derecha, d)
        if mejor is None or clave < mejor[0]:
            mejor = (clave, d, derecha, inicio + t * largo)
    return mejor and mejor[1:]


def orientar_tramos(vias):
    """Recibe las vías de una ruta en el orden de la relación (cada una como lista de ids
    de nodo) y devuelve tramos continuos en el sentido de circulación.

    En OSM el sentido en que se dibujó cada vía es arbitrario: hay que voltear las que
    estén al revés, y de las glorietas (vías cerradas) tomar solo el arco recorrido.
    """
    tramos, actual = [], None
    for i, via in enumerate(vias):
        siguiente = set(vias[i + 1]) if i + 1 < len(vias) else set()
        cerrada = len(via) > 2 and via[0] == via[-1]
        entrada = actual[-1] if actual and actual[-1] in via else None

        if cerrada:
            # Glorieta: se recorre en el sentido de la vía desde la entrada hasta la salida.
            anillo = via[:-1]
            inicio = anillo.index(entrada) if entrada is not None else 0
            camino = [anillo[inicio]]
            for paso in range(1, len(anillo) + 1):
                nodo = anillo[(inicio + paso) % len(anillo)]
                camino.append(nodo)
                if nodo in siguiente:
                    break
        elif entrada is not None:
            camino = via if via[0] == entrada else via[::-1] if via[-1] == entrada else via
        else:
            # Inicio de la ruta o hueco en los datos: se orienta según la vía siguiente.
            camino = via[::-1] if via[0] in siguiente and via[-1] not in siguiente else via

        if entrada is not None:
            actual.extend(camino[1:])
        else:
            if actual:
                tramos.append(actual)
            actual = list(camino)
    if actual:
        tramos.append(actual)
    return tramos


# ---------- Paradas ----------

def normalizar(texto):
    return unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode().lower().strip()


def centro(elemento, nodos):
    """Coordenadas de un nodo, o el centro de una vía (andén dibujado como línea o área)."""
    if elemento["type"] == "node":
        return elemento["lat"], elemento["lon"]
    puntos = [nodos[n] for n in elemento["nodes"] if n in nodos]
    return sum(p["lat"] for p in puntos) / len(puntos), sum(p["lon"] for p in puntos) / len(puntos)


def es_estacion(elemento):
    tags = elemento.get("tags", {})
    nombre = normalizar(tags.get("name"))
    return (elemento["type"] == "way" or tags.get("public_transport") == "station"
            or nombre.startswith(("estacion", "portal")))


def paradas_de_relacion(rel, nodos, vias):
    """Paradas que la relación declara. En PTv2 cada parada suele venir doble: stop (sobre
    la calzada) y platform (el andén). Se deja el andén, que es donde espera la gente."""
    andenes, en_calzada = [], []
    for m in rel.get("members", []):
        rol = m["role"]
        elemento = (nodos if m["type"] == "node" else vias if m["type"] == "way" else {}).get(m["ref"])
        if elemento is None or not rol.startswith(("platform", "stop")):
            continue
        lat, lon = centro(elemento, nodos)
        parada = {"id": f'{m["type"]}/{m["ref"]}', "nombre": elemento.get("tags", {}).get("name"),
                  "lat": lat, "lon": lon, "estacion": es_estacion(elemento)}
        (andenes if rol.startswith("platform") else en_calzada).append(parada)

    resultado = list(andenes)
    for s in en_calzada:
        pareja = next((a for a in andenes if distancia(a, s) < 50 or (
            a["nombre"] and normalizar(a["nombre"]) == normalizar(s["nombre"]) and distancia(a, s) < 250)), None)
        if pareja:
            pareja["nombre"] = pareja["nombre"] or s["nombre"]
            pareja["estacion"] = pareja["estacion"] or s["estacion"]
        else:
            resultado.append(s)
    return resultado


def nombre_calle(via):
    """Los carriles exclusivos de Transmetro se llaman "Transmetro" en OSM: para esos se usa
    el nombre oficial ("Troncal Murillo") si lo tienen."""
    tags = via.get("tags", {})
    if normalizar(tags.get("name")) in REDES_TRANSMETRO:
        return tags.get("official_name")
    return tags.get("name")


def calles_en_orden(vias_ruta, nodos, largo_minimo=80):
    """Calles por donde pasa la ruta, en orden de recorrido ("Carrera 53", "Calle 76"…).
    Se ignoran los pedacitos de menos de `largo_minimo` metros (giros en una esquina)."""
    tramos = []  # [nombre, metros] fusionando vías seguidas con el mismo nombre
    for via in vias_ruta:
        nombre = nombre_calle(via)
        if not nombre:
            continue
        puntos = [xy(nodos[n]["lat"], nodos[n]["lon"]) for n in via["nodes"] if n in nodos]
        largo = sum(math.hypot(bx - ax, by - ay) for (ax, ay), (bx, by) in zip(puntos, puntos[1:]))
        if tramos and tramos[-1][0] == nombre:
            tramos[-1][1] += largo
        else:
            tramos.append([nombre, largo])
    calles = []
    for nombre, largo in tramos:
        if largo >= largo_minimo and (not calles or calles[-1] != nombre):
            calles.append(nombre)
    return calles


def es_nombre_generico(nombre, ref):
    """"Parada A9-3", "Paradero", "A2-1 Ascenso"… no le dicen nada a quien espera el bus."""
    n = normalizar(nombre)
    return (not n or re.fullmatch(r"(parada|paradero)( \S+)?", n) is not None
            or (ref is not None and normalizar(ref) in n.split()))


def calle_cercana(lat, lon, vias_ruta, nodos, radio=50):
    """Nombre de la calle de la ruta más cercana al punto, o None."""
    px, py = xy(lat, lon)
    mejor_d, mejor = radio, None
    for via in vias_ruta:
        nombre = nombre_calle(via)
        if not nombre:
            continue
        puntos = [xy(nodos[n]["lat"], nodos[n]["lon"]) for n in via["nodes"] if n in nodos]
        for (ax, ay), (bx, by) in zip(puntos, puntos[1:]):
            d = distancia_a_segmento(px, py, ax, ay, bx, by)
            if d < mejor_d:
                mejor_d, mejor = d, nombre
    return mejor


def es_compatible(parada, tags_ruta):
    """¿La parada suelta pertenece al mismo sistema que la ruta?"""
    tags = parada.get("tags", {})
    refs = {r.strip() for r in tags.get("route_ref", "").split(";")}
    if tags_ruta.get("ref") and tags_ruta["ref"] in refs:
        return True
    red_parada = {normalizar(tags.get("network")), normalizar(tags.get("operator")).split(" ")[0]}
    red_ruta = {normalizar(tags_ruta.get("network")), normalizar(tags_ruta.get("operator")).split(" ")[0]}
    if red_ruta & REDES_TRANSMETRO:
        return bool(red_parada & REDES_TRANSMETRO)
    return bool(red_parada & red_ruta - {""})


def a_feature(rel_id, elementos, sueltas):
    nodos = {e["id"]: e for e in elementos if e["type"] == "node"}
    vias = {e["id"]: e for e in elementos if e["type"] == "way"}
    rel = next(e for e in elementos if e["type"] == "relation" and e["id"] == rel_id)
    tags_ruta = rel.get("tags", {})

    vias_ruta = [vias[m["ref"]] for m in rel.get("members", [])
                 if m["type"] == "way" and m["ref"] in vias and not m["role"].startswith("platform")]
    nodos_vias = [[n for n in via["nodes"] if n in nodos] for via in vias_ruta]
    tramos = [[(nodos[n]["lat"], nodos[n]["lon"]) for n in tramo] for tramo in orientar_tramos(nodos_vias)]
    segs = segmentos(tramos)

    # Paradas de la relación, ordenadas por su posición a lo largo del recorrido.
    paradas = paradas_de_relacion(rel, nodos, vias)
    posicion_anterior = 0.0
    for p in paradas:
        lugar = ubicar(segs, p["lat"], p["lon"], radio=150)
        p["pos"] = posicion_anterior = lugar[2] if lugar else posicion_anterior
        p["origen"] = "ruta"

    # Las troncales solo paran en sus estaciones; las demás rutas reciben las paradas
    # sueltas de su sistema que estén sobre el recorrido y del lado en que circula.
    es_troncal = sum(p["estacion"] for p in paradas) >= 3
    if not es_troncal:
        for s in sueltas:
            if not es_compatible(s, tags_ruta) or any(distancia(s, p) < 25 for p in paradas):
                continue
            lugar = ubicar(segs, s["lat"], s["lon"], radio=RADIO_PARADA_SUELTA, preferir_derecha=True)
            if lugar and lugar[1]:
                paradas.append({"id": f'node/{s["id"]}', "nombre": s.get("tags", {}).get("name"),
                                "lat": s["lat"], "lon": s["lon"], "estacion": False,
                                "pos": lugar[2], "origen": "cercana"})
    paradas.sort(key=lambda p: p["pos"])

    for p in paradas:
        if not p["estacion"] and es_nombre_generico(p["nombre"], tags_ruta.get("ref")):
            p["nombre"] = calle_cercana(p["lat"], p["lon"], vias_ruta, nodos)

    return {
        "type": "Feature",
        "geometry": {
            "type": "MultiLineString",
            "coordinates": [[[round(lon, 5), round(lat, 5)] for lat, lon in tramo] for tramo in tramos],
        },
        "properties": {
            "osm_id": rel_id,
            "tags": tags_ruta,
            "calles": calles_en_orden(vias_ruta, nodos),
            "paradas": [
                {"nombre": p["nombre"], "lat": round(p["lat"], 5), "lon": round(p["lon"], 5),
                 "tipo": "estacion" if p["estacion"] else "parada", "origen": p["origen"]}
                for p in paradas
            ],
        },
    }


def main():
    print("Buscando rutas en OpenStreetMap (Overpass)...")
    ids = buscar_ids()
    print(f"{len(ids)} rutas encontradas")
    print("Buscando paradas sueltas (Overpass)...")
    sueltas = buscar_paradas_sueltas()
    print(f"{len(sueltas)} paradas encontradas")

    features = []
    for i, rel_id in enumerate(ids, 1):
        print(f"[{i}/{len(ids)}] relacion {rel_id}")
        elementos = descargar_relacion(rel_id)
        if elementos is None:
            print(f"  se omite la relacion {rel_id}", file=sys.stderr)
            continue
        features.append(a_feature(rel_id, elementos, sueltas))
        time.sleep(1)  # la API de OSM es compartida: sin prisa

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    geojson = {
        "type": "FeatureCollection",
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuente": "© colaboradores de OpenStreetMap (ODbL)",
        "features": features,
    }
    SALIDA.write_text(json.dumps(geojson, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Guardado {SALIDA}: {len(features)} rutas, {SALIDA.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
