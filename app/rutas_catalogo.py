"""Catálogo: categorías, unidades, ubicaciones, productos y su vida útil, presentaciones."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from . import db
from .deps import autorizar, conexion
from .dominio import hoy, redondear, unidad
from .errores import conflicto, invalido, no_encontrado
from .modelos import (CategoriaNueva, PresentacionEdicion, PresentacionNueva, ProductoEdicion, ProductoNuevo,
                      VidaUtilBase, VidaUtilCompleta)

router = APIRouter(dependencies=[Depends(autorizar)])


def creado(cuerpo) -> JSONResponse:
    return JSONResponse(cuerpo, status_code=201)


# ---------------------------------------------------------------- categorías, unidades, ubicaciones

@router.get("/categorias")
def listar_categorias(cx=Depends(conexion)):
    return [dict(f) for f in cx.execute("SELECT id, nombre FROM categoria ORDER BY nombre")]


@router.post("/categorias")
def crear_categoria(datos: CategoriaNueva, cx=Depends(conexion)):
    with db.transaccion(cx):
        if cx.execute("SELECT 1 FROM categoria WHERE nombre = ?", (datos.nombre,)).fetchone():
            raise conflicto(f"ya existe una categoría llamada '{datos.nombre}'")
        cid = cx.execute("INSERT INTO categoria (nombre) VALUES (?)", (datos.nombre,)).lastrowid
    return creado({"id": cid, "nombre": datos.nombre})


@router.get("/unidades")
def listar_unidades(cx=Depends(conexion)):
    return [dict(f) for f in cx.execute("SELECT id, codigo, nombre, magnitud, factor_a_base FROM unidad ORDER BY id")]


@router.get("/ubicaciones")
def listar_ubicaciones(cx=Depends(conexion)):
    return [dict(f) for f in cx.execute("SELECT id, nombre, padre_id FROM ubicacion ORDER BY id")]


# ---------------------------------------------------------------- productos

SQL_PRODUCTO = """
SELECT p.id, p.nombre, p.categoria_id, c.nombre AS categoria, u.codigo AS unidad_base, p.perecedero, p.activo,
       p.nota, p.creado_en, vu.dias_base, vu.dias_abierto, vu.fuente, vu.nota AS vu_nota, vu.registrado_en
