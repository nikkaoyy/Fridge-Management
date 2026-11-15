"""Crea una base vacía del Catálogo de nevera (esquema + catálogo de referencia).

Uso:  .venv/bin/python -I scripts/crear_base.py [ruta]      (por defecto data/nevera.db)

No hace falta correrlo antes de arrancar: el servicio crea la base si no existe.
Sirve para crearla a mano, para inspeccionarla o para comprobar que el DDL
aplica limpio. Nunca sobrescribe una base que ya existe. No mete ninguna fila
de ejemplo: ni productos, ni miembros, ni precios.
"""
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

from app import db  # noqa: E402

ruta = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "data", "nevera.db")
try:
    db.crear_base(ruta)
except FileExistsError as e:
    sys.exit(str(e))
cx = db.conectar(ruta)
n = {t: cx.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = ?", (t,)).fetchone()[0] for t in ("table", "view", "trigger")}
print(f"base creada en {ruta}: esquema versión {db.version(cx)}, {n['table']} tablas, {n['view']} vistas, {n['trigger']} triggers")
print(f"catálogo de referencia: {cx.execute('SELECT COUNT(*) FROM unidad').fetchone()[0]} unidades, "
      f"{cx.execute('SELECT COUNT(*) FROM ubicacion').fetchone()[0]} ubicaciones; "
      f"{cx.execute('SELECT COUNT(*) FROM producto').fetchone()[0]} productos, "
      f"{cx.execute('SELECT COUNT(*) FROM miembro').fetchone()[0]} miembros")
cx.close()
