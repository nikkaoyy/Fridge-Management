# Verificación del bloque 4: lo que se puede probar sin código de aplicación

Entregable del bloque 4 de `PEDIDO-NEVERA-0.md`. Todo lo que sigue lo produce `scripts/verificacion.py` sobre una base
SQLite temporal en `/tmp` que se borra al terminar; el repositorio no gana ningún `.db` ni ninguna fila. La salida de
abajo es la real, pegada tal cual, de la corrida del 2026-11-15.

Cómo se corrió (no hay cliente `sqlite3` en la máquina, así que el DDL se aplica desde Python; el validador de OpenAPI
se instaló sin root en un entorno virtual de `/tmp`):

```
python3 -m venv /tmp/nevera-venv
/tmp/nevera-venv/bin/pip install pyyaml openapi-spec-validator
/tmp/nevera-venv/bin/python -I scripts/verificacion.py
```

Sin el validador, el paso 4 se queda en YAML + resolución de cada `$ref`; sin `pyyaml`, el paso 4 falla y lo dice.

## Lectura de los resultados

**El DDL aplica limpio.** 18 tablas, 2 vistas, 7 triggers, con `foreign_keys = ON`, `integrity_check = ok` y
`foreign_key_check` vacío. Tras `esquema.sql` + `referencia.sql` hay 0 productos: el catálogo de referencia son solo
unidades y ubicaciones.

**Las tres anomalías del pedido no ocurren.**

- Inserción: una presentación nueva en un producto con tres proveedores es una fila, y las filas de `precio` no se
  mueven. El contraejemplo (una tabla que mezclara presentaciones y proveedores) pide 9 filas para 4 combinaciones
  reales y 3 inserciones por cada presentación nueva. Es la 4FN de `docs/modelo-relacional.md` §2.
- Borrado: borrar un proveedor deja intactos producto, presentación y elemento; la compra sobrevive con
  `proveedor_id = NULL` y los precios de ese proveedor se van con él, que es lo que dice el DDL en cada FK. Y lo que
  debe estar protegido lo está: una presentación con compras y la unidad base de un producto no se pueden borrar.
- Actualización: cambiar el factor de la libra es un `UPDATE` de una fila en `unidad`; las dos presentaciones
  declaradas en libras cambian solas en `v_presentacion_base` y las de gramos y kilos no se tocan. Es la 3FN.

**Las dos consultas y sus joins.**

| Consulta | Joins | Dentro del límite de 3 | Por qué |
|---|---|---|---|
| 1 · qué vence en los próximos N días | 3 | Sí | `elemento → presentacion → producto` para el nombre, y un `LEFT JOIN` al agregado de `movimiento` para el saldo. Usa `ix_elemento_vencimiento` para el rango y claves primarias para el resto. |
| 2 · qué recetas usan lo que vence | 5 | **No** | `receta → receta_version` (vigente) `→ receta_ingrediente → elemento`, y para llegar de `elemento` al producto y al saldo hacen falta `presentacion` y el agregado de `movimiento`. |

Por qué la consulta 2 necesita cinco y si es aceptable:

- Dos de los cinco joins son el precio de la normalización, y se pagan a propósito. `elemento` no lleva `producto_id`
  porque sería una dependencia transitiva (`elemento → presentacion → producto`, 3FN), y no lleva `saldo` porque
  sería un dato mantenido en dos sitios (se deriva de `movimiento`). Ponerlos en `elemento` ahorraría dos joins y
  costaría un trigger de sincronización cada uno, que es exactamente la anomalía que el modelo evita.
- Un tercero es la versión vigente de la receta, que no se guarda como puntero (sería otro dato a mantener): es
  `MAX(numero)` por receta.
- Es aceptable: con 5 000 elementos, 3 000 movimientos y 100 recetas de 6 ingredientes la consulta 2 tarda 17 ms y
  la 1 tarda 4 ms, sin índices adicionales, en SQLite y en un solo hogar. El plan de ejecución de abajo muestra que
  cada join va por clave primaria o por índice; el único `SCAN` es sobre `elemento` dentro de `disponible`, que es
  inevitable porque la consulta pregunta por todos los elementos disponibles. Si algún día duele, lo primero es
  filtrar `disponible` al rango de vencimiento antes de agrupar, no desnormalizar.
