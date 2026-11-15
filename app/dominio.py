"""Reglas del catálogo que no caben en el DDL: unidades, vencimiento estimado, alta (D1, D3), saldos (D4).

Todo lo que escribe recibe una conexión ya dentro de una transacción (`db.transaccion`): quien llama decide el
alcance del «todo o nada» (una petición, o un CSV entero en el importador).
"""
from __future__ import annotations

import math
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta

from .errores import conflicto, invalido, no_encontrado

EPS = 1e-9
_FECHA = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
MADUREZ = ("verde", "en_punto", "madura")


# ---------------------------------------------------------------------------
# Fechas y números
# ---------------------------------------------------------------------------

def hoy() -> str:
    """El día local del proceso (el servicio corre con TZ=America/Bogota)."""
    return date.today().isoformat()


def mas_dias(fecha: str, dias: int) -> str:
    return (date.fromisoformat(fecha) + timedelta(days=dias)).isoformat()


def es_fecha(valor: str) -> bool:
    if not isinstance(valor, str) or not _FECHA.match(valor):
        return False
    try:
        date.fromisoformat(valor)
    except ValueError:
        return False
    return True


def validar_fecha(valor: str) -> str:
    """Para pydantic: AAAA-MM-DD y un día que exista."""
    if not es_fecha(valor):
        raise ValueError("fecha inválida: se espera AAAA-MM-DD con un día que exista")
    return valor


def redondear(x: float | None) -> float | None:
    return None if x is None else round(float(x), 6)


# ---------------------------------------------------------------------------
# Unidades (docs/modelo-relacional.md §3)
# ---------------------------------------------------------------------------

def unidad(cx: sqlite3.Connection, codigo: str) -> sqlite3.Row:
    fila = cx.execute("SELECT * FROM unidad WHERE codigo = ?", (codigo,)).fetchone()
    if fila is None:
        raise invalido(f"unidad '{codigo}' no existe")
    return fila


def unidad_base_de_magnitud(cx: sqlite3.Connection, magnitud: str) -> sqlite3.Row:
    fila = cx.execute("SELECT * FROM unidad WHERE magnitud = ? AND factor_a_base = 1 ORDER BY id LIMIT 1",
                      (magnitud,)).fetchone()
    if fila is None:
        raise invalido(f"no hay unidad base para la magnitud {magnitud}")
    return fila


def magnitud_producto(cx: sqlite3.Connection, producto_id: int) -> tuple[str, str]:
    fila = cx.execute("SELECT u.magnitud, u.codigo FROM producto p JOIN unidad u ON u.id = p.unidad_base_id "
                      "WHERE p.id = ?", (producto_id,)).fetchone()
    return fila["magnitud"], fila["codigo"]


def a_base(cx: sqlite3.Connection, cantidad: float, codigo: str, producto_id: int) -> float:
    u = unidad(cx, codigo)
    magnitud, _ = magnitud_producto(cx, producto_id)
    if u["magnitud"] != magnitud:
        raise invalido(f"unidad '{codigo}' no es de la magnitud del producto ({magnitud})")
    return redondear(cantidad * u["factor_a_base"])


# ---------------------------------------------------------------------------
# Vencimiento estimado (docs/modelo-relacional.md §4)
# ---------------------------------------------------------------------------

def estimar_vencimiento(cx, producto_id: int, fecha_compra: str, madurez: str | None, ubicacion_id: int) -> str | None:
    """dias_base × factor(madurez) × factor(ubicación), redondeado a días; NULL si el producto no tiene vida útil."""
    vu = cx.execute("SELECT dias_base FROM vida_util WHERE producto_id = ?", (producto_id,)).fetchone()
    if vu is None:
        return None
    f_mad = 1.0
    if madurez is not None:
        r = cx.execute("SELECT factor FROM vida_util_madurez WHERE producto_id = ? AND madurez = ?",
                       (producto_id, madurez)).fetchone()
        f_mad = r["factor"] if r else 1.0
    r = cx.execute("SELECT factor FROM vida_util_conservacion WHERE producto_id = ? AND ubicacion_id = ?",
                   (producto_id, ubicacion_id)).fetchone()
    f_con = r["factor"] if r else 1.0
    dias = math.floor(vu["dias_base"] * f_mad * f_con + 0.5)  # redondeo «de mercado», no el de banquero
    return mas_dias(fecha_compra, dias)


# ---------------------------------------------------------------------------
# Lecturas con la forma del contrato
# ---------------------------------------------------------------------------

CAMPOS_ELEMENTO = ("id", "compra_id", "fecha_compra", "producto_id", "producto", "categoria_id", "presentacion_id",
                   "presentacion", "ubicacion_id", "unidad_base", "cantidad_inicial", "saldo", "vencimiento",
                   "vencimiento_origen", "dias_para_vencer", "madurez", "abierto_en", "padre_id", "etiqueta", "nota",
                   "precio_unitario_cop", "alta_por")


