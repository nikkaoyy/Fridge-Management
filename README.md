# Catálogo de nevera

Backend del catálogo de la nevera de la casa: qué hay, qué vence, qué se botó y quién lo hizo. FastAPI + SQLite, sin
ORM. El modelo está en `docs/modelo-relacional.md`, el DDL en `db/esquema.sql`, el contrato en `api/openapi.yaml` y el
plan en `docs/plan.md`. Fase 1 del plan (`PEDIDO-NEVERA-2.md`), su primera pantalla (`PEDIDO-NEVERA-3.md`) el tablero en React con la piel de ARIA (`PEDIDO-NEVERA-4.md`) y las recetas con su pestaña (`PEDIDO-NEVERA-5.md`).
Dónde está todo hoy: `docs/ESTADO.md`.

## Requisitos

Python 3.12 o más nuevo (la máquina tiene 3.14). No hace falta el cliente `sqlite3`: todo va por el módulo de Python.

```
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

`.venv/` y `data/` están en `.gitignore`: el repositorio nunca lleva una base ni una foto.

## Crear la base

No hace falta hacerlo a mano: el servicio crea `data/nevera.db` si no existe. Para crearla aparte (o en otra ruta):

```
.venv/bin/python -I scripts/crear_base.py                 # data/nevera.db
.venv/bin/python -I scripts/crear_base.py /tmp/otra.db    # cualquier ruta
```

Aplica `db/esquema.sql` (20 tablas, 2 vistas, 8 triggers, `PRAGMA user_version = 2`) y `db/referencia.sql` (6 unidades
y 6 ubicaciones; es catálogo de referencia, no datos de ejemplo). Nunca sobrescribe una base existente. La base queda
con 0 productos y 0 miembros.

**Esquema ampliado, no migrado.** NEVERA-2 añadió `miembro`, `producto_foto` y las columnas de atribución
(`compra.registrada_por`, `elemento.alta_por`, `movimiento.miembro_id`) directamente en `db/esquema.sql` y subió la
versión a 2, porque no existía ninguna base con la versión 1 que migrar. No hay carpeta `db/migraciones/`. El servicio
se niega a abrir una base cuya versión no sea la 2 y lo dice. El primer cambio de esquema con una base viva sí irá como
migración numerada.

## Arrancar

El servicio escucha en `0.0.0.0:8451` (8445-8450 son de otros servicios; 8450 es PYTHAGORAS).

```
NEVERA_ADMIN_TOKEN='…' TZ=America/Bogota .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8451
```

- **Primer arranque, sin miembros**: el servicio crea **un** miembro `admin` con el token de `NEVERA_ADMIN_TOKEN` (se
  guarda solo su hash con sal). Si la variable falta, no arranca y lo dice. Los demás miembros de la familia se crean
  con `POST /miembros`; el token de cada uno se devuelve una sola vez.
- **Arranques siguientes**: `NEVERA_ADMIN_TOKEN` ya no se usa (si viene, se ignora y el log lo dice sin mostrarlo).
- `TZ=America/Bogota`: «hoy» (vencimientos, compra del día) es el día de Bogotá, no el de UTC.
- `NEVERA_DATOS`: directorio de datos (base, fotos). Por defecto `data/` dentro del repositorio.

En segundo plano, con log a archivo (lo normal):

```
NEVERA_ADMIN_TOKEN="$(cat data/admin.token)" scripts/arrancar.sh   # primer arranque
scripts/arrancar.sh                                                 # los siguientes
scripts/parar.sh
```

`arrancar.sh` comprueba antes que el puerto esté libre (y se niega a usar 8445-8450), deja el log en
`data/servicio.log` y el PID en `data/servicio.pid`, y espera a que `/salud` responda. `NEVERA_HOST` y `NEVERA_PUERTO`
lo cambian (p. ej. `NEVERA_HOST=127.0.0.1` detrás de un proxy con TLS). El token del primer admin de la base real se
guardó en `data/admin.token` (0600, fuera de git).

**Sin TLS la autenticación va en claro**: el servicio es para la red de la casa. Cómo se publicaría y qué falta, en
`docs/informe-nevera-2.md`.

## Pantalla

`http://<máquina>:8451/` es el tablero: React 19 + Vite 8 + TypeScript en `web/`, construido a `web/dist` y servido
por el **mismo** FastAPI (`app/pantalla.py`: `/`, `/assets/*`, `/fonts/*`, `/favicon.svg`). Una sola cosa que arrancar:
`scripts/arrancar.sh` no cambia. Requiere Node ≥ 22 solo para construir.

```
cd web && npm ci && npm run build      # deja web/dist; el servicio lo sirve sin reiniciar
```

