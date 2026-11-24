"""La pantalla (PEDIDO-NEVERA-4): FastAPI sirve el build de React (`web/dist`) sin token, sin datos y sin tocar la API.

Estas peticiones van con el TestClient a pelo (no con `Api`): `/`, `/assets/*`, `/fonts/*` y `/favicon.svg` no son
del contrato. Las pruebas de servir usan un `web/dist` falso en `tmp_path`, así la suite no depende de haber corrido
`npm run build`; las del código fuente miran `web/` del repositorio.
"""
from __future__ import annotations

import base64
import glob
import hashlib
import os
import re
import subprocess

import pytest
from fastapi.testclient import TestClient

from conftest import RAIZ, SPEC, TOKEN_ADMIN, Api, _operacion
from app import pantalla
from app.main import crear_app

WEB = os.path.join(RAIZ, "web")
TOKENS_ARIA = "/opt/data/pythagoras/web/src/styles/tokens.css"
ESTILO_FALSO = ":root{--void-900:#070b12}"
INDICE_FALSO = (f'<!doctype html>\n<html lang="es"><head><style id="piel-aria">{ESTILO_FALSO}</style>'
                '<script type="module" crossorigin src="/assets/index-abc123.js"></script></head>'
                '<body><div id="raiz"></div></body></html>\n')


def _sha(texto: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(texto.encode()).digest()).decode() + "'"


