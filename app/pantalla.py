"""La primera pantalla (PEDIDO-NEVERA-3): una sola página servida por el mismo FastAPI.

- `GET /` devuelve `app/estatico/index.html` tal cual (no un redirect: el enlace es solo `http://<casa>:8451/`).
- `GET /estatico/*` sirve `app.js` y `app.css`. Nada se construye: lo que está en el repositorio es lo que se sirve.
- Ni `/` ni `/estatico/*` llevan datos ni piden token: la página es una cáscara vacía que, en el navegador, pide el
  token y lo valida contra `GET /miembros/yo` antes de pedir nada más. Los datos solo salen de la API, que sigue
  exigiendo el token en cada petición.
- No están en `api/openapi.yaml` (el contrato es de la API, no de la piel) ni en un esquema OpenAPI generado.
- Cabeceras: CSP `'self'` (sin scripts ni estilos en línea, sin orígenes de fuera), `no-cache` para que el móvil
  revalide y coja la versión nueva tras un cambio, y `no-referrer`.
"""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

DIRECTORIO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "estatico")

CABECERAS = {
    "Content-Security-Policy": ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                                "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; "
                                "frame-ancestors 'none'"),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


class _Estaticos(StaticFiles):
    def file_response(self, *args, **kwargs):
        r = super().file_response(*args, **kwargs)
        r.headers.update(CABECERAS)
        return r


def instalar(app: FastAPI) -> None:
    app.mount("/estatico", _Estaticos(directory=DIRECTORIO), name="estatico")

    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    def raiz():
        return FileResponse(os.path.join(DIRECTORIO, "index.html"), media_type="text/html; charset=utf-8",
                            headers=CABECERAS)
