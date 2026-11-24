# Nevera

Catálogo de despensa para una casa: qué hay, dónde está, cuándo se vence y qué se puede cocinar con lo que está a
punto de perderse. FastAPI + SQLite en el servidor, una escena 3D en el navegador y un servidor MCP para que un
agente lo consulte y lo actualice.

Nació como pieza de ARIA, el sistema personal de su autor, y se publica como ejemplo de servicio pequeño, medido y
probado de punta a punta.

## Qué resuelve

- **Inventario por ubicación**: nevera, despensa, congelador y frutero, con la cantidad real y su unidad base
  (gramos, mililitros, unidades) aunque se compre por presentaciones distintas.
- **Vencimientos con aviso**: cada cosa guarda su fecha; el resumen dice qué vence hoy, en dos días y en siete, y
  cuánto valor está en riesgo.
- **Recetas que rescatan**: platos que usan primero lo que se vence, con sus sustituciones, y que descuentan el
  inventario al cocinar.
- **Compras y mermas**: alta rápida de la compra y registro de lo que se botó, para saber qué se compra de más.
- **Miembros con rol**: `admin` (todo), `editor` (altas y movimientos), `lector` (solo mirar). Cada miembro usa su
  propio token; en la base solo queda su hash con sal.

## Cómo está hecho

- **`app/`** — API FastAPI con el contrato en `api/openapi.yaml`, autenticación por token de miembro y roles.
- **`db/`** — esquema SQLite versionado con `PRAGMA user_version`: el servicio se niega a arrancar con una base de
  otra versión en vez de corromperla. Borrado lógico, unicidad de producto y trazabilidad de cambios.
- **`app/mcp_servidor.py`** — servidor MCP en el mismo proceso y el mismo puerto, en `/mcp`, con nueve herramientas:
  seis de lectura y tres de escritura que exigen `confirmar: true`.
- **`web/`** — front con React y una escena 3D propia sobre three.js: el mueble esquemático, los productos con forma
  por familia y la urgencia en el aro. Se compila a `web/dist`, que el propio backend sirve.
- **`tests/`** — más de cien pruebas: contrato, esquema, autenticación, recetas, MCP y formas de la escena.

## Arrancarlo

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
.venv/bin/python -I scripts/crear_base.py     # base vacía, sin datos de ejemplo
NEVERA_ADMIN_TOKEN="$(openssl rand -hex 24)" scripts/arrancar.sh
```

El servicio escucha en `127.0.0.1:8451` y sirve la interfaz en la raíz. El token de administrador **solo se usa la
primera vez**, cuando la base no tiene ningún miembro; después los demás se crean por `POST /miembros` con su rol.

Para tocar la escena:

```bash
npm --prefix web install && npm --prefix web run build
```

## La API y el MCP

El contrato completo está en `api/openapi.yaml`; los endpoints principales son `/productos`, `/items`, `/compras`,
`/vencimientos?dias=`, `/recetas/sugeridas` y `/indicadores`. Todo va con `Authorization: Bearer <token de miembro>`.

El MCP vive en `/mcp` con transporte HTTP y las mismas credenciales, y **el rol manda**: un `lector` no puede
escribir aunque conozca la ruta.

## Estado

Servicio en uso diario, catálogo en esquema 2 y nueve herramientas MCP. Lo que sigue: fotos opcionales de los
productos y un importador de tickets.

## Licencia

Apache-2.0.
