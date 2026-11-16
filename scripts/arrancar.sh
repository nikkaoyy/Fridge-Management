#!/usr/bin/env bash
# Arranca el Catálogo de nevera en segundo plano en 0.0.0.0:8451 (PEDIDO-NEVERA-2, bloque 4).
#
#   NEVERA_ADMIN_TOKEN='…' scripts/arrancar.sh      # primer arranque (base sin miembros)
#   scripts/arrancar.sh                             # arranques siguientes
#   scripts/parar.sh                                # detenerlo
#
# - Comprueba que el puerto esté libre ANTES de arrancar y, si no, lo dice y sale (8445-8450 son de otros servicios;
#   8450 es PYTHAGORAS: este script se niega a usarlos).
# - Log a $NEVERA_DATOS/servicio.log (por defecto data/servicio.log); PID en $NEVERA_DATOS/servicio.pid.
# - El token va solo por entorno: nunca en la línea de órdenes ni en el log.
# - Espera a que /salud responda; si el servicio muere al arrancar (p. ej. falta NEVERA_ADMIN_TOKEN), muestra el
#   final del log y sale con error.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${NEVERA_HOST:-0.0.0.0}"
PUERTO="${NEVERA_PUERTO:-8451}"
DATOS="${NEVERA_DATOS:-$RAIZ/data}"
PY="$RAIZ/.venv/bin/python"
LOG="$DATOS/servicio.log"
PID="$DATOS/servicio.pid"

if [ "$PUERTO" -ge 8445 ] && [ "$PUERTO" -le 8450 ]; then
  echo "el puerto $PUERTO es de otro servicio (8445-8450; 8450 es PYTHAGORAS): no se usa" >&2; exit 1
fi
[ -x "$PY" ] || { echo "falta el venv: python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt" >&2; exit 1; }

mkdir -p "$DATOS"
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
  echo "ya está corriendo (pid $(cat "$PID")); scripts/parar.sh para detenerlo" >&2; exit 1
fi

if ! "$PY" -I -c "import socket,sys; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind((sys.argv[1], int(sys.argv[2]))); s.close()" "$HOST" "$PUERTO" 2>/dev/null; then
  echo "el puerto $HOST:$PUERTO está ocupado: no se arranca" >&2; exit 1
fi
echo "puerto $HOST:$PUERTO libre"

cd "$RAIZ"
export NEVERA_DATOS="$DATOS" TZ="${TZ:-America/Bogota}"
setsid nohup "$PY" -m uvicorn app.main:app --host "$HOST" --port "$PUERTO" >>"$LOG" 2>&1 </dev/null &
echo $! >"$PID"

for _ in $(seq 1 50); do
  if ! kill -0 "$(cat "$PID")" 2>/dev/null; then
    echo "el servicio no arrancó (detalle en $LOG):" >&2
    grep -h "NO ARRANCA" "$LOG" | tail -n 1 >&2 || tail -n 15 "$LOG" >&2
    rm -f "$PID"; exit 1
  fi
  if curl -fsS "http://127.0.0.1:$PUERTO/salud" >/dev/null 2>&1; then
    echo "arriba: pid $(cat "$PID"), http://$HOST:$PUERTO, log $LOG"; exit 0
  fi
  sleep 0.2
done
echo "no respondió /salud en 10 s; mira $LOG" >&2; exit 1