Sin `web/dist` (repositorio recién clonado), `/` responde `503` con un HTML que dice cómo construirlo. `web/dist` y
`web/node_modules` están en `.gitignore`.

- **Piel de ARIA**: los tokens se copian tal cual de `/opt/data/pythagoras/web/src/styles/tokens.css` en un
  `<style id="piel-aria">` del `<head>` (`tests/test_pantalla.py` lo coteja byte a byte); un solo color propio,
  `--danger: #ef5f7a`. Inter, Space Grotesk y JetBrains Mono autohospedadas en `web/public/fonts`. `app.css` no
  escribe ningún color: solo `var(--…)` y `color-mix()` sobre ellas.
- **Token**: igual que en NEVERA-3 (misma clave de `localStorage`); `GET /miembros/yo` antes de cualquier dato.
- Solo endpoints del contrato; ni `/` ni los estáticos llevan datos ni están en `api/openapi.yaml`. CSP `'self'` sin
  scripts en línea; los `<style>` del `index.html` se permiten por su hash, calculado sobre el archivo servido.
- Detalle y decisiones: `INFORME-NEVERA-4.md`.

Verificación en navegador (Chrome headless de la máquina, por DevTools Protocol, con Node; nada que instalar):

```
node scripts/humo_pantalla.mjs http://127.0.0.1:8451 data/admin.token docs   # base real, SOLO LEE; capturas
.venv/bin/python -I scripts/medir_png.py docs/dashboard-4.png docs/movil-4.png  # medir antes de creer
```

`scripts/garantias_pantalla.mjs` (token, lector, revocado, cifras contra la API, acciones, alta con foto) **crea
filas** y solo corre contra una base en `/tmp`:

```
mkdir /tmp/nevera-garantias && export NEVERA_DATOS=/tmp/nevera-garantias NEVERA_HOST=127.0.0.1 NEVERA_PUERTO=8452 \
  NEVERA_ADMIN_TOKEN="$(openssl rand -hex 24)"
scripts/arrancar.sh && node scripts/garantias_pantalla.mjs http://127.0.0.1:8452; scripts/parar.sh
rm -rf /tmp/nevera-garantias
```

Ojo: `parar.sh`/`arrancar.sh` leen `NEVERA_DATOS` y `NEVERA_PUERTO` del entorno; sin ellos actúan sobre el servicio
real del 8451. Exportarlos en el mismo shell que los llama.

## Humo

`scripts/humo.sh` prueba con `curl` el servicio vivo (salud, alta de producto y de pack, movimientos, vencimientos,
403 de lector). **Crea filas**: correrlo contra una base desechable, nunca contra `data/`:

```
mkdir /tmp/nevera-humo && export NEVERA_DATOS=/tmp/nevera-humo NEVERA_ADMIN_TOKEN="$(openssl rand -hex 24)"
scripts/arrancar.sh && scripts/humo.sh; scripts/parar.sh
```

Recetas (`PEDIDO-NEVERA-5.md`): `scripts/humo_recetas.sh` (crear, versión 2, unidad fuera del catálogo, sugeridas,
cocinar con 409 sin saldo y cocinar de verdad) y `scripts/recetas_pantalla.mjs` (la pestaña en Chrome). El humo y el
modo `--escribe` **crean filas**: van contra una copia de la base en `/tmp` y se niegan a correr en el 8451. Sin
`--escribe`, la pantalla solo lee y vale para la base real (comprueba al final que la base quedó igual):

```
node scripts/recetas_pantalla.mjs http://127.0.0.1:8451 data/admin.token docs/recetas-5.png   # base real, solo lee
# contra la copia (127.0.0.1:8452, NEVERA_DATOS en /tmp, exportado en el mismo shell que arrancar/parar):
NEVERA_ADMIN_TOKEN="$(cat data/admin.token)" scripts/humo_recetas.sh http://127.0.0.1:8452
node scripts/recetas_pantalla.mjs http://127.0.0.1:8452 data/admin.token /tmp/recetas-copia.png --escribe
```

## Pruebas

```
.venv/bin/python -m pytest -q
```

Cada prueba crea su propia base en un directorio temporal (`tmp_path`) y su app; nada toca `data/`. Todas las
respuestas se validan contra `api/openapi.yaml` (código declarado y cuerpo sin campos de más ni de menos). Cubren auth
y roles (y que el token no sale en logs), D1, D3, D4, D5, vencimientos, atribución, el importador todo-o-nada,
`scripts/verificacion.py` (anomalías del modelo sobre el esquema versión 2) y las recetas (`tests/test_recetas.py`:
la versión nueva no toca la anterior, sugeridas por urgencia, cocinar descuenta en una transacción y sin saldo es
409 sin escribir).
