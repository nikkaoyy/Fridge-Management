"""Verificación del bloque 4 de PEDIDO-NEVERA-0, sin código de aplicación.
Actualizada en PEDIDO-NEVERA-2 al esquema versión 2 (miembros, atribución,
fotos, regla de hojas de D3 en las dos consultas).

1. Aplica db/esquema.sql y db/referencia.sql en una base SQLite TEMPORAL con
   PRAGMA foreign_keys = ON y la borra al terminar.
2. Corre tres pruebas de anomalías (inserción, borrado, actualización) sobre
   esa base, con filas de prueba que viven solo en ella.
3. Escribe y mide las dos consultas que importan, con su número de joins y
   su plan de ejecución, sobre una carga sintética también temporal.
4. Valida api/openapi.yaml (openapi-spec-validator si está; si no, YAML +
   resolución de cada $ref).

Uso: python3 -I scripts/verificacion.py   (pyyaml para el paso 4; el
validador es opcional). Imprime el informe en markdown por stdout; la
salida real se pega en docs/verificacion.md.

Ninguna fila de este script toca el repositorio: la base es un archivo en
/tmp que se borra al final, y se comprueba que se borró.
"""
import os, random, re, sqlite3, sys, tempfile, time
from datetime import date, timedelta

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESQUEMA = os.path.join(RAIZ, "db", "esquema.sql")
REFERENCIA = os.path.join(RAIZ, "db", "referencia.sql")
OPENAPI = os.path.join(RAIZ, "api", "openapi.yaml")

fallos = []
# Lo que ya había en el repositorio antes de correr (la base viva del
# servicio vive en data/, ignorada por git): el script solo responde de
# lo que él mismo cree.
ANTES_RAIZ = set(os.listdir(RAIZ))
ANTES_DATA = set(os.listdir(os.path.join(RAIZ, "data"))) if os.path.isdir(os.path.join(RAIZ, "data")) else None


def h(titulo):
    print(f"\n## {titulo}\n")


def ok(cond, texto):
    print(("- OK   " if cond else "- FALLA ") + texto)
    if not cond:
        fallos.append(texto)
    return cond


def uno(cx, sql, *args):
    return cx.execute(sql, args).fetchone()[0]


def rechaza(cx, sql, *args):
    """True si SQLite rechaza la sentencia (CHECK, FK o trigger)."""
    try:
        cx.execute(sql, args)
    except sqlite3.IntegrityError as e:
        return True, str(e)
    return False, "aceptada"


def hoy(mas=0):
    return (date.today() + timedelta(days=mas)).isoformat()


# ---------------------------------------------------------------------
# 1. DDL en base temporal
# ---------------------------------------------------------------------
h("1. El DDL aplica limpio en una base temporal")

fd, ruta = tempfile.mkstemp(prefix="nevera-prueba-", suffix=".db", dir="/tmp")
os.close(fd)
os.unlink(ruta)  # sqlite la crea de cero
cx = sqlite3.connect(ruta)
cx.execute("PRAGMA foreign_keys = ON")
print(f"- base temporal: `{ruta}`")
print(f"- SQLite {sqlite3.sqlite_version} (módulo sqlite3 de Python {sys.version.split()[0]}; no hay cliente `sqlite3` en la máquina)")

cx.executescript(open(ESQUEMA, encoding="utf-8").read())
cx.executescript(open(REFERENCIA, encoding="utf-8").read())
ok(uno(cx, "PRAGMA foreign_keys") == 1, "PRAGMA foreign_keys = 1 en la conexión")
ok(uno(cx, "PRAGMA user_version") == 2, "PRAGMA user_version = 2 (esquema ampliado en PEDIDO-NEVERA-2)")
n = {t: uno(cx, "SELECT COUNT(*) FROM sqlite_master WHERE type = ?", t) for t in ("table", "view", "trigger", "index")}
print(f"- objetos creados: {n['table']} tablas, {n['view']} vistas, {n['trigger']} triggers, {n['index']} índices (los índices incluyen los automáticos de UNIQUE/PK)")
ok(uno(cx, "PRAGMA integrity_check") == "ok", "PRAGMA integrity_check = ok")
ok(cx.execute("PRAGMA foreign_key_check").fetchall() == [], "PRAGMA foreign_key_check sin filas")
ok(uno(cx, "SELECT COUNT(*) FROM producto") == 0 and uno(cx, "SELECT COUNT(*) FROM miembro") == 0,
   "ningún producto ni miembro tras aplicar esquema + referencia (sin datos de ejemplo)")
