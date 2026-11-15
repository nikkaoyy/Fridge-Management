"""Elementos (alta rápida con D1/D3 y foto D5), vencimientos, movimientos (D4) e indicadores.

Toda lista y todo conteo mira solo hojas (D3): un pack explotado se ve por sus hijos; el padre se consulta en
GET /elementos/{id} y no suma.
"""
from __future__ import annotations

import base64
import binascii
import os
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse

from . import db
from .deps import autorizar, conexion
from .dominio import (EPS, SQL_MOVIMIENTOS, Alta, a_base, dar_de_alta, descendientes, elemento_json, elemento_vista,
                      elementos_json, es_fecha, estimar_vencimiento, hoy, mas_dias, movimiento_json, redondear)
from .errores import ErrorApi, conflicto, invalido, no_encontrado
from .modelos import ElementoEdicion, ElementoNuevo, MovimientoNuevo

router = APIRouter(dependencies=[Depends(autorizar)])

FOTO_MAXIMA = 8 * 1024 * 1024  # bytes ya decodificados


# ---------------------------------------------------------------- fotos (D5)

def _tipo_imagen(b: bytes) -> str | None:
    if b[:3] == b"\xff\xd8\xff":
        return "jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    if b[4:8] == b"ftyp" and b[8:12] in (b"heic", b"heix", b"heif", b"mif1", b"msf1", b"hevc"):
        return "heic"
    return None


def _decodificar_foto(texto: str) -> tuple[bytes, str]:
    if texto.startswith("data:") and "," in texto:  # se acepta también un data URL del navegador
        texto = texto.split(",", 1)[1]
    try:
        datos = base64.b64decode(texto, validate=True)
    except (binascii.Error, ValueError):
        raise invalido("foto: no es base64 válido")
    if not datos:
        raise invalido("foto: vacía")
    if len(datos) > FOTO_MAXIMA:
        raise invalido(f"foto: pesa {len(datos)} bytes; el máximo es {FOTO_MAXIMA}")
    ext = _tipo_imagen(datos)
    if ext is None:
        raise invalido("foto: formato no reconocido (se aceptan JPEG, PNG, WebP y HEIC)")
    return datos, ext


# ---------------------------------------------------------------- elementos

def _filtro_estado(estado: str) -> str:
    return {"disponible": f" AND saldo > {EPS}", "agotado": f" AND saldo <= {EPS}", "todos": ""}[estado]


@router.get("/elementos")
def listar_elementos(por_vencer: int | None = Query(None, ge=0), producto_id: int | None = None,
                     ubicacion_id: int | None = None, compra_id: int | None = None,
                     estado: Literal["disponible", "agotado", "todos"] = "disponible", cx=Depends(conexion)):
    sql, args = "SELECT * FROM v_elemento WHERE es_hoja = 1" + _filtro_estado(estado), []
    if por_vencer is not None:
        sql += " AND vencimiento IS NOT NULL AND vencimiento <= ?"
        args.append(mas_dias(hoy(), por_vencer))
    for campo, valor in (("producto_id", producto_id), ("ubicacion_id", ubicacion_id), ("compra_id", compra_id)):
        if valor is not None:
            sql += f" AND {campo} = ?"
            args.append(valor)
    sql += " ORDER BY vencimiento IS NULL, vencimiento, id"
    return [elemento_json(f) for f in cx.execute(sql, args)]


@router.post("/elementos")
def crear_elemento(request: Request, datos: ElementoNuevo, cx=Depends(conexion)):
    miembro = request.state.miembro
    foto = _decodificar_foto(datos.foto) if datos.foto is not None else None
    alta = Alta(**datos.model_dump(exclude={"foto"}))
    archivo = None
    try:
        with db.transaccion(cx):
            ids = dar_de_alta(cx, alta, miembro["id"])
            if foto is not None:
                producto_id = cx.execute("SELECT producto_id FROM presentacion WHERE id = ?",
                                         (datos.presentacion_id,)).fetchone()[0]
                ruta = f"fotos/{producto_id}/{uuid.uuid4().hex}.{foto[1]}"
                archivo = os.path.join(request.app.state.datos, ruta)
                os.makedirs(os.path.dirname(archivo), exist_ok=True)
                with open(archivo, "xb") as fh:
                    fh.write(foto[0])
                cx.execute("INSERT INTO producto_foto (producto_id, ruta, elemento_id) VALUES (?, ?, ?)",
                           (producto_id, ruta, ids[0]))
            cuerpo = elementos_json(cx, ids)
    except BaseException:
        if archivo and os.path.exists(archivo):  # la transacción no entró: la foto tampoco se queda
            os.unlink(archivo)
        raise
    return JSONResponse(cuerpo, status_code=201)


