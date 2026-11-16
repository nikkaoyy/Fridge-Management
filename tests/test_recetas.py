"""Recetas (PEDIDO-NEVERA-5, bloque 4): versiones, sugeridas por urgencia y cocinar. Base temporal por prueba.

Cada respuesta pasa por el validador del contrato (conftest.Api). Las fechas son relativas a hoy (`fechas["mas"]`):
las pruebas no dependen del día en que se corren.
"""
import sqlite3

import pytest

from conftest import TOKEN_ADMIN


# ---------------------------------------------------------------- ayudas

@pytest.fixture
def despensa(admin, ubic, fechas):
    """Cuatro productos en gramos con su bolsa y elementos con vencimientos conocidos (relativos a hoy):

    - tomate: 1000 g que vencen en 1 día     - arroz: 1000 g que vencen en 30 días
    - cebolla: 500 g que vencen en 4 días    - perejil: 50 g VENCIDO ayer (no cuenta como disponible)
    - queso: producto sin ningún elemento
    """
    cat = admin.ok("POST", "/categorias", json={"nombre": "despensa"})["id"]

    def producto(nombre):
        p = admin.ok("POST", "/productos", json={"nombre": nombre, "categoria_id": cat, "unidad_base": "g"})
        b = admin.ok("POST", "/presentaciones", json={"producto_id": p["id"], "nombre": f"bolsa de {nombre}",
                                                      "contenido": 1, "unidad": "kg"})
        return p["id"], b["id"]

    def alta(pres, dias, cantidad=None):
        cuerpo = {"presentacion_id": pres, "ubicacion_id": ubic["nevera"], "vencimiento": fechas["mas"](dias),
                  "vencimiento_impreso": True}
        if cantidad is not None:
            cuerpo |= {"cantidad": cantidad, "unidad": "g"}
        return admin.ok("POST", "/elementos", json=cuerpo)[0]["id"]

    d = {}
    for nombre in ("tomate", "cebolla", "arroz", "perejil", "queso"):
        d[nombre], d[f"bolsa_{nombre}"] = producto(nombre)
    d["e_tomate"] = alta(d["bolsa_tomate"], 1)
    d["e_cebolla"] = alta(d["bolsa_cebolla"], 4, 500)
    d["e_arroz"] = alta(d["bolsa_arroz"], 30)
    d["e_perejil"] = alta(d["bolsa_perejil"], -1, 50)
    return d


def receta(api, nombre, ingredientes, porciones=2, instrucciones=None):
    """`ingredientes`: tuplas (producto_id, cantidad, unidad) o (producto_id, cantidad, unidad, {"opcional": True})."""
    lineas = []
    for p, c, u, *extra in ingredientes:
        lineas.append({"producto_id": p, "cantidad": c, "unidad": u, **(extra[0] if extra else {})})
    return api.ok("POST", "/recetas", json={"nombre": nombre, "version": {
        "porciones": porciones, "instrucciones": instrucciones, "ingredientes": lineas}})


def saldos(api):
    return {e["id"]: e["saldo"] for e in api.ok("GET", "/elementos")}


def n_movimientos(cliente):
    cx = sqlite3.connect(cliente.app.state.ruta_base)
    try:
        return cx.execute("SELECT COUNT(*) FROM movimiento").fetchone()[0]
    finally:
        cx.close()


# ---------------------------------------------------------------- versiones

def test_version_nueva_no_altera_la_anterior(admin, despensa, cliente):
    r = receta(admin, "Arroz con tomate", [(despensa["arroz"], 0.2, "kg"), (despensa["tomate"], 300, "g")],
               instrucciones="Sofreír\nAgregar el arroz")
    v1 = r["version_vigente"]
    assert v1["numero"] == 1
    assert {i["producto_id"]: (i["cantidad"], i["unidad"]) for i in v1["ingredientes"]} == {
        despensa["arroz"]: (200, "g"), despensa["tomate"]: (300, "g")}  # 0,2 kg queda en la unidad base

    v2 = admin.ok("POST", f"/recetas/{r['id']}/versiones", json={
        "porciones": 4, "instrucciones": "Sofreír la cebolla\nAgregar el arroz",
        "ingredientes": [{"producto_id": despensa["arroz"], "cantidad": 400, "unidad": "g"},
                         {"producto_id": despensa["cebolla"], "cantidad": 100, "unidad": "g"}]})
    assert v2["numero"] == 2 and v2["id"] != v1["id"]

    det = admin.ok("GET", f"/recetas/{r['id']}")
    assert det["version_vigente"] == v2
    assert [v["numero"] for v in det["versiones"]] == [1, 2]
    assert det["versiones"][0] == v1, "la versión 1 cambió al crear la 2"
    assert admin.ok("GET", "/recetas")[0]["version_vigente"]["numero"] == 2

    # y en la base: las filas de la versión 1 siguen siendo las mismas
    cx = sqlite3.connect(cliente.app.state.ruta_base)
    try:
        filas = cx.execute("SELECT producto_id, cantidad FROM receta_ingrediente WHERE receta_version_id = ? "
                           "ORDER BY producto_id", (v1["id"],)).fetchall()
    finally:
        cx.close()
    assert filas == sorted([(despensa["arroz"], 200), (despensa["tomate"], 300)])