print(f"- catálogo de referencia: {uno(cx, 'SELECT COUNT(*) FROM unidad')} unidades, {uno(cx, 'SELECT COUNT(*) FROM ubicacion')} ubicaciones")

# ---------------------------------------------------------------------
# 2. Pruebas de anomalías (filas de prueba, solo en la base temporal)
# ---------------------------------------------------------------------
h("2. Pruebas de anomalías")
print("Filas de prueba creadas solo en la base temporal: una categoría, dos productos, presentaciones, tres proveedores y precios.\n")

U = {c: i for c, i in cx.execute("SELECT codigo, id FROM unidad")}
cx.execute("INSERT INTO categoria (nombre) VALUES ('prueba')")
cat = cx.execute("SELECT id FROM categoria WHERE nombre = 'prueba'").fetchone()[0]
cx.execute("INSERT INTO producto (nombre, categoria_id, unidad_base_id) VALUES ('producto de prueba (volumen)', ?, ?)", (cat, U["ml"]))
pv = cx.execute("SELECT id FROM producto WHERE nombre = 'producto de prueba (volumen)'").fetchone()[0]
cx.execute("INSERT INTO presentacion (producto_id, nombre, contenido, unidad_id) VALUES (?, 'bolsa 1 L', 1, ?)", (pv, U["l"]))
cx.execute("INSERT INTO presentacion (producto_id, nombre, contenido, unidad_id) VALUES (?, 'caja 200 ml', 200, ?)", (pv, U["ml"]))
bolsa = uno(cx, "SELECT id FROM presentacion WHERE nombre = 'bolsa 1 L'")
caja = uno(cx, "SELECT id FROM presentacion WHERE nombre = 'caja 200 ml'")
cx.execute("INSERT INTO presentacion (producto_id, nombre, parte_id, partes) VALUES (?, 'pack 6 bolsas', ?, 6)", (pv, bolsa))
pack = uno(cx, "SELECT id FROM presentacion WHERE nombre = 'pack 6 bolsas'")
for p in ("proveedor A", "proveedor B", "proveedor C"):
    cx.execute("INSERT INTO proveedor (nombre) VALUES (?)", (p,))
PA, PB, PC = (uno(cx, "SELECT id FROM proveedor WHERE nombre = ?", p) for p in ("proveedor A", "proveedor B", "proveedor C"))
# No todo proveedor vende toda presentación: ese es el punto de la 4FN.
cx.executemany("INSERT INTO precio (presentacion_id, proveedor_id, vigente_desde, precio_cop) VALUES (?, ?, ?, ?)", [
    (bolsa, PA, "2026-01-01", 4500), (caja, PA, "2026-01-01", 1200),
    (bolsa, PB, "2026-01-01", 4300),
    (pack, PC, "2026-01-01", 25000),
])
cx.commit()

# --- Prueba 1: inserción -------------------------------------------------
print("### Prueba 1 · Inserción: una presentación nueva en un producto con tres proveedores\n")
antes = dict(presentacion=uno(cx, "SELECT COUNT(*) FROM presentacion WHERE producto_id = ?", pv),
             precio=uno(cx, "SELECT COUNT(*) FROM precio"),
             proveedores=uno(cx, "SELECT COUNT(DISTINCT pr.proveedor_id) FROM precio pr JOIN presentacion p ON p.id = pr.presentacion_id WHERE p.producto_id = ?", pv))
cx.execute("INSERT INTO presentacion (producto_id, nombre, contenido, unidad_id) VALUES (?, 'botella 500 ml', 500, ?)", (pv, U["ml"]))
cambios = cx.total_changes
cx.commit()
despues = dict(presentacion=uno(cx, "SELECT COUNT(*) FROM presentacion WHERE producto_id = ?", pv),
               precio=uno(cx, "SELECT COUNT(*) FROM precio"),
               proveedores=uno(cx, "SELECT COUNT(DISTINCT pr.proveedor_id) FROM precio pr JOIN presentacion p ON p.id = pr.presentacion_id WHERE p.producto_id = ?", pv))