- `GET /recetas/sugeridas` del contrato se implementa con esta consulta tal cual (`PEDIDO-NEVERA-2`, fase F3 del
  plan). **Al implementarlo (PEDIDO-NEVERA-5)** se mantuvo su forma (versión vigente por `MAX(numero)` → ingrediente →
  lo disponible, una sola consulta para todas las recetas) con cuatro cambios, dichos en `INFORME-NEVERA-5.md`: lo
  disponible sale de `v_elemento` (hojas de D3, saldo > 0 y el vencimiento efectivo del abierto, «hoy» de Bogotá),
  lo vencido no cuenta como disponible, el orden es por los días del ingrediente más urgente (no por el conteo
  `por_vencer`) y salen todas las recetas que tienen al menos un ingrediente en casa, no solo las que tienen algo por
  vencer. Está en `app/rutas_recetas.py` (`SQL_SUGERIDAS`). `GET /elementos?por_vencer=` y `GET /vencimientos` con la consulta 1 o con `v_elemento`, que es la misma
  consulta más el join a `compra` por `fecha_compra` (4 joins; el cuarto es una búsqueda por clave primaria y da un
  dato que el panel muestra).
- Nota para D3: si Nico firma «el pack se explota al registrar», las dos consultas añaden
  `AND NOT EXISTS (SELECT 1 FROM elemento h WHERE h.padre_id = e.id)` para que el contenedor no cuente. Un join más,
  o una condición en `v_elemento`; se decide en `PEDIDO-NEVERA-2`.

**El contrato valida.** `openapi-spec-validator` 0.9.0 no reporta errores; los 134 `$ref` resuelven; 38 operaciones
con `operationId` único, 27 de fase 1 y 11 declaradas. Además, los dos cotejos de los bloques 1 y 2 siguen en verde
(DDL contra diagrama; contrato contra modelo), pegados al final.

## Salida real de `scripts/verificacion.py`

## 1. El DDL aplica limpio en una base temporal

- base temporal: `/tmp/nevera-prueba-arem46k3.db`
- SQLite 3.53.1 (módulo sqlite3 de Python 3.14.9; no hay cliente `sqlite3` en la máquina)
- OK   PRAGMA foreign_keys = 1 en la conexión
- OK   PRAGMA user_version = 1
- objetos creados: 18 tablas, 2 vistas, 7 triggers, 23 índices (los índices incluyen los automáticos de UNIQUE/PK)
- OK   PRAGMA integrity_check = ok
- OK   PRAGMA foreign_key_check sin filas
- OK   ningún producto tras aplicar esquema + referencia (sin datos de ejemplo)
- catálogo de referencia: 6 unidades, 6 ubicaciones

## 2. Pruebas de anomalías

Filas de prueba creadas solo en la base temporal: una categoría, dos productos, presentaciones, tres proveedores y precios.

### Prueba 1 · Inserción: una presentación nueva en un producto con tres proveedores

- antes: 3 presentaciones, 4 filas de precio, 3 proveedores del producto
- se inserta UNA fila en `presentacion` ('botella 500 ml')
- después: 4 presentaciones, 4 filas de precio, 3 proveedores del producto
- OK   una presentación nueva = una fila; ninguna fila espuria en precio ni proveedor fantasma
- contraejemplo (tabla temporal `x_producto_oferta` que mezcla los dos hechos): 3 presentaciones × 3 proveedores = 9 filas, de las que solo 4 son combinaciones reales; la cuarta presentación habría exigido 3 inserciones en vez de 1

### Prueba 2 · Borrado: borrar un proveedor no se lleva el producto ni la presentación