def elemento_json(fila: sqlite3.Row) -> dict:
    d = {k: fila[k] for k in CAMPOS_ELEMENTO}
    d["saldo"] = redondear(d["saldo"])
    d["cantidad_inicial"] = redondear(d["cantidad_inicial"])
    return d


def elemento_vista(cx, elemento_id: int) -> sqlite3.Row | None:
    return cx.execute("SELECT * FROM v_elemento WHERE id = ?", (elemento_id,)).fetchone()


def elementos_json(cx, ids: list[int]) -> list[dict]:
    if not ids:
        return []
    marcas = ",".join("?" * len(ids))
    filas = cx.execute(f"SELECT * FROM v_elemento WHERE id IN ({marcas}) ORDER BY id", ids).fetchall()
    return [elemento_json(f) for f in filas]


SQL_MOVIMIENTOS = """
SELECT * FROM (
    SELECT m.id, m.elemento_id, m.fecha, m.tipo, m.cantidad, m.motivo, m.creado_en, m.miembro_id,
           mi.nombre AS miembro,
           e.cantidad_inicial - SUM(m.cantidad) OVER (PARTITION BY m.elemento_id ORDER BY m.id) AS saldo
    FROM movimiento m
    JOIN elemento e      ON e.id = m.elemento_id
    LEFT JOIN miembro mi ON mi.id = m.miembro_id
) t
"""


def movimiento_json(fila: sqlite3.Row) -> dict:
    return {"id": fila["id"], "elemento_id": fila["elemento_id"], "fecha": fila["fecha"], "tipo": fila["tipo"],
            "cantidad": redondear(fila["cantidad"]), "motivo": fila["motivo"], "saldo": redondear(fila["saldo"]),
            "creado_en": fila["creado_en"], "miembro_id": fila["miembro_id"], "miembro": fila["miembro"]}


# ---------------------------------------------------------------------------
# Alta de elementos: D1 (una fila por cosa física) y D3 (el pack se explota)
# ---------------------------------------------------------------------------

@dataclass
class Alta:
    presentacion_id: int
    ubicacion_id: int
    cantidad: float | None = None
    unidad: str | None = None
    unidades: int = 1
    fecha_compra: str | None = None
    vencimiento: str | None = None
    vencimiento_impreso: bool = False
    madurez: str | None = None
    precio_unitario_cop: int | None = None
    padre_id: int | None = None
    etiqueta: str | None = None
    nota: str | None = None


def presentacion(cx, presentacion_id: int) -> sqlite3.Row | None:
    return cx.execute(
        "SELECT p.*, pb.contenido_base, pr.activo AS producto_activo, pr.nombre AS producto_nombre "
        "FROM presentacion p JOIN producto pr ON pr.id = p.producto_id "
        "LEFT JOIN v_presentacion_base pb ON pb.id = p.id WHERE p.id = ?", (presentacion_id,)).fetchone()


def compra_del_dia(cx, fecha: str, miembro_id: int) -> int:
    """La compra de ese día sin proveedor: se reutiliza si existe, si no se crea a nombre de quien registra."""
    fila = cx.execute("SELECT id FROM compra WHERE fecha = ? AND proveedor_id IS NULL ORDER BY id LIMIT 1",
                      (fecha,)).fetchone()
    if fila:
        return fila["id"]
    return cx.execute("INSERT INTO compra (fecha, registrada_por) VALUES (?, ?)", (fecha, miembro_id)).lastrowid


def asegurar_linea(cx, compra_id: int, presentacion_id: int, precio: int | None) -> None:
    fila = cx.execute("SELECT precio_unitario_cop FROM compra_linea WHERE compra_id = ? AND presentacion_id = ?",
                      (compra_id, presentacion_id)).fetchone()
    if fila is None:
        cx.execute("INSERT INTO compra_linea (compra_id, presentacion_id, precio_unitario_cop) VALUES (?, ?, ?)",
                   (compra_id, presentacion_id, precio))
    elif precio is not None:
        if fila["precio_unitario_cop"] is None:
            cx.execute("UPDATE compra_linea SET precio_unitario_cop = ? WHERE compra_id = ? AND presentacion_id = ?",
                       (precio, compra_id, presentacion_id))
        elif fila["precio_unitario_cop"] != precio:
            raise conflicto(f"la compra {compra_id} ya registró esta presentación a {fila['precio_unitario_cop']} COP "
                            f"la unidad; no se puede registrar a {precio} COP en la misma línea")