print(f"- antes: {antes['presentacion']} presentaciones, {antes['precio']} filas de precio, {antes['proveedores']} proveedores del producto")
print(f"- se inserta UNA fila en `presentacion` ('botella 500 ml')")
print(f"- después: {despues['presentacion']} presentaciones, {despues['precio']} filas de precio, {despues['proveedores']} proveedores del producto")
ok(despues["presentacion"] == antes["presentacion"] + 1 and despues["precio"] == antes["precio"] and despues["proveedores"] == antes["proveedores"],
   "una presentación nueva = una fila; ninguna fila espuria en precio ni proveedor fantasma")

# Contraejemplo: la tabla que la 4FN prohíbe, construida aparte para verlo.
cx.execute("CREATE TEMP TABLE x_producto_oferta (producto_id INTEGER, presentacion TEXT, proveedor TEXT)")
cx.execute("""INSERT INTO x_producto_oferta
              SELECT p.producto_id, p.nombre, v.nombre FROM presentacion p CROSS JOIN proveedor v
              WHERE p.producto_id = ? AND p.nombre <> 'botella 500 ml'""", (pv,))
esp = uno(cx, "SELECT COUNT(*) FROM x_producto_oferta")
reales = uno(cx, "SELECT COUNT(*) FROM precio pr JOIN presentacion p ON p.id = pr.presentacion_id WHERE p.producto_id = ?", pv)
print(f"- contraejemplo (tabla temporal `x_producto_oferta` que mezcla los dos hechos): 3 presentaciones × 3 proveedores = {esp} filas, de las que solo {reales} son combinaciones reales; "
      f"la cuarta presentación habría exigido {uno(cx, 'SELECT COUNT(*) FROM proveedor')} inserciones en vez de 1")
cx.execute("DROP TABLE x_producto_oferta")

# --- Prueba 2: borrado ---------------------------------------------------
print("\n### Prueba 2 · Borrado: borrar un proveedor no se lleva el producto ni la presentación\n")
cx.execute("INSERT INTO compra (fecha, proveedor_id) VALUES (?, ?)", (hoy(-3), PB))
compra_b = cx.execute("SELECT id FROM compra WHERE proveedor_id = ?", (PB,)).fetchone()[0]
cx.execute("INSERT INTO compra_linea (compra_id, presentacion_id, precio_unitario_cop) VALUES (?, ?, 4300)", (compra_b, bolsa))
nevera = uno(cx, "SELECT id FROM ubicacion WHERE nombre = 'nevera'")
cx.execute("INSERT INTO elemento (compra_id, presentacion_id, ubicacion_id, cantidad_inicial, vencimiento, vencimiento_origen, etiqueta) VALUES (?, ?, ?, 1000, ?, 'impreso', 'de la puerta')",
           (compra_b, bolsa, nevera, hoy(5)))
cx.commit()
antes = dict(producto=uno(cx, "SELECT COUNT(*) FROM producto"), presentacion=uno(cx, "SELECT COUNT(*) FROM presentacion"),
             elemento=uno(cx, "SELECT COUNT(*) FROM elemento"), compra=uno(cx, "SELECT COUNT(*) FROM compra"),
             precio_b=uno(cx, "SELECT COUNT(*) FROM precio WHERE proveedor_id = ?", PB), proveedor=uno(cx, "SELECT COUNT(*) FROM proveedor"))
print(f"- antes: {antes['proveedor']} proveedores, {antes['producto']} productos, {antes['presentacion']} presentaciones, {antes['compra']} compra (de B), {antes['elemento']} elemento, {antes['precio_b']} precio de B")
cx.execute("DELETE FROM proveedor WHERE id = ?", (PB,))
cx.commit()
despues = dict(producto=uno(cx, "SELECT COUNT(*) FROM producto"), presentacion=uno(cx, "SELECT COUNT(*) FROM presentacion"),
               elemento=uno(cx, "SELECT COUNT(*) FROM elemento"), compra=uno(cx, "SELECT COUNT(*) FROM compra"),
               precio_b=uno(cx, "SELECT COUNT(*) FROM precio WHERE proveedor_id = ?", PB), proveedor=uno(cx, "SELECT COUNT(*) FROM proveedor"),
               compra_prov=cx.execute("SELECT proveedor_id FROM compra WHERE id = ?", (compra_b,)).fetchone()[0])
print(f"- se ejecuta `DELETE FROM proveedor` (proveedor B)")
print(f"- después: {despues['proveedor']} proveedores, {despues['producto']} productos, {despues['presentacion']} presentaciones, {despues['compra']} compra con proveedor_id = {despues['compra_prov']}, {despues['elemento']} elemento, {despues['precio_b']} precios de B")
ok(despues["producto"] == antes["producto"] and despues["presentacion"] == antes["presentacion"] and despues["elemento"] == antes["elemento"],
   "producto, presentación y elemento intactos")
