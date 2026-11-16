"""Recetas (PEDIDO-NEVERA-5, fase F3 del plan): versiones, sugeridas por urgencia y cocinar.

- Editar es crear la versión N+1 (`POST /recetas/{id}/versiones`); las anteriores no se tocan. La vigente es la de
  número más alto: no hay puntero que mantener.
- Las cantidades de los ingredientes llegan con `cantidad` + `unidad` y se guardan en la unidad base del producto
  (`receta_ingrediente.unidad_id` = la base). Una unidad que no está en el catálogo («cucharada») es 400: no se
  convierte a ojo.
- `GET /recetas/sugeridas` es la consulta 2 de docs/verificacion.md, una sola consulta para todas las recetas (no un
  bucle por receta). Lo disponible sale de `v_elemento` (hojas, saldo > 0, vencimiento efectivo) y sin lo vencido.
- `POST /recetas/{id}/cocinar` registra un consumo por cada elemento que el usuario confirmó, en una transacción; si
  a alguno no le alcanza el saldo, 409 y nada escrito. La receta nunca consume por su cuenta.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from . import db
from .deps import autorizar, conexion
from .dominio import EPS, magnitud_producto, redondear
from .errores import conflicto, invalido, no_encontrado
from .modelos import IngredienteNuevo, RecetaNueva, RecetaVersionNueva

router = APIRouter(dependencies=[Depends(autorizar)])

# ---------------------------------------------------------------- lecturas con la forma del contrato

def _versiones_json(cx, versiones: list) -> list[dict]:
    """Las versiones con sus ingredientes, con UNA consulta de ingredientes para todas."""
    if not versiones:
        return []
    ids = [v["id"] for v in versiones]
    marcas = ",".join("?" * len(ids))
    ingredientes: dict[int, list[dict]] = {i: [] for i in ids}
    for f in cx.execute(f"""
            SELECT ri.receta_version_id, ri.producto_id, p.nombre AS producto,
                   ri.cantidad * ur.factor_a_base AS cantidad, ub.codigo AS unidad, ri.opcional
            FROM receta_ingrediente ri
            JOIN producto p ON p.id  = ri.producto_id
            JOIN unidad ur  ON ur.id = ri.unidad_id
            JOIN unidad ub  ON ub.id = p.unidad_base_id
            WHERE ri.receta_version_id IN ({marcas})
            ORDER BY ri.opcional, p.nombre""", ids):
        ingredientes[f["receta_version_id"]].append(
            {"producto_id": f["producto_id"], "producto": f["producto"], "cantidad": redondear(f["cantidad"]),
             "unidad": f["unidad"], "opcional": bool(f["opcional"])})
    return [{"id": v["id"], "receta_id": v["receta_id"], "numero": v["numero"], "porciones": v["porciones"],
             "instrucciones": v["instrucciones"], "ingredientes": ingredientes[v["id"]], "creado_en": v["creado_en"]}
            for v in versiones]


def _recetas_json(cx, recetas: list) -> list[dict]:
    if not recetas:
        return []
    marcas = ",".join("?" * len(recetas))
    vigentes = cx.execute(f"""
        SELECT rv.* FROM receta_version rv
        WHERE rv.receta_id IN ({marcas})
          AND rv.numero = (SELECT MAX(numero) FROM receta_version WHERE receta_id = rv.receta_id)""",
                          [r["id"] for r in recetas]).fetchall()
    por_receta = {v["receta_id"]: v for v in _versiones_json(cx, vigentes)}
    return [{"id": r["id"], "nombre": r["nombre"], "nota": r["nota"], "version_vigente": por_receta[r["id"]]}
            for r in recetas]


def _receta(cx, receta_id: int):
    r = cx.execute("SELECT * FROM receta WHERE id = ?", (receta_id,)).fetchone()
    if r is None:
        raise no_encontrado("receta", receta_id)
    return r


# ---------------------------------------------------------------- escritura de una versión

def _unidad_de_receta(cx, i: int, ing: IngredienteNuevo, producto: str):
    """La unidad tiene que estar en el catálogo y ser de la magnitud del producto; si no, 400 con el motivo."""
    u = cx.execute("SELECT * FROM unidad WHERE codigo = ?", (ing.unidad,)).fetchone()
    if u is None:
        codigos = ", ".join(f[0] for f in cx.execute("SELECT codigo FROM unidad ORDER BY id"))
        raise invalido(f"ingrediente {i + 1} («{producto}»): la unidad '{ing.unidad}' no existe en el catálogo "
                       f"({codigos}); la receta no la convierte a ojo: escribe la cantidad en una de esas",
                       ingrediente=i + 1, producto_id=ing.producto_id, unidad=ing.unidad)
    magnitud, base = magnitud_producto(cx, ing.producto_id)
    if u["magnitud"] != magnitud:
        raise invalido(f"ingrediente {i + 1} («{producto}»): la unidad '{ing.unidad}' es de {u['magnitud']} y el "
                       f"producto se mide en {magnitud} ({base})",
                       ingrediente=i + 1, producto_id=ing.producto_id, unidad=ing.unidad)
    return u


def _crear_version(cx, receta_id: int, v: RecetaVersionNueva) -> int:
    """Inserta la versión N+1 con sus ingredientes en la unidad base. Quien llama abre la transacción."""
    vistos: set[int] = set()
    filas = []
    for i, ing in enumerate(v.ingredientes):
        p = cx.execute("SELECT p.id, p.nombre, p.unidad_base_id FROM producto p WHERE p.id = ?",
                       (ing.producto_id,)).fetchone()
        if p is None:
            raise no_encontrado("producto", ing.producto_id)
        if ing.producto_id in vistos:
            raise invalido(f"ingrediente {i + 1}: «{p['nombre']}» va dos veces en la receta; junta las cantidades",
                           ingrediente=i + 1, producto_id=ing.producto_id)
        vistos.add(ing.producto_id)
        u = _unidad_de_receta(cx, i, ing, p["nombre"])
        cantidad = redondear(ing.cantidad * u["factor_a_base"])
        if cantidad <= 0:
            raise invalido(f"ingrediente {i + 1} («{p['nombre']}»): la cantidad en unidad base quedó en 0")
        filas.append((ing.producto_id, cantidad, p["unidad_base_id"], int(ing.opcional)))
    numero = cx.execute("SELECT COALESCE(MAX(numero), 0) + 1 FROM receta_version WHERE receta_id = ?",
                        (receta_id,)).fetchone()[0]
    vid = cx.execute("INSERT INTO receta_version (receta_id, numero, porciones, instrucciones) VALUES (?, ?, ?, ?)",
                     (receta_id, numero, v.porciones, v.instrucciones)).lastrowid
    cx.executemany("INSERT INTO receta_ingrediente (receta_version_id, producto_id, cantidad, unidad_id, opcional) "
                   "VALUES (?, ?, ?, ?, ?)", [(vid, *f) for f in filas])
    return vid


# ---------------------------------------------------------------- rutas

@router.get("/recetas")
def listar_recetas(cx=Depends(conexion)):
    return _recetas_json(cx, cx.execute("SELECT * FROM receta ORDER BY nombre, id").fetchall())


@router.post("/recetas")
def crear_receta(datos: RecetaNueva, cx=Depends(conexion)):
    with db.transaccion(cx):
        otra = cx.execute("SELECT nombre FROM receta WHERE nombre = ?", (datos.nombre,)).fetchone()  # NOCASE
        if otra:
            raise conflicto(f"ya existe una receta llamada '{otra['nombre']}': para cambiarla, crea una versión nueva "
                            "(POST /recetas/{id}/versiones)")
        rid = cx.execute("INSERT INTO receta (nombre, nota) VALUES (?, ?)", (datos.nombre, datos.nota)).lastrowid
        _crear_version(cx, rid, datos.version)
        cuerpo = _recetas_json(cx, [_receta(cx, rid)])[0]
    return JSONResponse(cuerpo, status_code=201)


# La consulta 2 de docs/verificacion.md, con lo disponible de v_elemento: hojas (D3), saldo > 0, vencimiento efectivo
# (un abierto se acorta) y sin lo vencido. Una fila por (receta, ingrediente) de la versión vigente; los totales de la
# receta van en la misma fila y el orden lo pone SQL. Python solo agrupa filas seguidas.
SQL_SUGERIDAS = """
WITH vigente AS (
    SELECT rv.id AS receta_version_id, rv.receta_id, rv.porciones
    FROM receta_version rv
    WHERE rv.numero = (SELECT MAX(numero) FROM receta_version WHERE receta_id = rv.receta_id)
),
disponible AS (
    SELECT producto_id, saldo, dias_para_vencer
    FROM v_elemento
    WHERE es_hoja = 1 AND saldo > :eps AND (dias_para_vencer IS NULL OR dias_para_vencer >= 0)
),
linea AS (
    SELECT r.id AS receta_id, r.nombre, v.receta_version_id, v.porciones,
           ri.producto_id, p.nombre AS producto, ri.cantidad * ur.factor_a_base AS cantidad,
           ub.codigo AS unidad, ri.opcional,
           COALESCE(SUM(d.saldo), 0)  AS saldo,
           COUNT(d.producto_id) > 0   AS hay,
           MIN(d.dias_para_vencer)    AS dias
    FROM receta r
    JOIN vigente v             ON v.receta_id = r.id
    JOIN receta_ingrediente ri ON ri.receta_version_id = v.receta_version_id
    JOIN producto p            ON p.id  = ri.producto_id
    JOIN unidad ur             ON ur.id = ri.unidad_id
    JOIN unidad ub             ON ub.id = p.unidad_base_id
    LEFT JOIN disponible d     ON d.producto_id = ri.producto_id
    GROUP BY r.id, ri.producto_id
),
total AS (
    SELECT receta_id,
           SUM(opcional = 0)                                                  AS ingredientes,
           SUM(opcional = 0 AND hay)                                          AS disponibles,
           SUM(opcional = 0 AND hay AND dias IS NOT NULL AND dias <= :dias)   AS por_vencer,
           SUM(opcional = 0 AND NOT hay)                                      AS faltan,
           MIN(dias)                                                          AS dias_mas_urgente,
           SUM(hay)                                                           AS con_algo
    FROM linea
    GROUP BY receta_id
)
SELECT l.*, t.ingredientes, t.disponibles, t.por_vencer, t.dias_mas_urgente
FROM linea l
JOIN total t ON t.receta_id = l.receta_id
WHERE t.con_algo > 0
ORDER BY t.dias_mas_urgente IS NULL, t.dias_mas_urgente, t.por_vencer DESC, t.faltan, l.nombre, l.receta_id,
         l.hay DESC, l.dias IS NULL, l.dias, l.opcional, l.producto
