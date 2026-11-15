"""POST /importar: CSV de compras, todo o nada.

- Todo el CSV corre dentro de UNA transacción. Una fila mala responde 400 `csv_invalido` con `detalle.fila` (número de
  línea del archivo: la cabecera es la 1) y `detalle.motivo`, y se hace ROLLBACK: no queda nada a medias.
- `?simular=1` corre exactamente lo mismo y termina en ROLLBACK siempre: la base no cambia.
- Una fila es un elemento (D1: una cosa física), o un pack con sus hijos si la presentación es un pack (D3). Dos filas
  idénticas son dos cosas iguales, no una repetición: solo se omiten las filas vacías.
"""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Query, Request

from . import db
from .deps import autorizar, conexion
from .dominio import MADUREZ, Alta, dar_de_alta, es_fecha, unidad_base_de_magnitud
from .errores import ErrorApi

router = APIRouter(dependencies=[Depends(autorizar)])

OBLIGATORIAS = ("nombre", "categoria", "unidad", "cantidad", "fecha_compra", "fecha_vencimiento", "precio_unitario")
OPCIONALES = ("presentacion", "ubicacion", "madurez", "etiqueta")
CSV_MAXIMO = 5 * 1024 * 1024
UBICACION_POR_DEFECTO = "nevera"


class _Rollback(Exception):
    pass


def _malo(fila: int, motivo: str) -> ErrorApi:
    return ErrorApi(400, "csv_invalido", f"fila {fila}: {motivo}", {"fila": fila, "motivo": motivo})


def _numero(texto: str, campo: str) -> float:
    if "," in texto:
        raise ValueError(f"{campo} usa coma; el decimal va con punto")
    try:
        return float(texto)
    except ValueError:
        raise ValueError(f"{campo} no es un número")


def _fila(cx, r: dict, miembro_id: int, resumen: dict, compras: set) -> None:
    nombre = r["nombre"]
    if not nombre:
        raise ValueError("nombre vacío")
    if not r["unidad"]:
        raise ValueError("unidad vacía")
    u = cx.execute("SELECT * FROM unidad WHERE codigo = ?", (r["unidad"],)).fetchone()
    if u is None:
        raise ValueError(f"unidad '{r['unidad']}' no existe")
    cantidad = _numero(r["cantidad"], "cantidad")
    if cantidad <= 0:
        raise ValueError("cantidad debe ser mayor que 0")
    if not es_fecha(r["fecha_compra"]):
        raise ValueError("fecha_compra no es una fecha AAAA-MM-DD")
    vencimiento = r["fecha_vencimiento"] or None
    if vencimiento is not None and not es_fecha(vencimiento):
        raise ValueError("fecha_vencimiento no es una fecha AAAA-MM-DD")
    precio = None
    if r["precio_unitario"]:
        if not r["precio_unitario"].isdigit():
            raise ValueError("precio_unitario debe ser un entero en COP (sin puntos ni signo)")
        precio = int(r["precio_unitario"])
    madurez = r.get("madurez") or None
    if madurez is not None and madurez not in MADUREZ:
        raise ValueError(f"madurez '{madurez}' no es una de {', '.join(MADUREZ)}")

    producto = cx.execute("SELECT p.id, u.magnitud FROM producto p JOIN unidad u ON u.id = p.unidad_base_id "
                          "WHERE p.nombre = ?", (nombre,)).fetchone()
    if producto is None:
        if not r["categoria"]:
            raise ValueError(f"el producto '{nombre}' no existe y la fila no trae categoria para crearlo")
        cat = cx.execute("SELECT id FROM categoria WHERE nombre = ?", (r["categoria"],)).fetchone()
        cat_id = cat["id"] if cat else cx.execute("INSERT INTO categoria (nombre) VALUES (?)",
                                                  (r["categoria"],)).lastrowid
        base = unidad_base_de_magnitud(cx, u["magnitud"])
        pid = cx.execute("INSERT INTO producto (nombre, categoria_id, unidad_base_id) VALUES (?, ?, ?)",
                         (nombre, cat_id, base["id"])).lastrowid
        resumen["productos_nuevos"].append(nombre)
    else:
        pid = producto["id"]
        if producto["magnitud"] != u["magnitud"]:
            raise ValueError(f"unidad '{r['unidad']}' no es de la magnitud del producto ({producto['magnitud']})")

    nombre_pres = r.get("presentacion") or "a granel"
    pres = cx.execute("SELECT id FROM presentacion WHERE producto_id = ? AND nombre = ? COLLATE NOCASE",
                      (pid, nombre_pres)).fetchone()
    pres_id = pres["id"] if pres else cx.execute(
        "INSERT INTO presentacion (producto_id, nombre) VALUES (?, ?)", (pid, nombre_pres)).lastrowid

    nombre_ubic = r.get("ubicacion") or UBICACION_POR_DEFECTO
    ubic = cx.execute("SELECT id FROM ubicacion WHERE nombre = ?", (nombre_ubic,)).fetchone()
    if ubic is None:
        raise ValueError(f"ubicacion '{nombre_ubic}' no existe")

    ids = dar_de_alta(cx, Alta(presentacion_id=pres_id, ubicacion_id=ubic["id"], cantidad=cantidad,
                               unidad=r["unidad"], fecha_compra=r["fecha_compra"], vencimiento=vencimiento,
                               madurez=madurez, precio_unitario_cop=precio, etiqueta=r.get("etiqueta") or None),
                      miembro_id)
    resumen["creados"] += len(ids)
    compras.add(cx.execute("SELECT compra_id FROM elemento WHERE id = ?", (ids[0],)).fetchone()[0])