ok(despues["compra"] == antes["compra"] and despues["compra_prov"] is None, "la compra sobrevive con proveedor_id = NULL (ON DELETE SET NULL): lo pagado es historia")
ok(despues["precio_b"] == 0, "los precios de B se van con B (ON DELETE CASCADE): el precio es un hecho del proveedor")
ok(cx.execute("PRAGMA foreign_key_check").fetchall() == [], "foreign_key_check limpio tras el borrado")
# Y al revés: lo que SÍ está protegido.
r, msg = rechaza(cx, "DELETE FROM presentacion WHERE id = ?", bolsa)
ok(r, f"borrar una presentación con compras registradas se rechaza (ON DELETE RESTRICT): `{msg}`")
r, msg = rechaza(cx, "DELETE FROM unidad WHERE id = ?", U["ml"])
ok(r, f"borrar la unidad base de un producto se rechaza (ON DELETE RESTRICT): `{msg}`")

# --- Prueba 3: actualización ---------------------------------------------
print("\n### Prueba 3 · Actualización: cambiar el factor de una unidad se hace en un solo sitio\n")
cx.execute("INSERT INTO producto (nombre, categoria_id, unidad_base_id) VALUES ('producto de prueba (masa)', ?, ?)", (cat, U["g"]))
pm = uno(cx, "SELECT id FROM producto WHERE nombre = 'producto de prueba (masa)'")
cx.executemany("INSERT INTO presentacion (producto_id, nombre, contenido, unidad_id) VALUES (?, ?, ?, ?)", [
    (pm, "paquete 500 g", 500, U["g"]), (pm, "paquete 0,5 kg", 0.5, U["kg"]), (pm, "paquete 1 lb", 1, U["lb"]),
    (pm, "bulto 10 lb", 10, U["lb"]),
])
cx.commit()
base = lambda: {n: c for n, c in cx.execute("SELECT nombre, contenido_base FROM v_presentacion_base WHERE producto_id = ? ORDER BY id", (pm,))}
b0 = base()
print("- cuatro presentaciones declaradas en g, kg y lb; `v_presentacion_base` las lleva a gramos:")
for k, v in b0.items():
    print(f"  - {k}: {v:g} g")
ok(b0["paquete 500 g"] == b0["paquete 0,5 kg"] == b0["paquete 1 lb"] == 500, "«500 g», «0,5 kg» y «1 lb» son la misma cantidad: 500 g")
cx.execute("UPDATE unidad SET factor_a_base = 453.6 WHERE codigo = 'lb'")
filas = cx.execute("SELECT changes()").fetchone()[0]
cx.commit()
b1 = base()
print(f"- `UPDATE unidad SET factor_a_base = 453.6 WHERE codigo = 'lb'` (libra internacional en vez de la de mercado): {filas} fila tocada, 0 en `presentacion`")
for k in ("paquete 1 lb", "bulto 10 lb"):
    print(f"  - {k}: {b0[k]:g} g → {b1[k]:g} g")
ok(filas == 1 and b1["paquete 1 lb"] == 453.6 and b1["bulto 10 lb"] == 4536 and b1["paquete 500 g"] == 500 and b1["paquete 0,5 kg"] == 500,
   "las dos presentaciones en libras cambian solas; las de g y kg no se mueven; una sola fila actualizada")
cx.execute("UPDATE unidad SET factor_a_base = 500 WHERE codigo = 'lb'")
cx.commit()