"""


@router.get("/recetas/sugeridas")
def recetas_sugeridas(dias: int = Query(3, ge=0), cx=Depends(conexion)):
    salida: list[dict] = []
    for f in cx.execute(SQL_SUGERIDAS, {"eps": EPS, "dias": dias}):
        if not salida or salida[-1]["receta_id"] != f["receta_id"]:
            salida.append({"receta_id": f["receta_id"], "nombre": f["nombre"],
                           "receta_version_id": f["receta_version_id"], "porciones": f["porciones"],
                           "ingredientes": f["ingredientes"], "disponibles": f["disponibles"],
                           "por_vencer": f["por_vencer"], "dias_mas_urgente": f["dias_mas_urgente"],
                           "cubre": [], "faltan": []})
        cantidad, saldo = redondear(f["cantidad"]), redondear(f["saldo"])
        ing = {"producto_id": f["producto_id"], "producto": f["producto"], "cantidad": cantidad,
               "unidad": f["unidad"], "opcional": bool(f["opcional"]), "saldo": saldo,
               "dias_para_vencer": f["dias"], "por_vencer": bool(f["hay"]) and f["dias"] is not None and f["dias"] <= dias,
               "alcanza": saldo >= cantidad - EPS}
        salida[-1]["cubre" if f["hay"] else "faltan"].append(ing)
    return salida


@router.get("/recetas/{id}")
def ver_receta(id: int, cx=Depends(conexion)):
    r = _receta(cx, id)
    d = _recetas_json(cx, [r])[0]
    d["versiones"] = _versiones_json(
        cx, cx.execute("SELECT * FROM receta_version WHERE receta_id = ? ORDER BY numero", (id,)).fetchall())
    return d


@router.post("/recetas/{id}/versiones")
def crear_version(id: int, datos: RecetaVersionNueva, cx=Depends(conexion)):
    with db.transaccion(cx):
        _receta(cx, id)
        vid = _crear_version(cx, id, datos)
        cuerpo = _versiones_json(cx, cx.execute("SELECT * FROM receta_version WHERE id = ?", (vid,)).fetchall())[0]
    return JSONResponse(cuerpo, status_code=201)