def test_unidad_que_no_existe_es_400_y_no_crea_nada(admin, despensa):
    r = admin.post("/recetas", json={"nombre": "Arepa", "version": {
        "ingredientes": [{"producto_id": despensa["queso"], "cantidad": 2, "unidad": "cucharada"}]}})
    assert r.status_code == 400 and "cucharada" in r.json()["error"]["mensaje"]
    r = admin.post("/recetas", json={"nombre": "Arepa", "version": {
        "ingredientes": [{"producto_id": despensa["queso"], "cantidad": 2, "unidad": "ml"}]}})
    assert r.status_code == 400, "ml no es de la magnitud de un producto en gramos"
    assert admin.ok("GET", "/recetas") == []


def test_nombre_repetido_es_409(admin, despensa):
    receta(admin, "Hogao", [(despensa["tomate"], 400, "g")])
    r = admin.post("/recetas", json={"nombre": "HOGAO", "version": {
        "ingredientes": [{"producto_id": despensa["tomate"], "cantidad": 1, "unidad": "g"}]}})
    assert r.status_code == 409


# ---------------------------------------------------------------- sugeridas

def test_sugeridas_ordena_por_el_ingrediente_mas_urgente(admin, despensa, cliente):
    # Los nombres van al revés del alfabeto para que un orden alfabético no pase por bueno.
    receta(admin, "A lejos", [(despensa["arroz"], 200, "g")])                                    # 30 días
    receta(admin, "B media", [(despensa["cebolla"], 100, "g"), (despensa["arroz"], 100, "g")])   # 4 días
    receta(admin, "C urgente", [(despensa["tomate"], 300, "g"), (despensa["arroz"], 200, "g"),  # 1 día
                                (despensa["perejil"], 10, "g"), (despensa["queso"], 50, "g", {"opcional": True})])
    receta(admin, "D sin nada", [(despensa["queso"], 100, "g"), (despensa["perejil"], 5, "g")])  # nada disponible
    antes = n_movimientos(cliente)

    sug = admin.ok("GET", "/recetas/sugeridas?dias=7")
    assert [s["nombre"] for s in sug] == ["C urgente", "B media", "A lejos"]
    assert [s["dias_mas_urgente"] for s in sug] == [1, 4, 30]

    c = sug[0]
    assert [i["producto_id"] for i in c["cubre"]] == [despensa["tomate"], despensa["arroz"]]  # lo urgente primero
    assert {i["producto_id"] for i in c["faltan"]} == {despensa["perejil"], despensa["queso"]}  # el vencido falta
    assert (c["ingredientes"], c["disponibles"], c["por_vencer"]) == (3, 2, 1)  # el opcional no cuenta
    tomate = c["cubre"][0]
    assert tomate["por_vencer"] and tomate["alcanza"] and tomate["dias_para_vencer"] == 1 and tomate["saldo"] == 1000
    assert not c["cubre"][1]["por_vencer"]
    assert sug[1]["por_vencer"] == 1 and sug[2]["por_vencer"] == 0
    assert n_movimientos(cliente) == antes, "sugerir no consume nada"


def test_sugeridas_a_igual_urgencia_primero_la_que_tiene_mas_por_vencer(admin, despensa):
    receta(admin, "A una", [(despensa["tomate"], 100, "g"), (despensa["arroz"], 100, "g")])
    receta(admin, "B dos", [(despensa["tomate"], 100, "g"), (despensa["cebolla"], 100, "g")])
    sug = admin.ok("GET", "/recetas/sugeridas?dias=7")
    assert [(s["nombre"], s["dias_mas_urgente"], s["por_vencer"]) for s in sug] == [("B dos", 1, 2), ("A una", 1, 1)]


def test_sugeridas_dice_cuando_no_alcanza(admin, despensa):
    receta(admin, "Mucha cebolla", [(despensa["cebolla"], 2, "kg")])
    (s,) = admin.ok("GET", "/recetas/sugeridas?dias=7")
    assert s["cubre"][0]["saldo"] == 500 and not s["cubre"][0]["alcanza"]


# ---------------------------------------------------------------- cocinar

def test_cocinar_descuenta_un_consumo_por_ingrediente(admin, despensa, cliente):
    r = receta(admin, "Sopa de tomate", [(despensa["tomate"], 1, "kg"), (despensa["cebolla"], 200, "g")])
    antes = saldos(admin)
    hecho = admin.ok("POST", f"/recetas/{r['id']}/cocinar", json={"consumos": [
        {"elemento_id": despensa["e_tomate"], "cantidad": 1000},
        {"elemento_id": despensa["e_cebolla"], "cantidad": 0.2, "unidad": "kg"}]})
    assert hecho["receta_id"] == r["id"] and hecho["receta_version_id"] == r["version_vigente"]["id"]
    assert hecho["motivo"] == "receta Sopa de tomate"
    movs = hecho["movimientos"]
    assert [(m["elemento_id"], m["tipo"], m["cantidad"], m["motivo"]) for m in movs] == [
        (despensa["e_tomate"], "consumo", 1000, "receta Sopa de tomate"),
        (despensa["e_cebolla"], "consumo", 200, "receta Sopa de tomate")]
    assert all(m["miembro"] == "admin" for m in movs)

    despues = saldos(admin)
    assert despensa["e_tomate"] not in despues, "el tomate se gastó entero: ya no está en la lista"
    assert despues[despensa["e_cebolla"]] == antes[despensa["e_cebolla"]] - 200 == 300
    assert despues[despensa["e_arroz"]] == antes[despensa["e_arroz"]]  # lo que no se eligió no se toca
    assert len(admin.ok("GET", "/movimientos")) == 2


