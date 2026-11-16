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
import unicodedata
from contextlib import asynccontextmanager, contextmanager
from typing import Annotated, Any, AsyncIterator, Callable, Iterator, Literal, NoReturn

from fastapi import FastAPI
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field, ValidationError
from starlette.requests import Request
from starlette.responses import Response

from . import __version__, auth, db, errores, rutas_catalogo, rutas_elementos, rutas_recetas
from .errores import ErrorApi, no_encontrado
from .modelos import Cocinar, ConsumoReceta, ElementoNuevo, Madurez, MovimientoNuevo

RUTA = "/mcp"
CLAVE_MIEMBRO = "nevera.miembro"  # en el scope ASGI: el miembro que autenticó el montaje, para las herramientas

INSTRUCCIONES = """La nevera de la casa: qué hay, dónde está y cuándo se vence, con las recetas que lo aprovechan.
Para «¿qué hay?» usa nevera_inventario; para «¿qué se vence?», nevera_vencimientos. Las herramientas que escriben
(nevera_compra, nevera_consumo, nevera_cocinar) exigen confirmar: true; sin él dicen qué habrían escrito y no
escriben. Los ids salen de las herramientas de lectura: no los inventes."""

Confirmar = Annotated[bool, Field(default=False, description="Debe ser true para escribir. Sin él no se escribe nada "
                                                             "y se explica qué se habría escrito.")]
Fecha = Annotated[str | None, Field(default=None, description="Fecha AAAA-MM-DD; vacía, hoy (hora de Bogotá).")]

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


