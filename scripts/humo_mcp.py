"""Humo del servidor MCP contra una instancia viva (PEDIDO-NEVERA-8, bloque 3). Solo lee: no escribe en la base.

    .venv/bin/python -I scripts/humo_mcp.py http://127.0.0.1:8462 /opt/data/secrets/nevera_aria_token

El token se lee del archivo y no se imprime. Comprueba: POST /mcp sin cabecera → 401; GET /mcp sin cabecera → 401;
tools/list con el token → las 9 herramientas; nevera_vencimientos con dias: 7 → lo mismo que GET /vencimientos?dias=7.
Sale con 1 si algo no cuadra.
"""
from __future__ import annotations

import json
import sys

import httpx

HERRAMIENTAS = {"nevera_salud", "nevera_resumen", "nevera_inventario", "nevera_vencimientos", "nevera_catalogo",
                "nevera_recetas_sugeridas", "nevera_compra", "nevera_consumo", "nevera_cocinar"}
CABECERAS = {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"}


def main(base: str, archivo_token: str) -> int:
    token = open(archivo_token, encoding="utf-8").read().strip()
    con_token = CABECERAS | {"Authorization": f"Bearer {token}"}
    fallos = []

    def rpc(metodo, params=None, cabeceras=con_token):
        return httpx.post(f"{base}/mcp", headers=cabeceras, timeout=20,
                          json={"jsonrpc": "2.0", "id": 1, "method": metodo, "params": params or {}})

    r = rpc("tools/list", cabeceras=CABECERAS)
    print(f"1. POST /mcp sin cabecera -> {r.status_code} {r.text}")
    r.status_code == 401 or fallos.append("POST sin cabecera no dio 401")

    r = httpx.get(f"{base}/mcp", timeout=20)
    print(f"2. GET /mcp sin cabecera -> {r.status_code} {r.text}")
    r.status_code == 401 or fallos.append("GET sin cabecera no dio 401")

    r = rpc("tools/list")
    nombres = sorted(t["name"] for t in r.json()["result"]["tools"])
    print(f"3. POST /mcp tools/list con el token -> {r.status_code}, {len(nombres)} herramientas: {', '.join(nombres)}")
    set(nombres) == HERRAMIENTAS or fallos.append(f"tools/list no son las 9: {nombres}")

    r = rpc("tools/call", {"name": "nevera_vencimientos", "arguments": {"dias": 7}})
    res = r.json()["result"]
    if res.get("isError"):
        fallos.append(f"nevera_vencimientos falló: {res['content'][0]['text']}")
    else:
        v = res["structuredContent"]
        http = httpx.get(f"{base}/vencimientos", params={"dias": 7}, headers={"Authorization": f"Bearer {token}"},
                         timeout=20).json()
        print(f"4. nevera_vencimientos dias=7 -> hoy {v['hoy']}, vencidos {len(v['vencidos'])}, hoy_vencen "
              f"{len(v['hoy_vencen'])}, proximos {len(v['proximos'])}, sin_vencimiento {v['sin_vencimiento']}; "
              f"igual a GET /vencimientos?dias=7: {v == http}")
        for e in (v["vencidos"] + v["hoy_vencen"] + v["proximos"])[:5]:
            print(f"   - {e['vencimiento']} ({e['dias_para_vencer']} d) {e['producto']} · saldo {e['saldo']:g} "
                  f"{e['unidad_base']}")
        v == http or fallos.append("nevera_vencimientos no coincide con GET /vencimientos")

    print("OK" if not fallos else "FALLOS:\n" + json.dumps(fallos, ensure_ascii=False, indent=2))
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1].rstrip("/"), sys.argv[2]))
