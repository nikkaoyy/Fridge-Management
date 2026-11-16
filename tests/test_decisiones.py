"""2-5. D1, D3, D4 y por_vencer (PEDIDO-NEVERA-2, bloque 3)."""
import base64
import os
import sqlite3


def alta(api, pres, ubic, **kw):
    return api.ok("POST", "/elementos", json={"presentacion_id": pres, "ubicacion_id": ubic} | kw)


def leche_disponible(api, producto):
    return api.ok("GET", f"/elementos?producto_id={producto}")


# ---------------------------------------------------------------- D1

def test_d1_seis_bolsas_son_seis_elementos(admin, leche, ubic):
    creados = alta(admin, leche["bolsa"], ubic["nevera"], unidades=6, precio_unitario_cop=4500)
    assert len(creados) == 6 and len({e["id"] for e in creados}) == 6
    lista = leche_disponible(admin, leche["producto"])
    assert sorted(e["id"] for e in lista) == sorted(e["id"] for e in creados)
    assert all(e["saldo"] == 1000 and e["cantidad_inicial"] == 1000 and e["padre_id"] is None for e in lista)
    assert admin.ok("GET", "/indicadores")["elementos_disponibles"] == 6
    assert len({e["compra_id"] for e in lista}) == 1  # misma compra, seis cosas


def test_d1_una_bolsa_se_consume_sola(admin, leche, ubic):
    a, b = alta(admin, leche["bolsa"], ubic["nevera"], unidades=2)
    admin.ok("POST", "/movimientos", json={"elemento_id": a["id"], "tipo": "consumo"})
    lista = leche_disponible(admin, leche["producto"])
    assert [e["id"] for e in lista] == [b["id"]]


# ---------------------------------------------------------------- D3

def test_d3_pack_de_12_es_padre_y_12_hijos(admin, leche, ubic):
    creados = alta(admin, leche["pack"], ubic["nevera"], precio_unitario_cop=48000)
    assert len(creados) == 13
    padre = creados[0]
    hijos = [e for e in creados if e["padre_id"] == padre["id"]]
    assert padre["padre_id"] is None and len(hijos) == 12
    assert all(h["presentacion_id"] == leche["bolsa"] and h["saldo"] == 1000 for h in hijos)
    assert padre["precio_unitario_cop"] == 48000 and all(h["precio_unitario_cop"] is None for h in hijos)
    det = admin.ok("GET", f"/elementos/{padre['id']}")
    assert sorted(det["hijos"]) == sorted(h["id"] for h in hijos)
    assert det["saldo"] == 12000  # el padre resume a sus hijos, pero no se cuenta


def test_d3_el_saldo_de_leche_no_cuenta_el_padre(admin, leche, ubic):
    padre = alta(admin, leche["pack"], ubic["nevera"])[0]
    lista = leche_disponible(admin, leche["producto"])
    assert len(lista) == 12 and padre["id"] not in {e["id"] for e in lista}
    assert sum(e["saldo"] for e in lista) == 12000  # 12 L, no 24
    assert admin.ok("GET", "/indicadores")["elementos_disponibles"] == 12
    vto = admin.ok("GET", "/vencimientos?dias=30")
    assert len(vto["proximos"]) == 12 and padre["id"] not in {e["id"] for e in vto["proximos"]}


def test_d3_movimiento_sobre_el_pack_es_409(admin, leche, ubic):
    padre = alta(admin, leche["pack"], ubic["nevera"])[0]
    r = admin.post("/movimientos", json={"elemento_id": padre["id"], "tipo": "consumo"})
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "es_pack"


def test_d3_al_consumir_hijos_baja_el_saldo_del_padre(admin, leche, ubic):
    creados = alta(admin, leche["pack"], ubic["nevera"])
    padre, hijo = creados[0], creados[1]
    admin.ok("POST", "/movimientos", json={"elemento_id": hijo["id"], "tipo": "consumo"})
    assert admin.ok("GET", f"/elementos/{padre['id']}")["saldo"] == 11000
    assert len(leche_disponible(admin, leche["producto"])) == 11


def test_d3_abrir_pack_y_abrir_bolsa(admin, leche, ubic, fechas):
    creados = alta(admin, leche["pack"], ubic["nevera"])
    padre, hijo, otro = creados[0], creados[1], creados[2]
    assert hijo["vencimiento"] == fechas["mas"](7) and hijo["vencimiento_origen"] == "estimado"

    p = admin.ok("PATCH", f"/elementos/{padre['id']}", json={"abierto_en": fechas["hoy"]})
    assert p["abierto_en"] == fechas["hoy"]
    h = admin.ok("GET", f"/elementos/{hijo['id']}")
    assert h["abierto_en"] is None and h["vencimiento"] == fechas["mas"](7)  # abrir el pack no abre las bolsas

    h = admin.ok("PATCH", f"/elementos/{hijo['id']}", json={"abierto_en": fechas["hoy"]})
    assert h["abierto_en"] == fechas["hoy"]
    assert h["vencimiento"] == fechas["mas"](3)  # dias_abierto = 3 manda sobre los 7 de cerrada
    assert h["vencimiento_origen"] == "estimado"
    assert admin.ok("GET", f"/elementos/{otro['id']}")["vencimiento"] == fechas["mas"](7)  # la vecina no se mueve