- antes: 3 proveedores, 1 productos, 4 presentaciones, 1 compra (de B), 1 elemento, 1 precio de B
- se ejecuta `DELETE FROM proveedor` (proveedor B)
- después: 2 proveedores, 1 productos, 4 presentaciones, 1 compra con proveedor_id = None, 1 elemento, 0 precios de B
- OK   producto, presentación y elemento intactos
- OK   la compra sobrevive con proveedor_id = NULL (ON DELETE SET NULL): lo pagado es historia
- OK   los precios de B se van con B (ON DELETE CASCADE): el precio es un hecho del proveedor
- OK   foreign_key_check limpio tras el borrado
- OK   borrar una presentación con compras registradas se rechaza (ON DELETE RESTRICT): `FOREIGN KEY constraint failed`
- OK   borrar la unidad base de un producto se rechaza (ON DELETE RESTRICT): `FOREIGN KEY constraint failed`

### Prueba 3 · Actualización: cambiar el factor de una unidad se hace en un solo sitio

- cuatro presentaciones declaradas en g, kg y lb; `v_presentacion_base` las lleva a gramos:
  - paquete 500 g: 500 g
  - paquete 0,5 kg: 500 g
  - paquete 1 lb: 500 g
  - bulto 10 lb: 5000 g
- OK   «500 g», «0,5 kg» y «1 lb» son la misma cantidad: 500 g
- `UPDATE unidad SET factor_a_base = 453.6 WHERE codigo = 'lb'` (libra internacional en vez de la de mercado): 1 fila tocada, 0 en `presentacion`
  - paquete 1 lb: 500 g → 453.6 g
  - bulto 10 lb: 5000 g → 4536 g
- OK   las dos presentaciones en libras cambian solas; las de g y kg no se mueven; una sola fila actualizada

### Reglas que un CHECK no alcanza (triggers)

- OK   producto con unidad base kg (factor ≠ 1) rechazado: `producto.unidad_base_id debe ser una unidad base (factor_a_base = 1)`
- OK   presentación en kg de un producto en ml rechazada: `presentacion.unidad_id no es de la magnitud del producto`
- OK   pack cuya parte es de otro producto rechazado: `presentacion.parte_id debe ser una presentacion del mismo producto`
- OK   contenido sin unidad rechazado (CHECK): `CHECK constraint failed: (contenido IS NULL) = (unidad_id IS NULL)`
- OK   vencimiento sin origen rechazado (CHECK): `CHECK constraint failed: (vencimiento IS NULL) = (vencimiento_origen IS NULL)`

## 3. Las dos consultas que importan

Filas de prueba en la base temporal: la bolsa «de la puerta» de la prueba 2 (vence en 5 días), dos cajas que vencen en 2 días (una ya consumida), un paquete que vence en 20, y dos recetas, una con dos versiones.

### Consulta 1 · «qué vence en los próximos N días»

```sql
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
ORDER BY e.vencimiento, e.id
```

- **joins: 3** (elemento → presentacion → producto, más el LEFT JOIN al agregado de movimiento para el saldo).
- Resultado con N = 7 sobre las filas de prueba:
  - {'id': 2, 'producto': 'producto de prueba (volumen)', 'presentacion': 'caja 200 ml', 'etiqueta': 'caja #1', 'vencimiento': '2026-11-17', 'dias': 2, 'saldo': 200.0}
  - {'id': 1, 'producto': 'producto de prueba (volumen)', 'presentacion': 'bolsa 1 L', 'etiqueta': 'de la puerta', 'vencimiento': '2026-11-20', 'dias': 5, 'saldo': 1000.0}
- OK   devuelve la caja #1 y la bolsa «de la puerta» (prueba 2, vence en 5 días), en ese orden; la caja #2 no sale porque está consumida (saldo 0) y el paquete no porque vence en 20 días
- Plan de ejecución (`EXPLAIN QUERY PLAN`):
  - MATERIALIZE m
  - SCAN movimiento USING INDEX ix_movimiento_elemento
  - SEARCH e USING INDEX ix_elemento_vencimiento (vencimiento>? AND vencimiento<?)
  - SEARCH pr USING INTEGER PRIMARY KEY (rowid=?)
  - SEARCH p USING INTEGER PRIMARY KEY (rowid=?)
  - BLOOM FILTER ON m (elemento_id=?)
  - SEARCH m USING AUTOMATIC COVERING INDEX (elemento_id=?) LEFT-JOIN