@pytest.fixture
def dist_falso(tmp_path):
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "fonts").mkdir()
    (d / "index.html").write_text(INDICE_FALSO, encoding="utf-8")
    (d / "assets" / "index-abc123.js").write_text("console.log('nevera')\n", encoding="utf-8")
    (d / "assets" / "index-abc123.css").write_text("body{color:var(--ink)}\n", encoding="utf-8")
    (d / "fonts" / "inter.woff2").write_bytes(b"wOF2\x00\x01")
    (d / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    return str(d)


def _cliente_con(monkeypatch, tmp_path, dist):
    monkeypatch.setattr(pantalla, "DIST", dist)
    datos = tmp_path / "datos"
    datos.mkdir()
    return TestClient(crear_app(str(datos), TOKEN_ADMIN))


@pytest.fixture
def con_build(monkeypatch, tmp_path, dist_falso):
    with _cliente_con(monkeypatch, tmp_path, dist_falso) as c:
        yield c


@pytest.fixture
def sin_build(monkeypatch, tmp_path):
    with _cliente_con(monkeypatch, tmp_path, str(tmp_path / "no-hay-dist")) as c:
        yield c


# ---------------------------------------------------------------- servir el build

def test_raiz_devuelve_el_index_del_build_sin_redirect(con_build):
    r = con_build.get("/", follow_redirects=False)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert r.text == INDICE_FALSO
    assert r.headers["cache-control"] == "no-cache"
    assert con_build.head("/").status_code == 200


def test_la_csp_solo_deja_los_estilos_en_linea_del_index_por_su_hash(con_build):
    csp = con_build.get("/").headers["content-security-policy"]
    directivas = dict(d.strip().split(" ", 1) for d in csp.split(";"))
    assert directivas["script-src"] == "'self'"                       # ningún script en línea
    assert directivas["style-src"] == "'self' " + _sha(ESTILO_FALSO)  # solo el <style> que trae el index
    assert "unsafe-inline" not in csp and "unsafe-eval" not in csp
    assert directivas["default-src"] == "'self'" and directivas["frame-ancestors"] == "'none'"


def test_assets_fuentes_y_favicon_con_su_ruta(con_build):
    js = con_build.get("/assets/index-abc123.js")
    css = con_build.get("/assets/index-abc123.css")
    fuente = con_build.get("/fonts/inter.woff2")
    icono = con_build.get("/favicon.svg")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"]
    assert css.status_code == 200 and css.headers["content-type"].startswith("text/css")
    assert fuente.status_code == 200 and fuente.content == b"wOF2\x00\x01"
    assert icono.status_code == 200 and icono.headers["content-type"].startswith("image/svg+xml")
    assert "immutable" in js.headers["cache-control"]                 # llevan hash en el nombre
    assert js.headers["x-content-type-options"] == "nosniff"


def test_nada_fuera_del_build(con_build):
    # ni archivos que no existen ni salirse del directorio (la base y el token están en data/, fuera de él)
    for ruta in ("/assets/no-existe.js", "/assets/../index.html", "/assets/%2e%2e/%2e%2e/app/main.py",
                 "/fonts/../../data/nevera.db", "/assets/../../../app/main.py", "/index.html", "/app.js"):
        r = con_build.get(ruta)
        assert r.status_code == 404, ruta
        assert "def crear_app" not in r.text


def test_sin_build_la_raiz_dice_como_construirlo(sin_build):
    r = sin_build.get("/")
    assert r.status_code == 503                                       # no un 404 mudo
    assert r.headers["content-type"].startswith("text/html")
    assert "npm run build" in r.text and "npm ci" in r.text and "cd web" in r.text
    assert sin_build.get("/assets/index-abc123.js").status_code == 404  # 404, no un 500
    assert sin_build.get("/favicon.svg").status_code == 404
    assert sin_build.get("/salud").json()["ok"] is True                # la API sigue viva


def test_la_api_no_cambia_de_rutas(cliente):
    """Fuera de la pantalla, cada ruta de la app está en el contrato y viceversa (por método)."""
    # el esquema que FastAPI deduce de sus rutas (no se publica: openapi_url=None) aplana los routers incluidos
    en_app = {(m.upper(), ruta) for ruta, item in cliente.app.openapi()["paths"].items() for m in item}
    en_contrato = {(m.upper(), ruta) for ruta, item in SPEC["paths"].items() for m in item
                   if m in ("get", "post", "put", "patch", "delete")}
    assert en_app == en_contrato


def test_ni_la_raiz_ni_los_estaticos_llevan_datos(con_build, leche_en_build):
    """Con datos en la base, nada de lo que se sirve sin token los nombra: los datos solo salen de la API."""
    rutas = ["/", "/assets/index-abc123.js", "/assets/index-abc123.css", "/favicon.svg"]
    real = os.path.join(WEB, "dist", "assets")
    for ruta in rutas:
        r = con_build.get(ruta)  # sin cabecera Authorization
        assert r.status_code == 200
        assert "leche" not in r.text.lower() and "lácteos" not in r.text.lower(), ruta
    # y si el build de verdad está hecho, tampoco nombra nada de la casa (no se metió un dato en el bundle)
    for archivo in glob.glob(os.path.join(real, "*")):
        texto = open(archivo, encoding="utf-8", errors="ignore").read().lower()
        assert "pierna" not in texto and "pernil" not in texto, archivo


@pytest.fixture
def leche_en_build(con_build):
    admin = Api(con_build, TOKEN_ADMIN)
    cat = admin.ok("POST", "/categorias", json={"nombre": "lácteos"})
    p = admin.ok("POST", "/productos", json={"nombre": "leche", "categoria_id": cat["id"], "unidad_base": "ml"})
    pres = admin.ok("POST", "/presentaciones", json={"producto_id": p["id"], "nombre": "bolsa 1 L",
                                                     "contenido": 1, "unidad": "l"})
    ubic = {u["nombre"]: u["id"] for u in admin.ok("GET", "/ubicaciones")}
    admin.ok("POST", "/elementos", json={"presentacion_id": pres["id"], "ubicacion_id": ubic["nevera"]})


# ---------------------------------------------------------------- el código del front (web/)

def _fuentes() -> dict[str, str]:
    archivos = glob.glob(os.path.join(WEB, "src", "**", "*.ts"), recursive=True)
    archivos += glob.glob(os.path.join(WEB, "src", "**", "*.tsx"), recursive=True)
    return {a: open(a, encoding="utf-8").read() for a in sorted(archivos)}


def _llamadas() -> list[tuple[str, str]]:
    llamadas = []
    for texto in _fuentes().values():
        for metodo, ruta in re.findall(r'api(?:<[^>(]*>)?\(\s*"([A-Z]+)",\s*[`"]([^`"]+)[`"]', texto):
            ruta = re.sub(r"\$\{[^}]+\}", "1", ruta).split("?", 1)[0]
            llamadas.append((metodo, ruta))
    return llamadas


def test_el_front_existe_y_se_construye_con_vite():
    for nombre in ("package.json", "package-lock.json", "index.html", "vite.config.ts", "tsconfig.json",
                   "src/main.tsx", "src/App.tsx", "src/api.ts"):
        assert os.path.isfile(os.path.join(WEB, nombre)), nombre
    paquete = open(os.path.join(WEB, "package.json"), encoding="utf-8").read()
    assert '"build": "tsc -p tsconfig.json --noEmit && vite build"' in paquete
    assert 'outDir: "dist"' in open(os.path.join(WEB, "vite.config.ts"), encoding="utf-8").read()


def test_el_front_solo_llama_endpoints_del_contrato():
    llamadas = _llamadas()
    assert ("GET", "/miembros/yo") in llamadas and ("GET", "/elementos") in llamadas
    for metodo, ruta in llamadas:
        plantilla, op = _operacion(metodo, ruta)
        assert op is not None, f"web/src llama {metodo} {ruta}, que no está en api/openapi.yaml"
        assert op.get("x-estado", "implementado") != "declarado", f"{metodo} {plantilla} es de la fase 2"
    # y no hay fetch a otra cosa: toda llamada pasa por api()
    for archivo, texto in _fuentes().items():
        if not archivo.endswith("api.ts"):
            assert "fetch(" not in texto, archivo


def test_el_titulo_sin_emojis():
    """PEDIDO-NEVERA-5: el título es «Nevera · la casa de ARIA», tal cual, y en el front no hay emojis."""
    indice = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
    assert re.findall(r"<title>(.*?)</title>", indice) == ["Nevera · la casa de ARIA"]
    emoji = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]")
    for archivo, texto in {os.path.join(WEB, "index.html"): indice, **_fuentes()}.items():
        assert not emoji.search(texto), f"{archivo}: {emoji.search(texto).group()!r}"


