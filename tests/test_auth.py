"""1. Auth y roles (PEDIDO-NEVERA-2, bloque 3)."""
import io
import logging
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.main import crear_app
from conftest import TOKEN_ADMIN, Api


def test_sin_token_401(anonimo):
    r = anonimo.get("/elementos")
    assert r.status_code == 401
    assert r.json()["error"]["codigo"] == "no_autenticado"
    assert r.headers["www-authenticate"] == "Bearer"


def test_token_invalido_401(cliente):
    for cabecera in ("Bearer otro-token-que-no-existe-000", "Basic abc", "Bearer", "bearer " + TOKEN_ADMIN[:-1]):
        r = cliente.get("/elementos", headers={"Authorization": cabecera})
        assert r.status_code == 401, cabecera
        assert r.json()["error"]["codigo"] == "no_autenticado"


def test_salud_publica(anonimo):
    s = anonimo.ok("GET", "/salud")
    assert s["ok"] is True and s["esquema"] == 2


def test_lector_lee_y_no_escribe(miembros):
    lector = miembros["lector"]
    for url in ("/elementos", "/productos", "/categorias", "/vencimientos", "/indicadores", "/movimientos",
                "/miembros", "/miembros/yo"):
        assert lector.get(url).status_code == 200, url
    for url, cuerpo in (("/categorias", {"nombre": "x"}), ("/productos", {"nombre": "x", "categoria_id": 1,
                                                                          "unidad_base": "g"}),
                        ("/elementos", {"presentacion_id": 1, "ubicacion_id": 1}),
                        ("/movimientos", {"elemento_id": 1, "tipo": "consumo"})):
        r = lector.post(url, json=cuerpo)
        assert r.status_code == 403, url
        assert r.json()["error"]["codigo"] == "prohibido"
    assert lector.post("/importar", content=b"x").status_code == 403
    assert lector.delete("/productos/1").status_code == 403
    assert lector.get("/miembros/yo").json()["rol"] == "lector"


def test_editor_escribe_pero_no_administra_miembros(miembros, admin):
    editor = miembros["editor"]
    cat = editor.ok("POST", "/categorias", json={"nombre": "verduras"})
    editor.ok("POST", "/productos", json={"nombre": "tomate", "categoria_id": cat["id"], "unidad_base": "g"})
    r = editor.post("/miembros", json={"nombre": "intruso", "rol": "admin"})
    assert r.status_code == 403
    assert editor.patch(f"/miembros/{miembros['ids']['lector']}", json={"rol": "admin"}).status_code == 403
    assert editor.delete(f"/miembros/{miembros['ids']['lector']}").status_code == 403
    assert len(admin.ok("GET", "/miembros")) == 3  # no se coló nadie


def test_admin_todo(admin, miembros, leche, ubic):
    admin.ok("GET", "/miembros")
    m = admin.ok("POST", "/miembros", json={"nombre": "otro", "rol": "lector"})
    admin.ok("PATCH", f"/miembros/{m['id']}", json={"rol": "editor"})
    e = admin.ok("POST", "/elementos", json={"presentacion_id": leche["bolsa"], "ubicacion_id": ubic["nevera"]})
    admin.ok("POST", "/movimientos", json={"elemento_id": e[0]["id"], "tipo": "consumo", "cantidad": 100})
    assert admin.ok("DELETE", f"/miembros/{m['id']}")["modo"] == "fisico"


def test_roles_cambian_y_desactivar_corta_el_acceso(admin, miembros):
    lid = miembros["ids"]["lector"]
    admin.ok("PATCH", f"/miembros/{lid}", json={"rol": "editor"})
    assert miembros["lector"].post("/categorias", json={"nombre": "granos"}).status_code == 201
    admin.ok("PATCH", f"/miembros/{lid}", json={"activo": False})
    assert miembros["lector"].get("/elementos").status_code == 401


def test_renovar_token_invalida_el_anterior(admin, miembros, cliente):
    eid = miembros["ids"]["editor"]
    nuevo = admin.ok("PATCH", f"/miembros/{eid}", json={"renovar_token": True})["token"]
    assert miembros["editor"].get("/elementos").status_code == 401
    assert Api(cliente, nuevo).get("/elementos").status_code == 200