def test_d3_abrir_no_alarga_un_vencimiento_impreso_cercano(admin, leche, ubic, fechas):
    e = alta(admin, leche["bolsa"], ubic["nevera"], vencimiento=fechas["mas"](1), vencimiento_impreso=True)[0]
    assert e["vencimiento_origen"] == "impreso"
    e = admin.ok("PATCH", f"/elementos/{e['id']}", json={"abierto_en": fechas["hoy"]})
    assert e["vencimiento"] == fechas["mas"](1) and e["vencimiento_origen"] == "impreso"


def test_d3_abierta_ayer_se_mueve_con_dias_abierto(admin, leche, ubic, fechas):
    e = alta(admin, leche["bolsa"], ubic["nevera"], fecha_compra=fechas["mas"](-5))[0]
    assert e["vencimiento"] == fechas["mas"](2)
    e = admin.ok("PATCH", f"/elementos/{e['id']}", json={"abierto_en": fechas["mas"](-4)})
    assert e["vencimiento"] == fechas["mas"](-1) and e["dias_para_vencer"] == -1
    assert e["id"] in {x["id"] for x in admin.ok("GET", "/vencimientos")["vencidos"]}


# ---------------------------------------------------------------- D4

def test_d4_movimiento_sin_cantidad_deja_saldo_cero(admin, leche, ubic):
    e = alta(admin, leche["bolsa"], ubic["nevera"])[0]
    m = admin.ok("POST", "/movimientos", json={"elemento_id": e["id"], "tipo": "consumo"})
    assert m["cantidad"] == 1000 and m["saldo"] == 0
    assert admin.ok("GET", f"/elementos/{e['id']}")["saldo"] == 0
    assert leche_disponible(admin, leche["producto"]) == []
    assert [x["id"] for x in admin.ok("GET", "/elementos?estado=agotado")] == [e["id"]]
    r = admin.post("/movimientos", json={"elemento_id": e["id"], "tipo": "consumo"})
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "agotado"


def test_d4_movimiento_con_cantidad_descuenta_eso(admin, leche, ubic):
    e = alta(admin, leche["bolsa"], ubic["nevera"])[0]
    admin.ok("POST", "/movimientos", json={"elemento_id": e["id"], "tipo": "consumo", "cantidad": 250})
    assert admin.ok("GET", f"/elementos/{e['id']}")["saldo"] == 750
    admin.ok("POST", "/movimientos", json={"elemento_id": e["id"], "tipo": "merma", "cantidad": 0.5, "unidad": "l",
                                           "motivo": "se cortó"})
    assert admin.ok("GET", f"/elementos/{e['id']}")["saldo"] == 250
    r = admin.post("/movimientos", json={"elemento_id": e["id"], "tipo": "consumo", "cantidad": 300})
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "saldo_negativo"
    r = admin.post("/movimientos", json={"elemento_id": e["id"], "tipo": "consumo", "cantidad": 1, "unidad": "g"})
    assert r.status_code == 400  # gramos de leche: otra magnitud
    movs = admin.ok("GET", f"/movimientos?elemento_id={e['id']}")
    assert [m["saldo"] for m in movs] == [750, 250]
    assert all(m["miembro"] == "admin" for m in movs)
    assert admin.ok("GET", "/indicadores")["mermas_30_dias"] == 1


def test_d4_ajuste_negativo_devuelve_saldo(admin, leche, ubic):
    e = alta(admin, leche["bolsa"], ubic["nevera"])[0]
    admin.ok("POST", "/movimientos", json={"elemento_id": e["id"], "tipo": "consumo", "cantidad": 400})
    admin.ok("POST", "/movimientos", json={"elemento_id": e["id"], "tipo": "ajuste", "cantidad": -100})
    assert admin.ok("GET", f"/elementos/{e['id']}")["saldo"] == 700
    r = admin.post("/movimientos", json={"elemento_id": e["id"], "tipo": "consumo", "cantidad": -1})
    assert r.status_code == 400


# ---------------------------------------------------------------- por_vencer