# --- Reglas cruzadas (triggers): que rechacen lo que deben ---------------
print("\n### Reglas que un CHECK no alcanza (triggers)\n")
r, msg = rechaza(cx, "INSERT INTO producto (nombre, categoria_id, unidad_base_id) VALUES ('mal base', ?, ?)", cat, U["kg"])
ok(r, f"producto con unidad base kg (factor ≠ 1) rechazado: `{msg}`")
r, msg = rechaza(cx, "INSERT INTO presentacion (producto_id, nombre, contenido, unidad_id) VALUES (?, 'bolsa 1 kg', 1, ?)", pv, U["kg"])
ok(r, f"presentación en kg de un producto en ml rechazada: `{msg}`")
r, msg = rechaza(cx, "INSERT INTO presentacion (producto_id, nombre, parte_id, partes) VALUES (?, 'pack ajeno', ?, 2)", pm, bolsa)
ok(r, f"pack cuya parte es de otro producto rechazado: `{msg}`")
r, msg = rechaza(cx, "INSERT INTO presentacion (producto_id, nombre, contenido) VALUES (?, 'sin unidad', 3)", pv)
ok(r, f"contenido sin unidad rechazado (CHECK): `{msg}`")
r, msg = rechaza(cx, "INSERT INTO elemento (compra_id, presentacion_id, ubicacion_id, cantidad_inicial, vencimiento) VALUES (?, ?, ?, 1, '2026-12-01')", compra_b, bolsa, nevera)
ok(r, f"vencimiento sin origen rechazado (CHECK): `{msg}`")
cx.rollback()

# ---------------------------------------------------------------------
# 3. Las dos consultas que importan
# ---------------------------------------------------------------------
h("3. Las dos consultas que importan")

CONSULTA_1 = """
-- Consulta 1 · qué vence en los próximos :n días (elementos disponibles)
SELECT e.id,
       p.nombre                                        AS producto,
       pr.nombre                                       AS presentacion,
       e.etiqueta,
       e.vencimiento,
       CAST(julianday(e.vencimiento) - julianday(date('now')) AS INTEGER) AS dias,
       e.cantidad_inicial - COALESCE(m.salida, 0)      AS saldo
FROM elemento e
JOIN presentacion pr ON pr.id = e.presentacion_id
JOIN producto p      ON p.id  = pr.producto_id
LEFT JOIN (SELECT elemento_id, SUM(cantidad) AS salida
           FROM movimiento GROUP BY elemento_id) m ON m.elemento_id = e.id
WHERE e.vencimiento BETWEEN date('now') AND date('now', '+' || :n || ' days')
  AND e.cantidad_inicial - COALESCE(m.salida, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM elemento h WHERE h.padre_id = e.id)   -- D3: solo hojas
ORDER BY e.vencimiento, e.id
"""

CONSULTA_2 = """
-- Consulta 2 · qué recetas (versión vigente) usan lo que vence en :n días
WITH vigente AS (
    SELECT rv.id AS receta_version_id, rv.receta_id
    FROM receta_version rv
    WHERE rv.numero = (SELECT MAX(numero) FROM receta_version WHERE receta_id = rv.receta_id)
),
disponible AS (
    SELECT pr.producto_id,
           e.vencimiento,
           e.cantidad_inicial - COALESCE(m.salida, 0) AS saldo
    FROM elemento e
    JOIN presentacion pr ON pr.id = e.presentacion_id
    LEFT JOIN (SELECT elemento_id, SUM(cantidad) AS salida
               FROM movimiento GROUP BY elemento_id) m ON m.elemento_id = e.id
    WHERE NOT EXISTS (SELECT 1 FROM elemento h WHERE h.padre_id = e.id)   -- D3: solo hojas
)
SELECT r.id                                   AS receta_id,
       r.nombre,
       v.receta_version_id,
       COUNT(DISTINCT ri.producto_id)         AS ingredientes,
       COUNT(DISTINCT CASE WHEN d.saldo > 0 THEN ri.producto_id END) AS disponibles,
       COUNT(DISTINCT CASE WHEN d.saldo > 0
                            AND d.vencimiento BETWEEN date('now') AND date('now', '+' || :n || ' days')
                           THEN ri.producto_id END)                  AS por_vencer
FROM receta r
JOIN vigente v             ON v.receta_id = r.id
JOIN receta_ingrediente ri ON ri.receta_version_id = v.receta_version_id
LEFT JOIN disponible d     ON d.producto_id = ri.producto_id
GROUP BY r.id, r.nombre, v.receta_version_id
HAVING por_vencer > 0
ORDER BY por_vencer DESC, r.nombre
"""


def joins(sql):
    return len(re.findall(r"\bJOIN\b", sql, re.I))


def plan(cx, sql, n):
    return [row[3] for row in cx.execute("EXPLAIN QUERY PLAN " + sql, {"n": n})]


def medir(cx, sql, n, veces=5):
    mejor = None
    for _ in range(veces):
        t = time.perf_counter()
        filas = cx.execute(sql, {"n": n}).fetchall()
        t = (time.perf_counter() - t) * 1000
        mejor = t if mejor is None else min(mejor, t)
    return mejor, len(filas)