FROM producto p
JOIN categoria c      ON c.id = p.categoria_id
JOIN unidad u         ON u.id = p.unidad_base_id
LEFT JOIN vida_util vu ON vu.producto_id = p.id
"""


def _vida_util_json(f) -> dict | None:
    if f["dias_base"] is None:
        return None
    return {"dias_base": f["dias_base"], "dias_abierto": f["dias_abierto"], "fuente": f["fuente"],
            "nota": f["vu_nota"], "registrado_en": f["registrado_en"]}


def producto_json(f) -> dict:
    return {"id": f["id"], "nombre": f["nombre"], "categoria_id": f["categoria_id"], "categoria": f["categoria"],
            "unidad_base": f["unidad_base"], "perecedero": bool(f["perecedero"]), "activo": bool(f["activo"]),
            "nota": f["nota"], "vida_util": _vida_util_json(f), "creado_en": f["creado_en"]}


def _producto(cx, pid: int):
    f = cx.execute(SQL_PRODUCTO + " WHERE p.id = ?", (pid,)).fetchone()
    if f is None:
        raise no_encontrado("producto", pid)
    return f


def _exigir_categoria(cx, cid: int) -> None:
    if cx.execute("SELECT 1 FROM categoria WHERE id = ?", (cid,)).fetchone() is None:
        raise invalido(f"categoria_id {cid} no existe")


def _nombre_libre(cx, nombre: str, excepto: int | None = None) -> None:
    if cx.execute("SELECT 1 FROM producto WHERE nombre = ? AND id IS NOT ?", (nombre, excepto)).fetchone():
        raise conflicto(f"ya existe un producto llamado '{nombre}'")


def _guardar_base(cx, pid: int, base: VidaUtilBase | None) -> None:
    if base is None:
        for t in ("vida_util", "vida_util_madurez", "vida_util_conservacion"):
            cx.execute(f"DELETE FROM {t} WHERE producto_id = ?", (pid,))
        return
    cx.execute("INSERT INTO vida_util (producto_id, dias_base, dias_abierto, fuente, nota, registrado_en) "
               "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (producto_id) DO UPDATE SET dias_base = excluded.dias_base, "
               "dias_abierto = excluded.dias_abierto, fuente = excluded.fuente, nota = excluded.nota, "
               "registrado_en = excluded.registrado_en",
               (pid, base.dias_base, base.dias_abierto, base.fuente, base.nota, base.registrado_en or hoy()))


@router.get("/productos")
def listar_productos(q: str | None = None, categoria_id: int | None = None, activo: bool = True,
                     cx=Depends(conexion)):
    sql, args = SQL_PRODUCTO + " WHERE p.activo = ?", [int(activo)]
    if q:
        sql += " AND p.nombre LIKE ? ESCAPE '\\'"
        args.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    if categoria_id is not None:
        sql += " AND p.categoria_id = ?"
        args.append(categoria_id)
    return [producto_json(f) for f in cx.execute(sql + " ORDER BY p.nombre", args)]


@router.post("/productos")
def crear_producto(datos: ProductoNuevo, cx=Depends(conexion)):
    with db.transaccion(cx):
        _exigir_categoria(cx, datos.categoria_id)
        _nombre_libre(cx, datos.nombre)
        pid = cx.execute("INSERT INTO producto (nombre, categoria_id, unidad_base_id, perecedero, nota) "
                         "VALUES (?, ?, ?, ?, ?)",
                         (datos.nombre, datos.categoria_id, unidad(cx, datos.unidad_base)["id"],
                          int(datos.perecedero), datos.nota)).lastrowid
        if datos.vida_util is not None:
            _guardar_base(cx, pid, datos.vida_util)
        return creado(producto_json(_producto(cx, pid)))


@router.get("/productos/{id}")
def ver_producto(id: int, cx=Depends(conexion)):
    return producto_json(_producto(cx, id))


@router.patch("/productos/{id}")
def editar_producto(id: int, datos: ProductoEdicion, cx=Depends(conexion)):
    campos = datos.model_fields_set
    with db.transaccion(cx):
        actual = _producto(cx, id)
        for obligatorio in ("nombre", "categoria_id", "unidad_base", "perecedero", "activo"):
            if obligatorio in campos and getattr(datos, obligatorio) is None:
                raise invalido(f"{obligatorio} no puede ser null")
        cambios = {}
        if "nombre" in campos:
            _nombre_libre(cx, datos.nombre, id)
            cambios["nombre"] = datos.nombre
        if "categoria_id" in campos:
            _exigir_categoria(cx, datos.categoria_id)
            cambios["categoria_id"] = datos.categoria_id
        if "unidad_base" in campos and datos.unidad_base != actual["unidad_base"]:
            if cx.execute("SELECT 1 FROM presentacion WHERE producto_id = ?", (id,)).fetchone():
                raise conflicto("unidad_base no se puede cambiar: el producto ya tiene presentaciones o elementos")
            cambios["unidad_base_id"] = unidad(cx, datos.unidad_base)["id"]
        for k in ("perecedero", "activo"):
            if k in campos:
                cambios[k] = int(getattr(datos, k))
        if "nota" in campos:
            cambios["nota"] = datos.nota
        if cambios:
            cx.execute(f"UPDATE producto SET {', '.join(k + ' = ?' for k in cambios)} WHERE id = ?",
                       [*cambios.values(), id])
        if "vida_util" in campos:
            _guardar_base(cx, id, datos.vida_util)
        return producto_json(_producto(cx, id))


@router.delete("/productos/{id}")
def borrar_producto(id: int, cx=Depends(conexion)):
    with db.transaccion(cx):
        _producto(cx, id)
        colgando = cx.execute("""
            SELECT EXISTS (SELECT 1 FROM compra_linea cl JOIN presentacion p ON p.id = cl.presentacion_id
                           WHERE p.producto_id = :id)
                OR EXISTS (SELECT 1 FROM receta_ingrediente WHERE producto_id = :id)
                OR EXISTS (SELECT 1 FROM producto_foto WHERE producto_id = :id)""", {"id": id}).fetchone()[0]
        if colgando:
            cx.execute("UPDATE producto SET activo = 0 WHERE id = ?", (id,))
            return {"id": id, "modo": "logico"}
        # Sin historia: se van sus presentaciones (los packs antes que sus partes) y el producto.
        for (pid,) in cx.execute("SELECT id FROM v_presentacion_base WHERE producto_id = ? ORDER BY nivel DESC",
                                 (id,)).fetchall():
            cx.execute("DELETE FROM presentacion WHERE id = ?", (pid,))
        cx.execute("DELETE FROM producto WHERE id = ?", (id,))
        return {"id": id, "modo": "fisico"}


@router.get("/productos/{id}/vida-util")
def ver_vida_util(id: int, cx=Depends(conexion)):
    return _vida_util_completa(cx, _producto(cx, id))


def _vida_util_completa(cx, prod) -> dict:
    return {
        "base": _vida_util_json(prod),
        "madurez": [{"madurez": m, "factor": f} for m, f in cx.execute(
            "SELECT madurez, factor FROM vida_util_madurez WHERE producto_id = ? ORDER BY madurez", (prod["id"],))],
        "conservacion": [{"ubicacion_id": u, "factor": f} for u, f in cx.execute(
            "SELECT ubicacion_id, factor FROM vida_util_conservacion WHERE producto_id = ? ORDER BY ubicacion_id",
            (prod["id"],))],
    }


@router.put("/productos/{id}/vida-util")
def fijar_vida_util(id: int, datos: VidaUtilCompleta, cx=Depends(conexion)):
    with db.transaccion(cx):
        _producto(cx, id)
        if datos.base is None and (datos.madurez or datos.conservacion):
            raise invalido("sin vida útil base no hay factores: envía base o listas vacías")
        madureces = [m.madurez for m in datos.madurez]
        if len(set(madureces)) != len(madureces):
            raise invalido("madurez repetida en los factores")
        ubicaciones = [c.ubicacion_id for c in datos.conservacion]
        if len(set(ubicaciones)) != len(ubicaciones):
            raise invalido("ubicacion_id repetida en los factores")
        for u in ubicaciones:
            if cx.execute("SELECT 1 FROM ubicacion WHERE id = ?", (u,)).fetchone() is None:
                raise invalido(f"ubicacion_id {u} no existe")
        _guardar_base(cx, id, datos.base)
        cx.execute("DELETE FROM vida_util_madurez WHERE producto_id = ?", (id,))
        cx.execute("DELETE FROM vida_util_conservacion WHERE producto_id = ?", (id,))
        cx.executemany("INSERT INTO vida_util_madurez (producto_id, madurez, factor) VALUES (?, ?, ?)",
                       [(id, m.madurez, m.factor) for m in datos.madurez])
        cx.executemany("INSERT INTO vida_util_conservacion (producto_id, ubicacion_id, factor) VALUES (?, ?, ?)",
                       [(id, c.ubicacion_id, c.factor) for c in datos.conservacion])
        return _vida_util_completa(cx, _producto(cx, id))


# ---------------------------------------------------------------- presentaciones

SQL_PRESENTACION = """
SELECT p.id, p.producto_id, p.nombre, p.contenido, u.codigo AS unidad, p.parte_id, p.partes, pb.contenido_base,
       p.codigo_barras, p.activo
