-- =====================================================================
-- Catálogo de nevera · esquema de referencia para SQLite
-- (PEDIDO-NEVERA-0; ampliado en PEDIDO-NEVERA-2: miembros, atribución,
-- fotos y la regla de hojas de D3 en v_elemento)
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
-- · Versión 2 (PRAGMA user_version). Se amplió este archivo en vez de
--   añadir una migración porque no existía ninguna base desplegada con
--   la versión 1; la aplicación se niega a abrir una base de otra versión.
-- · Decisiones firmadas (docs/plan.md §2): D1 unidad física, D2 3D
--   esquemática (nada en el esquema), D3 el pack se explota al registrar
--   y el saldo se cuenta solo en hojas, D4 todo o nada en la interfaz,
--   D5 fotos desde el alta (producto_foto).
-- =====================================================================

PRAGMA foreign_keys = ON;
PRAGMA user_version = 2;

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
-- Miembros del hogar (PEDIDO-NEVERA-2): quién ve, quién edita, quién hizo qué
-- ---------------------------------------------------------------------

-- Una persona o un dispositivo con acceso. Sin filas de ejemplo: el
-- primer admin lo crea la aplicación desde NEVERA_ADMIN_TOKEN.
--  · rol: lector (solo lee), editor (altas, movimientos, fotos),
--    admin (además gestiona miembros y borra).
--  · token_hash: 'sha256$<sal hex>$<sha256(sal || token) hex>', con sal
--    propia por miembro. El token en claro no se guarda nunca.
--  · activo: borrado lógico. Un miembro con historia no se borra: su
--    nombre sigue respondiendo «quién se acabó la leche».
CREATE TABLE miembro (
    id         INTEGER PRIMARY KEY,
    nombre     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    rol        TEXT    NOT NULL CHECK (rol IN ('admin', 'editor', 'lector')),
    token_hash TEXT    NOT NULL UNIQUE CHECK (token_hash GLOB 'sha256$*$*'),
    activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    creado_en  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

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
    nota         TEXT,
    registrada_por INTEGER        REFERENCES miembro (id) ON DELETE RESTRICT -- quién la abrió; NULL solo fuera de la API
) STRICT;

CREATE INDEX ix_compra_fecha ON compra (fecha);
CREATE INDEX ix_compra_registrada_por ON compra (registrada_por);

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
--  · D1: una fila por cosa física. D3: un pack entra como padre y sus
--    partes como hijos (padre_id) en la misma alta; el saldo que cuenta
--    es el de las hojas (v_elemento.es_hoja).
--  · alta_por: el miembro que lo registró.
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
    alta_por           INTEGER          REFERENCES miembro (id) ON DELETE RESTRICT, -- NULL solo fuera de la API
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
CREATE INDEX ix_elemento_alta_por     ON elemento (alta_por);

