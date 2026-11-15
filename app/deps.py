"""Dependencias de FastAPI: conexión por petición y autorización central."""
from __future__ import annotations

from fastapi import Depends, Request

from . import auth, db


def conexion(request: Request):
    cx = db.conectar(request.app.state.ruta_base)
    try:
        yield cx
    finally:
        cx.close()


def autorizar(request: Request, cx=Depends(conexion)):
    """401 sin token o con token inválido; 403 si el rol no alcanza para este método y esta ruta."""
    token = auth.token_de_cabecera(request.headers.get("authorization"))
    miembro = auth.buscar_por_token(cx, token)
    if miembro is None:
        raise auth.ErrorApi(401, "no_autenticado", "token inválido o de un miembro inactivo")
    ruta = getattr(request.scope.get("route"), "path", request.url.path)
    auth.exigir(miembro, request.method, ruta)
    request.state.miembro = miembro
    return miembro
