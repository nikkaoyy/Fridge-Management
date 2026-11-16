# Informe de PEDIDO-NEVERA-2 — fase 1: backend del catálogo con la familia dentro

Cierre: 2026-11-15, hora de Bogotá (2026-11-16 UTC). Un commit por bloque sobre `main`.

## Resumen en cinco líneas

1. **Pruebas**: `pytest`, **39 de 39 en verde** (auth y roles, D1, D3, D4, D5, vencimientos, atribución, importador
   todo-o-nada, y `scripts/verificacion.py` sobre el esquema v2), con una base temporal por prueba.
2. **Humo** con `curl` contra el servicio vivo en `0.0.0.0:8451` (no TestClient): `HUMO OK`, transcripción abajo.
3. **Admin**: la base real `data/nevera.db` nació sin miembros; al arrancar, el servicio creó **un** miembro `admin`
   desde `NEVERA_ADMIN_TOKEN` y guardó solo el sha256 con sal. El token se generó con `openssl rand -hex 32` y está en
   `data/admin.token` (0600, en `.gitignore`, no se imprimió). No hay ningún otro miembro, producto ni precio.
4. **Esquema ampliado, no migrado**: `db/esquema.sql` versión 2 (no existía ninguna base v1 que migrar); no hay
   `db/migraciones/`.
5. **Fase 2**: el front del dashboard (abajo, «Lo que falta»).

## Estado del servicio

- `scripts/arrancar.sh`: comprueba que el puerto esté libre (bind de prueba; esta máquina no tiene `ss` ni
  `netstat`), se niega a usar 8445-8450, arranca `uvicorn` en segundo plano con `setsid nohup`, deja el log en
  `data/servicio.log` y el PID en `data/servicio.pid`, y espera a que `/salud` responda. `scripts/parar.sh` lo detiene.
- Sin `NEVERA_ADMIN_TOKEN` y sin miembros **no arranca**, y lo dice:
  `NO ARRANCA: no hay ningún miembro y falta NEVERA_ADMIN_TOKEN: defínela con el token del primer admin y vuelve a arrancar`.
- Puertos vistos al arrancar: 8445, 8448 y 8450 (PYTHAGORAS) ocupados por sus servicios y sin tocar; 8451 libre.
- Base real después del arranque: 1 miembro (`admin`), 0 productos, 0 elementos. El token del admin aparece 0 veces
  en el log.

## Humo contra el 8451 vivo

Se corrió con `scripts/humo.sh` contra el servicio en 8451 apuntando a una base **desechable**
(`NEVERA_DATOS=/tmp/nevera-humo-2`, borrada después), para que la base real no se quede con datos del humo. Luego se
paró y se arrancó el servicio definitivo sobre `data/`. Los tokens salen tapados (`***`); el cuerpo de cada
respuesta se corta en 400 caracteres.