-- Libro de salidas del elemento: consumo, merma (se botó) o ajuste. En la
-- unidad base del producto. El elemento no se actualiza al consumir.
CREATE TABLE movimiento (
    id          INTEGER PRIMARY KEY,
    elemento_id INTEGER NOT NULL REFERENCES elemento (id) ON DELETE CASCADE,
    fecha       TEXT    NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    tipo        TEXT    NOT NULL CHECK (tipo IN ('consumo', 'merma', 'ajuste')),
    cantidad    REAL    NOT NULL CHECK (cantidad <> 0 AND (tipo = 'ajuste' OR cantidad > 0)), -- ajuste puede ser negativo (apareció más)
    motivo      TEXT,
    miembro_id  INTEGER          REFERENCES miembro (id) ON DELETE RESTRICT, -- quién lo registró; NULL solo fuera de la API
    creado_en   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE INDEX ix_movimiento_elemento ON movimiento (elemento_id);
CREATE INDEX ix_movimiento_fecha    ON movimiento (fecha);
CREATE INDEX ix_movimiento_miembro  ON movimiento (miembro_id);

-- ---------------------------------------------------------------------
-- Fotos del producto (D5): se guardan desde el alta, sin modelo de visión
-- ---------------------------------------------------------------------

-- Una foto tomada en el alta. El archivo vive en disco (directorio de
-- datos de la aplicación); aquí va su ruta relativa a ese directorio.
-- Es material para el reconocimiento de §3 del plan: se guarda el
-- producto (lo que la foto muestra) y, si se sabe, el elemento con el
-- que entró. Borrar el elemento (error de registro) no borra la foto.
CREATE TABLE producto_foto (
    id          INTEGER PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES producto (id) ON DELETE RESTRICT,
    ruta        TEXT    NOT NULL UNIQUE CHECK (ruta NOT LIKE '/%' AND ruta NOT LIKE '%..%'),
    tomada_en   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    elemento_id INTEGER          REFERENCES elemento (id) ON DELETE SET NULL
) STRICT;

CREATE INDEX ix_producto_foto_producto ON producto_foto (producto_id);
CREATE INDEX ix_producto_foto_elemento ON producto_foto (elemento_id);

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

-- La foto de un elemento es foto de su producto.
CREATE TRIGGER tg_producto_foto_coherente_ins BEFORE INSERT ON producto_foto
BEGIN
    SELECT RAISE(ABORT, 'producto_foto.elemento_id debe ser un elemento del mismo producto')
    WHERE NEW.elemento_id IS NOT NULL
      AND (SELECT pr.producto_id FROM elemento e JOIN presentacion pr ON pr.id = e.presentacion_id WHERE e.id = NEW.elemento_id)
       <> NEW.producto_id;
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
--  · D3, el saldo se cuenta solo en hojas. es_hoja = 1 si nadie cuelga
--    del elemento (NOT EXISTS hijo). El saldo de una hoja es
--    cantidad_inicial − Σ movimiento; el de un pack es la suma del saldo de
--    sus hojas: su propia cantidad_inicial no suma nunca. Para CONTAR o
--    SUMAR lo que hay, filtrar es_hoja = 1 (si no, el pack cuenta doble).
--  · vencimiento es el EFECTIVO (docs/modelo-relacional.md §4): en una
--    hoja abierta con vida_util.dias_abierto, min(vencimiento,
--    abierto_en + dias_abierto), y entonces vencimiento_origen =
--    'estimado'. La columna elemento.vencimiento no se toca al abrir, así
--    que «cerrar» (abierto_en = NULL) devuelve la fecha original. Abrir
--    un pack no acorta la vida de sus bolsas cerradas.
--  · «hoy» es date('now', 'localtime'): la aplicación corre con
--    TZ=America/Bogota; con date('now') a secas, de 19:00 a 24:00 en
--    Bogotá el día ya sería mañana (UTC).
CREATE VIEW v_elemento AS
WITH RECURSIVE
salida (elemento_id, total) AS (
    SELECT elemento_id, SUM(cantidad) FROM movimiento GROUP BY elemento_id
),
hoja (id, saldo) AS (
    SELECT e.id, e.cantidad_inicial - COALESCE(s.total, 0)
    FROM elemento e
    LEFT JOIN salida s ON s.elemento_id = e.id
    WHERE NOT EXISTS (SELECT 1 FROM elemento h WHERE h.padre_id = e.id)
),
-- cada hoja aporta su saldo a sí misma y a cada antepasado; la hoja va en
-- la fila para que UNION no confunda dos hojas con el mismo saldo y para
-- que un ciclo de padre_id (que la API no permite) no recurra sin fin.
sube (hoja_id, elemento_id, saldo) AS (
    SELECT id, id, saldo FROM hoja
    UNION
    SELECT s.hoja_id, e.padre_id, s.saldo
    FROM sube s JOIN elemento e ON e.id = s.elemento_id
    WHERE e.padre_id IS NOT NULL
),
saldo (elemento_id, saldo) AS (
    SELECT elemento_id, SUM(saldo) FROM sube GROUP BY elemento_id
),
base AS (
    SELECT e.*,
           CASE WHEN EXISTS (SELECT 1 FROM elemento h WHERE h.padre_id = e.id) THEN 0 ELSE 1 END AS es_hoja,
           pr.producto_id,
           pr.nombre AS presentacion_nombre,
           vu.dias_abierto
    FROM elemento e
    JOIN presentacion pr ON pr.id = e.presentacion_id
    LEFT JOIN vida_util vu ON vu.producto_id = pr.producto_id
),
efectivo AS (
    SELECT b.*,
           CASE WHEN b.es_hoja = 1 AND b.abierto_en IS NOT NULL AND b.dias_abierto IS NOT NULL
                 AND (b.vencimiento IS NULL OR date(b.abierto_en, '+' || b.dias_abierto || ' days') < b.vencimiento)
                THEN 1 ELSE 0 END AS por_apertura
    FROM base b
)
SELECT f.id,
       f.compra_id,
       c.fecha                                   AS fecha_compra,
       f.producto_id,
       p.nombre                                  AS producto,
       p.categoria_id,
       p.perecedero,
       f.presentacion_id,
       f.presentacion_nombre                     AS presentacion,
       f.ubicacion_id,
       p.unidad_base_id,
       u.codigo                                  AS unidad_base,
       f.cantidad_inicial,
       COALESCE(sd.saldo, 0)                     AS saldo,
       f.es_hoja,
       CASE WHEN f.por_apertura = 1 THEN date(f.abierto_en, '+' || f.dias_abierto || ' days')
            ELSE f.vencimiento END               AS vencimiento,
       CASE WHEN f.por_apertura = 1 THEN 'estimado'
            ELSE f.vencimiento_origen END        AS vencimiento_origen,
       CASE WHEN f.por_apertura = 1
            THEN CAST(julianday(date(f.abierto_en, '+' || f.dias_abierto || ' days')) - julianday(date('now', 'localtime')) AS INTEGER)
            WHEN f.vencimiento IS NULL THEN NULL
            ELSE CAST(julianday(f.vencimiento) - julianday(date('now', 'localtime')) AS INTEGER) END AS dias_para_vencer,
       f.madurez,
       f.abierto_en,
       f.padre_id,
       f.etiqueta,
       f.nota,
       cl.precio_unitario_cop,
       f.alta_por,
       f.creado_en
FROM efectivo f
JOIN producto p      ON p.id  = f.producto_id
JOIN unidad u        ON u.id  = p.unidad_base_id
JOIN compra c        ON c.id  = f.compra_id
JOIN compra_linea cl ON cl.compra_id = f.compra_id AND cl.presentacion_id = f.presentacion_id
LEFT JOIN saldo sd   ON sd.elemento_id = f.id;