@router.post("/importar")
async def importar(request: Request, simular: int = Query(0, ge=0, le=1), cx=Depends(conexion)):
    miembro = request.state.miembro
    crudo = await request.body()
    if len(crudo) > CSV_MAXIMO:
        raise _malo(0, f"el CSV pesa {len(crudo)} bytes; el máximo es {CSV_MAXIMO}")
    try:
        texto = crudo.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise _malo(0, "el CSV no está en UTF-8")
    lector = csv.reader(io.StringIO(texto, newline=""))
    cabecera = next(lector, None)
    if not cabecera:
        raise _malo(1, "el CSV está vacío: falta la cabecera")
    cabecera = [c.strip().lower() for c in cabecera]
    faltan = [c for c in OBLIGATORIAS if c not in cabecera]
    sobran = [c for c in cabecera if c not in OBLIGATORIAS + OPCIONALES]
    if faltan:
        raise _malo(1, f"faltan columnas: {', '.join(faltan)}")
    if sobran:
        raise _malo(1, f"columnas desconocidas: {', '.join(sobran)}")
    if len(set(cabecera)) != len(cabecera):
        raise _malo(1, "hay columnas repetidas")

    resumen = {"simulado": bool(simular), "filas": 0, "creados": 0, "productos_nuevos": [], "compras": 0,
               "omitidos": []}
    compras: set[int] = set()
    try:
        with db.transaccion(cx):
            filas = list(enumerate(lector, start=2))
            while filas and not any(v.strip() for v in filas[-1][1]):
                filas.pop()  # las líneas en blanco del final del archivo no son filas
            for n, valores in filas:
                if not any(v.strip() for v in valores):
                    resumen["filas"] += 1
                    resumen["omitidos"].append({"fila": n, "motivo": "fila vacía"})
                    continue
                resumen["filas"] += 1
                if len(valores) != len(cabecera):
                    raise _malo(n, f"tiene {len(valores)} columnas y la cabecera {len(cabecera)}")
                fila = {c: v.strip() for c, v in zip(cabecera, valores)}
                for c in OPCIONALES:
                    fila.setdefault(c, "")
                try:
                    _fila(cx, fila, miembro["id"], resumen, compras)
                except ValueError as e:
                    raise _malo(n, str(e))
                except ErrorApi as e:
                    raise _malo(n, e.mensaje)
            resumen["compras"] = len(compras)
            if simular:
                raise _Rollback()
    except _Rollback:
        pass
    return resumen
