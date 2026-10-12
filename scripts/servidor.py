"""Servidor local para probar la app: como `python -m http.server`, pero le pide al
navegador que revise si hay versión nueva de cada archivo en cada carga, para que
nunca se quede mostrando una versión vieja de app.js o styles.css.

Uso:  python scripts/servidor.py [puerto]          solo en este computador
      python scripts/servidor.py --red [puerto]    también desde el celular (misma red Wi-Fi)

El puerto por defecto es 8000.
"""
import argparse
import functools
import http.server
import socket
from pathlib import Path


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def ip_local():
    """IP de este computador en la red local (la de la interfaz que sale a internet)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("8.8.8.8", 80))  # con UDP no se envía nada: solo elige la interfaz
            return s.getsockname()[0]
        except OSError:
            return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Servidor local de Pa' Donde")
    parser.add_argument("puerto", nargs="?", type=int, default=8000)
    parser.add_argument("--red", action="store_true", help="aceptar conexiones de otros equipos de la red local")
    args = parser.parse_args()

    raiz = Path(__file__).resolve().parent.parent
    handler = functools.partial(SinCache, directory=str(raiz))
    servidor = http.server.ThreadingHTTPServer(("0.0.0.0" if args.red else "127.0.0.1", args.puerto), handler)

    print(f"Pa' Donde en http://localhost:{args.puerto}")
    if args.red:
        ip = ip_local()
        if ip:
            print(f"En el celular (misma red Wi-Fi): http://{ip}:{args.puerto}")
        print("Si el celular no carga la página, revisa que Windows permita a Python en el firewall")
        print("y que la red Wi-Fi esté marcada como privada.")
    print("Ctrl+C para detener")
    servidor.serve_forever()