# Filas de prueba para que las consultas devuelvan algo verificable a mano.
cx.execute("INSERT INTO compra (fecha) VALUES (?)", (hoy(-1),))
compra_h = uno(cx, "SELECT id FROM compra WHERE fecha = ? AND proveedor_id IS NULL", hoy(-1))
cx.executemany("INSERT INTO compra_linea (compra_id, presentacion_id) VALUES (?, ?)", [(compra_h, caja), (compra_h, uno(cx, "SELECT id FROM presentacion WHERE nombre = 'paquete 500 g'"))])
pq = uno(cx, "SELECT id FROM presentacion WHERE nombre = 'paquete 500 g'")
cx.executemany("INSERT INTO elemento (compra_id, presentacion_id, ubicacion_id, cantidad_inicial, vencimiento, vencimiento_origen, etiqueta) VALUES (?, ?, ?, ?, ?, 'impreso', ?)", [
    (compra_h, caja, nevera, 200, hoy(2), "caja #1"),
    (compra_h, caja, nevera, 200, hoy(2), "caja #2 (consumida)"),
    (compra_h, pq, nevera, 500, hoy(20), "paquete lejano"),
])
e_consumida = uno(cx, "SELECT id FROM elemento WHERE etiqueta = 'caja #2 (consumida)'")
cx.execute("INSERT INTO movimiento (elemento_id, fecha, tipo, cantidad) VALUES (?, ?, 'consumo', 200)", (e_consumida, hoy()))
cx.execute("INSERT INTO receta (nombre) VALUES ('receta de prueba 1')")
cx.execute("INSERT INTO receta (nombre) VALUES ('receta de prueba 2')")
r1, r2 = uno(cx, "SELECT id FROM receta WHERE nombre = 'receta de prueba 1'"), uno(cx, "SELECT id FROM receta WHERE nombre = 'receta de prueba 2'")
cx.executemany("INSERT INTO receta_version (receta_id, numero) VALUES (?, ?)", [(r1, 1), (r1, 2), (r2, 1)])
rv = {(a, b): i for i, a, b in cx.execute("SELECT id, receta_id, numero FROM receta_version")}
cx.executemany("INSERT INTO receta_ingrediente (receta_version_id, producto_id, cantidad, unidad_id) VALUES (?, ?, ?, ?)", [
    (rv[(r1, 1)], pm, 100, U["g"]),                       # versión vieja: solo el producto en masa
    (rv[(r1, 2)], pm, 100, U["g"]), (rv[(r1, 2)], pv, 1, U["l"]),  # versión vigente: masa + volumen (el que vence)
    (rv[(r2, 1)], pm, 250, U["g"]),                       # no usa nada que venza en 7 días
])
cx.commit()

print("Filas de prueba en la base temporal: la bolsa «de la puerta» de la prueba 2 (vence en 5 días), dos cajas que vencen en 2 días (una ya consumida), un paquete que vence en 20, y dos recetas, una con dos versiones.\n")

print("### Consulta 1 · «qué vence en los próximos N días»\n")
print("```sql" + CONSULTA_1 + "```")
j1 = joins(CONSULTA_1)
print(f"\n- **joins: {j1}** (elemento → presentacion → producto, más el LEFT JOIN al agregado de movimiento para el saldo).")
print("- Resultado con N = 7 sobre las filas de prueba:")
for row in cx.execute(CONSULTA_1, {"n": 7}):
    print(f"  - {dict(zip(['id', 'producto', 'presentacion', 'etiqueta', 'vencimiento', 'dias', 'saldo'], row))}")
res1 = cx.execute(CONSULTA_1, {"n": 7}).fetchall()
ok(len(res1) == 2 and [r[3] for r in res1] == ["caja #1", "de la puerta"],
   "devuelve la caja #1 y la bolsa «de la puerta» (prueba 2, vence en 5 días), en ese orden; la caja #2 no sale porque está consumida (saldo 0) y el paquete no porque vence en 20 días")
print("- Plan de ejecución (`EXPLAIN QUERY PLAN`):")
for linea in plan(cx, CONSULTA_1, 7):
    print(f"  - {linea}")