def _plano(texto: str) -> str:
    """Para comparar nombres: sin tildes, sin mayúsculas y sin espacios de sobra."""
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return " ".join(sin_tildes.lower().split())


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

    def ubicacion_id(cx, ubicacion: str) -> int:
        """Id o nombre exacto (sin tildes ni mayúsculas) de una ubicación del catálogo."""
        filas = llamar(rutas_catalogo.listar_ubicaciones, cx=cx)
        for u in filas:
            if ubicacion.strip() == str(u["id"]) or _plano(ubicacion) == _plano(u["nombre"]):
                return u["id"]
        raise error_de_api(ErrorApi(404, "no_encontrado", f"ubicación «{ubicacion}» no existe; las hay: " +
                                    ", ".join(f"{u['id']} {u['nombre']}" for u in filas)))

    def presentacion_de(cx, producto: str) -> int:
        """La presentación activa de un producto (id o nombre exacto). Si tiene varias, hay que elegir."""
        prods = llamar(rutas_catalogo.listar_productos, q=None, categoria_id=None, activo=True, cx=cx)
        hallado = next((p for p in prods if producto.strip() == str(p["id"]) or _plano(producto) == _plano(p["nombre"])),
                       None)
        if hallado is None:
            parecidos = [f"{p['id']} {p['nombre']}" for p in prods if _plano(producto) in _plano(p["nombre"])]
            raise error_de_api(ErrorApi(404, "no_encontrado", f"producto «{producto}» no existe" +
                                        (f"; parecidos: {', '.join(parecidos[:10])}" if parecidos else
                                         "; mira los nombres en nevera_inventario")))
        pres = [x for x in llamar(rutas_catalogo.listar_presentaciones, producto_id=hallado["id"], codigo_barras=None,
                                  cx=cx) if x["activo"]]
        if len(pres) == 1:
            return pres[0]["id"]
        if not pres:
            raise error_de_api(ErrorApi(409, "sin_presentacion", f"el producto {hallado['id']} «{hallado['nombre']}» "
                                        "no tiene presentaciones activas: hay que crearla en la app"))
        raise error_de_api(ErrorApi(400, "invalido", f"el producto «{hallado['nombre']}» tiene varias presentaciones; "
                                    "di cuál con presentacion_id: " +
                                    ", ".join(f"{x['id']} {x['nombre']}" for x in pres)))

    # --- lectura ----------------------------------------------------------------------------------

    @mcp.tool(annotations=LECTURA, description=(
        "Salud del servicio: si responde, versión de la app, versión del esquema de la base y qué base usa. Los "
        "conteos de productos y elementos están en nevera_resumen."))
    def nevera_salud(ctx: Context) -> dict[str, Any]:
        miembro(ctx, "GET", "/salud")
        return db.salud(app.state.ruta_base)

    @mcp.tool(annotations=LECTURA, description=(
        "Resumen de la nevera: productos activos, elementos disponibles, cuántos están vencidos, cuántos vencen en "
        "los próximos 7 días, cuántos perecederos no tienen fecha y cuántas mermas hubo en los últimos 30 días."))
    def nevera_resumen(ctx: Context) -> dict[str, Any]:
        miembro(ctx, "GET", "/indicadores")
        with base() as cx:
            return llamar(rutas_elementos.indicadores, cx=cx)

    @mcp.tool(annotations=LECTURA, description=(
        "Inventario: los elementos con saldo (cada cosa física), los que vencen antes primero, con producto, "
        "presentación, saldo y unidad base, ubicación, vencimiento y días para vencer. Filtra por texto, por "
        "ubicación y por los que vencen en N días. `ubicaciones` traduce ubicacion_id a nombre."))
    def nevera_inventario(
        ctx: Context,
        buscar: Annotated[str | None, Field(default=None, description="Texto en el producto, la presentación, la "
                                                                      "etiqueta o la nota; sin tildes ni mayúsculas.")] = None,
        ubicacion: Annotated[str | None, Field(default=None, description="Id o nombre de la ubicación (nevera, "
                                                                         "congelador, despensa…).")] = None,
        por_vencer_dias: Annotated[int | None, Field(default=None, ge=0, description="Solo lo que vence de aquí a "
                                                                                     "N días (incluye lo vencido).")] = None,
    ) -> dict[str, Any]:
        miembro(ctx, "GET", "/elementos")
        with base() as cx:
            uid = ubicacion_id(cx, ubicacion) if ubicacion else None
            filas = llamar(rutas_elementos.listar_elementos, por_vencer=por_vencer_dias, producto_id=None,
                           ubicacion_id=uid, compra_id=None, estado="disponible", cx=cx)
            nombres = {u["id"]: u["nombre"] for u in llamar(rutas_catalogo.listar_ubicaciones, cx=cx)}
        if buscar:
            aguja = _plano(buscar)
            filas = [f for f in filas if any(aguja in _plano(f[k] or "") for k in ("producto", "presentacion",
                                                                                   "etiqueta", "nota"))]
        return {"elementos": filas, "total": len(filas),
                "ubicaciones": {str(i): nombres[i] for i in sorted({f["ubicacion_id"] for f in filas})}}

    @mcp.tool(annotations=LECTURA, description=(
        "Vencimientos: lo ya vencido primero, luego lo que vence hoy y lo que vence en los próximos `dias`, cada "
        "elemento con producto, saldo, ubicación y fecha; más cuántos perecederos no tienen fecha."))
    def nevera_vencimientos(
        ctx: Context,
        dias: Annotated[int, Field(default=7, ge=1, description="Horizonte en días desde hoy.")] = 7,
    ) -> dict[str, Any]:
        miembro(ctx, "GET", "/vencimientos")
        with base() as cx:
            return llamar(rutas_elementos.resumen_vencimientos, dias=dias, cx=cx)

    @mcp.tool(annotations=LECTURA, description=(
        "Catálogo de referencia: categorías, unidades (código, magnitud y factor a la unidad base) y ubicaciones "
        "(con su ubicación madre). Los ids y códigos que piden nevera_compra y nevera_consumo salen de aquí."))
    def nevera_catalogo(ctx: Context) -> dict[str, Any]:
        for ruta in ("/categorias", "/unidades", "/ubicaciones"):
            miembro(ctx, "GET", ruta)
        with base() as cx:
            return {"categorias": llamar(rutas_catalogo.listar_categorias, cx=cx),
                    "unidades": llamar(rutas_catalogo.listar_unidades, cx=cx),
                    "ubicaciones": llamar(rutas_catalogo.listar_ubicaciones, cx=cx)}

    @mcp.tool(annotations=LECTURA, description=(
        "Recetas que rescatan lo que está por vencerse: las que usan algo que vence en `dias`, la más urgente "
        "primero, con qué ingredientes hay (saldo, días para vencer, si alcanza) y cuáles faltan. Vacía si no hay "
        "recetas guardadas."))
    def nevera_recetas_sugeridas(
        ctx: Context,
        dias: Annotated[int, Field(default=3, ge=0, description="Cuenta como «por vencer» lo que vence en estos "
                                                                "días.")] = 3,
    ) -> dict[str, Any]:
        miembro(ctx, "GET", "/recetas/sugeridas")
        with base() as cx:
            return {"recetas": llamar(rutas_recetas.recetas_sugeridas, dias=dias, cx=cx)}

    # --- escritura --------------------------------------------------------------------------------

    @mcp.tool(annotations=ESCRITURA, description=(
        "Da de alta lo comprado: uno o varios elementos de un producto en una ubicación, con cantidad, precio por "
        "unidad y vencimiento (si no viene, se estima con la vida útil del producto; un pack entra con sus partes). "
        "Devuelve los elementos creados. Escribe: exige confirmar: true."))
    def nevera_compra(
        ctx: Context,
        ubicacion: Annotated[str, Field(description="Id o nombre de la ubicación donde se guarda.")],
        producto: Annotated[str | None, Field(default=None, description="Id o nombre exacto del producto; vale si "
                                                                        "tiene una sola presentación activa.")] = None,
        presentacion_id: Annotated[int | None, Field(default=None, description="La presentación exacta; manda "
                                                                               "sobre `producto`.")] = None,
        cantidad: Annotated[float | None, Field(default=None, gt=0, description="Contenido de cada unidad; vacío, "
                                                                                "el de la presentación.")] = None,
        unidad: Annotated[str | None, Field(default=None, description="Código de unidad de `cantidad` (g, kg, ml, "
                                                                      "l, u…).")] = None,
        unidades: Annotated[int, Field(default=1, ge=1, le=200, description="Cuántas iguales se compraron: un "
                                                                            "elemento por cada una.")] = 1,
        precio_unitario_cop: Annotated[int | None, Field(default=None, ge=0, description="Precio de cada unidad "
                                                                                         "en pesos.")] = None,
        vencimiento: Annotated[str | None, Field(default=None, description="AAAA-MM-DD; vacío, se estima.")] = None,
        vencimiento_impreso: Annotated[bool, Field(default=False, description="true si la fecha viene impresa en "
                                                                              "el empaque.")] = False,
        fecha_compra: Fecha = None,
        madurez: Annotated[Madurez | None, Field(default=None, description="Para fruta: verde, en_punto o "
                                                                           "madura.")] = None,
        etiqueta: Annotated[str | None, Field(default=None, description="Texto corto para reconocerlo.")] = None,
        nota: Annotated[str | None, Field(default=None, description="Nota libre.")] = None,
        confirmar: Confirmar = False,
    ) -> dict[str, Any]:
        m = miembro(ctx, "POST", "/elementos")
        if presentacion_id is None and not producto:
            raise error_de_api(ErrorApi(400, "invalido", "falta el producto (o presentacion_id)"))
        with base() as cx:
            pid = presentacion_id if presentacion_id is not None else presentacion_de(cx, producto)
            datos = validar(ElementoNuevo, {
                "presentacion_id": pid, "ubicacion_id": ubicacion_id(cx, ubicacion), "cantidad": cantidad,
                "unidad": unidad, "unidades": unidades, "fecha_compra": fecha_compra, "vencimiento": vencimiento,
                "vencimiento_impreso": vencimiento_impreso, "madurez": madurez,
                "precio_unitario_cop": precio_unitario_cop, "etiqueta": etiqueta, "nota": nota})
            peticion = Peticion(app, m)
            if confirmar:
                return {"elementos": llamar(rutas_elementos.crear_elemento, peticion, datos, cx=cx)}
            with db.simulacro(cx):
                creados = llamar(rutas_elementos.crear_elemento, peticion, datos, cx=cx)
        sin_confirmar(f"dado de alta {len(creados)} elemento(s) de «{creados[0]['producto']}» "
                      f"({creados[0]['presentacion']})", creados)

    @mcp.tool(annotations=ESCRITURA, description=(
        "Descuenta de un elemento lo que se consumió o se descartó (se dañó, se botó). Sin cantidad, se va el "
        "saldo entero. Devuelve el movimiento con el saldo que queda. Escribe: exige confirmar: true."))
    def nevera_consumo(
        ctx: Context,
        elemento_id: Annotated[int, Field(description="Id del elemento (de nevera_inventario).")],
        tipo: Annotated[Literal["consumo", "descarte"], Field(default="consumo", description="consumo o descarte; "
                                                              "el descarte se guarda como merma.")] = "consumo",
        cantidad: Annotated[float | None, Field(default=None, gt=0, description="Cuánto; vacío, todo el "
                                                                                "saldo.")] = None,
        unidad: Annotated[str | None, Field(default=None, description="Código de unidad de `cantidad`; vacío, la "
                                                                      "unidad base del producto.")] = None,
        motivo: Annotated[str | None, Field(default=None, description="Por qué (sobre todo en un descarte: "
                                                                      "«se dañó», «se venció»).")] = None,
        fecha: Fecha = None,
        confirmar: Confirmar = False,
    ) -> dict[str, Any]:
        m = miembro(ctx, "POST", "/movimientos")
        datos = validar(MovimientoNuevo, {"elemento_id": elemento_id, "tipo": "merma" if tipo == "descarte" else tipo,
                                          "cantidad": cantidad, "unidad": unidad, "fecha": fecha, "motivo": motivo})
        peticion = Peticion(app, m)
        with base() as cx:
            if confirmar:
                return llamar(rutas_elementos.crear_movimiento, peticion, datos, cx=cx)
            with db.simulacro(cx):
                mov = llamar(rutas_elementos.crear_movimiento, peticion, datos, cx=cx)
        sin_confirmar(f"registrado {'una merma' if datos.tipo == 'merma' else 'un consumo'} de {mov['cantidad']:g} "
                      f"en el elemento {elemento_id} (quedaría saldo {mov['saldo']:g})", mov)

    @mcp.tool(annotations=ESCRITURA, description=(
        "Cocina una receta: registra un consumo por cada elemento indicado, todo o nada (si a uno no le alcanza, no "
        "se descuenta ninguno). La receta no elige sola qué elementos usar: van en `consumos`, sacados de "
        "nevera_recetas_sugeridas y nevera_inventario. Devuelve los movimientos. Escribe: exige confirmar: true."))
    def nevera_cocinar(
        ctx: Context,
        receta_id: Annotated[int, Field(description="Id de la receta (de nevera_recetas_sugeridas).")],
        consumos: Annotated[list[ConsumoReceta], Field(min_length=1, description="Cada elemento que se usa: "
                                                       "elemento_id, cantidad y unidad (vacía, la base).")],
        fecha: Fecha = None,
        confirmar: Confirmar = False,
    ) -> dict[str, Any]:
        m = miembro(ctx, "POST", "/recetas/{id}/cocinar")
        datos = validar(Cocinar, {"consumos": [c.model_dump(exclude_none=True) for c in consumos], "fecha": fecha})
        peticion = Peticion(app, m)
        with base() as cx:
            if confirmar:
                return llamar(rutas_recetas.cocinar, receta_id, peticion, datos, cx=cx)
            with db.simulacro(cx):
                hecho = llamar(rutas_recetas.cocinar, receta_id, peticion, datos, cx=cx)
        sin_confirmar(f"cocinado {hecho['motivo']} con {len(hecho['movimientos'])} consumo(s)", hecho)

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
