-- =====================================================================
-- Catálogo de nevera · esquema de referencia para SQLite (PEDIDO-NEVERA-0)
-- ---------------------------------------------------------------------
-- · Sin datos. Ni productos, ni precios, ni lotes. El catálogo de
--   referencia (unidades, ubicaciones) va aparte en db/referencia.sql.
-- · Claves foráneas activas: la aplicación debe ejecutar
--   PRAGMA foreign_keys = ON en cada conexión (SQLite lo exige por
--   conexión, no por base).
-- · Tablas STRICT (SQLite >= 3.37, 2021). Fechas como TEXT ISO
--   AAAA-MM-DD con CHECK de forma. Booleanos como INTEGER 0/1.
-- · Dinero en COP como INTEGER (pesos enteros, sin centavos).
-- · El modelo y su justificación están en docs/modelo-relacional.md.
--   El DDL y el diagrama mermaid de ese documento dicen lo mismo.
-- =====================================================================

PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;

-- ---------------------------------------------------------------------
-- Catálogo: unidad, categoría, ubicación, proveedor
-- ---------------------------------------------------------------------

-- Unidad de medida. El factor a la unidad base depende SOLO de la
-- unidad (kg -> 1000 g), nunca del producto ni del par unidad-producto.
CREATE TABLE unidad (
    id            INTEGER PRIMARY KEY,
    codigo        TEXT    NOT NULL UNIQUE COLLATE NOCASE,      -- g, kg, ml, l, u
    nombre        TEXT    NOT NULL,
    magnitud      TEXT    NOT NULL CHECK (magnitud IN ('masa', 'volumen', 'conteo')),
    factor_a_base REAL    NOT NULL CHECK (factor_a_base > 0)   -- 1 en la unidad base de su magnitud
) STRICT;

CREATE TABLE categoria (
    id     INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE COLLATE NOCASE
) STRICT;

-- Dónde se guarda algo. Jerárquica (nevera > cajón de verduras) para que
-- la vista 3D esquemática y el factor de conservación tengan dónde colgar.
CREATE TABLE ubicacion (
    id       INTEGER PRIMARY KEY,
    nombre   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    padre_id INTEGER REFERENCES ubicacion (id) ON DELETE RESTRICT,
    CHECK (padre_id IS NULL OR padre_id <> id)
) STRICT;

CREATE TABLE proveedor (
    id     INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nota   TEXT
) STRICT;

-- ---------------------------------------------------------------------
-- Producto y su vida útil
-- ---------------------------------------------------------------------

-- El tipo de cosa (leche, tomate). No la instancia.
CREATE TABLE producto (
    id             INTEGER PRIMARY KEY,
    nombre         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    categoria_id   INTEGER NOT NULL REFERENCES categoria (id) ON DELETE RESTRICT,
    unidad_base_id INTEGER NOT NULL REFERENCES unidad (id)    ON DELETE RESTRICT, -- g, ml o u (factor 1)
    perecedero     INTEGER NOT NULL DEFAULT 1 CHECK (perecedero IN (0, 1)),
    activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),          -- borrado lógico
    nota           TEXT,
    creado_en      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE INDEX ix_producto_categoria ON producto (categoria_id);

-- Vida útil cuando no hay fecha impresa (frutas, verduras, pan). 1:1
-- opcional con producto: si no hay fila, no se estima nada.
CREATE TABLE vida_util (
    producto_id  INTEGER PRIMARY KEY REFERENCES producto (id) ON DELETE CASCADE,
    dias_base    INTEGER NOT NULL CHECK (dias_base > 0),       -- en condición de referencia (madurez en_punto, factor 1)
    dias_abierto INTEGER          CHECK (dias_abierto IS NULL OR dias_abierto > 0), -- vida tras abrir; NULL = no aplica
    fuente       TEXT    NOT NULL CHECK (fuente IN ('etiqueta', 'experiencia', 'referencia', 'estimacion')),
    nota         TEXT,
    registrado_en TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now'))
) STRICT;

-- Factor por madurez al comprar. Hecho multivaluado propio (4FN): no se
-- mezcla con el factor por conservación.
CREATE TABLE vida_util_madurez (
    producto_id INTEGER NOT NULL REFERENCES producto (id) ON DELETE CASCADE,
    madurez     TEXT    NOT NULL CHECK (madurez IN ('verde', 'en_punto', 'madura')),
    factor      REAL    NOT NULL CHECK (factor > 0),
    PRIMARY KEY (producto_id, madurez)
) STRICT, WITHOUT ROWID;