def _detalle(cx, elemento_id: int) -> dict:
    fila = elemento_vista(cx, elemento_id)
    if fila is None:
        raise no_encontrado("elemento", elemento_id)
    d = elemento_json(fila)
    d["movimientos"] = [movimiento_json(m) for m in cx.execute(SQL_MOVIMIENTOS + " WHERE elemento_id = ? ORDER BY id",
                                                                (elemento_id,))]
    d["hijos"] = [h[0] for h in cx.execute("SELECT id FROM elemento WHERE padre_id = ? ORDER BY id", (elemento_id,))]
    d["fotos"] = [dict(f) for f in cx.execute(
        "SELECT id, producto_id, ruta, tomada_en, elemento_id FROM producto_foto WHERE elemento_id = ? ORDER BY id",
        (elemento_id,))]
    return d


@router.get("/elementos/{id}")
def ver_elemento(id: int, cx=Depends(conexion)):
    return _detalle(cx, id)


@router.patch("/elementos/{id}")
def editar_elemento(id: int, datos: ElementoEdicion, cx=Depends(conexion)):
    campos = datos.model_fields_set
    with db.transaccion(cx):
        e = cx.execute("SELECT e.*, c.fecha AS fecha_compra, p.producto_id FROM elemento e "
                       "JOIN compra c ON c.id = e.compra_id JOIN presentacion p ON p.id = e.presentacion_id "
                       "WHERE e.id = ?", (id,)).fetchone()
        if e is None:
            raise no_encontrado("elemento", id)
        cambios: dict = {}
        if "ubicacion_id" in campos:
            if datos.ubicacion_id is None:
                raise invalido("ubicacion_id no puede ser null")
            if cx.execute("SELECT 1 FROM ubicacion WHERE id = ?", (datos.ubicacion_id,)).fetchone() is None:
                raise no_encontrado("ubicación", datos.ubicacion_id)
            cambios["ubicacion_id"] = datos.ubicacion_id
        if "vencimiento" in campos:
            cambios["vencimiento"] = datos.vencimiento
            cambios["vencimiento_origen"] = "manual" if datos.vencimiento else None
        if "madurez" in campos:
            cambios["madurez"] = datos.madurez
        if "abierto_en" in campos:
            if datos.abierto_en is not None and datos.abierto_en < e["fecha_compra"]:
                raise invalido(f"abierto_en {datos.abierto_en} es anterior a la compra ({e['fecha_compra']})")
            cambios["abierto_en"] = datos.abierto_en
        for k in ("etiqueta", "nota"):
            if k in campos:
                cambios[k] = getattr(datos, k)

        def recalcular(fila, ubicacion_id, madurez) -> dict:
            # §4: el estimado se recalcula desde la compra con los factores nuevos; impreso y manual no se tocan.
            v = estimar_vencimiento(cx, fila["producto_id"], fila["fecha_compra"], madurez, ubicacion_id)
            return {"vencimiento": v, "vencimiento_origen": "estimado" if v else None}

        nueva_ubic = cambios.get("ubicacion_id", e["ubicacion_id"])
        nueva_mad = cambios.get("madurez", e["madurez"])
        if ("vencimiento" not in campos and e["vencimiento_origen"] == "estimado"
                and (nueva_ubic != e["ubicacion_id"] or nueva_mad != e["madurez"])):
            cambios.update(recalcular(e, nueva_ubic, nueva_mad))
        if cambios:
            cx.execute(f"UPDATE elemento SET {', '.join(k + ' = ?' for k in cambios)} WHERE id = ?",
                       [*cambios.values(), id])
        # Mover un pack mueve lo que sigue dentro de él (lo que estaba en su misma ubicación).
        if nueva_ubic != e["ubicacion_id"]:
            for hid in descendientes(cx, id):
                h = cx.execute("SELECT e.*, c.fecha AS fecha_compra, p.producto_id FROM elemento e "
                               "JOIN compra c ON c.id = e.compra_id JOIN presentacion p ON p.id = e.presentacion_id "
                               "WHERE e.id = ?", (hid,)).fetchone()
                if h["ubicacion_id"] != e["ubicacion_id"]:
                    continue
                ch = {"ubicacion_id": nueva_ubic}
                if h["vencimiento_origen"] == "estimado":
                    ch.update(recalcular(h, nueva_ubic, h["madurez"]))
                cx.execute(f"UPDATE elemento SET {', '.join(k + ' = ?' for k in ch)} WHERE id = ?", [*ch.values(), hid])
        return elemento_json(elemento_vista(cx, id))


@router.delete("/elementos/{id}")
def borrar_elemento(id: int, cx=Depends(conexion)):
    with db.transaccion(cx):
        if cx.execute("DELETE FROM elemento WHERE id = ?", (id,)).rowcount == 0:
            raise no_encontrado("elemento", id)
    return Response(status_code=204)


# ---------------------------------------------------------------- vencimientos e indicadores