print("\n### Consulta 2 · «qué recetas usan lo que vence»\n")
print("```sql" + CONSULTA_2 + "```")
j2 = joins(CONSULTA_2)
print(f"\n- **joins: {j2}** (receta → versión vigente → ingrediente → elemento, y dentro de `disponible`: elemento → presentacion y el agregado de movimiento).")
print("- Resultado con N = 7 sobre las filas de prueba:")
for row in cx.execute(CONSULTA_2, {"n": 7}):
    print(f"  - {dict(zip(['receta_id', 'nombre', 'receta_version_id', 'ingredientes', 'disponibles', 'por_vencer'], row))}")
res2 = cx.execute(CONSULTA_2, {"n": 7}).fetchall()
ok(len(res2) == 1 and res2[0][1] == "receta de prueba 1" and res2[0][2] == rv[(r1, 2)] and res2[0][3:] == (2, 2, 1),
   "solo la receta 1, en su versión 2 (la vigente), con 2 ingredientes, 2 disponibles y 1 por vencer; la versión 1 no cuenta")
print("- Plan de ejecución (`EXPLAIN QUERY PLAN`):")
for linea in plan(cx, CONSULTA_2, 7):
    print(f"  - {linea}")

# --- Carga sintética temporal para medir -----------------------------------
print("\n### Tiempo con una carga sintética (solo en la base temporal, se borra con ella)\n")
random.seed(7)
NP, NE, NR = 300, 5000, 100
cx.execute("INSERT INTO categoria (nombre) VALUES ('carga')")
catc = uno(cx, "SELECT id FROM categoria WHERE nombre = 'carga'")
cx.executemany("INSERT INTO producto (nombre, categoria_id, unidad_base_id) VALUES (?, ?, ?)", [(f"carga {i}", catc, U["u"]) for i in range(NP)])
prods = [i for (i,) in cx.execute("SELECT id FROM producto WHERE categoria_id = ?", (catc,))]
cx.executemany("INSERT INTO presentacion (producto_id, nombre, contenido, unidad_id) VALUES (?, ?, 1, ?)", [(p, n, U["u"]) for p in prods for n in ("unidad", "bandeja")])
pres = [i for (i,) in cx.execute("SELECT pr.id FROM presentacion pr JOIN producto p ON p.id = pr.producto_id WHERE p.categoria_id = ?", (catc,))]
ubis = [i for (i,) in cx.execute("SELECT id FROM ubicacion")]
cx.executemany("INSERT INTO compra (fecha) VALUES (?)", [(hoy(-d),) for d in range(2, 62)])
compras = [i for (i,) in cx.execute("SELECT id FROM compra WHERE fecha < ?", (hoy(-1),))]
lineas = set()
elems = []
for _ in range(NE):
    c, p = random.choice(compras), random.choice(pres)
    lineas.add((c, p))
    elems.append((c, p, random.choice(ubis), random.randint(1, 6), hoy(random.randint(-5, 40)), random.choice(["impreso", "estimado"])))
cx.executemany("INSERT INTO compra_linea (compra_id, presentacion_id) VALUES (?, ?)", sorted(lineas))
cx.executemany("INSERT INTO elemento (compra_id, presentacion_id, ubicacion_id, cantidad_inicial, vencimiento, vencimiento_origen) VALUES (?, ?, ?, ?, ?, ?)", elems)
ids = [i for (i,) in cx.execute("SELECT id FROM elemento WHERE cantidad_inicial >= 1 AND id > 3")]
movs = []
for e in ids:
    if random.random() < 0.6:
        movs.append((e, hoy(-1), random.choice(["consumo", "merma"]), random.randint(1, 6)))
cx.executemany("INSERT INTO movimiento (elemento_id, fecha, tipo, cantidad) VALUES (?, ?, ?, ?)", movs)
cx.executemany("INSERT INTO receta (nombre) VALUES (?)", [(f"receta carga {i}",) for i in range(NR)])
recs = [i for (i,) in cx.execute("SELECT id FROM receta WHERE nombre LIKE 'receta carga %'")]
cx.executemany("INSERT INTO receta_version (receta_id, numero) VALUES (?, ?)", [(r, n) for r in recs for n in (1, 2)])
rvs = [i for (i,) in cx.execute("SELECT rv.id FROM receta_version rv JOIN receta r ON r.id = rv.receta_id WHERE r.nombre LIKE 'receta carga %'")]
ing = []
for v in rvs:
    for p in random.sample(prods, 6):
        ing.append((v, p, 1, U["u"]))
