"""Genera las imágenes PNG de la app a partir de assets/icono.svg, usando Chrome o Edge sin
ventana para dibujarlas:

- los íconos para instalarla en el celular (192, 512, "maskable" y el de iPhone);
- assets/og-image.png, la vista previa que muestran WhatsApp y otras apps al compartir un enlace.

Uso:  python scripts/generar_iconos.py
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SVG = (RAIZ / "assets" / "icono.svg").read_text(encoding="utf-8")
NAVEGADORES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

# archivo, tamaño, fondo, qué tanto del cuadro ocupa el pin
ICONOS = [
    ("icon-192.png", 192, "transparent", 0.94),
    ("icon-512.png", 512, "transparent", 0.94),
    # "maskable": Android lo recorta en círculo o en cuadro redondeado, así que el pin va
    # más pequeño (dentro de la zona segura del 80 %) y con fondo.
    ("maskable-512.png", 512, "#ffffff", 0.62),
    ("apple-touch-icon.png", 180, "#ffffff", 0.74),
]

# Vista previa al compartir (1200 x 630, el tamaño que piden WhatsApp, Facebook y X).
OG_HTML = """<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500&family=Montserrat:wght@800&display=block">
<style>
  html, body {{ margin: 0; width: 1200px; height: 630px; overflow: hidden; }}
  body {{ display: flex; align-items: center; gap: 56px; padding: 0 90px; box-sizing: border-box;
         background: #0B3D91; color: #fff; font-family: Inter, "Segoe UI", sans-serif; position: relative; }}
  svg {{ width: 300px; height: 300px; flex: none; }}
  h1 {{ margin: 0; font: 800 108px/1 Montserrat, "Segoe UI", sans-serif; letter-spacing: -2px; }}
  h1 span {{ color: #00AEEF; }}
  p {{ margin: 22px 0 0; font-size: 36px; line-height: 1.3; color: #DCE6F7; }}
  .sub {{ margin-top: 26px; font-size: 26px; color: #9FB6DD; }}
  .franja {{ position: absolute; left: 0; right: 0; bottom: 0; height: 18px;
            background: linear-gradient(90deg, #7ED321 0 33%, #00AEEF 33% 66%, #FFD600 66%); }}
</style>
{svg}
<div>
  <h1>Pa’ <span>Donde</span></h1>
  <p>Rutas de buses en Barranquilla<br>y su área metropolitana</p>
  <p class="sub">Transmetro · Buses tradicionales · Cómo llegar</p>
</div>
<div class="franja"></div>"""


def tamano_png(ruta):
    with open(ruta, "rb") as f:
        cabecera = f.read(24)
    return struct.unpack(">II", cabecera[16:24])


def dibujar(navegador, html_texto, ancho, alto, salida, tmp):
    html = Path(tmp) / f"{salida.name}.html"
    html.write_text(html_texto, encoding="utf-8")
    subprocess.run([
        navegador, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
        "--default-background-color=00000000", f"--window-size={ancho},{alto}",
        "--virtual-time-budget=5000",  # espera a que carguen las tipografías
        f"--screenshot={salida}", html.as_uri(),
    ], check=True, timeout=90, capture_output=True)
    medida = tamano_png(salida)
    print(f"{salida.name}: {medida[0]}x{medida[1]}")
    if medida != (ancho, alto):
        print(f"  ojo: se esperaba {ancho}x{alto}", file=sys.stderr)


def main():
    navegador = next((n for n in NAVEGADORES if Path(n).exists()), None)
    if not navegador:
        raise SystemExit("No encontré Chrome ni Edge para dibujar las imágenes.")
    with tempfile.TemporaryDirectory() as tmp:
        for nombre, lado, fondo, escala in ICONOS:
            html = f"""<!doctype html><meta charset="utf-8">
<style>html,body{{margin:0;width:{lado}px;height:{lado}px;background:{fondo};overflow:hidden}}
body{{display:grid;place-items:center}}svg{{width:{lado * escala}px;height:{lado * escala}px}}</style>
{SVG}"""
            dibujar(navegador, html, lado, lado, RAIZ / "assets" / nombre, tmp)
        dibujar(navegador, OG_HTML.format(svg=SVG), 1200, 630, RAIZ / "assets" / "og-image.png", tmp)


if __name__ == "__main__":
    main()