def test_cocinar_sin_saldo_es_409_y_no_escribe_nada(admin, despensa, cliente):
    r = receta(admin, "Hogao", [(despensa["tomate"], 400, "g"), (despensa["cebolla"], 200, "g")])
    antes, movs0 = saldos(admin), n_movimientos(cliente)
    res = admin.post(f"/recetas/{r['id']}/cocinar", json={"consumos": [
        {"elemento_id": despensa["e_tomate"], "cantidad": 400},           # este alcanza…
        {"elemento_id": despensa["e_cebolla"], "cantidad": 2, "unidad": "kg"}]})  # …y este no
    assert res.status_code == 409
    err = res.json()["error"]
    assert err["codigo"] == "saldo_insuficiente"
    assert err["detalle"]["faltan"] == [{"elemento_id": despensa["e_cebolla"], "producto": "cebolla", "pide": 2000,
                                         "hay": 500, "unidad": "g"}]
    assert n_movimientos(cliente) == movs0, "ni el tomate, que sí alcanzaba, se descontó"
    assert saldos(admin) == antes


def test_cocinar_es_una_transaccion_si_falla_a_mitad_no_queda_nada(admin, despensa, cliente):
    """Un fallo de la base en el SEGUNDO insert (un trigger que solo existe en esta base temporal) deshace el primero."""
    r = receta(admin, "Hogao", [(despensa["tomate"], 400, "g"), (despensa["cebolla"], 200, "g")])
    cx = sqlite3.connect(cliente.app.state.ruta_base)
    cx.execute("CREATE TRIGGER falla_cebolla BEFORE INSERT ON movimiento WHEN NEW.elemento_id = %d "
               "BEGIN SELECT RAISE(ABORT, 'fallo provocado'); END" % despensa["e_cebolla"])
    cx.commit()
    cx.close()
    antes, movs0 = saldos(admin), n_movimientos(cliente)
    res = cliente.post(f"/recetas/{r['id']}/cocinar", headers={"Authorization": f"Bearer {TOKEN_ADMIN}"}, json={
        "consumos": [{"elemento_id": despensa["e_tomate"], "cantidad": 400},
                     {"elemento_id": despensa["e_cebolla"], "cantidad": 200}]})
    assert res.status_code == 400 and "fallo provocado" in res.json()["error"]["mensaje"]  # la base lo rechazó
    assert n_movimientos(cliente) == movs0, "el consumo del tomate quedó escrito sin el de la cebolla"
    assert saldos(admin) == antes


def test_cocinar_valida_todo_antes_de_escribir(admin, despensa, cliente):
    r = receta(admin, "Hogao", [(despensa["tomate"], 400, "g")])
    movs0 = n_movimientos(cliente)
    url = f"/recetas/{r['id']}/cocinar"
    casos = [
        ([{"elemento_id": despensa["e_tomate"], "cantidad": 100}, {"elemento_id": despensa["e_arroz"], "cantidad": 1}],
         400),  # el arroz no es de la receta
        ([{"elemento_id": despensa["e_tomate"], "cantidad": 100}, {"elemento_id": despensa["e_tomate"], "cantidad": 1}],
         400),  # repetido
        ([{"elemento_id": despensa["e_tomate"], "cantidad": 2, "unidad": "cucharada"}], 400),
        ([{"elemento_id": 99999, "cantidad": 1}], 404),
    ]
    for consumos, codigo in casos:
        assert admin.post(url, json={"consumos": consumos}).status_code == codigo, consumos
    assert admin.post("/recetas/99999/cocinar", json={"consumos": [{"elemento_id": despensa["e_tomate"],
                                                                     "cantidad": 1}]}).status_code == 404
    assert n_movimientos(cliente) == movs0


def test_el_lector_no_cocina(admin, miembros, despensa, cliente):
    r = receta(admin, "Hogao", [(despensa["tomate"], 400, "g")])
    assert miembros["lector"].get("/recetas/sugeridas").status_code == 200
    res = miembros["lector"].post(f"/recetas/{r['id']}/cocinar",
                                  json={"consumos": [{"elemento_id": despensa["e_tomate"], "cantidad": 100}]})
    assert res.status_code == 403 and n_movimientos(cliente) == 0
    hecho = miembros["editor"].ok("POST", f"/recetas/{r['id']}/cocinar",
                                  json={"consumos": [{"elemento_id": despensa["e_tomate"], "cantidad": 100}]})
    assert hecho["movimientos"][0]["miembro"] == "editor de prueba"