cx.executemany("INSERT INTO receta_ingrediente (receta_version_id, producto_id, cantidad, unidad_id) VALUES (?, ?, ?, ?)", ing)
cx.commit()
cx.execute("ANALYZE")
tot = {t: uno(cx, f"SELECT COUNT(*) FROM {t}") for t in ("producto", "presentacion", "compra", "elemento", "movimiento", "receta", "receta_version", "receta_ingrediente")}
print("- filas: " + ", ".join(f"{k} {v}" for k, v in tot.items()))
t1, f1 = medir(cx, CONSULTA_1, 7)
t2, f2 = medir(cx, CONSULTA_2, 3)
print(f"- consulta 1 (N = 7): {f1} filas en {t1:.1f} ms (mejor de 5)")
print(f"- consulta 2 (N = 3): {f2} recetas en {t2:.1f} ms (mejor de 5)")
ok(t1 < 100 and t2 < 500, "ambas consultas por debajo de 100 ms y 500 ms respectivamente con esa carga, sin índices adicionales")

# ---------------------------------------------------------------------
# 4. El contrato valida
# ---------------------------------------------------------------------
h("4. `api/openapi.yaml` valida")
try:
    import yaml
except ImportError:
    yaml = None
    ok(False, "pyyaml no disponible: no se pudo parsear el contrato")
if yaml:
    spec = yaml.safe_load(open(OPENAPI, encoding="utf-8"))
    ok(spec.get("openapi", "").startswith("3."), f"YAML parsea; `openapi: {spec.get('openapi')}`")
    # cada $ref resuelve
    refs, rotos = [], []

    def recorrer(nodo):
        if isinstance(nodo, dict):
            for k, v in nodo.items():
                if k == "$ref" and isinstance(v, str):
                    refs.append(v)
                    if not v.startswith("#/"):
                        rotos.append(v); continue
                    cur = spec
                    for parte in v[2:].split("/"):
                        if not isinstance(cur, dict) or parte not in cur:
                            rotos.append(v); break
                        cur = cur[parte]
                else:
                    recorrer(v)
        elif isinstance(nodo, list):
            for v in nodo:
                recorrer(v)

    recorrer(spec)
    ok(not rotos, f"{len(refs)} `$ref` y todos resuelven" + (f"; rotos: {rotos}" if rotos else ""))
    ops = [(p, m, o) for p, it in spec["paths"].items() for m, o in it.items() if m in ("get", "post", "put", "patch", "delete")]
    decl = [o for _, _, o in ops if o.get("x-estado") == "declarado"]
    print(f"- {len(spec['paths'])} rutas, {len(ops)} operaciones: {len(ops) - len(decl)} de fase 1 y {len(decl)} declaradas (`x-estado: declarado`), {len(spec['components']['schemas'])} esquemas")
    ok(all("operationId" in o for _, _, o in ops) and len({o["operationId"] for _, _, o in ops}) == len(ops), "todas las operaciones tienen operationId único")
    ok(all(any(r.startswith("4") or r.startswith("5") for r in o.get("responses", {})) for _, m, o in ops if m != "get" or "{" in _),
       "toda operación que puede fallar declara al menos una respuesta 4xx/5xx")
    try:
        from openapi_spec_validator import validate
        validate(spec)
        ok(True, "openapi-spec-validator (instalado sin root en un venv de /tmp): sin errores")
    except ImportError:
        print("- openapi-spec-validator no disponible: queda la comprobación de YAML + `$ref`")
    except Exception as e:  # noqa: BLE001
        ok(False, f"openapi-spec-validator: {e}")

# ---------------------------------------------------------------------
# 5. Limpieza
# ---------------------------------------------------------------------
h("5. Limpieza")
cx.close()
os.unlink(ruta)
ok(not os.path.exists(ruta), f"base temporal borrada: `{ruta}` ya no existe")
nuevos_raiz = set(os.listdir(RAIZ)) - ANTES_RAIZ
nuevos_data = (set(os.listdir(os.path.join(RAIZ, "data"))) - ANTES_DATA) if ANTES_DATA is not None else set()
ok(not any(f.endswith(".db") for f in nuevos_raiz) and "data" not in nuevos_raiz and not nuevos_data,
   "el script no dejó ningún .db ni carpeta data/ en el repositorio (la base viva de data/, si existe, no se toca)")

print()
print("**VERIFICACIÓN OK**" if not fallos else "**VERIFICACIÓN CON FALLOS:** " + "; ".join(fallos))
sys.exit(1 if fallos else 0)