def test_por_vencer_7_exactamente_lo_que_esta_en_rango(admin, leche, ubic, fechas):
    def con_vto(dias, etiqueta):
        return alta(admin, leche["bolsa"], ubic["nevera"], fecha_compra=fechas["mas"](-10),
                    vencimiento=fechas["mas"](dias), etiqueta=etiqueta)[0]["id"]
    vencido = con_vto(-1, "vencido ayer")
    hoy_ = con_vto(0, "vence hoy")
    borde = con_vto(7, "vence en 7")
    fuera = con_vto(8, "vence en 8")
    consumido = con_vto(3, "consumido")
    sin_vto = admin.ok("POST", "/productos", json={"nombre": "sal", "categoria_id": leche["categoria"],
                                                   "unidad_base": "g", "perecedero": False})
    granel = admin.ok("GET", f"/presentaciones?producto_id={sin_vto['id']}")
    pres = granel[0]["id"] if granel else admin.ok("POST", "/presentaciones", json={
        "producto_id": sin_vto["id"], "nombre": "a granel"})["id"]
    alta(admin, pres, ubic["nevera"], cantidad=500, unidad="g")
    admin.ok("POST", "/movimientos", json={"elemento_id": consumido, "tipo": "consumo"})

    lista = admin.ok("GET", "/elementos?por_vencer=7")
    assert [e["id"] for e in lista] == [vencido, hoy_, borde]  # ordenados por vencimiento, sin el consumido
    assert [e["id"] for e in admin.ok("GET", "/elementos?por_vencer=0")] == [vencido, hoy_]
    assert fuera in {e["id"] for e in admin.ok("GET", "/elementos?por_vencer=8")}
    assert consumido not in {e["id"] for e in admin.ok("GET", "/elementos?por_vencer=30")}
    assert admin.get("/elementos?por_vencer=-1").status_code == 400

    v = admin.ok("GET", "/vencimientos?dias=7")
    assert [e["id"] for e in v["vencidos"]] == [vencido]
    assert [e["id"] for e in v["hoy_vencen"]] == [hoy_]
    assert [e["id"] for e in v["proximos"]] == [borde]
    assert v["sin_vencimiento"] == 0  # la sal no es perecedera
    ind = admin.ok("GET", "/indicadores")
    assert ind["vencidos"] == 1 and ind["por_vencer_7"] == 2


def test_por_vencer_con_pack_cuenta_hojas(admin, leche, ubic):
    alta(admin, leche["pack"], ubic["nevera"])
    assert len(admin.ok("GET", "/elementos?por_vencer=7")) == 12


# ---------------------------------------------------------------- D5: foto opcional en el alta

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def test_d5_foto_en_el_alta(admin, leche, ubic, datos):
    e = alta(admin, leche["bolsa"], ubic["nevera"], foto=base64.b64encode(PNG).decode())[0]
    det = admin.ok("GET", f"/elementos/{e['id']}")
    assert len(det["fotos"]) == 1
    ruta = det["fotos"][0]["ruta"]
    assert ruta.startswith(f"fotos/{leche['producto']}/") and ruta.endswith(".png")
    with open(os.path.join(datos, ruta), "rb") as f:
        assert f.read() == PNG


def test_d5_foto_mala_no_deja_nada(admin, leche, ubic, datos):
    r = admin.post("/elementos", json={"presentacion_id": leche["bolsa"], "ubicacion_id": ubic["nevera"],
                                       "foto": base64.b64encode(b"no soy imagen").decode()})
    assert r.status_code == 400
    r = admin.post("/elementos", json={"presentacion_id": leche["bolsa"], "ubicacion_id": 999,
                                       "foto": base64.b64encode(PNG).decode()})
    assert r.status_code == 404
    assert admin.ok("GET", "/elementos?estado=todos") == []
    assert not os.path.exists(os.path.join(datos, "fotos")) or not any(
        fs for _, _, fs in os.walk(os.path.join(datos, "fotos")))
    cx = sqlite3.connect(os.path.join(datos, "nevera.db"))
    assert cx.execute("SELECT COUNT(*) FROM producto_foto").fetchone()[0] == 0
    cx.close()


def test_atribucion(admin, miembros, leche, ubic, datos):
    e = alta(miembros["editor"], leche["bolsa"], ubic["nevera"])[0]
    assert e["alta_por"] == miembros["ids"]["editor"]
    m = miembros["editor"].ok("POST", "/movimientos", json={"elemento_id": e["id"], "tipo": "consumo"})
    assert m["miembro_id"] == miembros["ids"]["editor"] and m["miembro"] == "editor de prueba"
    cx = sqlite3.connect(os.path.join(datos, "nevera.db"))
    assert cx.execute("SELECT registrada_por FROM compra").fetchone()[0] == miembros["ids"]["editor"]
    cx.close()
    # con historia, borrar al miembro es lógico
    assert admin.ok("DELETE", f"/miembros/{miembros['ids']['editor']}")["modo"] == "logico"