```
$ curl -X GET http://127.0.0.1:8451/salud
→ 200 {"ok": true, "version": "0.2.0", "esquema": 2, "base": "/tmp/nevera-humo-2/nevera.db"}

$ curl -X GET http://127.0.0.1:8451/elementos
→ 401 {"error": {"codigo": "no_autenticado", "mensaje": "falta la cabecera Authorization: Bearer <token>"}}

$ curl -X GET http://127.0.0.1:8451/ubicaciones -H 'Authorization: Bearer ***'
→ 200 [{"id": 1, "nombre": "nevera", "padre_id": null}, {"id": 2, "nombre": "congelador", "padre_id": null}, {"id": 3, "nombre": "despensa", "padre_id": null}, {"id": 4, "nombre": "frutero", "padre_id": null}, {"id": 5, "nombre": "puerta de la nevera", "padre_id": 1}, {"id": 6, "nombre": "cajón de verduras", "padre_id": 1}]

$ curl -X POST http://127.0.0.1:8451/categorias -H 'Authorization: Bearer ***' -d '{"nombre":"lácteos"}'
→ 201 {"id": 1, "nombre": "lácteos"}

$ curl -X POST http://127.0.0.1:8451/productos -H 'Authorization: Bearer ***' -d '{"nombre":"leche","categoria_id":1,"unidad_base":"ml","vida_util":{"dias_base":7,"dias_abierto":3,"fuente":"etiqueta"}}'
→ 201 {"id": 1, "nombre": "leche", "categoria_id": 1, "categoria": "lácteos", "unidad_base": "ml", "perecedero": true, "activo": true, "nota": null, "vida_util": {"dias_base": 7, "dias_abierto": 3, "fuente": "etiqueta", "nota": null, "registrado_en": "2026-11-15"}, "creado_en": "2026-11-16T01:18:58Z"}

$ curl -X POST http://127.0.0.1:8451/presentaciones -H 'Authorization: Bearer ***' -d '{"producto_id":1,"nombre":"bolsa 1 L","contenido":1,"unidad":"l"}'
→ 201 {"id": 1, "producto_id": 1, "nombre": "bolsa 1 L", "contenido": 1.0, "unidad": "l", "parte_id": null, "partes": null, "contenido_base": 1000.0, "codigo_barras": null, "activo": true}

$ curl -X POST http://127.0.0.1:8451/presentaciones -H 'Authorization: Bearer ***' -d '{"producto_id":1,"nombre":"pack 6 bolsas","parte_id":1,"partes":6}'
→ 201 {"id": 2, "producto_id": 1, "nombre": "pack 6 bolsas", "contenido": null, "unidad": null, "parte_id": 1, "partes": 6, "contenido_base": 6000.0, "codigo_barras": null, "activo": true}

$ curl -X POST http://127.0.0.1:8451/elementos -H 'Authorization: Bearer ***' -d '{"presentacion_id":2,"ubicacion_id":1,"precio_unitario_cop":27000}'
→ 201 [{"id": 1, "compra_id": 1, "fecha_compra": "2026-11-15", "producto_id": 1, "producto": "leche", "categoria_id": 1, "presentacion_id": 2, "presentacion": "pack 6 bolsas", "ubicacion_id": 1, "unidad_base": "ml", "cantidad_inicial": 6000.0, "saldo": 6000.0, "vencimiento": "2026-11-22", "vencimiento_origen": "estimado", "dias_para_vencer": 7, "madurez": null, "abierto_en": null, "padre_id": null, "eti

(pack: padre 1 con 6 hijos)

$ curl -X PATCH http://127.0.0.1:8451/elementos/2 -H 'Authorization: Bearer ***' -d '{"abierto_en":"2026-11-15"}'
→ 200 {"id": 2, "compra_id": 1, "fecha_compra": "2026-11-15", "producto_id": 1, "producto": "leche", "categoria_id": 1, "presentacion_id": 1, "presentacion": "bolsa 1 L", "ubicacion_id": 1, "unidad_base": "ml", "cantidad_inicial": 1000.0, "saldo": 1000.0, "vencimiento": "2026-11-18", "vencimiento_origen": "estimado", "dias_para_vencer": 3, "madurez": null, "abierto_en": "2026-11-15", "padre_id": 1, "eti

$ curl -X POST http://127.0.0.1:8451/movimientos -H 'Authorization: Bearer ***' -d '{"elemento_id":2,"tipo":"consumo","cantidad":250}'
→ 201 {"id": 1, "elemento_id": 2, "fecha": "2026-11-15", "tipo": "consumo", "cantidad": 250.0, "motivo": null, "saldo": 750.0, "creado_en": "2026-11-16T01:18:58Z", "miembro_id": 1, "miembro": "admin"}

$ curl -X POST http://127.0.0.1:8451/movimientos -H 'Authorization: Bearer ***' -d '{"elemento_id":3,"tipo":"consumo"}'
→ 201 {"id": 2, "elemento_id": 3, "fecha": "2026-11-15", "tipo": "consumo", "cantidad": 1000.0, "motivo": null, "saldo": 0.0, "creado_en": "2026-11-16T01:18:58Z", "miembro_id": 1, "miembro": "admin"}

$ curl -X POST http://127.0.0.1:8451/movimientos -H 'Authorization: Bearer ***' -d '{"elemento_id":1,"tipo":"consumo"}'
→ 409 {"error": {"codigo": "es_pack", "mensaje": "el elemento 1 es un pack con hijos: los movimientos van en sus hojas (GET /elementos/{id} da sus hijos)"}}

$ curl -X GET http://127.0.0.1:8451/elementos?producto_id=1 -H 'Authorization: Bearer ***'
→ 200 [{"id": 2, "compra_id": 1, "fecha_compra": "2026-11-15", "producto_id": 1, "producto": "leche", "categoria_id": 1, "presentacion_id": 1, "presentacion": "bolsa 1 L", "ubicacion_id": 1, "unidad_base": "ml", "cantidad_inicial": 1000.0, "saldo": 750.0, "vencimiento": "2026-11-18", "vencimiento_origen": "estimado", "dias_para_vencer": 3, "madurez": null, "abierto_en": "2026-11-15", "padre_id": 1, "eti

(leche disponible: 5 bolsas, 4750.0 ml)

$ curl -X GET http://127.0.0.1:8451/elementos?por_vencer=7 -H 'Authorization: Bearer ***'
→ 200 [{"id": 2, "compra_id": 1, "fecha_compra": "2026-11-15", "producto_id": 1, "producto": "leche", "categoria_id": 1, "presentacion_id": 1, "presentacion": "bolsa 1 L", "ubicacion_id": 1, "unidad_base": "ml", "cantidad_inicial": 1000.0, "saldo": 750.0, "vencimiento": "2026-11-18", "vencimiento_origen": "estimado", "dias_para_vencer": 3, "madurez": null, "abierto_en": "2026-11-15", "padre_id": 1, "eti

(por vencer en 7 días: 5 elementos; [(2, '2026-11-18'), (4, '2026-11-22')] …)

$ curl -X POST http://127.0.0.1:8451/miembros -H 'Authorization: Bearer ***' -d '{"nombre":"lector de humo","rol":"lector"}'
→ 201 {"id": 2, "nombre": "lector de humo", "rol": "lector", "activo": true, "creado_en": "2026-11-16T01:18:59Z", "token": "***"}

$ curl -X GET http://127.0.0.1:8451/indicadores -H 'Authorization: Bearer ***'
→ 200 {"productos": 1, "elementos_disponibles": 5, "vencidos": 0, "por_vencer_7": 5, "sin_vencimiento": 0, "mermas_30_dias": 0}

$ curl -X POST http://127.0.0.1:8451/movimientos -H 'Authorization: Bearer ***' -d '{"elemento_id":2,"tipo":"consumo"}'
→ 403 {"error": {"codigo": "prohibido", "mensaje": "el rol «lector» no puede hacer POST /movimientos; hace falta «editor»"}}

HUMO OK
```

