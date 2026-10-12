"""Prepara las fotos de la placa y del bus de las rutas tradicionales para el carrusel de la app.

1. Pon las fotos en la carpeta fotos/ (en la raíz del proyecto), nombradas con el código de
   la ruta tal como sale en la app:

     C14-placa.jpg     la placa: el cartel con la ruta que va en la ventanilla
     C14-bus.jpg       el bus por fuera
     C14-placa-2.jpg   (opcional) otra foto del mismo tipo

   La ida y la vuelta de una ruta (A1, C12…) comparten las fotos. Sirven JPG, PNG y WebP.

2. Corre:  python scripts/preparar_fotos.py

Las fotos se achican (máximo 1280 px, en JPEG liviano) para que carguen rápido en celulares de
gama baja, y se les quitan los datos ocultos de la cámara, incluida la ubicación GPS donde se
tomaron. Quedan en assets/fotos/ junto con data/fotos.json, que es lo que lee la app. La carpeta
fotos/ con los originales no se sube a GitHub.

Necesita Pillow:  pip install pillow
"""
import json
import re
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "fotos"
DESTINO = RAIZ / "assets" / "fotos"
INDICE = RAIZ / "data" / "fotos.json"
RUTAS = RAIZ / "data" / "rutas_amb.geojson"

LADO_MAX = 1280  # píxeles del lado más largo
CALIDAD = 80
EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp"}
TIPOS = ["placa", "bus"]  # mismo orden que el carrusel
NOMBRE = re.compile(r"^(?P<ref>.+?)-(?P<tipo>placa|bus)(?:-(?P<n>\d+))?$", re.IGNORECASE)


def main():
    for salida in (sys.stdout, sys.stderr):
        salida.reconfigure(encoding="utf-8")  # tildes bien en cualquier terminal de Windows
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise SystemExit("Falta Pillow para achicar las fotos. Instálalo con:  pip install pillow")

    codigos = {}  # "C1-B" -> "C1-B" (en mayúsculas -> como lo escribe el AMB)
    for ruta in json.loads(RUTAS.read_text(encoding="utf-8"))["features"]:
        ref = ruta["properties"]["tags"]["ref"]
        codigos[ref.upper()] = ref

    ORIGEN.mkdir(exist_ok=True)
    if DESTINO.exists():
        shutil.rmtree(DESTINO)  # se arma desde cero: si borras una foto de fotos/, sale de la app
    DESTINO.mkdir(parents=True)

    fotos, problemas = [], []
    for archivo in sorted(ORIGEN.iterdir()):
        if not archivo.is_file() or archivo.name.startswith("."):
            continue
        if archivo.suffix.lower() not in EXTENSIONES:
            problemas.append(f"{archivo.name}: formato no admitido (usa JPG, PNG o WebP)")
            continue
        m = NOMBRE.match(archivo.stem)
        if not m:
            problemas.append(f"{archivo.name}: el nombre debe ser CÓDIGO-placa o CÓDIGO-bus (por ejemplo C14-placa.jpg)")
            continue
        clave = m["ref"].upper()
        if clave not in codigos:
            problemas.append(f"{archivo.name}: no hay una ruta tradicional con el código {m['ref']}")
            continue
        tipo, numero = m["tipo"].lower(), int(m["n"] or 1)
        nombre = f"{codigos[clave]}-{tipo}{f'-{numero}' if numero > 1 else ''}.jpg"
        if (DESTINO / nombre).exists():
            problemas.append(f"{archivo.name}: ya hay otra foto {nombre} (¿la misma foto en dos formatos?)")
            continue
        try:
            with Image.open(archivo) as original:
                img = ImageOps.exif_transpose(original)  # la deja derecha, según cómo se tomó
                img = img.convert("RGB")
                img.thumbnail((LADO_MAX, LADO_MAX))
                # Se guarda sin los datos de la cámara (EXIF), así que tampoco va la ubicación GPS.
                img.save(DESTINO / nombre, "JPEG", quality=CALIDAD, optimize=True, progressive=True)
        except OSError as e:
            problemas.append(f"{archivo.name}: no se pudo abrir ({e})")
            continue
        fotos.append((clave, TIPOS.index(tipo), numero, {"src": f"assets/fotos/{nombre}", "tipo": tipo}))

    indice = {}
    for clave, _, _, foto in sorted(fotos, key=lambda f: f[:3]):
        indice.setdefault(clave, []).append(foto)
    INDICE.write_text(json.dumps(indice, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    peso = sum(p.stat().st_size for p in DESTINO.iterdir())
    print(f"Listo: {len(fotos)} fotos de {len(indice)} rutas ({peso / 1e6:.2f} MB) en {DESTINO}")
    sin_placa = sorted({codigos[c] for c in codigos} - {codigos[c] for c, t, _, _ in fotos if t == 0})
    print(f"Rutas sin foto de la placa: {len(sin_placa)} de {len(codigos)}")
    if problemas:
        print("\nEstas fotos no se usaron:", file=sys.stderr)
        for p in problemas:
            print(f"  - {p}", file=sys.stderr)


if __name__ == "__main__":
    main()
