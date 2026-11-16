#!/usr/bin/env bash
# Humo de las recetas contra el servicio VIVO (PEDIDO-NEVERA-5, bloque 4): crear receta, crearla otra vez con un
# cambio de ingrediente (versión 2), sugeridas y cocinar (y un 409 sin saldo que no escribe nada).
#
# CREA FILAS (recetas y movimientos): se corre contra una COPIA desechable de la base real en /tmp, nunca contra
# data/. Usa productos que la copia ya tiene (los de la factura importada), por nombre. Se niega a hablar con el 8451.
#
#   NEVERA_ADMIN_TOKEN='…' scripts/humo_recetas.sh http://127.0.0.1:8452
set -euo pipefail
URL="${1:?uso: scripts/humo_recetas.sh http://127.0.0.1:<puerto de la copia>}"
case "$URL" in *:8451|*:8451/*) echo "8451 es el servicio real: este humo crea filas y no corre ahí" >&2; exit 1 ;; esac
: "${NEVERA_ADMIN_TOKEN:?falta NEVERA_ADMIN_TOKEN}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$RAIZ/.venv/bin/python"
CUERPO="$(mktemp)"; trap 'rm -f "$CUERPO"' EXIT

campo() { "$PY" -I -c "import json,sys; v=json.load(open(sys.argv[1])); exec('for k in sys.argv[2].split(\".\"): v=v[int(k)] if isinstance(v,list) else v[k]'); print(v)" "$CUERPO" "$1"; }
py() { "$PY" -I -c "import json,sys; d=json.load(open(sys.argv[1])); $1" "$CUERPO"; }

pedir() {
  local met="$1" ruta="$2" json="${3:-}" cod
  local args=(-sS -o "$CUERPO" -w '%{http_code}' -X "$met" "$URL$ruta" -H "Authorization: Bearer $NEVERA_ADMIN_TOKEN")
  [ -n "$json" ] && args+=(-H 'Content-Type: application/json' -d "$json")
  echo "\$ curl -X $met $URL$ruta -H 'Authorization: Bearer ***'${json:+ -d '$json'}"
  cod="$(curl "${args[@]}")"
  echo "→ $cod $("$PY" -I -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1])),ensure_ascii=False)[:420])" "$CUERPO" 2>/dev/null || cat "$CUERPO")"
  echo
  ULTIMO="$cod"
}
espera() { [ "$ULTIMO" = "$1" ] || { echo "HUMO RECETAS FALLA: se esperaba $1 y llegó $ULTIMO" >&2; exit 1; }; }
comprueba() { if py "$1"; then echo "OK    $2"; echo; else echo "HUMO RECETAS FALLA: $2" >&2; exit 1; fi; }

# --------------------------------------------------------------- productos y elementos de la copia, por nombre
pedir GET /productos; espera 200
eval "$(py "
ids = {p['nombre']: p['id'] for p in d}
for var, nombre in [('PECHUGA','PECHUGA BLANCA'), ('ZANAHORIA','ZANAHORIA'), ('BROCOLI','BROCOLI'), ('ZUKINI','ZUKINI VERDE'),
                    ('AHUYAMA','AHUYAMA'), ('CEBOLLA','CEBOLLA LARGA'), ('AJO','AJO CORRIENTE'), ('CILANTRO','CILANTRO'),
                    ('TOMATE','TOMATE CHONTO'), ('PAN','PAN SANTA CLARA BLANCO'), ('QUESO','QUESO DONA LECHE')]:
    print(f'{var}={ids[nombre]}')
")"
pedir GET /elementos; espera 200
eval "$(py "
for var, pid in [('E_AHUYAMA', $AHUYAMA), ('E_CEBOLLA', $CEBOLLA), ('E_AJO', $AJO), ('E_TOMATE', $TOMATE)]:
    print(f'{var}=' + str(min(e['id'] for e in d if e['producto_id'] == pid)))
")"
pedir GET /movimientos; espera 200; MOVS0="$(py 'print(len(d))')"

# --------------------------------------------------------------- crear, y la versión 2 con un ingrediente cambiado
pedir POST /recetas "{\"nombre\":\"Pechuga con verduras\",\"version\":{\"porciones\":2,\"instrucciones\":\"Dorar la pechuga\nSaltear las verduras\",\"ingredientes\":[{\"producto_id\":$PECHUGA,\"cantidad\":500,\"unidad\":\"g\"},{\"producto_id\":$ZANAHORIA,\"cantidad\":0.3,\"unidad\":\"kg\"},{\"producto_id\":$BROCOLI,\"cantidad\":250,\"unidad\":\"g\"}]}}"
espera 201; R1="$(campo id)"
comprueba "assert d['version_vigente']['numero'] == 1 and {i['producto_id']: i['cantidad'] for i in d['version_vigente']['ingredientes']}[$ZANAHORIA] == 300" \
  "versión 1; 0,3 kg de zanahoria quedó en la unidad base: 300 g"
pedir POST /recetas "{\"nombre\":\"pechuga CON verduras\",\"version\":{\"ingredientes\":[{\"producto_id\":$PECHUGA,\"cantidad\":1,\"unidad\":\"g\"}]}}"
espera 409
pedir POST "/recetas/$R1/versiones" "{\"porciones\":3,\"instrucciones\":\"Dorar la pechuga\nSaltear el zukini y la zanahoria\",\"ingredientes\":[{\"producto_id\":$PECHUGA,\"cantidad\":500,\"unidad\":\"g\"},{\"producto_id\":$ZANAHORIA,\"cantidad\":300,\"unidad\":\"g\"},{\"producto_id\":$ZUKINI,\"cantidad\":250,\"unidad\":\"g\"}]}"
espera 201
comprueba "assert d['numero'] == 2" "versión 2 creada (brócoli → zukini)"
pedir GET "/recetas/$R1"; espera 200
comprueba "
v = {x['numero']: sorted(i['producto_id'] for i in x['ingredientes']) for x in d['versiones']}
assert d['version_vigente']['numero'] == 2 and v[1] == sorted([$PECHUGA, $ZANAHORIA, $BROCOLI]) and v[2] == sorted([$PECHUGA, $ZANAHORIA, $ZUKINI])
assert d['versiones'][0]['porciones'] == 2 and d['versiones'][1]['porciones'] == 3" \
  "la vigente es la 2 y la 1 sigue con brócoli y 2 comensales: no se tocó"
pedir POST /recetas "{\"nombre\":\"Arepa\",\"version\":{\"ingredientes\":[{\"producto_id\":$QUESO,\"cantidad\":2,\"unidad\":\"cucharada\"}]}}"
espera 400

# --------------------------------------------------------------- más recetas para ver el orden
pedir POST /recetas "{\"nombre\":\"Sopa de ahuyama\",\"version\":{\"porciones\":4,\"ingredientes\":[{\"producto_id\":$AHUYAMA,\"cantidad\":1,\"unidad\":\"kg\"},{\"producto_id\":$CEBOLLA,\"cantidad\":100,\"unidad\":\"g\"},{\"producto_id\":$AJO,\"cantidad\":20,\"unidad\":\"g\"},{\"producto_id\":$CILANTRO,\"cantidad\":10,\"unidad\":\"g\",\"opcional\":true}]}}"
espera 201; R_SOPA="$(campo id)"
pedir POST /recetas "{\"nombre\":\"Hogao\",\"version\":{\"ingredientes\":[{\"producto_id\":$TOMATE,\"cantidad\":400,\"unidad\":\"g\"},{\"producto_id\":$CEBOLLA,\"cantidad\":200,\"unidad\":\"g\"}]}}"
espera 201; R_HOGAO="$(campo id)"
pedir POST /recetas "{\"nombre\":\"Sánduche de queso\",\"version\":{\"ingredientes\":[{\"producto_id\":$PAN,\"cantidad\":1,\"unidad\":\"u\"},{\"producto_id\":$QUESO,\"cantidad\":1,\"unidad\":\"u\"}]}}"
espera 201

# --------------------------------------------------------------- sugeridas
pedir GET "/recetas/sugeridas?dias=7"; espera 200
py "print('orden:', ' > '.join(f\"{s['nombre']} ({s['dias_mas_urgente']} d, {s['por_vencer']} por vencer, faltan {len(s['faltan'])})\" for s in d))"
comprueba "
dias = [s['dias_mas_urgente'] for s in d]
assert dias == sorted(dias), dias
assert all(a['por_vencer'] >= b['por_vencer'] for a, b in zip(d, d[1:]) if a['dias_mas_urgente'] == b['dias_mas_urgente'])
assert len(d) == 4, [s['nombre'] for s in d]
assert d[0]['receta_version_id'] != None and all(not s['faltan'] for s in d)" \
  "ordenadas por los días del ingrediente más urgente (de menos a más); a igual urgencia, primero la que tiene más por vencer"

# --------------------------------------------------------------- cocinar
pedir POST "/recetas/$R_HOGAO/cocinar" "{\"consumos\":[{\"elemento_id\":$E_CEBOLLA,\"cantidad\":200},{\"elemento_id\":$E_TOMATE,\"cantidad\":5,\"unidad\":\"kg\"}]}"
espera 409
comprueba "assert d['error']['codigo'] == 'saldo_insuficiente' and d['error']['detalle']['faltan'][0]['elemento_id'] == $E_TOMATE" \
  "sin saldo de tomate: 409 con lo que falta"
pedir GET /movimientos; espera 200
comprueba "assert len(d) == $MOVS0" "y no se escribió nada (ni la cebolla, que sí alcanzaba): $MOVS0 movimientos"
pedir POST "/recetas/$R_SOPA/cocinar" "{\"consumos\":[{\"elemento_id\":$E_AHUYAMA,\"cantidad\":1000},{\"elemento_id\":$E_CEBOLLA,\"cantidad\":100},{\"elemento_id\":$E_AJO,\"cantidad\":20}]}"
espera 201
comprueba "assert len(d['movimientos']) == 3 and all(m['tipo'] == 'consumo' and m['motivo'] == 'receta Sopa de ahuyama' and m['miembro'] == 'admin' for m in d['movimientos'])" \
  "tres consumos, uno por ingrediente, con motivo «receta Sopa de ahuyama» y a nombre de quien cocinó"
pedir GET "/elementos?producto_id=$AHUYAMA"; espera 200
comprueba "assert d == []" "la ahuyama se gastó entera: ya no está en la lista"
pedir GET "/recetas/sugeridas?dias=7"; espera 200
comprueba "
s = next(x for x in d if x['nombre'] == 'Sopa de ahuyama')
assert [i['producto_id'] for i in s['faltan']] == [$AHUYAMA] and s['disponibles'] == 2" \
  "después de cocinar, a la sopa le falta la ahuyama"
echo "HUMO RECETAS OK"