def test_las_recetas_vacias_dicen_su_frase():
    texto = open(os.path.join(WEB, "src", "componentes", "Recetas.tsx"), encoding="utf-8").read()
    assert "Todavía no hay recetas: crea la primera con lo que sueles cocinar." in texto
    llamadas = set(_llamadas())
    for esperada in (("GET", "/recetas"), ("GET", "/recetas/sugeridas"), ("POST", "/recetas"),
                     ("POST", "/recetas/1/versiones"), ("POST", "/recetas/1/cocinar"), ("GET", "/recetas/1")):
        assert esperada in llamadas, esperada


def test_el_front_no_inyecta_html():
    """Lo que viene de la API entra como texto (JSX lo escapa): ningún sumidero de HTML en web/src."""
    for archivo, texto in _fuentes().items():
        for sumidero in (r"dangerouslySetInnerHTML", r"\.innerHTML\b", r"\.outerHTML\b", r"insertAdjacentHTML",
                         r"document\.write", r"\beval\(", r"new Function\("):
            assert not re.search(sumidero, texto), f"{archivo}: {sumidero}"


# ---------------------------------------------------------------- la piel

def _bloque(html: str, ident: str) -> str:
    m = re.search(rf'<style id="{ident}">\n?(.*?)\s*</style>', html, re.S)
    assert m, ident
    return m.group(1)


def _variables(css: str) -> dict[str, str]:
    sin_comentarios = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    return {k: re.sub(r"\s+", " ", v.strip()) for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", sin_comentarios)}


def test_la_piel_es_la_de_aria_copiada_tal_cual():
    indice = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
    aria = _variables(_bloque(indice, "piel-aria"))
    # los valores que fija el pedido
    for k, v in {"--void-900": "#070b12", "--void-800": "#0f1520", "--void-700": "#151c2a", "--line": "#232c3e",
                 "--ink": "#e8edf4", "--cyan": "#62d6ea", "--done": "#4ccf8f", "--warn": "#f2b84b",
                 "--active": "#c98bf0", "--radius": "8px", "--radius-lg": "14px"}.items():
        assert aria[k] == v, k
    assert aria["--font-body"].startswith('"Inter"') and aria["--font-display"].startswith('"Space Grotesk"')
    assert aria["--font-mono"].startswith('"JetBrains Mono"')
    if os.path.isfile(TOKENS_ARIA):  # en la máquina: copia literal, byte a byte
        # NEVERA-9: la copia es de los tokens de ARIA tal como estaban en PYTHAGORAS en d062795 (2026-11-09), los que
        # cita el pedido. El 2026-11-24 PYTHAGORAS 14 (b9113fa) añadió su `--naranja` («no viene del HUD», solo de su
        # escena): no es de ARIA ni lo usa la nevera, así que no se copia y la comparación queda fijada en ese commit.
        commiteado = subprocess.run(["git", "-C", os.path.dirname(TOKENS_ARIA), "show", "d062795:./tokens.css"],
                                    capture_output=True, text=True)
        original = commiteado.stdout if commiteado.returncode == 0 else open(TOKENS_ARIA, encoding="utf-8").read()
        assert _bloque(indice, "piel-aria") + "\n" == original
    # un solo color propio, y declarado
    assert _variables(_bloque(indice, "piel-nevera")) == {"--danger": "#ef5f7a"}


def test_la_hoja_de_estilo_no_inventa_colores():
    """Ningún color literal en web/src: todo sale de var(--…) (los tonos suaves, con color-mix sobre ellas)."""
    for archivo in glob.glob(os.path.join(WEB, "src", "**", "*.css"), recursive=True) + list(_fuentes()):
        texto = re.sub(r"/\*.*?\*/", "", open(archivo, encoding="utf-8").read(), flags=re.S)
        texto = re.sub(r"//[^\n]*", "", texto) if not archivo.endswith(".css") else texto
        assert not re.search(r"#[0-9a-fA-F]{3,8}\b", texto), archivo
        assert not re.search(r"\b(rgba?|hsla?|oklch|lab|lch)\(", texto), archivo
        for nombre in ("white", "black", "red", "green", "orange", "yellow", "gray", "grey"):
            assert not re.search(rf":\s*{nombre}\b", texto), f"{archivo}: {nombre}"


def test_las_fuentes_estan_autohospedadas():
    for f in ("inter-latin-wght-normal-Dx4kXJAl.woff2", "space-grotesk-latin-500-normal-lFbtlQH6.woff2",
              "jetbrains-mono-latin-400-normal-V6pRDFza.woff2"):
        ruta = os.path.join(WEB, "public", "fonts", f)
        assert os.path.isfile(ruta) and open(ruta, "rb").read(4) == b"wOF2", f
    css = open(os.path.join(WEB, "src", "styles", "app.css"), encoding="utf-8").read()
    assert css.count("font-display: swap") == 3
    assert "googleapis" not in css and "http" not in css
