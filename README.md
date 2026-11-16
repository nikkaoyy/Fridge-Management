# Catálogo de nevera

Backend del catálogo de la nevera de la casa: qué hay, qué vence, qué se botó y quién lo hizo. FastAPI + SQLite, sin
ORM. El modelo está en `docs/modelo-relacional.md`, el DDL en `db/esquema.sql`, el contrato en `api/openapi.yaml` y el
plan en `docs/plan.md`. Fase 1 del plan (`PEDIDO-NEVERA-2.md`) y su primera pantalla (`PEDIDO-NEVERA-3.md`).
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

`http://<máquina>:8451/` es una página para el móvil servida por el mismo FastAPI: `GET /` devuelve
`app/estatico/index.html` y `/estatico/*` sirve `app.js` y `app.css`, escritos a mano (sin build, sin dependencias).
Pide el token del miembro, lo valida con `GET /miembros/yo` y lo guarda solo en ese dispositivo. Usa solo endpoints
del contrato; `/` y `/estatico/*` no llevan datos ni están en `api/openapi.yaml`. Detalle en `INFORME-NEVERA-3.md`.

Verificación en navegador (Chrome headless de la máquina, por DevTools Protocol, con Node; nada que instalar):

```
node scripts/humo_pantalla.mjs http://127.0.0.1:8451 data/admin.token docs   # base real: edita y devuelve un vencimiento
.venv/bin/python -I scripts/medir_png.py docs/pantalla-3.png docs/alta-3.png  # medir las capturas antes de creerlas
```

`scripts/garantias_pantalla.mjs` (sin token no hay datos, lector sin botones, token revocado) **crea filas** y solo
corre contra una base en `/tmp`:

```
mkdir /tmp/nevera-garantias && export NEVERA_DATOS=/tmp/nevera-garantias NEVERA_HOST=127.0.0.1 NEVERA_PUERTO=8452 \
  NEVERA_ADMIN_TOKEN="$(openssl rand -hex 24)"
scripts/arrancar.sh && node scripts/garantias_pantalla.mjs http://127.0.0.1:8452; scripts/parar.sh
rm -rf /tmp/nevera-garantias
```

## Humo

`scripts/humo.sh` prueba con `curl` el servicio vivo (salud, alta de producto y de pack, movimientos, vencimientos,
403 de lector). **Crea filas**: correrlo contra una base desechable, nunca contra `data/`:

```
mkdir /tmp/nevera-humo && export NEVERA_DATOS=/tmp/nevera-humo NEVERA_ADMIN_TOKEN="$(openssl rand -hex 24)"
scripts/arrancar.sh && scripts/humo.sh; scripts/parar.sh
```

## Pruebas

```
.venv/bin/python -m pytest -q
```

Cada prueba crea su propia base en un directorio temporal (`tmp_path`) y su app; nada toca `data/`. Todas las
respuestas se validan contra `api/openapi.yaml` (código declarado y cuerpo sin campos de más ni de menos). Cubren auth
y roles (y que el token no sale en logs), D1, D3, D4, D5, vencimientos, atribución, el importador todo-o-nada, y
`scripts/verificacion.py` (anomalías del modelo sobre el esquema versión 2).
