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


def test_ni_la_raiz_ni_los_estaticos_llevan_datos(cliente, admin, leche, ubic):
    """Con datos en la base, nada de lo que se sirve sin token los nombra: los datos solo salen de la API."""
    admin.ok("POST", "/elementos", json={"presentacion_id": leche["bolsa"], "ubicacion_id": ubic["nevera"]})
    for ruta in ("/", "/estatico/app.js", "/estatico/app.css"):
        r = cliente.get(ruta)  # sin cabecera Authorization
        assert r.status_code == 200
        assert "leche" not in r.text.lower() and "lácteos" not in r.text.lower(), ruta


def _llamadas_de_app_js() -> list[tuple[str, str]]:
    import re
    texto = open(os.path.join(RAIZ, "app", "estatico", "app.js"), encoding="utf-8").read()
    llamadas = []
    for metodo, ruta in re.findall(r'api\("([A-Z]+)",\s*[`"]([^`"]+)[`"]', texto):
        ruta = re.sub(r"\$\{[^}]+\}", "1", ruta).split("?", 1)[0]
        llamadas.append((metodo, ruta))
    return llamadas


def test_la_pantalla_solo_llama_endpoints_del_contrato():
    from conftest import _operacion
    llamadas = _llamadas_de_app_js()
    assert ("GET", "/miembros/yo") in llamadas and ("POST", "/importar") in llamadas
    for metodo, ruta in llamadas:
        plantilla, op = _operacion(metodo, ruta)
        assert op is not None, f"app.js llama {metodo} {ruta}, que no está en api/openapi.yaml"
        assert op.get("x-estado", "implementado") != "declarado", f"{metodo} {plantilla} es de la fase 2"


def test_la_pantalla_no_inyecta_html():
    """Lo que viene de la API entra con textContent: ningún sumidero de HTML en app.js."""
    import re
    texto = open(os.path.join(RAIZ, "app", "estatico", "app.js"), encoding="utf-8").read()
    for sumidero in (r"\.innerHTML\b", r"\.outerHTML\b", r"insertAdjacentHTML", r"document\.write", r"\beval\(",
                     r"new Function\("):
        assert not re.search(sumidero, texto), sumidero
