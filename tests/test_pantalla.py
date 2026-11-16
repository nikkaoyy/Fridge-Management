"""La pantalla (PEDIDO-NEVERA-3): / y /estatico/* se sirven sin token, no llevan datos y no tocan la API.

Estas peticiones van con el TestClient a pelo (no con `Api`): / y /estatico/* no son del contrato.
"""
from __future__ import annotations

import os

from conftest import RAIZ, SPEC


def test_raiz_devuelve_el_html_sin_redirect(cliente):
    r = cliente.get("/", follow_redirects=False)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert r.text.lstrip().lower().startswith("<!doctype html>")
    assert '<script src="/estatico/app.js"' in r.text
    assert "script-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-cache"
    assert cliente.head("/").status_code == 200


def test_estaticos_se_sirven_y_nada_mas(cliente):
    js = cliente.get("/estatico/app.js")
    css = cliente.get("/estatico/app.css")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"]
    assert css.status_code == 200 and css.headers["content-type"].startswith("text/css")
    assert "default-src 'self'" in js.headers["content-security-policy"]
    # ni archivos que no existen ni salirse del directorio (la base y el token están en data/, fuera de él)
    for ruta in ("/estatico/no-existe.js", "/estatico/../main.py", "/estatico/%2e%2e/main.py",
                 "/estatico/../../data/nevera.db"):
        r = cliente.get(ruta)
        assert r.status_code == 404, ruta
        assert "def crear_app" not in r.text


def test_la_api_no_cambia_de_rutas(cliente):
    """Fuera de / y /estatico/*, cada ruta de la app está en el contrato y viceversa (por método)."""
    # el esquema que FastAPI deduce de sus rutas (no se publica: openapi_url=None) aplana los routers incluidos
    en_app = {(m.upper(), ruta) for ruta, item in cliente.app.openapi()["paths"].items() for m in item}
    en_contrato = {(m.upper(), ruta) for ruta, item in SPEC["paths"].items() for m in item
                   if m in ("get", "post", "put", "patch", "delete")}
    assert en_app == en_contrato


def test_los_estaticos_vienen_del_repositorio():
    for nombre in ("index.html", "app.js", "app.css"):
        assert os.path.isfile(os.path.join(RAIZ, "app", "estatico", nombre)), nombre
