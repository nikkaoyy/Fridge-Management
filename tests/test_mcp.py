"""PEDIDO-NEVERA-8: el servidor MCP en /mcp, dentro de la misma app.

Todo pasa por el transporte real (JSON-RPC sobre HTTP con el TestClient), no llamando a las funciones por debajo: así
se prueba también el montaje, el token de miembro, el rol y la forma de las respuestas. Base temporal de conftest.py;
nada toca data/.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from app import db
from app.errores import ErrorApi
from tests.conftest import TOKEN_ADMIN
from tests.test_recetas import despensa, n_movimientos, receta, saldos  # noqa: F401  (despensa es un fixture)

LEEN = {"nevera_salud", "nevera_resumen", "nevera_inventario", "nevera_vencimientos", "nevera_catalogo",
        "nevera_recetas_sugeridas"}
ESCRIBEN = {"nevera_compra", "nevera_consumo", "nevera_cocinar"}
VERSION_PROTOCOLO = "2025-06-18"
ACEPTA = "application/json, text/event-stream"


# ---------------------------------------------------------------- utilidades

def rpc(cliente, metodo, params=None, token=TOKEN_ADMIN):
    cabeceras = {"Accept": ACEPTA, "MCP-Protocol-Version": VERSION_PROTOCOLO}
    if token is not None:
        cabeceras["Authorization"] = f"Bearer {token}"
    return cliente.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": metodo, "params": params or {}},
                        headers=cabeceras)


def llamar(cliente, nombre, token=TOKEN_ADMIN, **argumentos):
    """(es_error, datos): datos es el JSON estructurado, o el texto del error."""
    r = rpc(cliente, "tools/call", {"name": nombre, "arguments": argumentos}, token=token)
    assert r.status_code == 200, r.text
    res = r.json()["result"]
    texto = res["content"][0]["text"] if res.get("content") else ""
    if res.get("isError"):
        return True, texto
    return False, res.get("structuredContent") or json.loads(texto)


def ok(cliente, nombre, token=TOKEN_ADMIN, **argumentos):
    error, datos = llamar(cliente, nombre, token=token, **argumentos)
    assert not error, datos
    return datos


def falla(cliente, nombre, token=TOKEN_ADMIN, **argumentos) -> str:
    error, texto = llamar(cliente, nombre, token=token, **argumentos)
    assert error, f"{nombre} debía fallar y devolvió {texto}"
    return texto


def conteo(cliente, tabla):
    cx = sqlite3.connect(cliente.app.state.ruta_base)
    try:
        return cx.execute(f"SELECT COUNT(*) FROM {tabla}").fetchone()[0]
    finally:
        cx.close()


@pytest.fixture
def bolsa(admin, leche, ubic):
    """Una bolsa de leche de 1 L en la nevera, dada de alta por la API."""
    return admin.ok("POST", "/elementos", json={"presentacion_id": leche["bolsa"], "ubicacion_id": ubic["nevera"]})[0]


# ---------------------------------------------------------------- descubrimiento y acceso

def test_tools_list_son_las_9_en_espanol(cliente):
    r = rpc(cliente, "tools/list")
    assert r.status_code == 200
    tools = r.json()["result"]["tools"]
    assert {t["name"] for t in tools} == LEEN | ESCRIBEN and len(tools) == 9
    for t in tools:
        assert len(t["description"]) > 60, t["name"]
        propiedades = t["inputSchema"].get("properties", {})
        assert ("confirmar" in propiedades) == (t["name"] in ESCRIBEN), t["name"]
        assert t["annotations"]["readOnlyHint"] == (t["name"] in LEEN), t["name"]
        for nombre, p in propiedades.items():
            assert p.get("description"), f"{t['name']}.{nombre} sin descripción"


def test_initialize_dice_quien_es(cliente):
    r = rpc(cliente, "initialize", {"protocolVersion": VERSION_PROTOCOLO, "capabilities": {},
                                    "clientInfo": {"name": "prueba", "version": "0"}})
    res = r.json()["result"]
    assert res["serverInfo"]["name"] == "nevera"
    assert "confirmar: true" in res["instructions"]


@pytest.mark.parametrize("token", [None, "token-que-no-es-de-nadie"])
def test_sin_token_valido_es_401_y_no_llega_a_ninguna_herramienta(cliente, bolsa, token):
    antes = conteo(cliente, "movimiento")
    for metodo, params in (("tools/list", {}),
                           ("tools/call", {"name": "nevera_resumen", "arguments": {}}),
                           ("tools/call", {"name": "nevera_consumo",
                                           "arguments": {"elemento_id": bolsa["id"], "confirmar": True}})):
        r = rpc(cliente, metodo, params, token=token)
        assert r.status_code == 401, (metodo, r.text)
        assert r.json()["error"]["codigo"] == "no_autenticado"
        assert r.headers["www-authenticate"] == "Bearer"
    assert conteo(cliente, "movimiento") == antes


def test_get_sin_cabecera_es_401_y_con_token_405(cliente):
    assert cliente.get("/mcp").status_code == 401
    r = cliente.get("/mcp", headers={"Authorization": f"Bearer {TOKEN_ADMIN}"})
    assert r.status_code == 405 and r.headers["allow"] == "POST"


def test_miembro_inactivo_es_401(cliente, admin, miembros):
    admin.ok("PATCH", f"/miembros/{miembros['ids']['lector']}", json={"activo": False})
    assert rpc(cliente, "tools/list", token=miembros["tokens"]["lector"]).status_code == 401


def test_mcp_no_entra_al_contrato(cliente):
    assert "/mcp" not in cliente.app.openapi()["paths"]


def test_lector_lee_pero_escribir_es_403(cliente, miembros, bolsa, leche):
    lector = miembros["tokens"]["lector"]
    assert ok(cliente, "nevera_resumen", token=lector)["elementos_disponibles"] == 1
    elementos, movimientos = conteo(cliente, "elemento"), conteo(cliente, "movimiento")
    for nombre, argumentos in (
            ("nevera_compra", {"presentacion_id": leche["bolsa"], "ubicacion": "nevera"}),
            ("nevera_compra", {"presentacion_id": leche["bolsa"], "ubicacion": "nevera", "confirmar": True}),
            ("nevera_consumo", {"elemento_id": bolsa["id"], "confirmar": True}),
            ("nevera_cocinar", {"receta_id": 1, "consumos": [{"elemento_id": bolsa["id"], "cantidad": 1}],
                                "confirmar": True})):
        texto = falla(cliente, nombre, token=lector, **argumentos)
        assert "403 prohibido" in texto and "«lector»" in texto and "«editor»" in texto, texto
    assert (conteo(cliente, "elemento"), conteo(cliente, "movimiento")) == (elementos, movimientos)


def test_editor_si_escribe(cliente, miembros, bolsa):
    mov = ok(cliente, "nevera_consumo", token=miembros["tokens"]["editor"], elemento_id=bolsa["id"], cantidad=200,
             confirmar=True)
    assert mov["miembro"] == "editor de prueba" and mov["saldo"] == 800


# ---------------------------------------------------------------- lectura: el JSON de la ruta

def test_lecturas_devuelven_el_json_de_su_ruta(cliente, admin, bolsa):
    assert ok(cliente, "nevera_salud") == cliente.get("/salud").json()
    assert ok(cliente, "nevera_resumen") == admin.ok("GET", "/indicadores")
    assert ok(cliente, "nevera_vencimientos", dias=7) == admin.ok("GET", "/vencimientos?dias=7")
    assert ok(cliente, "nevera_vencimientos")["dias"] == 7  # por defecto, 7
    assert ok(cliente, "nevera_catalogo") == {"categorias": admin.ok("GET", "/categorias"),
                                              "unidades": admin.ok("GET", "/unidades"),
                                              "ubicaciones": admin.ok("GET", "/ubicaciones")}
    inv = ok(cliente, "nevera_inventario")
    assert inv["elementos"] == admin.ok("GET", "/elementos") and inv["total"] == 1
    assert inv["ubicaciones"] == {str(bolsa["ubicacion_id"]): "nevera"}


def test_inventario_filtra_por_texto_ubicacion_y_vencimiento(cliente, admin, despensa, ubic):
    assert [e["producto"] for e in ok(cliente, "nevera_inventario", buscar="CEBOLLA")["elementos"]] == ["cebolla"]
    assert ok(cliente, "nevera_inventario", buscar="no existe")["elementos"] == []
    pronto = ok(cliente, "nevera_inventario", por_vencer_dias=4)["elementos"]
    assert pronto == admin.ok("GET", "/elementos?por_vencer=4")
    assert {e["producto"] for e in pronto} == {"tomate", "cebolla", "perejil"}  # lo vencido también, como la ruta
    en_nevera = ok(cliente, "nevera_inventario", ubicacion="Nevera")["elementos"]
    assert en_nevera == admin.ok("GET", f"/elementos?ubicacion_id={ubic['nevera']}")
    assert ok(cliente, "nevera_inventario", ubicacion=str(ubic["nevera"]))["elementos"] == en_nevera
    texto = falla(cliente, "nevera_inventario", ubicacion="sótano")
    assert "404 no_encontrado" in texto and "congelador" in texto


def test_recetas_sugeridas_son_las_de_la_ruta(cliente, admin, despensa):
    receta(admin, "Sopa de tomate", [(despensa["tomate"], 1, "kg"), (despensa["cebolla"], 200, "g")])
    assert ok(cliente, "nevera_recetas_sugeridas") == {"recetas": admin.ok("GET", "/recetas/sugeridas")}
    assert ok(cliente, "nevera_recetas_sugeridas", dias=5) == {"recetas": admin.ok("GET", "/recetas/sugeridas?dias=5")}
    assert ok(cliente, "nevera_recetas_sugeridas")["recetas"][0]["nombre"] == "Sopa de tomate"


# ---------------------------------------------------------------- escritura: confirmar

def test_compra_sin_confirmar_no_cambia_el_conteo_de_elementos(cliente, leche):
    antes = {t: conteo(cliente, t) for t in ("elemento", "compra", "compra_linea")}
    texto = falla(cliente, "nevera_compra", presentacion_id=leche["bolsa"], ubicacion="Nevera", unidades=2,
                  precio_unitario_cop=4800)
    assert "No se escribió nada: falta confirmar: true" in texto and "2 elemento(s) de «leche»" in texto
    assert {t: conteo(cliente, t) for t in antes} == antes

    hecho = ok(cliente, "nevera_compra", presentacion_id=leche["bolsa"], ubicacion="nevera", unidades=2,
               precio_unitario_cop=4800, confirmar=True)
    assert [e["presentacion_id"] for e in hecho["elementos"]] == [leche["bolsa"]] * 2
    assert all(e["precio_unitario_cop"] == 4800 and e["alta_por"] == 1 for e in hecho["elementos"])
    assert conteo(cliente, "elemento") == antes["elemento"] + 2


def test_compra_de_un_pack_entra_con_sus_partes(cliente, leche):
    hecho = ok(cliente, "nevera_compra", presentacion_id=leche["pack"], ubicacion="nevera", confirmar=True)
    assert len(hecho["elementos"]) == 13  # el pack y sus 12 bolsas, como en POST /elementos


def test_compra_por_nombre_de_producto(cliente, leche, despensa):
    hecho = ok(cliente, "nevera_compra", producto="ARROZ", ubicacion="despensa", confirmar=True)
    assert [(e["producto"], e["saldo"]) for e in hecho["elementos"]] == [("arroz", 1000)]
    texto = falla(cliente, "nevera_compra", producto="leche", ubicacion="nevera")  # bolsa 1 L y pack 12 bolsas
    assert "varias presentaciones" in texto and "presentacion_id" in texto and "pack 12 bolsas" in texto
    assert "parecidos: " in falla(cliente, "nevera_compra", producto="lech", ubicacion="nevera")


def test_consumo_sin_confirmar_no_escribe_y_con_confirmar_si(cliente, admin, bolsa):
    texto = falla(cliente, "nevera_consumo", elemento_id=bolsa["id"], cantidad=250, unidad="ml")
    assert "No se escribió nada" in texto and "quedaría saldo 750" in texto
    assert conteo(cliente, "movimiento") == 0
    assert saldos(admin)[bolsa["id"]] == 1000

    mov = ok(cliente, "nevera_consumo", elemento_id=bolsa["id"], tipo="descarte", cantidad=0.25, unidad="l",
             motivo="se cortó", confirmar=True)
    assert (mov["tipo"], mov["cantidad"], mov["motivo"], mov["saldo"]) == ("merma", 250, "se cortó", 750)
    assert admin.ok("GET", f"/movimientos?elemento_id={bolsa['id']}") == [mov]


def test_cocinar_sin_confirmar_no_descuenta_y_con_confirmar_si(cliente, admin, despensa):
    r = receta(admin, "Sopa de tomate", [(despensa["tomate"], 1, "kg"), (despensa["cebolla"], 200, "g")])
    consumos = [{"elemento_id": despensa["e_tomate"], "cantidad": 1000},
                {"elemento_id": despensa["e_cebolla"], "cantidad": 0.2, "unidad": "kg"}]
    antes = saldos(admin)
    texto = falla(cliente, "nevera_cocinar", receta_id=r["id"], consumos=consumos)
    assert "No se escribió nada" in texto and "receta Sopa de tomate con 2 consumo(s)" in texto
    assert saldos(admin) == antes and n_movimientos(cliente) == 0

    hecho = ok(cliente, "nevera_cocinar", receta_id=r["id"], consumos=consumos, confirmar=True)
    assert hecho["receta_id"] == r["id"] and [m["cantidad"] for m in hecho["movimientos"]] == [1000, 200]
    assert saldos(admin)[despensa["e_cebolla"]] == 300


# ---------------------------------------------------------------- errores de dominio: el mismo mensaje

def test_errores_de_dominio_con_el_mismo_mensaje_que_la_api(cliente, admin, bolsa, despensa):
    api = admin.post("/movimientos", json={"elemento_id": bolsa["id"], "tipo": "consumo", "cantidad": 5000})
    assert api.status_code == 409
    texto = falla(cliente, "nevera_consumo", elemento_id=bolsa["id"], cantidad=5000, confirmar=True)
    assert f"409 saldo_negativo: {api.json()['error']['mensaje']}" in texto
    # también sin confirmar: el simulacro corre las mismas validaciones
    assert f"409 saldo_negativo: {api.json()['error']['mensaje']}" in falla(cliente, "nevera_consumo",
                                                                           elemento_id=bolsa["id"], cantidad=5000)

    api = admin.post("/movimientos", json={"elemento_id": 999, "tipo": "consumo"})
    assert f"404 no_encontrado: {api.json()['error']['mensaje']}" in falla(cliente, "nevera_consumo",
                                                                          elemento_id=999, confirmar=True)

    api = admin.post("/elementos", json={"presentacion_id": bolsa["presentacion_id"], "ubicacion_id": 1,
                                         "vencimiento": "2026-02-30"})
    assert api.status_code == 400
    texto = falla(cliente, "nevera_compra", presentacion_id=bolsa["presentacion_id"], ubicacion="1",
                  vencimiento="2026-02-30", confirmar=True)
    assert f"400 invalido: {api.json()['error']['mensaje']}" in texto

    r = receta(admin, "Hogao", [(despensa["tomate"], 400, "g"), (despensa["cebolla"], 200, "g")])
    consumos = [{"elemento_id": despensa["e_tomate"], "cantidad": 400},
                {"elemento_id": despensa["e_cebolla"], "cantidad": 2, "unidad": "kg"}]
    api = admin.post(f"/recetas/{r['id']}/cocinar", json={"consumos": consumos})
    texto = falla(cliente, "nevera_cocinar", receta_id=r["id"], consumos=consumos, confirmar=True)
    assert f"409 saldo_insuficiente: {api.json()['error']['mensaje']}" in texto
    assert n_movimientos(cliente) == 0


# ---------------------------------------------------------------- la transacción anidada del simulacro

def test_simulacro_deshace_y_la_transaccion_anidada_respeta_el_error(cliente):
    cx = db.conectar(cliente.app.state.ruta_base)
    try:
        with db.simulacro(cx):
            with db.transaccion(cx):
                cx.execute("INSERT INTO categoria (nombre) VALUES ('del simulacro')")
            assert cx.execute("SELECT COUNT(*) FROM categoria WHERE nombre = 'del simulacro'").fetchone()[0] == 1
            with pytest.raises(ErrorApi):
                with db.transaccion(cx):
                    cx.execute("INSERT INTO categoria (nombre) VALUES ('a medias')")
                    raise ErrorApi(409, "conflicto", "a mitad")
            assert cx.execute("SELECT COUNT(*) FROM categoria WHERE nombre = 'a medias'").fetchone()[0] == 0
        assert not cx.in_transaction
        assert cx.execute("SELECT COUNT(*) FROM categoria WHERE nombre = 'del simulacro'").fetchone()[0] == 0
        with db.transaccion(cx):  # fuera del simulacro, la de siempre: BEGIN IMMEDIATE … COMMIT
            cx.execute("INSERT INTO categoria (nombre) VALUES ('de verdad')")
        assert not cx.in_transaction
    finally:
        cx.close()
    assert conteo(cliente, "categoria WHERE nombre = 'de verdad'") == 1