@router.get("/vencimientos")
def resumen_vencimientos(dias: int = Query(7, ge=1), cx=Depends(conexion)):
    h = hoy()
    base = f"SELECT * FROM v_elemento WHERE es_hoja = 1 AND saldo > {EPS}"
    orden = " ORDER BY vencimiento, id"
    lista = lambda cond, *a: [elemento_json(f) for f in cx.execute(base + cond + orden, a)]  # noqa: E731
    return {
        "hoy": h,
        "dias": dias,
        "vencidos": lista(" AND vencimiento < ?", h),
        "hoy_vencen": lista(" AND vencimiento = ?", h),
        "proximos": lista(" AND vencimiento > ? AND vencimiento <= ?", h, mas_dias(h, dias)),
        "sin_vencimiento": cx.execute(base.replace("SELECT *", "SELECT COUNT(*)") +
                                      " AND vencimiento IS NULL AND perecedero = 1").fetchone()[0],
    }


@router.get("/indicadores")
def indicadores(cx=Depends(conexion)):
    h = hoy()
    f = cx.execute(f"""
        SELECT COUNT(*)                                                        AS elementos_disponibles,
               COALESCE(SUM(vencimiento < :hoy), 0)                            AS vencidos,
               COALESCE(SUM(vencimiento BETWEEN :hoy AND :hoy7), 0)            AS por_vencer_7,
               COALESCE(SUM(vencimiento IS NULL AND perecedero = 1), 0)        AS sin_vencimiento
        FROM v_elemento WHERE es_hoja = 1 AND saldo > {EPS}""", {"hoy": h, "hoy7": mas_dias(h, 7)}).fetchone()
    return {
        "productos": cx.execute("SELECT COUNT(*) FROM producto WHERE activo = 1").fetchone()[0],
        "elementos_disponibles": f["elementos_disponibles"],
        "vencidos": f["vencidos"],
        "por_vencer_7": f["por_vencer_7"],
        "sin_vencimiento": f["sin_vencimiento"],
        "mermas_30_dias": cx.execute("SELECT COUNT(*) FROM movimiento WHERE tipo = 'merma' AND fecha BETWEEN ? AND ?",
                                     (mas_dias(h, -30), h)).fetchone()[0],
    }


# ---------------------------------------------------------------- movimientos (D4)

@router.get("/movimientos")
def listar_movimientos(elemento_id: int | None = None, tipo: Literal["consumo", "merma", "ajuste"] | None = None,
                       desde: str | None = None, hasta: str | None = None, cx=Depends(conexion)):
    sql, args = SQL_MOVIMIENTOS + " WHERE 1 = 1", []
    for nombre, valor in (("desde", desde), ("hasta", hasta)):
        if valor is not None and not es_fecha(valor):
            raise invalido(f"{nombre}: fecha inválida, se espera AAAA-MM-DD")
    for cond, valor in (("elemento_id = ?", elemento_id), ("tipo = ?", tipo), ("fecha >= ?", desde),
                        ("fecha <= ?", hasta)):
        if valor is not None:
            sql += " AND " + cond
            args.append(valor)
    return [movimiento_json(f) for f in cx.execute(sql + " ORDER BY fecha, id", args)]


@router.post("/movimientos")
def crear_movimiento(request: Request, datos: MovimientoNuevo, cx=Depends(conexion)):
    miembro = request.state.miembro
    with db.transaccion(cx):
        e = elemento_vista(cx, datos.elemento_id)
        if e is None:
            raise no_encontrado("elemento", datos.elemento_id)
        if not e["es_hoja"]:
            raise conflicto(f"el elemento {e['id']} es un pack con hijos: los movimientos van en sus hojas "
                            "(GET /elementos/{id} da sus hijos)", "es_pack")
        saldo = redondear(e["saldo"])
        if datos.cantidad is None:  # D4: sin cantidad, se va el saldo entero
            if datos.unidad is not None:
                raise invalido("viene unidad sin cantidad")
            if saldo <= EPS:
                raise conflicto(f"el elemento {e['id']} ya tiene saldo 0", "agotado")
            cantidad = saldo
        else:
            if datos.cantidad == 0:
                raise invalido("cantidad no puede ser 0")
            if datos.cantidad < 0 and datos.tipo != "ajuste":
                raise invalido("solo un ajuste puede llevar cantidad negativa (apareció más)")
            cantidad = a_base(cx, datos.cantidad, datos.unidad or e["unidad_base"], e["producto_id"])
        nuevo = redondear(saldo - cantidad)
        if nuevo < -EPS:
            raise conflicto(f"el saldo quedaría negativo: hay {saldo:g} {e['unidad_base']} y se quieren sacar "
                            f"{cantidad:g}", "saldo_negativo")
        fecha = datos.fecha or hoy()
        if fecha < e["fecha_compra"]:
            raise invalido(f"fecha {fecha} es anterior a la compra del elemento ({e['fecha_compra']})")
        mid = cx.execute("INSERT INTO movimiento (elemento_id, fecha, tipo, cantidad, motivo, miembro_id) "
                         "VALUES (?, ?, ?, ?, ?, ?)",
                         (e["id"], fecha, datos.tipo, cantidad, datos.motivo, miembro["id"])).lastrowid
        fila = cx.execute(SQL_MOVIMIENTOS + " WHERE id = ?", (mid,)).fetchone()
    return JSONResponse(movimiento_json(fila), status_code=201)