FROM presentacion p
LEFT JOIN unidad u ON u.id = p.unidad_id
LEFT JOIN v_presentacion_base pb ON pb.id = p.id
"""


def presentacion_json(f) -> dict:
    d = dict(f)
    d["activo"] = bool(d["activo"])
    d["contenido_base"] = redondear(d["contenido_base"])
    return d


def _presentacion(cx, pid: int):
    f = cx.execute(SQL_PRESENTACION + " WHERE p.id = ?", (pid,)).fetchone()
    if f is None:
        raise no_encontrado("presentación", pid)
    return f


def _validar_forma(cx, producto_id: int, pid: int | None, nombre, contenido, unidad_codigo, parte_id, partes,
                   codigo_barras):
    """Reglas de presentacion: contenido+unidad, o parte+partes, o nada (granel). Devuelve unidad_id."""
    if (contenido is None) != (unidad_codigo is None):
        raise invalido("contenido y unidad van juntos")
    if (parte_id is None) != (partes is None):
        raise invalido("parte_id y partes van juntos")
    if contenido is not None and parte_id is not None:
        raise invalido("un pack (parte_id) no declara contenido propio: se deriva de sus partes")
    if cx.execute("SELECT 1 FROM presentacion WHERE producto_id = ? AND nombre = ? AND id IS NOT ?",
                  (producto_id, nombre, pid)).fetchone():
        raise conflicto(f"el producto {producto_id} ya tiene una presentación llamada '{nombre}'")
    if codigo_barras is not None and cx.execute(
            "SELECT 1 FROM presentacion WHERE codigo_barras = ? AND id IS NOT ?", (codigo_barras, pid)).fetchone():
        raise conflicto(f"el código de barras {codigo_barras} ya es de otra presentación")
    unidad_id = None
    if unidad_codigo is not None:
        u = unidad(cx, unidad_codigo)
        magnitud = cx.execute("SELECT u.magnitud FROM producto p JOIN unidad u ON u.id = p.unidad_base_id "
                              "WHERE p.id = ?", (producto_id,)).fetchone()[0]
        if u["magnitud"] != magnitud:
            raise invalido(f"unidad '{unidad_codigo}' no es de la magnitud del producto ({magnitud})")
        unidad_id = u["id"]
    if parte_id is not None:
        parte = cx.execute("SELECT producto_id FROM presentacion WHERE id = ?", (parte_id,)).fetchone()
        if parte is None:
            raise no_encontrado("presentación", parte_id)
        if parte["producto_id"] != producto_id:
            raise invalido("parte_id debe ser una presentación del mismo producto")
        # sin ciclos: la cadena de partes no puede volver a esta presentación
        actual, vistos = parte_id, set()
        while actual is not None:
            if actual == pid or actual in vistos:
                raise invalido("parte_id formaría un ciclo de packs")
            vistos.add(actual)
            actual = cx.execute("SELECT parte_id FROM presentacion WHERE id = ?", (actual,)).fetchone()[0]
    return unidad_id


@router.get("/presentaciones")
def listar_presentaciones(producto_id: int | None = None, codigo_barras: str | None = None, cx=Depends(conexion)):
    sql, args = SQL_PRESENTACION + " WHERE 1 = 1", []
    if producto_id is not None:
        sql += " AND p.producto_id = ?"
        args.append(producto_id)
    if codigo_barras is not None:
        sql += " AND p.codigo_barras = ?"
        args.append(codigo_barras)
    return [presentacion_json(f) for f in cx.execute(sql + " ORDER BY p.producto_id, p.nombre", args)]


@router.post("/presentaciones")
def crear_presentacion(datos: PresentacionNueva, cx=Depends(conexion)):
    with db.transaccion(cx):
        if cx.execute("SELECT 1 FROM producto WHERE id = ?", (datos.producto_id,)).fetchone() is None:
            raise no_encontrado("producto", datos.producto_id)
        unidad_id = _validar_forma(cx, datos.producto_id, None, datos.nombre, datos.contenido, datos.unidad,
                                   datos.parte_id, datos.partes, datos.codigo_barras)
        pid = cx.execute("INSERT INTO presentacion (producto_id, nombre, contenido, unidad_id, parte_id, partes, "
                         "codigo_barras) VALUES (?, ?, ?, ?, ?, ?, ?)",
                         (datos.producto_id, datos.nombre, datos.contenido, unidad_id, datos.parte_id, datos.partes,
                          datos.codigo_barras)).lastrowid
        return creado(presentacion_json(_presentacion(cx, pid)))


@router.get("/presentaciones/{id}")
def ver_presentacion(id: int, cx=Depends(conexion)):
    return presentacion_json(_presentacion(cx, id))


@router.patch("/presentaciones/{id}")
def editar_presentacion(id: int, datos: PresentacionEdicion, cx=Depends(conexion)):
    campos = datos.model_fields_set
    with db.transaccion(cx):
        actual = _presentacion(cx, id)
        if "nombre" in campos and datos.nombre is None:
            raise invalido("nombre no puede ser null")
        if "activo" in campos and datos.activo is None:
            raise invalido("activo no puede ser null")
        nuevo = {k: (getattr(datos, k) if k in campos else actual[k])
                 for k in ("nombre", "contenido", "unidad", "parte_id", "partes", "codigo_barras", "activo")}
        if (nuevo["parte_id"], nuevo["partes"]) != (actual["parte_id"], actual["partes"]) and cx.execute(
                "SELECT 1 FROM elemento WHERE presentacion_id = ?", (id,)).fetchone():
            raise conflicto("parte_id y partes no se cambian en una presentación con elementos: sus packs ya "
                            "se explotaron con la forma anterior")
        unidad_id = _validar_forma(cx, actual["producto_id"], id, nuevo["nombre"], nuevo["contenido"],
                                   nuevo["unidad"], nuevo["parte_id"], nuevo["partes"], nuevo["codigo_barras"])
        cx.execute("UPDATE presentacion SET nombre = ?, contenido = ?, unidad_id = ?, parte_id = ?, partes = ?, "
                   "codigo_barras = ?, activo = ? WHERE id = ?",
                   (nuevo["nombre"], nuevo["contenido"], unidad_id, nuevo["parte_id"], nuevo["partes"],
                    nuevo["codigo_barras"], int(nuevo["activo"]), id))
        return presentacion_json(_presentacion(cx, id))


@router.delete("/presentaciones/{id}")
def borrar_presentacion(id: int, cx=Depends(conexion)):
    with db.transaccion(cx):
        _presentacion(cx, id)
        colgando = cx.execute("""
            SELECT EXISTS (SELECT 1 FROM compra_linea WHERE presentacion_id = :id)
                OR EXISTS (SELECT 1 FROM presentacion WHERE parte_id = :id)""", {"id": id}).fetchone()[0]
        if colgando:
            cx.execute("UPDATE presentacion SET activo = 0 WHERE id = ?", (id,))
            return {"id": id, "modo": "logico"}
        cx.execute("DELETE FROM presentacion WHERE id = ?", (id,))
        return {"id": id, "modo": "fisico"}
