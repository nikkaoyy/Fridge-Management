#!/usr/bin/env bash
# Humo contra el servicio VIVO (no TestClient): /salud, alta de producto, alta de pack, dos movimientos, vencimientos
# y un 403 de lector. Crea filas: correrlo contra una base desechable (NEVERA_DATOS=/tmp/...), nunca contra data/.
#
#   NEVERA_ADMIN_TOKEN='…' scripts/humo.sh [http://127.0.0.1:8451]
set -euo pipefail
URL="${1:-http://127.0.0.1:8451}"
: "${NEVERA_ADMIN_TOKEN:?falta NEVERA_ADMIN_TOKEN (el del admin de la base desechable)}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$RAIZ/.venv/bin/python"
CUERPO="$(mktemp)"; trap 'rm -f "$CUERPO"' EXIT

campo() { "$PY" -I -c "import json,sys; v=json.load(open(sys.argv[1])); exec('for k in sys.argv[2].split(\".\"): v=v[int(k)] if isinstance(v,list) else v[k]'); print(v)" "$CUERPO" "$1"; }

# pedir TOKEN METODO RUTA [JSON] — imprime la orden (con el token tapado) y la respuesta
pedir() {
  local tok="$1" met="$2" ruta="$3" json="${4:-}" cod
  local args=(-sS -o "$CUERPO" -w '%{http_code}' -X "$met" "$URL$ruta")
  [ -n "$tok" ] && args+=(-H "Authorization: Bearer $tok")
  [ -n "$json" ] && args+=(-H 'Content-Type: application/json' -d "$json")
  echo "\$ curl -X $met $URL$ruta${tok:+ -H 'Authorization: Bearer ***'}${json:+ -d '$json'}"
  cod="$(curl "${args[@]}")"
  echo "→ $cod $("$PY" -I -c "import json,sys; d=json.load(open(sys.argv[1])); d.update(token='***') if isinstance(d,dict) and 'token' in d else None; print(json.dumps(d,ensure_ascii=False)[:400])" "$CUERPO" 2>/dev/null || cat "$CUERPO")"
  echo
  ULTIMO="$cod"
}
espera() { [ "$ULTIMO" = "$1" ] || { echo "HUMO FALLA: se esperaba $1 y llegó $ULTIMO" >&2; exit 1; }; }

A="$NEVERA_ADMIN_TOKEN"
HOY="$(TZ=America/Bogota date +%F)"

pedir "" GET /salud;                                                    espera 200
pedir "" GET /elementos;                                                espera 401
pedir "$A" GET /ubicaciones;                                            espera 200
NEVERA="$("$PY" -I -c "import json,sys; print(next(u['id'] for u in json.load(open(sys.argv[1])) if u['nombre']=='nevera'))" "$CUERPO")"
pedir "$A" POST /categorias '{"nombre":"lácteos"}';                     espera 201; CAT="$(campo id)"
pedir "$A" POST /productos "{\"nombre\":\"leche\",\"categoria_id\":$CAT,\"unidad_base\":\"ml\",\"vida_util\":{\"dias_base\":7,\"dias_abierto\":3,\"fuente\":\"etiqueta\"}}"
espera 201; PROD="$(campo id)"
pedir "$A" POST /presentaciones "{\"producto_id\":$PROD,\"nombre\":\"bolsa 1 L\",\"contenido\":1,\"unidad\":\"l\"}"
espera 201; BOLSA="$(campo id)"
pedir "$A" POST /presentaciones "{\"producto_id\":$PROD,\"nombre\":\"pack 6 bolsas\",\"parte_id\":$BOLSA,\"partes\":6}"
espera 201; PACK="$(campo id)"
pedir "$A" POST /elementos "{\"presentacion_id\":$PACK,\"ubicacion_id\":$NEVERA,\"precio_unitario_cop\":27000}"
espera 201; PADRE="$(campo 0.id)"; H1="$(campo 1.id)"; H2="$(campo 2.id)"
echo "(pack: padre $PADRE con $("$PY" -I -c "import json,sys; print(len(json.load(open(sys.argv[1])))-1)" "$CUERPO") hijos)"; echo
pedir "$A" PATCH "/elementos/$H1" "{\"abierto_en\":\"$HOY\"}";             espera 200
pedir "$A" POST /movimientos "{\"elemento_id\":$H1,\"tipo\":\"consumo\",\"cantidad\":250}";  espera 201
pedir "$A" POST /movimientos "{\"elemento_id\":$H2,\"tipo\":\"consumo\"}";                   espera 201
pedir "$A" POST /movimientos "{\"elemento_id\":$PADRE,\"tipo\":\"consumo\"}";                espera 409
pedir "$A" GET "/elementos?producto_id=$PROD";                           espera 200
echo "(leche disponible: $("$PY" -I -c "import json,sys; l=json.load(open(sys.argv[1])); print(len(l), 'bolsas,', sum(e['saldo'] for e in l), 'ml')" "$CUERPO"))"; echo
pedir "$A" GET "/elementos?por_vencer=7";                                espera 200
echo "(por vencer en 7 días: $("$PY" -I -c "import json,sys; l=json.load(open(sys.argv[1])); print(len(l), 'elementos;', sorted({(e['id'], e['vencimiento']) for e in l})[:2], '…')" "$CUERPO"))"; echo
pedir "$A" POST /miembros '{"nombre":"lector de humo","rol":"lector"}';  espera 201; L="$(campo token)"
pedir "$L" GET /indicadores;                                             espera 200
pedir "$L" POST /movimientos "{\"elemento_id\":$H1,\"tipo\":\"consumo\"}"; espera 403
echo "HUMO OK"