-- Factor por dónde se guarda. Hecho multivaluado independiente del anterior.
CREATE TABLE vida_util_conservacion (
    producto_id  INTEGER NOT NULL REFERENCES producto (id)  ON DELETE CASCADE,
    ubicacion_id INTEGER NOT NULL REFERENCES ubicacion (id) ON DELETE CASCADE,
    factor       REAL    NOT NULL CHECK (factor > 0),
    PRIMARY KEY (producto_id, ubicacion_id)
) STRICT, WITHOUT ROWID;

-- ---------------------------------------------------------------------
-- Presentación (cómo se compra) y empaque anidado
-- ---------------------------------------------------------------------

-- Bolsa de 1 L, caja de 200 g, pack de 12 bolsas, a granel.
--  · contenido + unidad_id: contenido nominal declarado en SU unidad
--    (0,2 kg); la conversión a la base del producto es contenido ×
--    unidad.factor_a_base. NULL en las compuestas (se deriva de las
--    partes) y en las de granel (se mide al comprar).
--  · parte_id + partes: empaque anidado. «pack de 12» = 12 × «bolsa 1 L».
--    Un pack contiene un solo tipo de parte; si algún día hay surtidos,
--    se extrae a tabla presentacion_contenido.
CREATE TABLE presentacion (
    id            INTEGER PRIMARY KEY,
    producto_id   INTEGER NOT NULL REFERENCES producto (id) ON DELETE CASCADE,
    nombre        TEXT    NOT NULL,
    contenido     REAL             CHECK (contenido IS NULL OR contenido > 0),
    unidad_id     INTEGER          REFERENCES unidad (id) ON DELETE RESTRICT,
    parte_id      INTEGER          REFERENCES presentacion (id) ON DELETE RESTRICT,
    partes        INTEGER          CHECK (partes IS NULL OR partes > 1),
    codigo_barras TEXT    UNIQUE,
    activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    UNIQUE (producto_id, nombre),
    CHECK ((contenido IS NULL) = (unidad_id IS NULL)),       -- cantidad y unidad van juntas
    CHECK ((parte_id  IS NULL) = (partes    IS NULL)),       -- parte y número de partes van juntos
    CHECK (parte_id IS NULL OR contenido IS NULL),           -- la compuesta no declara contenido propio
    CHECK (parte_id IS NULL OR parte_id <> id)
) STRICT;

CREATE INDEX ix_presentacion_producto ON presentacion (producto_id);
CREATE INDEX ix_presentacion_parte    ON presentacion (parte_id);

-- ---------------------------------------------------------------------
-- Compra y elemento (la instancia en la nevera)
-- ---------------------------------------------------------------------

-- Una ida al mercado. La fecha de compra vive aquí, no en cada elemento.
-- El alta rápida crea o reutiliza la compra del día sin proveedor.
CREATE TABLE compra (
    id           INTEGER PRIMARY KEY,
    fecha        TEXT    NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    proveedor_id INTEGER          REFERENCES proveedor (id) ON DELETE SET NULL,
    total_cop    INTEGER          CHECK (total_cop IS NULL OR total_cop >= 0),
    nota         TEXT
) STRICT;

CREATE INDEX ix_compra_fecha ON compra (fecha);

-- Qué presentación se compró en esa compra y a qué precio unitario. El
-- precio pagado depende del par (compra, presentación), no del elemento:
-- tres bolsas de la misma compra no repiten el precio tres veces.
CREATE TABLE compra_linea (
    compra_id           INTEGER NOT NULL REFERENCES compra (id)       ON DELETE CASCADE,
    presentacion_id     INTEGER NOT NULL REFERENCES presentacion (id) ON DELETE RESTRICT,
    precio_unitario_cop INTEGER          CHECK (precio_unitario_cop IS NULL OR precio_unitario_cop >= 0),
    PRIMARY KEY (compra_id, presentacion_id)
) STRICT, WITHOUT ROWID;

