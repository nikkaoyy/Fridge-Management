#!/usr/bin/env bash
# Detiene el servicio arrancado con scripts/arrancar.sh (mismo NEVERA_DATOS).
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID="${NEVERA_DATOS:-$RAIZ/data}/servicio.pid"
[ -f "$PID" ] || { echo "no hay $PID: no está corriendo (o se arrancó con otro NEVERA_DATOS)" >&2; exit 1; }
P="$(cat "$PID")"
if kill -0 "$P" 2>/dev/null; then
  kill "$P"
  for _ in $(seq 1 50); do kill -0 "$P" 2>/dev/null || break; sleep 0.1; done
  echo "detenido (pid $P)"
else
  echo "el pid $P ya no existía"
fi
rm -f "$PID"
