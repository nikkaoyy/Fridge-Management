"""Servidor MCP de la nevera: lo que ARIA necesita de la API como herramientas, en la misma app y el mismo puerto.

Transporte streamable HTTP en `/mcp`, montado desde `main.crear_app` con una `Route` (no `Mount`: así `/mcp` responde
sin redirigir a `/mcp/`) y fuera de `api/openapi.yaml`, que sigue siendo el contrato HTTP. Mismo patrón que
`invest_api/mcp_servidor.py` (MIDAS): sin proceso ni base aparte, cada herramienta abre su conexión a la misma base que
usan las rutas y llama a la función de la ruta que ya existe. Aquí no hay SQL de dominio ni cálculos propios: solo la
validación con los modelos de `modelos.py` y la forma de la respuesta.

- **Autenticación**: toda petición a `/mcp` exige `Authorization: Bearer <token de miembro>`, el mismo token de la
  API (`auth.token_de_cabecera` + `auth.buscar_por_token`). Sin él o con uno inválido, 401 con el mismo cuerpo que da
  la API, antes de llegar a cualquier herramienta; `GET` incluido.
- **Rol**: cada herramienta llama a `auth.exigir` con el método y la ruta de la operación equivalente. Un `lector`
  lee; escribir pide `editor`. El 403 vuelve como error de la herramienta (la petición JSON-RPC es un 200: el error
  va dentro, con su código).
- **Escrituras**: exigen `confirmar: true`. Sin él, la herramienta corre la operación entera dentro de una
  transacción que se deshace (`db.simulacro`), devuelve un error que dice qué se habría escrito y no toca la base.
- **Errores de dominio** (`errores.ErrorApi`): error de herramienta con el código y el mismo mensaje que da la API.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from typing import Any, AsyncIterator, Callable, Iterator, NoReturn

from fastapi import FastAPI
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import BaseModel, ValidationError
from starlette.requests import Request
from starlette.responses import Response

from . import __version__, auth, db, errores
from .errores import ErrorApi

RUTA = "/mcp"
CLAVE_MIEMBRO = "nevera.miembro"  # en el scope ASGI: el miembro que autenticó el montaje, para las herramientas

INSTRUCCIONES = """La nevera de la casa: qué hay, dónde está y cuándo se vence, con las recetas que lo aprovechan.
Para «¿qué hay?» usa nevera_inventario; para «¿qué se vence?», nevera_vencimientos. Las herramientas que escriben
(nevera_compra, nevera_consumo, nevera_cocinar) exigen confirmar: true; sin él dicen qué habrían escrito y no
escriben. Los ids salen de las herramientas de lectura: no los inventes."""

LECTURA = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
ESCRITURA = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)


# ---------------------------------------------------------------- utilidades compartidas por las herramientas

def error_de_api(e: ErrorApi) -> ToolError:
    """El error de dominio como error de herramienta: código HTTP, código del contrato y el mismo mensaje."""
    texto = f"{e.status} {e.codigo}: {e.mensaje}"
    if e.detalle:
        texto += f" Detalle: {json.dumps(e.detalle, ensure_ascii=False)}"
    return ToolError(texto)


def llamar(fn: Callable[..., Any], *args, **kwargs) -> Any:
    """Llama a la función de la ruta y devuelve su JSON (de un `JSONResponse` o tal cual), con sus errores traducidos."""
    try:
        r = fn(*args, **kwargs)
    except ErrorApi as e:
        raise error_de_api(e) from None
    except sqlite3.IntegrityError as e:
        raise error_de_api(errores.de_integridad(e)) from None
    if isinstance(r, Response):
        return json.loads(r.body) if r.body else None
    return r


def validar(modelo: type[BaseModel], datos: dict) -> BaseModel:
    """Con el modelo de la API; si no cumple, el mismo 400 `invalido` que da la ruta. Los None no se mandan: en la API
    un campo ausente y uno en null no siempre son lo mismo."""
    try:
        return modelo.model_validate({k: v for k, v in datos.items() if v is not None})
    except ValidationError as e:
        raise error_de_api(errores.de_validacion(e.errors(include_url=False))) from None


def sin_confirmar(que: str, resultado: Any) -> NoReturn:
    raise ToolError("No se escribió nada: falta confirmar: true. Con confirmar: true se habría "
                    f"{que}. Resultado del simulacro (ids provisionales): "
                    f"{json.dumps(resultado, ensure_ascii=False)}")


class Peticion:
    """Lo que las rutas leen de `request`: el miembro autorizado (`state.miembro`) y la app (`app.state.datos`)."""

    class _Estado:
        def __init__(self, miembro):
            self.miembro = miembro

    def __init__(self, app: FastAPI, miembro: dict):
        self.app, self.state = app, Peticion._Estado(miembro)


def crear_servidor(app: FastAPI) -> MCPServer:
    """Las herramientas. `app` es la FastAPI que monta el servidor: de su estado sale la base."""
    mcp = MCPServer(name="nevera", title="Nevera", version=__version__, instructions=INSTRUCCIONES,
                    log_level="WARNING")  # el SDK hace basicConfig del logger raíz: no subirlo a INFO

    @contextmanager
    def base() -> Iterator[sqlite3.Connection]:
        cx = db.conectar(app.state.ruta_base)
        try:
            yield cx
        finally:
            cx.close()

    def miembro(ctx: Context, metodo: str, ruta: str) -> dict:
        """El miembro que autenticó el montaje, con el rol que pide la operación equivalente de la API."""
        peticion = ctx.request_context.request
        m = peticion.scope.get(CLAVE_MIEMBRO) if isinstance(peticion, Request) else None
        if m is None:  # no pasa por el montaje: no hay a quién autorizar
            raise error_de_api(ErrorApi(401, "no_autenticado", "falta la cabecera Authorization: Bearer <token>"))
        try:
            auth.exigir(m, metodo, ruta)
        except ErrorApi as e:
            raise error_de_api(e) from None
        return m

    return mcp


class MontajeMCP:
    """ASGI en `/mcp`: exige un token de miembro y entrega la petición al `streamable_http_app()` del SDK.

    El gestor de sesiones del SDK solo puede arrancar una vez por instancia; `ciclo()` crea uno nuevo en cada
    arranque de la app (el lifespan de `crear_app` lo llama), así sobrevive a varios arranques en las pruebas.
    Modo sin estado y respuestas JSON: cada llamada es independiente y un reinicio no deja sesiones colgadas.
    """

    def __init__(self, mcp: MCPServer, app: FastAPI):
        self.mcp, self.app = mcp, app
        self._asgi = None

    @asynccontextmanager
    async def ciclo(self) -> AsyncIterator[None]:
        # Sin la protección de DNS rebinding del SDK: solo admite Host localhost y aquí se llega por la IP de la LAN
        # o del tailnet. La defensa es el token obligatorio: un navegador engañado no lo tiene.
        self._asgi = self.mcp.streamable_http_app(
            streamable_http_path=RUTA, stateless_http=True, json_response=True,
            transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False))
        try:
            async with self.mcp.session_manager.run():
                yield
        finally:
            self._asgi = None

    def _autenticar(self, scope) -> dict:
        """El mismo 401 que `deps.autorizar`: sin cabecera, mal formada, o token que no es de un miembro activo."""
        token = auth.token_de_cabecera(Request(scope).headers.get("authorization"))
        cx = db.conectar(self.app.state.ruta_base)
        try:
            fila = auth.buscar_por_token(cx, token)
        finally:
            cx.close()
        if fila is None:
            raise ErrorApi(401, "no_autenticado", "token inválido o de un miembro inactivo")
        return {"id": fila["id"], "nombre": fila["nombre"], "rol": fila["rol"]}

    async def __call__(self, scope, receive, send) -> None:
        try:
            scope[CLAVE_MIEMBRO] = self._autenticar(scope)
        except ErrorApi as e:
            respuesta = errores.respuesta(e.status, e.codigo, e.mensaje, e.detalle, {"WWW-Authenticate": "Bearer"})
        else:
            if scope["method"] != "POST":
                # Sin estado y con respuestas JSON no hay mensajes del servidor que esperar: un GET abriría un flujo
                # SSE que nunca se cierra. La especificación de MCP admite responder 405 a eso.
                respuesta = errores.respuesta(405, "metodo_no_permitido", "en /mcp solo se admite POST (JSON-RPC)",
                                              headers={"Allow": "POST"})
            elif self._asgi is not None:
                await self._asgi(scope, receive, send)
                return
            else:
                respuesta = errores.respuesta(503, "no_disponible", "el servidor MCP no está arrancado")
        await respuesta(scope, receive, send)
