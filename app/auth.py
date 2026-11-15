"""Miembros, tokens y permisos por rol.

- El token se guarda como `sha256$<sal hex>$<sha256(sal || token) hex>`, con 16 bytes de sal propia por miembro. El
  token en claro solo existe en la respuesta que lo entrega (alta del miembro o renovación) y en el dispositivo.
  Nunca se escribe en la base ni en un log.
- Rol por petición, en un solo sitio (`rol_necesario`):
    GET                          -> lector (cualquier miembro activo)
    POST/PUT/PATCH en /miembros  -> admin
    DELETE en cualquier ruta     -> admin
    POST/PUT/PATCH en el resto   -> editor (altas, movimientos, mermas, fotos, catálogo, importador)
- Arranque: si no hay ningún miembro, se crea UN admin con el token de NEVERA_ADMIN_TOKEN. Si falta, no arranca.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import sqlite3

from .errores import ErrorApi

log = logging.getLogger("nevera")

NIVEL = {"lector": 1, "editor": 2, "admin": 3}
ROLES = tuple(NIVEL)
LARGO_MINIMO_TOKEN_ADMIN = 16


class ArranqueImposible(RuntimeError):
    pass


def nuevo_token() -> str:
    return secrets.token_urlsafe(32)


def hashear(token: str) -> str:
    sal = secrets.token_bytes(16)
    return f"sha256${sal.hex()}${hashlib.sha256(sal + token.encode('utf-8')).hexdigest()}"


def coincide(token: str, token_hash: str) -> bool:
    try:
        esquema, sal_hex, esperado = token_hash.split("$")
        sal = bytes.fromhex(sal_hex)
    except ValueError:
        return False
    if esquema != "sha256":
        return False
    calculado = hashlib.sha256(sal + token.encode("utf-8")).hexdigest()
    return hmac.compare_digest(calculado, esperado)


def buscar_por_token(cx: sqlite3.Connection, token: str):
    """Miembro activo cuyo hash coincide. Recorre todos (un hogar: pocos) sin cortar antes, a tiempo parejo."""
    hallado = None
    for fila in cx.execute("SELECT id, nombre, rol, token_hash, activo FROM miembro WHERE activo = 1"):
        if coincide(token, fila["token_hash"]) and hallado is None:
            hallado = fila
    return hallado


def token_de_cabecera(valor: str | None) -> str:
    if not valor:
        raise ErrorApi(401, "no_autenticado", "falta la cabecera Authorization: Bearer <token>")
    esquema, _, token = valor.partition(" ")
    token = token.strip()
    if esquema.lower() != "bearer" or not token:
        raise ErrorApi(401, "no_autenticado", "la cabecera Authorization debe ser «Bearer <token>»")
    return token


def rol_necesario(metodo: str, ruta: str) -> str:
    metodo = metodo.upper()
    if metodo in ("GET", "HEAD"):
        return "lector"
    if ruta == "/miembros" or ruta.startswith("/miembros/"):
        return "admin"
    if metodo == "DELETE":
        return "admin"
    return "editor"


def exigir(miembro, metodo: str, ruta: str) -> None:
    necesario = rol_necesario(metodo, ruta)
    if NIVEL[miembro["rol"]] < NIVEL[necesario]:
        raise ErrorApi(403, "prohibido",
                       f"el rol «{miembro['rol']}» no puede hacer {metodo.upper()} {ruta}; hace falta «{necesario}»")


def arrancar(cx: sqlite3.Connection, token_admin: str | None) -> str:
    """Crea el primer admin si no hay miembros. Devuelve un mensaje para el log (sin el token)."""
    hay = cx.execute("SELECT COUNT(*) FROM miembro").fetchone()[0]
    if hay:
        if token_admin:
            return f"{hay} miembro(s) en la base; NEVERA_ADMIN_TOKEN se ignora (solo sirve para el primer arranque)"
        return f"{hay} miembro(s) en la base"
    if not token_admin:
        raise ArranqueImposible(
            "no hay ningún miembro y falta NEVERA_ADMIN_TOKEN: defínela con el token del primer admin y vuelve a arrancar"
        )
    if len(token_admin) < LARGO_MINIMO_TOKEN_ADMIN or any(c.isspace() for c in token_admin):
        raise ArranqueImposible(
            f"NEVERA_ADMIN_TOKEN debe tener al menos {LARGO_MINIMO_TOKEN_ADMIN} caracteres y ningún espacio"
        )
    cx.execute("INSERT INTO miembro (nombre, rol, token_hash) VALUES ('admin', 'admin', ?)", (hashear(token_admin),))
    return "base sin miembros: se creó el miembro «admin» (rol admin) desde NEVERA_ADMIN_TOKEN; se guardó solo su hash"
