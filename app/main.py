"""Aplicación FastAPI del Catálogo de nevera (fase 1, PEDIDO-NEVERA-2).

Arranque:  NEVERA_ADMIN_TOKEN=… TZ=America/Bogota .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8451
(o scripts/arrancar.sh, que además comprueba que el puerto esté libre y deja el log en data/servicio.log).

Variables de entorno:
- NEVERA_DATOS        directorio de datos (base y fotos); por defecto data/ en el repositorio.
- NEVERA_ADMIN_TOKEN  token del primer admin; solo se usa si la base no tiene ningún miembro.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from . import __version__, auth, db, errores
from . import rutas_catalogo, rutas_elementos, rutas_fase2, rutas_importar, rutas_miembros

log = logging.getLogger("nevera")
_NO_DADO = object()


def _preparar_log() -> None:
    if not log.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        log.addHandler(h)
        log.setLevel(logging.INFO)
        log.propagate = False


def crear_app(datos: str | None = None, token_admin=_NO_DADO) -> FastAPI:
    """`datos` y `token_admin` explícitos para las pruebas; si no, salen del entorno al arrancar."""
    _preparar_log()

    @asynccontextmanager
    async def ciclo(app: FastAPI):
        dir_datos = os.path.abspath(datos or os.environ.get("NEVERA_DATOS") or os.path.join(db.RAIZ, "data"))
        token = os.environ.get("NEVERA_ADMIN_TOKEN") if token_admin is _NO_DADO else token_admin
        ruta = os.path.join(dir_datos, "nevera.db")
        try:
            creada = db.abrir_o_crear(ruta)
            cx = db.conectar(ruta)
            try:
                with db.transaccion(cx):
                    mensaje = auth.arrancar(cx, token)
            finally:
                cx.close()
        except (auth.ArranqueImposible, db.BaseInvalida) as e:
            log.critical("NO ARRANCA: %s", e)
            raise
        app.state.datos, app.state.ruta_base = dir_datos, ruta
        log.info("base %s (%s, esquema %s)", ruta, "creada ahora" if creada else "existente", db.VERSION_ESQUEMA)
        log.info(mensaje)
        yield

    app = FastAPI(title="Catálogo de nevera", version=__version__, lifespan=ciclo,
                  docs_url=None, redoc_url=None, openapi_url=None)  # el contrato es api/openapi.yaml
    errores.instalar(app)

    @app.get("/salud")
    def salud(request: Request):
        cx = db.conectar(request.app.state.ruta_base)
        try:
            esquema = db.version(cx)
        finally:
            cx.close()
        return {"ok": True, "version": __version__, "esquema": esquema,
                "base": os.path.relpath(request.app.state.ruta_base, db.RAIZ)
                if request.app.state.ruta_base.startswith(db.RAIZ + os.sep) else request.app.state.ruta_base}

    for r in (rutas_catalogo, rutas_elementos, rutas_importar, rutas_miembros, rutas_fase2):
        app.include_router(r.router)
    return app


app = crear_app()