### Consulta 2 · «qué recetas usan lo que vence»

```sql
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
```

- **joins: 5** (receta → versión vigente → ingrediente → elemento, y dentro de `disponible`: elemento → presentacion y el agregado de movimiento).
- Resultado con N = 7 sobre las filas de prueba:
  - {'receta_id': 1, 'nombre': 'receta de prueba 1', 'receta_version_id': 2, 'ingredientes': 2, 'disponibles': 2, 'por_vencer': 1}
- OK   solo la receta 1, en su versión 2 (la vigente), con 2 ingredientes, 2 disponibles y 1 por vencer; la versión 1 no cuenta
- Plan de ejecución (`EXPLAIN QUERY PLAN`):
  - MATERIALIZE disponible
  - MATERIALIZE m
  - SCAN movimiento USING INDEX ix_movimiento_elemento
  - SCAN e
  - SEARCH pr USING INTEGER PRIMARY KEY (rowid=?)
  - BLOOM FILTER ON m (elemento_id=?)
  - SEARCH m USING AUTOMATIC COVERING INDEX (elemento_id=?) LEFT-JOIN
  - SCAN rv
  - CORRELATED SCALAR SUBQUERY 1
  - SEARCH receta_version USING COVERING INDEX sqlite_autoindex_receta_version_1 (receta_id=?)
  - SEARCH r USING INTEGER PRIMARY KEY (rowid=?)
  - SEARCH ri USING PRIMARY KEY (receta_version_id=?)
  - BLOOM FILTER ON d (producto_id=?)
  - SEARCH d USING AUTOMATIC COVERING INDEX (producto_id=?) LEFT-JOIN
  - USE TEMP B-TREE FOR count(DISTINCT)
  - USE TEMP B-TREE FOR count(DISTINCT)
  - USE TEMP B-TREE FOR count(DISTINCT)
  - USE TEMP B-TREE FOR ORDER BY

### Tiempo con una carga sintética (solo en la base temporal, se borra con ella)

- filas: producto 302, presentacion 608, compra 62, elemento 5004, movimiento 3014, receta 102, receta_version 203, receta_ingrediente 1204
- consulta 1 (N = 7): 542 filas en 3.7 ms (mejor de 5)
- consulta 2 (N = 3): 101 recetas en 13.3 ms (mejor de 5)
- OK   ambas consultas por debajo de 100 ms y 500 ms respectivamente con esa carga, sin índices adicionales

## 4. `api/openapi.yaml` valida

- OK   YAML parsea; `openapi: 3.0.3`
- OK   134 `$ref` y todos resuelven
- 22 rutas, 38 operaciones: 27 de fase 1 y 11 declaradas (`x-estado: declarado`), 38 esquemas
- OK   todas las operaciones tienen operationId único
- OK   toda operación que puede fallar declara al menos una respuesta 4xx/5xx
- OK   openapi-spec-validator (instalado sin root en un venv de /tmp): sin errores

## 5. Limpieza

- OK   base temporal borrada: `/tmp/nevera-prueba-arem46k3.db` ya no existe
- OK   ningún .db ni carpeta data/ quedó en el repositorio

**VERIFICACIÓN OK**

## Cotejos de los bloques 1 y 2, corridos de nuevo

```
$ python3 -I scripts/cotejo_ddl_mermaid.py
tablas DDL: 18 entidades mermaid: 18 FKs DDL: 24 relaciones mermaid: 24
COTEJO OK

$ /tmp/nevera-venv/bin/python -I scripts/cotejo_contrato_modelo.py | tail -2
Campos cotejados: 197 · columna: 128 · derivada: 49 · entrada: 20
COTEJO CONTRATO-MODELO OK
```