Lo que demuestra: `/salud` 200 y 401 sin token; alta de producto con vida útil; alta de un pack de 6 → padre + 6
hijos (D3); abrir una bolsa mueve su vencimiento a hoy + `dias_abierto` (3) mientras las otras siguen a 7; dos
movimientos, uno con cantidad (250 ml, saldo 750) y otro sin cantidad (D4, saldo 0); un movimiento sobre el padre da
409 `es_pack`; la leche disponible son 5 bolsas y 4750 ml (el padre no suma, la agotada no sale);
`por_vencer=7` da esas 5 hojas; un lector lee (`/indicadores` 200) y no escribe (`POST /movimientos` 403 con la forma
de error del contrato). En el log del servicio, 0 apariciones del token y ninguna cabecera `Authorization`.

## Pruebas

```
.venv/bin/python -m pytest -q
39 passed, 1 warning in 8.79s
```

(El único aviso es de Starlette sobre `httpx` en el TestClient; no afecta a nada.)

Las dos pruebas rojas del intento anterior eran de la prueba, no del código:

- `test_simular_no_escribe` esperaba `filas: 4` con un CSV de 4 filas con datos y una línea en blanco en medio. El
  importador cuenta 5, y es lo coherente con el contrato: `omitidos` las llama «filas vacías» y las reporta con su
  número de línea. Se corrigió la prueba (y se endureció: `omitidos` tiene que ser exactamente
  `[{"fila": 5, "motivo": "fila vacía"}]`) y el contrato ahora lo dice en la descripción de `filas`.