def _crear_arbol(cx, compra_id: int, pres: sqlite3.Row, cantidad: float, padre_id: int | None, comun: dict,
                 etiqueta: str | None, nota: str | None, ids: list[int]) -> None:
    eid = cx.execute(
        "INSERT INTO elemento (compra_id, presentacion_id, ubicacion_id, cantidad_inicial, vencimiento, "
        "vencimiento_origen, madurez, padre_id, etiqueta, nota, alta_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (compra_id, pres["id"], comun["ubicacion_id"], cantidad, comun["vencimiento"], comun["vencimiento_origen"],
         comun["madurez"], padre_id, etiqueta, nota, comun["alta_por"])).lastrowid
    ids.append(eid)
    if pres["parte_id"] is not None:  # D3: el pack entra con sus partes como hijos
        parte = presentacion(cx, pres["parte_id"])
        asegurar_linea(cx, compra_id, parte["id"], None)
        por_parte = redondear(cantidad / pres["partes"])
        for _ in range(pres["partes"]):
            _crear_arbol(cx, compra_id, parte, por_parte, eid, comun, None, None, ids)


def dar_de_alta(cx, a: Alta, miembro_id: int) -> list[int]:
    """Crea `unidades` elementos (D1) y, si la presentación es un pack, sus hijos (D3). Devuelve los ids creados."""
    pres = presentacion(cx, a.presentacion_id)
    if pres is None:
        raise no_encontrado("presentación", a.presentacion_id)
    if not pres["activo"]:
        raise conflicto(f"la presentación {pres['id']} está inactiva")
    if not pres["producto_activo"]:
        raise conflicto(f"el producto «{pres['producto_nombre']}» está inactivo")
    if cx.execute("SELECT 1 FROM ubicacion WHERE id = ?", (a.ubicacion_id,)).fetchone() is None:
        raise no_encontrado("ubicación", a.ubicacion_id)
    if a.unidades < 1:
        raise invalido("unidades debe ser 1 o más")

    fecha_compra = a.fecha_compra or hoy()
    if fecha_compra > hoy():
        raise invalido(f"fecha_compra {fecha_compra} es futura")

    if a.cantidad is not None:
        if a.unidad is None:
            raise invalido("unidad es obligatoria si viene cantidad")
        if a.cantidad <= 0:
            raise invalido("cantidad debe ser mayor que 0")
        cantidad = a_base(cx, a.cantidad, a.unidad, pres["producto_id"])
    else:
        if a.unidad is not None:
            raise invalido("viene unidad sin cantidad")
        cantidad = redondear(pres["contenido_base"])
        if cantidad is None:
            raise invalido(f"la presentación «{pres['nombre']}» no tiene contenido nominal (a granel): "
                           "indica cantidad y unidad")
    if cantidad <= 0:
        raise invalido("la cantidad en unidad base quedó en 0")

    if a.vencimiento is not None:
        vencimiento, origen = a.vencimiento, ("impreso" if a.vencimiento_impreso else "manual")
    elif a.vencimiento_impreso:
        raise invalido("vencimiento_impreso sin vencimiento")
    else:
        vencimiento = estimar_vencimiento(cx, pres["producto_id"], fecha_compra, a.madurez, a.ubicacion_id)
        origen = "estimado" if vencimiento else None

    if a.padre_id is not None:
        padre = cx.execute("SELECT e.id, p.parte_id, p.partes, p.nombre FROM elemento e "
                           "JOIN presentacion p ON p.id = e.presentacion_id WHERE e.id = ?", (a.padre_id,)).fetchone()
        if padre is None:
            raise no_encontrado("elemento", a.padre_id)
        if padre["parte_id"] != pres["id"]:
            raise invalido(f"el elemento {padre['id']} («{padre['nombre']}») no es un pack de «{pres['nombre']}»")
        hijos = cx.execute("SELECT COUNT(*) FROM elemento WHERE padre_id = ?", (padre["id"],)).fetchone()[0]
        if hijos + a.unidades > padre["partes"]:
            raise conflicto(f"el pack {padre['id']} trae {padre['partes']} partes y ya tiene {hijos}: "
                            f"no caben {a.unidades} más")

    compra_id = compra_del_dia(cx, fecha_compra, miembro_id)
    asegurar_linea(cx, compra_id, pres["id"], a.precio_unitario_cop)
    comun = {"ubicacion_id": a.ubicacion_id, "vencimiento": vencimiento, "vencimiento_origen": origen,
             "madurez": a.madurez, "alta_por": miembro_id}
    ids: list[int] = []
    for _ in range(a.unidades):
        _crear_arbol(cx, compra_id, pres, cantidad, a.padre_id, comun, a.etiqueta, a.nota, ids)
    return ids


def descendientes(cx, elemento_id: int) -> list[int]:
    return [f[0] for f in cx.execute(
        "WITH RECURSIVE d(id) AS (SELECT id FROM elemento WHERE padre_id = ? "
        "UNION SELECT e.id FROM elemento e JOIN d ON e.padre_id = d.id) SELECT id FROM d ORDER BY id",
        (elemento_id,))]
