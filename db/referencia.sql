-- =====================================================================
-- Catálogo de referencia (NO son datos de ejemplo): unidades de medida y
-- ubicaciones básicas de una casa. Sin esto el esquema no puede recibir
-- un producto (necesita una unidad base). Ni productos, ni precios, ni
-- lotes. Se aplica después de db/esquema.sql.
-- =====================================================================

-- Unidades. La base de cada magnitud lleva factor 1.
INSERT INTO unidad (codigo, nombre, magnitud, factor_a_base) VALUES
    ('g',  'gramo',      'masa',    1),
    ('kg', 'kilogramo',  'masa',    1000),
    ('lb', 'libra',      'masa',    500),        -- libra colombiana de mercado = 500 g
    ('ml', 'mililitro',  'volumen', 1),
    ('l',  'litro',      'volumen', 1000),
    ('u',  'unidad',     'conteo',  1);

-- Ubicaciones. Jerárquicas: lo que está en la puerta está en la nevera.
INSERT INTO ubicacion (nombre, padre_id) VALUES ('nevera', NULL);
INSERT INTO ubicacion (nombre, padre_id) VALUES ('congelador', NULL);
INSERT INTO ubicacion (nombre, padre_id) VALUES ('despensa', NULL);
INSERT INTO ubicacion (nombre, padre_id) VALUES ('frutero', NULL);
INSERT INTO ubicacion (nombre, padre_id) VALUES ('puerta de la nevera',    (SELECT id FROM ubicacion WHERE nombre = 'nevera'));
INSERT INTO ubicacion (nombre, padre_id) VALUES ('cajón de verduras',      (SELECT id FROM ubicacion WHERE nombre = 'nevera'));
