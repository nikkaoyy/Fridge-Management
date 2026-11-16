"""Pruebas de la fase 1. Cada prueba tiene su base temporal (tmp_path) y su app; nada toca data/.

`Api` envuelve el TestClient con el token de un miembro y valida CADA respuesta contra api/openapi.yaml: que el código
HTTP esté declarado en la operación y que el cuerpo cumpla el esquema sin campos de más ni requeridos de menos.
"""
from __future__ import annotations

import copy
import os
import re
import sys

import pytest
import yaml
from fastapi.testclient import TestClient

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

from app.dominio import hoy, mas_dias  # noqa: E402
from app.main import crear_app  # noqa: E402

TOKEN_ADMIN = "token-admin-de-prueba-0123456789"
SPEC = yaml.safe_load(open(os.path.join(RAIZ, "api", "openapi.yaml"), encoding="utf-8"))


# ---------------------------------------------------------------- validación contra el contrato

def _resolver(nodo):
    if isinstance(nodo, dict):
        if "$ref" in nodo:
            destino = SPEC
            for parte in nodo["$ref"][2:].split("/"):
                destino = destino[parte]
            return _resolver(copy.deepcopy(destino))
        nodo = {k: _resolver(v) for k, v in nodo.items()}
        if "allOf" in nodo:
            unido = {"properties": {}, "required": []}
            for parte in nodo.pop("allOf"):
                for k, v in parte.items():
                    if k == "properties":
                        unido["properties"].update(v)
                    elif k == "required":
                        unido["required"] += v
                    else:
                        unido[k] = v
            if not unido["properties"]:
                unido.pop("properties")
            if not unido["required"]:
                unido.pop("required")
            unido.update(nodo)
            nodo = unido
        return nodo
    if isinstance(nodo, list):
        return [_resolver(v) for v in nodo]
    return nodo


def validar(esquema: dict, valor, donde: str = "$") -> None:
    if valor is None:
        assert esquema.get("nullable"), f"{donde}: null y el contrato no lo permite"
        return
    tipo = esquema.get("type") or ("object" if "properties" in esquema else None)
    if "enum" in esquema:
        assert valor in esquema["enum"], f"{donde}: {valor!r} no está en {esquema['enum']}"
    if tipo == "object":
        assert isinstance(valor, dict), f"{donde}: se esperaba objeto"
        props = esquema.get("properties", {})
        if not esquema.get("additionalProperties"):
            sobran = set(valor) - set(props)
            assert not sobran, f"{donde}: campos que no están en el contrato: {sorted(sobran)}"
        faltan = set(esquema.get("required", [])) - set(valor)
        assert not faltan, f"{donde}: faltan campos requeridos: {sorted(faltan)}"
        for k, v in valor.items():
            if k in props:
                validar(props[k], v, f"{donde}.{k}")
    elif tipo == "array":
        assert isinstance(valor, list), f"{donde}: se esperaba lista"
        for i, v in enumerate(valor):
            validar(esquema.get("items", {}), v, f"{donde}[{i}]")
    elif tipo == "integer":
        assert isinstance(valor, int) and not isinstance(valor, bool), f"{donde}: {valor!r} no es entero"
    elif tipo == "number":
        assert isinstance(valor, (int, float)) and not isinstance(valor, bool), f"{donde}: {valor!r} no es número"
    elif tipo == "boolean":
        assert isinstance(valor, bool), f"{donde}: {valor!r} no es booleano"
    elif tipo == "string":
        assert isinstance(valor, str), f"{donde}: {valor!r} no es texto"
        if "pattern" in esquema:
            assert re.match(esquema["pattern"], valor), f"{donde}: {valor!r} no cumple {esquema['pattern']}"


def _operacion(metodo: str, url: str):
    ruta = url.split("?", 1)[0]
    for plantilla, item in SPEC["paths"].items():
        if re.fullmatch(re.sub(r"\{[^}]+\}", r"[^/]+", plantilla), ruta) and metodo.lower() in item:
            return plantilla, item[metodo.lower()]
    return None, None


