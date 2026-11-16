"""La pantalla (PEDIDO-NEVERA-4): el build de React + Vite (`web/dist`) servido por el mismo FastAPI.

- `GET /` devuelve `web/dist/index.html` (no un redirect: el enlace es solo `http://<casa>:8451/`). Se lee en cada
  petición: un `npm run build` nuevo se ve sin reiniciar el servicio.
- `GET /assets/*` (JS y CSS con hash en el nombre), `GET /fonts/*` (Inter, Space Grotesk y JetBrains Mono,
  autohospedadas) y `GET /favicon.svg`, con su ruta tal como las deja Vite.
- **Si `web/dist` no existe** (repositorio recién clonado), `/` responde `503` con un HTML corto que dice cómo
  construirlo. Nunca un 404 mudo.
- Ni `/` ni los estáticos llevan datos ni piden token: la página es una cáscara que, en el navegador, pide el token y
  lo valida contra `GET /miembros/yo` antes de pedir nada más. Los datos solo salen de la API, que sigue exigiendo el
  token en cada petición. Nada de esto está en `api/openapi.yaml` (el contrato es de la API, no de la piel).
- Cabeceras: CSP `'self'` sin scripts en línea; los únicos estilos en línea permitidos son los `<style>` del
  `index.html` servido (los tokens de ARIA van en el `<head>`, como en PYTHAGORAS), cada uno por su hash `sha256`
  calculado aquí sobre el archivo que se sirve. `no-cache` en el HTML para que el móvil coja el build nuevo; los
  assets llevan hash en el nombre y se cachean un año.
"""
from __future__ import annotations

import base64
import hashlib
import html
import os
import re

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, Response
from starlette.staticfiles import StaticFiles

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(RAIZ, "web", "dist")  # las pruebas lo cambian antes de crear la app

_ESTILO = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)


def csp(estilos_en_linea: list[str] | tuple[str, ...] = ()) -> str:
    hashes = "".join(f" 'sha256-{base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()}'"
                     for s in estilos_en_linea)
    return ("default-src 'self'; script-src 'self'; "
            f"style-src 'self'{hashes}; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; "
            "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")


COMUNES = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}
SIN_CACHE = {**COMUNES, "Cache-Control": "no-cache", "Content-Security-Policy": csp()}
INMUTABLE = {**COMUNES, "Cache-Control": "public, max-age=31536000, immutable", "Content-Security-Policy": csp()}

SIN_BUILD = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nevera · falta el build</title></head><body>
<h1>Nevera: falta construir la pantalla</h1>
<p>El servicio está vivo (la API responde), pero no encuentra <code>{dist}/index.html</code>.</p>
<p>En la máquina, desde el repositorio:</p>
<pre>cd web
npm ci
npm run build</pre>
<p>El build queda en <code>web/dist</code> y se sirve en <code>/</code> sin reiniciar el servicio.</p>
</body></html>
"""


class _Estaticos(StaticFiles):
    """StaticFiles que no exige que el directorio exista al arrancar (sin build: 404 en los assets, 503 en /)."""

    def __init__(self, *, directory: str, cabeceras: dict[str, str]):
        super().__init__(directory=directory, check_dir=False)
        self.cabeceras = cabeceras

    async def check_config(self) -> None:
        return None

    def file_response(self, *args, **kwargs):
        r = super().file_response(*args, **kwargs)
        r.headers.update(self.cabeceras)
        return r


def instalar(app: FastAPI) -> None:
    dist = DIST
    app.mount("/assets", _Estaticos(directory=os.path.join(dist, "assets"), cabeceras=INMUTABLE), name="assets")
    app.mount("/fonts", _Estaticos(directory=os.path.join(dist, "fonts"), cabeceras=INMUTABLE), name="fonts")

    @app.api_route("/favicon.svg", methods=["GET", "HEAD"], include_in_schema=False)
    def favicon():
        ruta = os.path.join(dist, "favicon.svg")
        if not os.path.isfile(ruta):
            return Response(status_code=404, headers=SIN_CACHE)
        return FileResponse(ruta, media_type="image/svg+xml", headers=SIN_CACHE)

    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    def raiz():
        indice = os.path.join(dist, "index.html")
        try:
            with open(indice, encoding="utf-8") as f:
                texto = f.read()
        except FileNotFoundError:
            rel = os.path.relpath(dist, RAIZ) if dist.startswith(RAIZ + os.sep) else dist
            return HTMLResponse(SIN_BUILD.format(dist=html.escape(rel)), status_code=503, headers=SIN_CACHE)
        cab = {**SIN_CACHE, "Content-Security-Policy": csp(_ESTILO.findall(texto))}
        return HTMLResponse(texto, headers=cab)