- `test_errores_variados_dan_su_fila` buscaba «futuro» en «fecha_compra 2026-11-19 es futura». Se corrigió la
  palabra.

Se añadió `tests/test_verificacion.py`, que faltaba para el punto 6 del bloque 3: corre `scripts/verificacion.py`
y exige `VERIFICACIÓN OK` y ningún `FALLA`.

## Publicación: cómo se haría y qué falta (no se hizo)

Hoy el servicio escucha en `0.0.0.0:8451`, así que se llega desde la red local de la máquina (`172.16.2.4:8451`), y
**la autenticación va en claro**: el token Bearer viaja sin cifrar. No se abrió ningún túnel ni se expuso a internet.

Para que entren la familia y sus teléfonos fuera de casa falta:

1. **TLS**. Sin TLS, cualquiera en la misma red puede leer los tokens. Hay dos caminos, y **los decide Nico**:
   - **Tailnet** (Tailscale o similar): cada dispositivo de la familia entra a la red privada y llega a
     `https://<máquina>.<tailnet>:…` con certificado de la tailnet (`tailscale serve` hace de proxy TLS hacia
     `127.0.0.1:8451`). No queda nada abierto a internet. Cada teléfono necesita la app de la tailnet.
   - **Proxy del host** (Caddy o nginx con Let's Encrypt) en un dominio, hacia `127.0.0.1:8451`. Cualquier navegador
     entra sin instalar nada, pero el servicio queda en internet: harían falta además límite de intentos en el 401 y
     revisar los logs del proxy (que no registren la cabecera `Authorization`).
2. En los dos casos, cuando haya proxy, el servicio debería escuchar en `127.0.0.1:8451` y no en `0.0.0.0`
   (`NEVERA_HOST=127.0.0.1 scripts/arrancar.sh`), para que no se pueda saltar el TLS.
3. Que arranque solo al reiniciar la máquina (unidad de systemd o el supervisor del host). Hoy hay que lanzar
   `scripts/arrancar.sh` a mano.
4. Copias de seguridad de `data/nevera.db` y `data/fotos/`.

## Lo que falta para la fase 2 (F2 de `docs/plan.md`)

- **El front del dashboard** (React + Vite + TypeScript): el resumen de `GET /vencimientos`, la lista de
  `GET /elementos?por_vencer=N`, el alta rápida y la merma en dos toques, servido por FastAPI en producción desde
  el mismo 8451.
- Cambia una cosa respecto al plan, que dejaba fuera «cuentas de usuario»: ahora toda llamada salvo `/salud` exige
  token, así que el front necesita **una pantalla para pegar el token del miembro** y guardarlo en el dispositivo, y
  tiene que tratar 401 (pedirlo otra vez) y 403 (esconder lo que un lector no puede hacer, con `GET /miembros/yo`).
- Si el dashboard se va a usar fuera de la red de la casa, la decisión de publicación de arriba va antes que el front.
- Siguen en 501 los 11 endpoints de la fase 2 del contrato (proveedores, precios, recetas, planes), para F3.