def validar_respuesta(metodo: str, url: str, r) -> None:
    plantilla, op = _operacion(metodo, url)
    assert op is not None, f"{metodo} {url} no está en el contrato"
    declarado = op["responses"].get(str(r.status_code))
    assert declarado is not None, (f"{metodo} {plantilla} respondió {r.status_code}, que el contrato no declara "
                                   f"({sorted(op['responses'])}): {r.text[:300]}")
    declarado = _resolver(declarado)
    contenido = declarado.get("content", {}).get("application/json")
    if contenido is None:
        assert not r.content, f"{metodo} {plantilla} {r.status_code}: el contrato no declara cuerpo"
        return
    validar(contenido["schema"], r.json(), f"{metodo} {plantilla} {r.status_code}")


class Api:
    def __init__(self, cliente: TestClient, token: str | None):
        self.c, self.token = cliente, token

    def _h(self, extra=None):
        h = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        return h | (extra or {})

    def pedir(self, metodo: str, url: str, **kw):
        kw["headers"] = self._h(kw.get("headers"))
        r = self.c.request(metodo, url, **kw)
        validar_respuesta(metodo, url, r)
        return r

    def get(self, url, **kw): return self.pedir("GET", url, **kw)
    def post(self, url, **kw): return self.pedir("POST", url, **kw)
    def put(self, url, **kw): return self.pedir("PUT", url, **kw)
    def patch(self, url, **kw): return self.pedir("PATCH", url, **kw)
    def delete(self, url, **kw): return self.pedir("DELETE", url, **kw)

    def ok(self, metodo, url, esperado=None, **kw):
        r = self.pedir(metodo, url, **kw)
        esperado = esperado or {"POST": 201}.get(metodo, 200)
        assert r.status_code == esperado, f"{metodo} {url}: {r.status_code} {r.text}"
        return r.json() if r.content else None


# ---------------------------------------------------------------- fixtures

@pytest.fixture
def datos(tmp_path):
    return str(tmp_path)


@pytest.fixture
def cliente(datos):
    with TestClient(crear_app(datos, TOKEN_ADMIN)) as c:
        yield c


@pytest.fixture
def admin(cliente):
    return Api(cliente, TOKEN_ADMIN)


@pytest.fixture
def anonimo(cliente):
    return Api(cliente, None)


@pytest.fixture
def miembros(admin, cliente):
    """Un editor y un lector creados por el admin (solo en la base temporal de la prueba)."""
    e = admin.ok("POST", "/miembros", json={"nombre": "editor de prueba", "rol": "editor"})
    l = admin.ok("POST", "/miembros", json={"nombre": "lector de prueba", "rol": "lector"})
    return {"editor": Api(cliente, e["token"]), "lector": Api(cliente, l["token"]),
            "ids": {"editor": e["id"], "lector": l["id"]}, "tokens": {"editor": e["token"], "lector": l["token"]}}


@pytest.fixture
def ubic(admin):
    return {u["nombre"]: u["id"] for u in admin.ok("GET", "/ubicaciones")}


@pytest.fixture
def leche(admin):
    """Producto en ml con vida útil (7 días, 3 abierta), bolsa 1 L y pack de 12 bolsas."""
    cat = admin.ok("POST", "/categorias", json={"nombre": "lácteos"})
    p = admin.ok("POST", "/productos", json={"nombre": "leche", "categoria_id": cat["id"], "unidad_base": "ml",
                                             "vida_util": {"dias_base": 7, "dias_abierto": 3, "fuente": "etiqueta"}})
    bolsa = admin.ok("POST", "/presentaciones", json={"producto_id": p["id"], "nombre": "bolsa 1 L",
                                                      "contenido": 1, "unidad": "l"})
    pack = admin.ok("POST", "/presentaciones", json={"producto_id": p["id"], "nombre": "pack 12 bolsas",
                                                     "parte_id": bolsa["id"], "partes": 12})
    return {"categoria": cat["id"], "producto": p["id"], "bolsa": bolsa["id"], "pack": pack["id"]}


@pytest.fixture
def fechas():
    return {"hoy": hoy(), "mas": lambda n: mas_dias(hoy(), n)}
