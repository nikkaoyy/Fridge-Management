"""Miembros del hogar. Leer: cualquier miembro. Crear, editar, borrar: admin (auth.rol_necesario).

El token se devuelve UNA vez (al crear o al renovar). Lo que se guarda es su hash con sal.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from . import auth, db
from .deps import autorizar, conexion
from .errores import conflicto, invalido, no_encontrado
from .modelos import MiembroEdicion, MiembroNuevo

router = APIRouter(dependencies=[Depends(autorizar)])

SQL = "SELECT id, nombre, rol, activo, creado_en FROM miembro"


def miembro_json(f) -> dict:
    return {"id": f["id"], "nombre": f["nombre"], "rol": f["rol"], "activo": bool(f["activo"]),
            "creado_en": f["creado_en"]}


def _miembro(cx, mid: int):
    f = cx.execute(SQL + " WHERE id = ?", (mid,)).fetchone()
    if f is None:
        raise no_encontrado("miembro", mid)
    return f


def _quedaria_sin_admin(cx, mid: int) -> bool:
    return cx.execute("SELECT COUNT(*) FROM miembro WHERE rol = 'admin' AND activo = 1 AND id <> ?",
                      (mid,)).fetchone()[0] == 0


@router.get("/miembros")
def listar_miembros(cx=Depends(conexion)):
    return [miembro_json(f) for f in cx.execute(SQL + " ORDER BY id")]


@router.get("/miembros/yo")
def yo(request: Request, cx=Depends(conexion)):
    return miembro_json(_miembro(cx, request.state.miembro["id"]))


@router.post("/miembros")
def crear_miembro(datos: MiembroNuevo, cx=Depends(conexion)):
    token = auth.nuevo_token()
    with db.transaccion(cx):
        if cx.execute("SELECT 1 FROM miembro WHERE nombre = ?", (datos.nombre,)).fetchone():
            raise conflicto(f"ya existe un miembro llamado '{datos.nombre}'")
        mid = cx.execute("INSERT INTO miembro (nombre, rol, token_hash) VALUES (?, ?, ?)",
                         (datos.nombre, datos.rol, auth.hashear(token))).lastrowid
        cuerpo = miembro_json(_miembro(cx, mid)) | {"token": token}
    return JSONResponse(cuerpo, status_code=201)


@router.patch("/miembros/{id}")
def editar_miembro(id: int, datos: MiembroEdicion, cx=Depends(conexion)):
    campos = datos.model_fields_set
    token = None
    with db.transaccion(cx):
        actual = _miembro(cx, id)
        for k in ("nombre", "rol", "activo"):
            if k in campos and getattr(datos, k) is None:
                raise invalido(f"{k} no puede ser null")
        cambios = {}
        if "nombre" in campos:
            if cx.execute("SELECT 1 FROM miembro WHERE nombre = ? AND id <> ?", (datos.nombre, id)).fetchone():
                raise conflicto(f"ya existe un miembro llamado '{datos.nombre}'")
            cambios["nombre"] = datos.nombre
        if "rol" in campos:
            cambios["rol"] = datos.rol
        if "activo" in campos:
            cambios["activo"] = int(datos.activo)
        deja_de_ser_admin = actual["rol"] == "admin" and actual["activo"] and (
            cambios.get("rol", "admin") != "admin" or cambios.get("activo", 1) == 0)
        if deja_de_ser_admin and _quedaria_sin_admin(cx, id):
            raise conflicto("es el último admin activo: crea o activa otro admin antes", "ultimo_admin")
        if datos.renovar_token:
            token = auth.nuevo_token()
            cambios["token_hash"] = auth.hashear(token)
        if cambios:
            cx.execute(f"UPDATE miembro SET {', '.join(k + ' = ?' for k in cambios)} WHERE id = ?",
                       [*cambios.values(), id])
        cuerpo = miembro_json(_miembro(cx, id))
    if token is not None:
        cuerpo["token"] = token
    return cuerpo


@router.delete("/miembros/{id}")
def borrar_miembro(id: int, cx=Depends(conexion)):
    with db.transaccion(cx):
        actual = _miembro(cx, id)
        if actual["rol"] == "admin" and actual["activo"] and _quedaria_sin_admin(cx, id):
            raise conflicto("es el último admin activo: crea o activa otro admin antes", "ultimo_admin")
        historia = cx.execute("""
            SELECT EXISTS (SELECT 1 FROM compra WHERE registrada_por = :id)
                OR EXISTS (SELECT 1 FROM elemento WHERE alta_por = :id)
                OR EXISTS (SELECT 1 FROM movimiento WHERE miembro_id = :id)""", {"id": id}).fetchone()[0]
        if historia:  # su nombre sigue respondiendo «quién hizo qué»
            cx.execute("UPDATE miembro SET activo = 0 WHERE id = ?", (id,))
            return {"id": id, "modo": "logico"}
        cx.execute("DELETE FROM miembro WHERE id = ?", (id,))
        return {"id": id, "modo": "fisico"}