def test_ultimo_admin_no_se_pierde(admin):
    yo = admin.ok("GET", "/miembros/yo")
    for metodo, cuerpo in (("PATCH", {"rol": "editor"}), ("PATCH", {"activo": False}), ("DELETE", None)):
        r = admin.pedir(metodo, f"/miembros/{yo['id']}", **({"json": cuerpo} if cuerpo else {}))
        assert r.status_code == 409 and r.json()["error"]["codigo"] == "ultimo_admin"


def test_token_hasheado_con_sal_en_la_base(admin, miembros, datos):
    cx = sqlite3.connect(f"{datos}/nevera.db")
    filas = cx.execute("SELECT token_hash FROM miembro").fetchall()
    cx.close()
    sales = set()
    for (h,) in filas:
        esquema, sal, digesto = h.split("$")
        assert esquema == "sha256" and len(digesto) == 64
        sales.add(sal)
        for t in (TOKEN_ADMIN, *miembros["tokens"].values()):
            assert t not in h
    assert len(sales) == len(filas)  # sal por miembro


def test_el_token_no_aparece_en_logs(datos, capfd):
    """Arranque, peticiones buenas y malas, alta y renovación de miembros y un 500: ningún token en ningún log."""
    salida = io.StringIO()
    manejador = logging.StreamHandler(salida)
    manejador.setLevel(logging.DEBUG)
    registradores = [logging.getLogger(n) for n in ("", "nevera", "uvicorn", "uvicorn.access", "uvicorn.error",
                                                     "fastapi", "httpx")]
    niveles = [r.level for r in registradores]
    for r in registradores:
        r.addHandler(manejador)
        r.setLevel(logging.DEBUG)
    tokens = [TOKEN_ADMIN]
    try:
        app = crear_app(datos, TOKEN_ADMIN)

        @app.get("/__falla")  # ruta solo de esta prueba: fuerza el manejador de 500
        def _falla():
            raise RuntimeError("falla a propósito")

        with TestClient(app, raise_server_exceptions=False) as c:
            h = {"Authorization": f"Bearer {TOKEN_ADMIN}"}
            m = c.post("/miembros", json={"nombre": "alguien", "rol": "editor"}, headers=h).json()
            tokens.append(m["token"])
            tokens.append(c.patch(f"/miembros/{m['id']}", json={"renovar_token": True}, headers=h).json()["token"])
            c.get("/elementos", headers={"Authorization": "Bearer token-falso-que-no-existe-12345"})
            tokens.append("token-falso-que-no-existe-12345")
            c.post("/categorias", json={"nombre": TOKEN_ADMIN, "extra": TOKEN_ADMIN}, headers=h)  # 400
            assert c.get("/__falla", headers=h).status_code == 500
        # Y un segundo arranque sobre la misma base con token: se ignora y lo dice, sin imprimirlo.
        with TestClient(crear_app(datos, TOKEN_ADMIN)) as c:
            c.get("/salud")
    finally:
        for r, n in zip(registradores, niveles):
            r.removeHandler(manejador)
            r.setLevel(n)
    capturado = capfd.readouterr()
    todo = salida.getvalue() + capturado.out + capturado.err
    assert "admin" in todo and "error no previsto" in todo  # el log sí registró cosas
    for t in tokens:
        assert t not in todo


def test_sin_token_de_entorno_no_arranca(datos):
    with pytest.raises(Exception, match="NEVERA_ADMIN_TOKEN"):
        with TestClient(crear_app(datos, None)):
            pass


@pytest.mark.parametrize("malo", ["corto", "con espacios dentro de él 1234"])
def test_token_de_entorno_debil_no_arranca(datos, malo):
    with pytest.raises(Exception):
        with TestClient(crear_app(datos, malo)):
            pass


def test_con_miembros_el_token_de_entorno_se_ignora(datos):
    with TestClient(crear_app(datos, TOKEN_ADMIN)):
        pass
    otro = "otro-token-de-entorno-0123456789"
    with TestClient(crear_app(datos, otro)) as c:
        assert c.get("/elementos", headers={"Authorization": f"Bearer {otro}"}).status_code == 401
        assert c.get("/elementos", headers={"Authorization": f"Bearer {TOKEN_ADMIN}"}).status_code == 200