-- LA instancia: esta bolsa, este tomate. Lo que vence es el elemento.
--  · (compra_id, presentacion_id) -> compra_linea: de dónde salió y a qué precio.
--  · cantidad_inicial en la UNIDAD BASE del producto (g, ml, u). Es un
--    hecho de la instancia (lo que de verdad entró), no del tipo: la
--    presentación solo precarga el valor nominal.
--  · El saldo NO se guarda: cantidad_inicial − Σ movimiento (vista v_elemento).
--  · vencimiento NULL = no se sabe; vencimiento_origen dice de dónde salió.
--  · padre_id: la bolsa que salió de este pack (empaque anidado).
--  · etiqueta: cómo lo llama la casa para saber cuál es cuál («la de la puerta»).
CREATE TABLE elemento (
    id                 INTEGER PRIMARY KEY,
    compra_id          INTEGER NOT NULL,
    presentacion_id    INTEGER NOT NULL,
    ubicacion_id       INTEGER NOT NULL REFERENCES ubicacion (id) ON DELETE RESTRICT,
    cantidad_inicial   REAL    NOT NULL CHECK (cantidad_inicial > 0),
    vencimiento        TEXT             CHECK (vencimiento IS NULL OR vencimiento GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    vencimiento_origen TEXT             CHECK (vencimiento_origen IS NULL OR vencimiento_origen IN ('impreso', 'estimado', 'manual')),
    madurez            TEXT             CHECK (madurez IS NULL OR madurez IN ('verde', 'en_punto', 'madura')),
    abierto_en         TEXT             CHECK (abierto_en IS NULL OR abierto_en GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    padre_id           INTEGER          REFERENCES elemento (id) ON DELETE SET NULL,
    etiqueta           TEXT,
    nota               TEXT,
    creado_en          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (compra_id, presentacion_id) REFERENCES compra_linea (compra_id, presentacion_id) ON DELETE RESTRICT,
    CHECK ((vencimiento IS NULL) = (vencimiento_origen IS NULL)),
    CHECK (padre_id IS NULL OR padre_id <> id)
) STRICT;

CREATE INDEX ix_elemento_vencimiento  ON elemento (vencimiento);
CREATE INDEX ix_elemento_presentacion ON elemento (presentacion_id);
CREATE INDEX ix_elemento_compra       ON elemento (compra_id);
CREATE INDEX ix_elemento_ubicacion    ON elemento (ubicacion_id);
CREATE INDEX ix_elemento_padre        ON elemento (padre_id);

-- Libro de salidas del elemento: consumo, merma (se botó) o ajuste. En la
-- unidad base del producto. El elemento no se actualiza al consumir.
CREATE TABLE movimiento (
    id          INTEGER PRIMARY KEY,
    elemento_id INTEGER NOT NULL REFERENCES elemento (id) ON DELETE CASCADE,
    fecha       TEXT    NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    tipo        TEXT    NOT NULL CHECK (tipo IN ('consumo', 'merma', 'ajuste')),
    cantidad    REAL    NOT NULL CHECK (cantidad <> 0 AND (tipo = 'ajuste' OR cantidad > 0)), -- ajuste puede ser negativo (apareció más)
    motivo      TEXT,
    creado_en   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE INDEX ix_movimiento_elemento ON movimiento (elemento_id);
CREATE INDEX ix_movimiento_fecha    ON movimiento (fecha);

-- ---------------------------------------------------------------------
-- Precio por proveedor (fase 2). Ternaria no descomponible: 5FN.
-- ---------------------------------------------------------------------

-- Lo que cobra un proveedor por una presentación desde una fecha. El
-- precio depende del trío completo; (presentación, proveedor) ×
-- (proveedor, fecha) × (presentación, fecha) no lo reconstruyen. El
-- «vigente_hasta» no se guarda: es el vigente_desde siguiente.
CREATE TABLE precio (
    presentacion_id INTEGER NOT NULL REFERENCES presentacion (id) ON DELETE CASCADE,
    proveedor_id    INTEGER NOT NULL REFERENCES proveedor (id)    ON DELETE CASCADE,
    vigente_desde   TEXT    NOT NULL CHECK (vigente_desde GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    precio_cop      INTEGER NOT NULL CHECK (precio_cop >= 0),
    PRIMARY KEY (presentacion_id, proveedor_id, vigente_desde)
) STRICT, WITHOUT ROWID;

CREATE INDEX ix_precio_proveedor ON precio (proveedor_id);

-- ---------------------------------------------------------------------
-- Receta, versión, ingrediente y plan (fases 2 y 3)
-- ---------------------------------------------------------------------

CREATE TABLE receta (
    id        INTEGER PRIMARY KEY,
    nombre    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nota      TEXT,
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

-- Los ingredientes cuelgan de la VERSIÓN, no de la receta: un plan viejo
-- apunta a su versión y no cambia de ingredientes.
CREATE TABLE receta_version (
    id            INTEGER PRIMARY KEY,
    receta_id     INTEGER NOT NULL REFERENCES receta (id) ON DELETE CASCADE,
    numero        INTEGER NOT NULL CHECK (numero > 0),
    porciones     INTEGER NOT NULL DEFAULT 1 CHECK (porciones > 0),
    instrucciones TEXT,
    creado_en     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (receta_id, numero)
) STRICT;

-- Tabla puente (1FN): nada de ingrediente_1, cantidad_1…
-- cantidad en la unidad que dice la receta; la magnitud debe ser la del
-- producto (trigger). Conversión: cantidad × unidad.factor_a_base.
CREATE TABLE receta_ingrediente (
    receta_version_id INTEGER NOT NULL REFERENCES receta_version (id) ON DELETE CASCADE,
    producto_id       INTEGER NOT NULL REFERENCES producto (id)       ON DELETE RESTRICT,
    cantidad          REAL    NOT NULL CHECK (cantidad > 0),
    unidad_id         INTEGER NOT NULL REFERENCES unidad (id)         ON DELETE RESTRICT,
    opcional          INTEGER NOT NULL DEFAULT 0 CHECK (opcional IN (0, 1)),
    PRIMARY KEY (receta_version_id, producto_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX ix_receta_ingrediente_producto ON receta_ingrediente (producto_id);

-- Qué se va a cocinar qué día (fase 2, declarado). Apunta a la versión.
CREATE TABLE plan_comida (
    id                INTEGER PRIMARY KEY,
    fecha             TEXT    NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    receta_version_id INTEGER NOT NULL REFERENCES receta_version (id) ON DELETE RESTRICT,
    porciones         INTEGER NOT NULL DEFAULT 1 CHECK (porciones > 0),
    nota              TEXT
) STRICT;

CREATE INDEX ix_plan_comida_fecha ON plan_comida (fecha);

-- ---------------------------------------------------------------------
-- Reglas que un CHECK no alcanza (cruzan tablas): triggers
-- ---------------------------------------------------------------------

-- La unidad base de un producto es una unidad base (factor 1).
CREATE TRIGGER tg_producto_unidad_base_ins BEFORE INSERT ON producto
BEGIN
    SELECT RAISE(ABORT, 'producto.unidad_base_id debe ser una unidad base (factor_a_base = 1)')
    WHERE (SELECT factor_a_base FROM unidad WHERE id = NEW.unidad_base_id) <> 1;
END;

CREATE TRIGGER tg_producto_unidad_base_upd BEFORE UPDATE OF unidad_base_id ON producto
BEGIN
    SELECT RAISE(ABORT, 'producto.unidad_base_id debe ser una unidad base (factor_a_base = 1)')
    WHERE (SELECT factor_a_base FROM unidad WHERE id = NEW.unidad_base_id) <> 1;
END;

-- La presentación se declara en una unidad de la misma magnitud que la
-- base del producto (leche en ml o l, nunca en g), y su parte es del
-- mismo producto.
CREATE TRIGGER tg_presentacion_coherente_ins BEFORE INSERT ON presentacion
BEGIN
    SELECT RAISE(ABORT, 'presentacion.unidad_id no es de la magnitud del producto')
    WHERE NEW.unidad_id IS NOT NULL
      AND (SELECT magnitud FROM unidad WHERE id = NEW.unidad_id)
       <> (SELECT u.magnitud FROM producto p JOIN unidad u ON u.id = p.unidad_base_id WHERE p.id = NEW.producto_id);
    SELECT RAISE(ABORT, 'presentacion.parte_id debe ser una presentacion del mismo producto')
    WHERE NEW.parte_id IS NOT NULL
      AND (SELECT producto_id FROM presentacion WHERE id = NEW.parte_id) <> NEW.producto_id;
END;

CREATE TRIGGER tg_presentacion_coherente_upd BEFORE UPDATE OF producto_id, unidad_id, parte_id ON presentacion
BEGIN
    SELECT RAISE(ABORT, 'presentacion.unidad_id no es de la magnitud del producto')
    WHERE NEW.unidad_id IS NOT NULL
      AND (SELECT magnitud FROM unidad WHERE id = NEW.unidad_id)
       <> (SELECT u.magnitud FROM producto p JOIN unidad u ON u.id = p.unidad_base_id WHERE p.id = NEW.producto_id);
    SELECT RAISE(ABORT, 'presentacion.parte_id debe ser una presentacion del mismo producto')
    WHERE NEW.parte_id IS NOT NULL
      AND (SELECT producto_id FROM presentacion WHERE id = NEW.parte_id) <> NEW.producto_id;
END;

-- El ingrediente de una receta se mide en la magnitud del producto.
CREATE TRIGGER tg_receta_ingrediente_unidad_ins BEFORE INSERT ON receta_ingrediente
BEGIN
    SELECT RAISE(ABORT, 'receta_ingrediente.unidad_id no es de la magnitud del producto')
    WHERE (SELECT magnitud FROM unidad WHERE id = NEW.unidad_id)
       <> (SELECT u.magnitud FROM producto p JOIN unidad u ON u.id = p.unidad_base_id WHERE p.id = NEW.producto_id);
END;

CREATE TRIGGER tg_receta_ingrediente_unidad_upd BEFORE UPDATE OF producto_id, unidad_id ON receta_ingrediente
BEGIN
    SELECT RAISE(ABORT, 'receta_ingrediente.unidad_id no es de la magnitud del producto')
    WHERE (SELECT magnitud FROM unidad WHERE id = NEW.unidad_id)
       <> (SELECT u.magnitud FROM producto p JOIN unidad u ON u.id = p.unidad_base_id WHERE p.id = NEW.producto_id);
END;

-- El hijo de un pack es del mismo producto que el pack.
CREATE TRIGGER tg_elemento_padre_mismo_producto_ins BEFORE INSERT ON elemento
BEGIN
    SELECT RAISE(ABORT, 'elemento.padre_id debe ser un elemento del mismo producto')
    WHERE NEW.padre_id IS NOT NULL
      AND (SELECT pr.producto_id FROM elemento e JOIN presentacion pr ON pr.id = e.presentacion_id WHERE e.id = NEW.padre_id)
       <> (SELECT producto_id FROM presentacion WHERE id = NEW.presentacion_id);
END;

-- ---------------------------------------------------------------------
-- Vistas: lo derivado se calcula, no se guarda
-- ---------------------------------------------------------------------

-- Contenido nominal de cada presentación en la unidad base del producto,
-- resolviendo el empaque anidado (pack de 12 × bolsa 1 L = 12000 ml).
-- NULL para granel.
CREATE VIEW v_presentacion_base AS
WITH RECURSIVE arbol (id, producto_id, nombre, contenido_base, nivel) AS (
    SELECT p.id, p.producto_id, p.nombre, p.contenido * u.factor_a_base, 0
    FROM presentacion p
    LEFT JOIN unidad u ON u.id = p.unidad_id
    WHERE p.parte_id IS NULL
    UNION ALL
    SELECT p.id, p.producto_id, p.nombre, a.contenido_base * p.partes, a.nivel + 1
    FROM presentacion p
    JOIN arbol a ON a.id = p.parte_id
)
SELECT id, producto_id, nombre, contenido_base, nivel FROM arbol;

-- El elemento con su saldo y su producto: lo que miran el dashboard, la
-- vista 3D y el motor de recetas.
CREATE VIEW v_elemento AS
SELECT e.id,
       e.compra_id,
       c.fecha                                   AS fecha_compra,
       pr.producto_id,
       p.nombre                                  AS producto,
       p.categoria_id,
       e.presentacion_id,
       pr.nombre                                 AS presentacion,
       e.ubicacion_id,
       p.unidad_base_id,
       e.cantidad_inicial,
       e.cantidad_inicial - COALESCE(m.salida, 0) AS saldo,
       e.vencimiento,
       e.vencimiento_origen,
       CASE WHEN e.vencimiento IS NULL THEN NULL
            ELSE CAST(julianday(e.vencimiento) - julianday(date('now')) AS INTEGER) END AS dias_para_vencer,
       e.madurez,
       e.abierto_en,
       e.padre_id,
       e.etiqueta
FROM elemento e
JOIN presentacion pr ON pr.id = e.presentacion_id
JOIN producto p      ON p.id  = pr.producto_id
JOIN compra c        ON c.id  = e.compra_id
LEFT JOIN (SELECT elemento_id, SUM(cantidad) AS salida FROM movimiento GROUP BY elemento_id) m
       ON m.elemento_id = e.id;
