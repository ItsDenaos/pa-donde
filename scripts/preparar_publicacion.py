"""Prepara la carpeta publicar/ con solo los archivos que necesita la página, lista para
subirla a Netlify:

- arrastrando la carpeta publicar/ a https://app.netlify.com/drop, o
- conectando el proyecto con GitHub: Netlify corre este script solo (ver netlify.toml).

Uso:  python scripts/preparar_publicacion.py [--url https://tu-sitio.netlify.app]

La dirección del sitio es opcional, pero sirve para que la vista previa de los enlaces
compartidos (WhatsApp, Facebook) muestre la imagen: esas apps necesitan la URL completa.
Si Netlify construye el sitio, la toma solo de la variable de entorno URL.
"""
import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "publicar"

ARCHIVOS = [
    "index.html",
    "styles.css",
    "app.js",
    "planner.js",
    "sw.js",
    "manifest.webmanifest",
    "assets/icono.svg",
    "assets/icon-192.png",
    "assets/icon-512.png",
    "assets/maskable-512.png",
    "assets/apple-touch-icon.png",
    "assets/og-image.png",
    "data/rutas.geojson",
    "data/rutas_amb.geojson",
    "data/lugares.json",
    "data/fotos.json",
]
# Fotos de la placa y del bus (las prepara scripts/preparar_fotos.py): se copian todas.
FOTOS = "assets/fotos"

# Encabezados que Netlify agrega a cada respuesta (archivo _headers).
HEADERS = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(self), camera=(), microphone=()

# El service worker siempre se revisa, para que las actualizaciones lleguen enseguida.
/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Content-Type: application/manifest+json
"""


def main():
    parser = argparse.ArgumentParser(description="Prepara la carpeta publicar/ para Netlify")
    parser.add_argument("--url", default=os.environ.get("URL", ""), help="dirección del sitio, p. ej. https://padonde.netlify.app")
    args = parser.parse_args()
    url = args.url.rstrip("/")

    faltan = [a for a in ARCHIVOS if not (RAIZ / a).exists()]
    if faltan:
        raise SystemExit(f"Faltan archivos: {', '.join(faltan)}")

    if SALIDA.exists():
        shutil.rmtree(SALIDA)  # se genera desde cero cada vez
    for archivo in ARCHIVOS:
        destino = SALIDA / archivo
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(RAIZ / archivo, destino)
    if (RAIZ / FOTOS).is_dir():
        shutil.copytree(RAIZ / FOTOS, SALIDA / FOTOS)
    # Una foto que está en data/fotos.json pero no se subió saldría como "No se pudo cargar".
    indice = json.loads((RAIZ / "data" / "fotos.json").read_text(encoding="utf-8"))
    faltan_fotos = [f["src"] for fotos in indice.values() for f in fotos if not (SALIDA / f["src"]).exists()]
    if faltan_fotos:
        print(f"Aviso: faltan fotos de data/fotos.json: {', '.join(faltan_fotos)}", file=sys.stderr)

    # Cada publicación renueva la copia que guarda el service worker en los celulares.
    sw = SALIDA / "sw.js"
    version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    texto, cambios = re.subn(r"const VERSION = '[^']*';", f"const VERSION = 'pa-donde-{version}';", sw.read_text(encoding="utf-8"))
    if cambios != 1:
        raise SystemExit("No encontré la versión en sw.js")
    sw.write_text(texto, encoding="utf-8")

    # Vista previa al compartir: con la dirección del sitio, la imagen va con URL completa.
    index = SALIDA / "index.html"
    html = index.read_text(encoding="utf-8")
    if url:
        html = html.replace('content="assets/og-image.png"', f'content="{url}/assets/og-image.png"')
        html = html.replace('<meta property="og:type"', f'<meta property="og:url" content="{url}/">\n  <meta property="og:type"', 1)
    index.write_text(html, encoding="utf-8")

    (SALIDA / "_headers").write_text(HEADERS, encoding="utf-8")

    archivos = [p for p in SALIDA.rglob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in archivos)
    print(f"Listo: {SALIDA} ({len(archivos)} archivos, {total / 1e6:.2f} MB)")
    if url:
        print(f"Vista previa de enlaces configurada para {url}")
    else:
        print("Aviso: sin --url, la imagen de vista previa al compartir puede no aparecer en WhatsApp.", file=sys.stderr)
        print("       Cuando sepas la dirección de Netlify, vuelve a correr con --url https://….netlify.app", file=sys.stderr)


if __name__ == "__main__":
    main()
