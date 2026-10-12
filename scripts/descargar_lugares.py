"""Descarga de OpenStreetMap los lugares que la gente busca para moverse (barrios,
universidades, centros comerciales, hospitales, parques, estadios…) y los guarda en
data/lugares.json, para que el buscador de la app los sugiera al instante mientras se
escribe, sin depender de internet.

Uso:  python scripts/descargar_lugares.py

Datos © colaboradores de OpenStreetMap (ODbL).
"""
import json
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

SALIDA = Path(__file__).resolve().parent.parent / "data" / "lugares.json"
USER_AGENT = "pa-donde-prototipo/0.1"
OVERPASS_ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
AREA = (10.82, -74.98, 11.11, -74.70)  # sur, oeste, norte, este

# (clave, valor de OSM) -> cómo se muestra en la app
TIPOS = {
    ("place", "suburb"): "Barrio",
    ("place", "neighbourhood"): "Barrio",
    ("place", "quarter"): "Barrio",
    ("place", "town"): "Municipio",
    ("place", "village"): "Corregimiento",
    ("amenity", "university"): "Universidad",
    ("amenity", "college"): "Institución educativa",
    ("amenity", "school"): "Colegio",
    ("amenity", "hospital"): "Hospital",
    ("amenity", "clinic"): "Clínica",
    ("amenity", "marketplace"): "Mercado",
    ("amenity", "bus_station"): "Terminal de buses",
    ("amenity", "townhall"): "Alcaldía",
    ("amenity", "library"): "Biblioteca",
    ("amenity", "theatre"): "Teatro",
    ("amenity", "cinema"): "Cine",
    ("amenity", "place_of_worship"): "Iglesia",
    ("shop", "mall"): "Centro comercial",
    ("leisure", "park"): "Parque",
    ("leisure", "stadium"): "Estadio",
    ("leisure", "sports_centre"): "Centro deportivo",
    ("tourism", "museum"): "Museo",
    ("tourism", "attraction"): "Sitio de interés",
    ("aeroway", "aerodrome"): "Aeropuerto",
}


def normalizar(texto):
    return unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode().lower().strip()


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


def consulta(bbox):
    filtros = {}
    for clave, valor in TIPOS:
        filtros.setdefault(clave, []).append(valor)
    partes = [f'nwr["{clave}"~"^({"|".join(valores)})$"]["name"]({bbox});' for clave, valores in filtros.items()]
    return f"[out:json][timeout:180];({''.join(partes)});out center tags;"


def main():
    s, w, n, e = AREA
    pedazos = [f"{s + (n - s) * i / 3},{w + (e - w) * j / 3},{s + (n - s) * (i + 1) / 3},{w + (e - w) * (j + 1) / 3}"
               for i in range(3) for j in range(3)]
    lugares = {}
    # Overpass a veces falla con un pedazo: se sigue con los demás y al final se reintentan
    # los que fallaron; si alguno sigue sin responder, se guarda lo que se alcanzó a bajar.
    for ronda in range(3):
        fallidos = []
        for k, bbox in enumerate(pedazos, 1):
            print(f"Lugares de OSM, pedazo {k}/{len(pedazos)}" + (f" (reintento {ronda})" if ronda else ""))
            elementos = overpass(consulta(bbox), intentos=2)
            if elementos is None:
                fallidos.append(bbox)
                continue
            for el in elementos:
                tags = el.get("tags", {})
                tipo = next((etiqueta for (clave, valor), etiqueta in TIPOS.items() if tags.get(clave) == valor), None)
                lat = el.get("lat", el.get("center", {}).get("lat"))
                lon = el.get("lon", el.get("center", {}).get("lon"))
                if not tipo or lat is None:
                    continue
                lugares[f'{el["type"]}/{el["id"]}'] = {
                    "nombre": tags["name"].strip(),
                    "tipo": tipo,
                    "zona": tags.get("addr:suburb") or tags.get("addr:city") or "",
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                }
            time.sleep(2)
        pedazos = fallidos
        if not pedazos:
            break
        time.sleep(30)

    if not lugares:
        raise SystemExit("Overpass no responde: se deja el archivo anterior. Inténtalo más tarde.")
    if pedazos:
        print(f"Aviso: {len(pedazos)} de 9 zonas no se pudieron descargar; vuelve a correr el script más tarde "
              "para completarlas.", file=sys.stderr)

    # Un mismo lugar a veces está como punto y como área: se deja uno solo.
    unicos, vistos = [], set()
    for lugar in lugares.values():
        clave = (normalizar(lugar["nombre"]), lugar["tipo"], round(lugar["lat"], 3), round(lugar["lon"], 3))
        if clave not in vistos:
            vistos.add(clave)
            unicos.append(lugar)
    unicos.sort(key=lambda l: (l["tipo"], normalizar(l["nombre"])))

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps(unicos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Guardado {SALIDA}: {len(unicos)} lugares, {SALIDA.stat().st_size / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
