"""Base SQLite del Catálogo de nevera: creación, apertura y transacciones.

- La base se crea aplicando db/esquema.sql y db/referencia.sql (catálogo de
  referencia: unidades y ubicaciones; nada de datos de ejemplo).
- Cada conexión activa PRAGMA foreign_keys = ON (SQLite lo exige por conexión).
- La aplicación no migra: si la base tiene otra versión de esquema
  (PRAGMA user_version), se niega a abrirla y lo dice.
"""
from __future__ import annotations

import contextlib
import os
import sqlite3

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESQUEMA = os.path.join(RAIZ, "db", "esquema.sql")
REFERENCIA = os.path.join(RAIZ, "db", "referencia.sql")
VERSION_ESQUEMA = 2


class BaseInvalida(RuntimeError):
    """La base existe pero no es de esta versión del esquema."""


def conectar(ruta: str) -> sqlite3.Connection:
    """Conexión en modo autocommit; las escrituras van dentro de `transaccion`."""
    cx = sqlite3.connect(ruta, isolation_level=None, check_same_thread=False, timeout=10)
    cx.row_factory = sqlite3.Row
    cx.execute("PRAGMA foreign_keys = ON")
    cx.execute("PRAGMA busy_timeout = 10000")
    return cx


@contextlib.contextmanager
def transaccion(cx: sqlite3.Connection):
    """BEGIN IMMEDIATE … COMMIT; ROLLBACK ante cualquier excepción (todo o nada).

    Si la conexión ya está dentro de una transacción (el simulacro de `simulacro`), esta queda anidada como
    SAVEPOINT: lo que haga se deshace o se suelta, y la decisión final es de la transacción de fuera."""
    if cx.in_transaction:
        cx.execute("SAVEPOINT anidada")
        try:
            yield cx
        except BaseException:
            cx.execute("ROLLBACK TO anidada")
            cx.execute("RELEASE anidada")
            raise
        else:
            cx.execute("RELEASE anidada")
        return
    cx.execute("BEGIN IMMEDIATE")
    try:
        yield cx
    except BaseException:
        cx.execute("ROLLBACK")
        raise
    else:
        cx.execute("COMMIT")


@contextlib.contextmanager
def simulacro(cx: sqlite3.Connection):
    """Corre lo de dentro con todas sus validaciones y escrituras y al final lo deshace: ROLLBACK siempre.

    Para decir qué se habría escrito sin escribirlo (las herramientas MCP sin `confirmar: true`)."""
    cx.execute("BEGIN IMMEDIATE")
    try:
        yield cx
    finally:
        cx.execute("ROLLBACK")


def salud(ruta_base: str) -> dict:
    """El cuerpo de GET /salud: versión de la app, esquema de la base y dónde está."""
    from . import __version__
    cx = conectar(ruta_base)
    try:
        esquema = version(cx)
    finally:
        cx.close()
    return {"ok": True, "version": __version__, "esquema": esquema,
            "base": os.path.relpath(ruta_base, RAIZ) if ruta_base.startswith(RAIZ + os.sep) else ruta_base}


def version(cx: sqlite3.Connection) -> int:
    return cx.execute("PRAGMA user_version").fetchone()[0]


def crear_base(ruta: str) -> None:
    """Crea la base desde cero. Falla si ya existe: nunca pisa una base."""
    if os.path.exists(ruta):
        raise FileExistsError(f"ya existe una base en {ruta}; no se sobrescribe")
    os.makedirs(os.path.dirname(os.path.abspath(ruta)), exist_ok=True)
    temporal = ruta + ".creando"
    if os.path.exists(temporal):
        os.unlink(temporal)
    cx = sqlite3.connect(temporal)
    try:
        cx.execute("PRAGMA foreign_keys = ON")
        cx.executescript(open(ESQUEMA, encoding="utf-8").read())
        cx.executescript(open(REFERENCIA, encoding="utf-8").read())
        if version(cx) != VERSION_ESQUEMA:
            raise BaseInvalida(f"db/esquema.sql dejó user_version = {version(cx)}, se esperaba {VERSION_ESQUEMA}")
        if cx.execute("PRAGMA foreign_key_check").fetchall():
            raise BaseInvalida("foreign_key_check no está limpio tras crear la base")
        cx.execute("PRAGMA journal_mode = WAL")
        cx.close()
    except BaseException:
        cx.close()
        os.unlink(temporal)
        raise
    os.replace(temporal, ruta)


def abrir_o_crear(ruta: str) -> bool:
    """Crea la base si no existe y comprueba su versión. Devuelve True si la creó."""
    creada = False
    if not os.path.exists(ruta):
        crear_base(ruta)
        creada = True
    cx = conectar(ruta)
    try:
        v = version(cx)
        if v != VERSION_ESQUEMA:
            raise BaseInvalida(
                f"la base {ruta} tiene esquema versión {v}; esta aplicación espera la {VERSION_ESQUEMA} y no migra"
            )
    finally:
        cx.close()
    return creada
