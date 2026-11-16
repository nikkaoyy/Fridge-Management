"""Errores uniformes del contrato: {"error": {"codigo", "mensaje", "detalle"?}}.

Reglas:
- 400 `invalido`: la petición no cumple el contrato o no tiene sentido (campo faltante, tipo equivocado, fecha mal
  formada, unidad de otra magnitud…). El contrato declara 400 para todo esto, así que la validación de FastAPI, que
  por defecto respondería 422, se reasigna aquí a 400.
- 401 `no_autenticado`, 403 `prohibido`, 404 `no_encontrado`, 409 `conflicto` (o un código más preciso), 501
  `no_implementado`, 500 `error_interno`.
- Nunca se devuelve el valor recibido en un error de validación: podría ser una foto entera o un token.
"""
from __future__ import annotations

import logging
import sqlite3

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("nevera")


class ErrorApi(Exception):
    def __init__(self, status: int, codigo: str, mensaje: str, detalle: dict | None = None):
        super().__init__(mensaje)
        self.status, self.codigo, self.mensaje, self.detalle = status, codigo, mensaje, detalle


def invalido(mensaje: str, **detalle) -> ErrorApi:
    return ErrorApi(400, "invalido", mensaje, detalle or None)


def no_encontrado(que: str, ident) -> ErrorApi:
    return ErrorApi(404, "no_encontrado", f"{que} {ident} no existe")


def conflicto(mensaje: str, codigo: str = "conflicto") -> ErrorApi:
    return ErrorApi(409, codigo, mensaje)


def cuerpo(codigo: str, mensaje: str, detalle: dict | None = None) -> dict:
    err = {"codigo": codigo, "mensaje": mensaje}
    if detalle:
        err["detalle"] = detalle
    return {"error": err}


def respuesta(status: int, codigo: str, mensaje: str, detalle: dict | None = None, headers: dict | None = None):
    return JSONResponse(cuerpo(codigo, mensaje, detalle), status_code=status, headers=headers)


_CODIGO_HTTP = {400: "invalido", 401: "no_autenticado", 403: "prohibido", 404: "no_encontrado",
                405: "metodo_no_permitido", 409: "conflicto", 413: "demasiado_grande", 501: "no_implementado"}


_MOTIVOS = {"missing": "falta el campo", "extra_forbidden": "campo desconocido en el contrato",
            "json_invalid": "el cuerpo no es JSON válido", "model_attributes_type": "se esperaba un objeto JSON",
            "int_parsing": "se esperaba un entero", "int_type": "se esperaba un entero",
            "int_from_float": "se esperaba un entero", "float_parsing": "se esperaba un número",
            "float_type": "se esperaba un número", "bool_parsing": "se esperaba true o false",
            "bool_type": "se esperaba true o false", "string_type": "se esperaba texto",
            "list_type": "se esperaba una lista", "too_short": "la lista no puede estar vacía"}


def _motivo(x: dict) -> str:
    tipo, msg = x.get("type", ""), x.get("msg", "")
    if tipo in _MOTIVOS:
        return _MOTIVOS[tipo]
    if tipo == "literal_error":
        return "valor no permitido; " + msg.replace("Input should be", "debe ser").replace(" or ", " o ")
    if tipo in ("greater_than", "greater_than_equal", "less_than_equal", "less_than"):
        lim = x.get("ctx", {})
        return {"greater_than": f"debe ser mayor que {lim.get('gt')}",
                "greater_than_equal": f"debe ser mayor o igual que {lim.get('ge')}",
                "less_than_equal": f"debe ser menor o igual que {lim.get('le')}",
                "less_than": f"debe ser menor que {lim.get('lt')}"}[tipo]
    if tipo == "string_too_short":
        return "no puede estar vacío"
    return msg.removeprefix("Value error, ")


def _lugar(loc) -> str:
    partes = [str(p) for p in loc if p not in ("body",)]
    return ".".join(partes) if partes else "cuerpo"


def instalar(app: FastAPI) -> None:
    @app.exception_handler(ErrorApi)
    async def _error_api(_: Request, e: ErrorApi):
        headers = {"WWW-Authenticate": "Bearer"} if e.status == 401 else None
        return respuesta(e.status, e.codigo, e.mensaje, e.detalle, headers)

    @app.exception_handler(RequestValidationError)
    async def _validacion(_: Request, e: RequestValidationError):
        errores = [{"campo": _lugar(x.get("loc", ())), "motivo": _motivo(x)} for x in e.errors()]
        primero = errores[0] if errores else {"campo": "cuerpo", "motivo": "petición inválida"}
        return respuesta(400, "invalido", f"{primero['campo']}: {primero['motivo']}", {"errores": errores})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        mensaje = {404: "la ruta no existe", 405: "método no permitido en esta ruta"}.get(e.status_code, str(e.detail))
        return respuesta(e.status_code, _CODIGO_HTTP.get(e.status_code, "error"), mensaje)

    @app.exception_handler(sqlite3.IntegrityError)
    async def _integridad(_: Request, e: sqlite3.IntegrityError):
        # Lo que la validación de la API no atrapó y la base sí: se dice, no se convierte en 500.
        texto = str(e)
        if "UNIQUE" in texto or "FOREIGN KEY" in texto:
            return respuesta(409, "conflicto", f"la base rechazó la escritura: {texto}")
        return respuesta(400, "invalido", f"la base rechazó la escritura: {texto}")

    @app.exception_handler(Exception)
    async def _inesperado(request: Request, e: Exception):
        # Solo método y ruta: ni cabeceras (el token) ni cuerpo.
        log.exception("error no previsto en %s %s", request.method, request.url.path)
        return respuesta(500, "error_interno", "error interno; quedó en el log del servicio")
