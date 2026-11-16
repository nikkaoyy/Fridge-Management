"""7. Importador: simular no escribe, lo válido entra en una transacción, una fila mala no deja nada."""
import os
import sqlite3

CAB = "nombre,categoria,unidad,cantidad,fecha_compra,fecha_vencimiento,precio_unitario,ubicacion,etiqueta\n"


def csv_valido(f):
    return (CAB +
            f"tomate,verduras,kg,1.2,{f['mas'](-1)},,3000,,\n"
            f"leche,lácteos,l,1,{f['mas'](-1)},{f['mas'](6)},4500,nevera,\n"
            f"leche,lácteos,l,1,{f['mas'](-1)},{f['mas'](6)},4500,nevera,\n"      # D1: dos bolsas, dos filas
            "\n"
            f"arroz,granos,g,500,{f['hoy']},,2800,despensa,bolsa abierta\n")


def conteos(datos):
    cx = sqlite3.connect(os.path.join(datos, "nevera.db"))
    try:
        return {t: cx.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in ("categoria", "producto", "presentacion", "compra", "compra_linea", "elemento")}
    finally:
        cx.close()


def importar(api, texto, simular=False):
    return api.post("/importar" + ("?simular=1" if simular else ""), content=texto.encode(),
                    headers={"Content-Type": "text/csv"})


def test_simular_no_escribe(admin, datos, fechas):
    antes = conteos(datos)
    r = importar(admin, csv_valido(fechas), simular=True)
    assert r.status_code == 200, r.text
    res = r.json()
    # `filas` son las filas de datos leídas sin la cabecera, vacías incluidas (el contrato las llama «filas vacías» y
    # las reporta en `omitidos` con su número de línea): 4 con datos + la línea 5 en blanco.
    assert res["simulado"] is True and res["filas"] == 5 and res["creados"] == 4
    assert sorted(res["productos_nuevos"]) == ["arroz", "leche", "tomate"] and res["compras"] == 2
    assert res["omitidos"] == [{"fila": 5, "motivo": "fila vacía"}]
    assert conteos(datos) == antes


def test_validos_entran(admin, datos, fechas, miembros):
    antes = conteos(datos)
    r = importar(miembros["editor"], csv_valido(fechas))
    assert r.status_code == 200, r.text
    assert r.json()["simulado"] is False and r.json()["creados"] == 4
    despues = conteos(datos)
    assert despues["producto"] == antes["producto"] + 3 and despues["elemento"] == 4 and despues["compra"] == 2
    lista = admin.ok("GET", "/elementos")
    assert len(lista) == 4 and all(e["alta_por"] == miembros["ids"]["editor"] for e in lista)
    tomate = next(e for e in lista if e["producto"] == "tomate")
    assert tomate["unidad_base"] == "g" and tomate["saldo"] == 1200 and tomate["precio_unitario_cop"] == 3000
    leches = [e for e in lista if e["producto"] == "leche"]
    assert len(leches) == 2 and all(e["saldo"] == 1000 and e["vencimiento_origen"] == "manual" for e in leches)
    arroz = next(e for e in lista if e["producto"] == "arroz")
    ubic = {u["id"]: u["nombre"] for u in admin.ok("GET", "/ubicaciones")}
    assert ubic[arroz["ubicacion_id"]] == "despensa" and arroz["etiqueta"] == "bolsa abierta"
    assert ubic[tomate["ubicacion_id"]] == "nevera"  # por defecto


def test_una_fila_mala_no_deja_nada(admin, datos, fechas):
    antes = conteos(datos)
    texto = csv_valido(fechas) + f"pera,frutas,u,dos,{fechas['hoy']},,1000,,\n"  # línea 7
    r = importar(admin, texto)
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["codigo"] == "csv_invalido" and err["detalle"]["fila"] == 7 and "cantidad" in err["detalle"]["motivo"]
    assert conteos(datos) == antes
    assert admin.ok("GET", "/productos") == [] and admin.ok("GET", "/categorias") == []


def test_fila_mala_en_medio_tampoco(admin, datos, fechas):
    antes = conteos(datos)
    texto = (CAB + f"tomate,verduras,kg,1,{fechas['hoy']},,3000,,\n"
             f"leche,lácteos,kg,1,{fechas['hoy']},,4500,,\n"
             f"leche,lácteos,ml,1000,{fechas['hoy']},,4500,,\n")  # línea 4: kg y luego ml → magnitud distinta
    r = importar(admin, texto)
    assert r.status_code == 400 and r.json()["error"]["detalle"]["fila"] == 4
    assert conteos(datos) == antes


def test_cabecera_mala(admin, datos):
    r = importar(admin, "nombre,cosa\nx,y\n")
    assert r.status_code == 400 and r.json()["error"]["detalle"]["fila"] == 1
    r = importar(admin, "")
    assert r.status_code == 400


def test_errores_variados_dan_su_fila(admin, fechas):
    casos = {
        f"x,c,zz,1,{fechas['hoy']},,1,,": "unidad",
        f"x,c,g,1,15/11/2026,,1,,": "fecha_compra",
        f"x,c,g,1,{fechas['hoy']},mañana,1,,": "fecha_vencimiento",
        f"x,c,g,1,{fechas['hoy']},,1.500,,": "precio_unitario",
        f"x,c,g,1,{fechas['hoy']},,1,sótano,": "ubicacion",
        f"x,c,g,1,{fechas['mas'](3)},,1,,": "futura",   # «fecha_compra … es futura»
    }
    for fila, palabra in casos.items():
        r = importar(admin, CAB + fila + "\n")
        assert r.status_code == 400, fila
        assert r.json()["error"]["detalle"]["fila"] == 2
        assert palabra in r.json()["error"]["mensaje"], (fila, r.json())
