"""Las cosas de la escena con forma (PEDIDO-NEVERA-7).

La regla de la familia, el tamaño, el tono, los montones y el nombre corto son TypeScript puro (familias.ts y
colocar.ts, sin three ni React): se ejecutan aquí con el Node de la máquina, que quita los tipos solo. Un gancho de
resolución añade `.ts` a los imports relativos sin extensión (los de Vite). Sin Node, esas pruebas se saltan y quedan
las de lectura del código.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(RAIZ, "web", "src")
ESCENA = os.path.join(WEB, "escena")
FAMILIAS = json.load(open(os.path.join(ESCENA, "familias.json"), encoding="utf-8"))
NODE = shutil.which("node")
con_node = pytest.mark.skipif(NODE is None, reason="sin Node en esta máquina")

GANCHO = """
import { registerHooks } from "node:module";
registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (/^\\.\\.?\\//.test(especificador) && !/\\.[a-z]+$/.test(especificador)) {
      try { return siguiente(especificador + ".ts", contexto); } catch {}
    }
    return siguiente(especificador, contexto);
  },
});
"""


def _leer(nombre: str) -> str:
    return open(os.path.join(ESCENA, nombre), encoding="utf-8").read()


def _sin_comentarios(ts: str) -> str:
    ts = re.sub(r"/\*.*?\*/", "", ts, flags=re.S)
    return "\n".join(re.sub(r"(^|\s)//.*$", "", linea) for linea in ts.split("\n"))


def _node(cuerpo: str):
    """Ejecuta `cuerpo` (con `familias` y `colocar` importados) y devuelve lo que imprima como JSON."""
    guion = (
        GANCHO
        + f'const familias = await import({json.dumps(os.path.join(ESCENA, "familias.ts"))});\n'
        + f'const colocar = await import({json.dumps(os.path.join(ESCENA, "colocar.ts"))});\n'
        + cuerpo
    )
    r = subprocess.run(
        [NODE, "--no-warnings", "--input-type=module", "-e", guion],
        capture_output=True, text=True, timeout=60, cwd=RAIZ,
    )
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


# ---------------------------------------------------------------- bloque 1: la familia, el tamaño y el tono

@con_node
def test_la_familia_sale_de_la_categoria_y_de_las_excepciones():
    casos = [
        ("BANANO CORRIENTE", "frutas y verduras", "bolsa"),
        ("LECHE ENTERA ALQUERIA", "lacteos", "botella"),
        ("HUEVO CAMPESINO AA X30", "huevos", "esfera"),
        ("LECHE PLV ENT KLIM", "lacteos", "caja"),       # lácteo, pero en polvo: caja
        ("MANZANA ROYAL", "frutas y verduras", "esfera"),  # fruta redonda
        ("GELATINA COMPARAN", "despensa", "lata"),
        ("AGUA CIELO 600ML", "bebidas", "botella"),
        ("CEREAL BOL", "despensa", "caja"),
        ("LO QUE SEA", "categoría que no existe", FAMILIAS["porDefecto"]),
        ("LO QUE SEA", None, FAMILIAS["porDefecto"]),
    ]
    got = _node(f"console.log(JSON.stringify({json.dumps(casos)}.map(([p, c]) => familias.familiaDe(p, c))));")
    assert got == [f for _, _, f in casos]


def test_cinco_formas_y_la_lista_vive_en_un_solo_archivo():
    """Las cinco formas del pedido, y ningún nombre de producto de las excepciones repartido por el código."""
    assert list(FAMILIAS["formas"]) == ["botella", "caja", "bolsa", "lata", "esfera"]
    formas = set(FAMILIAS["formas"])
    assert set(FAMILIAS["porCategoria"].values()) <= formas
    assert {x["forma"] for x in FAMILIAS["excepciones"]} <= formas
    for nombre in ("familias.ts", "formas.ts", "colocar.ts", "motor.ts", "mueble.ts"):
        codigo = _sin_comentarios(_leer(nombre)).lower()
        for x in FAMILIAS["excepciones"]:
            clave = x["empieza"].strip()
            assert not re.search(rf'["\'`]{re.escape(clave)}', codigo), f"{nombre}: «{clave}» fuera de familias.json"


def test_los_tonos_son_tokens_de_la_piel_de_aria():
    """El cuerpo va en el tono de su categoría, siempre un token de piel.ts (ningún color literal en el JSON)."""
    piel = _leer("piel.ts")
    tokens = set(re.findall(r"^\s+(\w+): \"--[\w-]+\"", piel, flags=re.M))
    assert {"void", "ink", "done", "warn", "danger", "active"} <= tokens
    for cat, t in FAMILIAS["tonos"].items():
        assert t["token"] in tokens, cat
        assert t.get("hacia", "void") in tokens, cat
        assert 0 <= t.get("t", 0) <= 1, cat
        assert t["token"] != "danger", f"{cat}: --danger es solo para la urgencia"
    assert set(FAMILIAS["tonosSinCategoria"]) <= tokens
    texto = json.dumps(FAMILIAS)
    assert not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(", texto)


@con_node
def test_el_tamano_va_con_la_cantidad_y_tiene_tope():
    """Una bolsa de 6 kg no crece sin fin ni un diente de ajo desaparece."""
    got = _node("""
      const f = (unidad_base, saldo) => familias.factorTamano({ producto: "x", unidad_base, saldo });
      console.log(JSON.stringify([f("g", 6000), f("g", 1000), f("g", 5), f("ml", 0), f("u", 1), f("u", 30), f("u", 0)]));
    """)
    m, c = FAMILIAS["tamano"]["masa"], FAMILIAS["tamano"]["conteo"]
    assert got[0] == m["max"] and got[1] == pytest.approx(1) and got[2] == m["min"] and got[3] == m["min"]
    assert got[4] == pytest.approx(1) and got[5] == c["max"] and c["min"] <= got[6] < 1


@con_node
def test_nada_atraviesa_la_balda_ni_se_sale_de_su_celda():
    """Con la cosa más grande posible en un estante bajo, colocar() la encoge entera hasta caber."""
    got = _node("""
      const sup = { ancho: 0.3, fondo: 0.1, alto: 0.12 };
      const unidades = [0, 1, 2, 3].map((i) => ({ id: i, ids: [i], grupo: "g" + i, monton: false, desplegadaDe: null,
        forma: "botella", medidas: { ancho: 0.1, alto: 0.27, fondo: 0.1 }, semaforo: "bien" }));
      const { puestos, rejilla } = colocar.colocar(unidades, [sup]);
      console.log(JSON.stringify({ puestos, rejilla }));
    """)
    r = got["rejilla"]
    for p in got["puestos"]:
        assert p["alto"] <= 0.12 + 1e-9
        assert p["ancho"] <= r["pasoX"] + 1e-9 and p["fondo"] <= r["pasoZ"] + 1e-9
        assert p["alto"] / p["ancho"] == pytest.approx(0.27 / 0.1)  # se encoge sin deformarse


def test_una_instanced_mesh_por_forma_y_la_urgencia_en_un_aro():
    """Cinco InstancedMesh (una por forma) y no una malla por cosa; el cuerpo lleva el tono de la categoría y la
    urgencia va en el aro y el pulso."""
    formas = _sin_comentarios(_leer("formas.ts"))
    assert re.search(r"for \(const f of FORMAS\) \{\s+const m = new THREE\.InstancedMesh\(this\.geos\[f\]", formas)
    motor = _sin_comentarios(_leer("motor.ts"))
    assert len(re.findall(r"new THREE\.Mesh\(", motor)) == 1  # el marcador de la selección, uno solo
    assert "new THREE.InstancedMesh(" not in motor
    poner = re.search(r"this\.cuerpos\.poner\((.*)\);", motor).group(1)
    assert "tonoCategoria" in poner and "colores" not in poner
    assert re.search(r"this\.senales\.aro\([^;]*cosa\.colorAro", motor)
    # el pulso, solo para lo que vence en ≤ 2 días (vencido o urgente del semáforo de la lista)
    assert re.search(r'if \(sem === "vencido" \|\| sem === "urgente"\) this\.senales\.latir\(', motor)
    assert "uLatido" in formas and "reducido ? 0 : 1" in formas  # sin pulso con movimiento reducido


# ---------------------------------------------------------------- bloque 2: que se lean

@con_node
def test_los_montones_van_en_el_sitio_del_mas_urgente_y_se_despliegan():
    """Más de MONTON_MAS_DE cosas del mismo grupo → un montón en el sitio de la más urgente; abierto, una por sitio
    y juntas; los grupos pequeños no se tocan (manda la urgencia)."""
    got = _node("""
      const e = (id, producto, dias) => ({ id, producto, dias_para_vencer: dias, cantidad_inicial: 1, saldo: 1,
        unidad_base: "u", vencimiento: null, abierto_en: null });
      const lista = [e(1, "PAPA PASTUSA", 9), e(2, "PAPA CRIOLLA", 3), e(3, "LECHE ENTERA", 1), e(4, "PAPA SABANERA", 6),
                     e(5, "PAPA LUD", 12), e(6, "YOGUR POMAR", 2), e(7, "YOGUR SUPERIOR", 8)];
      const como = (x) => ({ forma: x.producto.startsWith("PAPA") ? "bolsa" : "botella", medidas: { ancho: 0.1, alto: 0.1, fondo: 0.1 } });
      const plegado = colocar.agrupar(lista, como).map((u) => [u.id, u.ids, u.monton]);
      const abierto = colocar.agrupar(lista, como, new Set(["papa|bolsa"])).map((u) => [u.id, u.desplegadaDe]);
      console.log(JSON.stringify({ plegado, abierto, masDe: familias.MONTON_MAS_DE }));
    """)
    assert got["masDe"] == FAMILIAS["monton"]["masDe"] == 2
    assert got["plegado"] == [[3, [3], False], [6, [6], False], [2, [2, 4, 1, 5], True], [7, [7], False]]
    assert got["abierto"] == [[3, None], [6, None], [2, "papa|bolsa"], [4, "papa|bolsa"], [1, "papa|bolsa"],
                              [5, "papa|bolsa"], [7, None]]


@con_node
def test_el_nombre_corto_de_la_etiqueta():
    casos = {
        "LECHE PLV ENT KLIM": "Leche en polvo",
        "BANANO CORRIENTE": "Banano",
        "SH ALMA DE FLORES 400ML": "Champú alma",
        "HUEVO CAMPESINO AA X30": "Huevo campesino",
        "ATUN VAN CAMPS": "Atún van",
    }
    got = _node(f"console.log(JSON.stringify({json.dumps(list(casos))}.map((p) => familias.nombreCorto(p))));")
    assert got == list(casos.values())
    assert all(len(n) <= FAMILIAS["nombreCorto"]["largoMax"] for n in got)


def test_etiquetas_fijas_con_tope_y_solo_lo_elegido_en_el_movil():
    """Una o dos por compartimento de lejos, tres por balda de cerca, en el teléfono ninguna fija; todas pasan por el
    resolvedor de solapes de siempre y el nombre fijo es lo primero que cede."""
    motor = _sin_comentarios(_leer("motor.ts"))
    assert re.search(r"const NOMBRES_POR_COMPARTIMENTO = 2;", motor)
    assert re.search(r"const NOMBRES_POR_BALDA = 3;", motor)
    assert re.search(r"if \(!this\.tactil\) \{", motor)
    assert "colocarEtiqueta(k.caja, puestas" in motor
    etq = _leer("etiquetas.ts")
    rangos = dict(re.findall(r"(\w+): ([\d.]+)", re.search(r"RANGO_ETIQUETA[^=]*= \{([^}]*)\}", etq).group(1)))
    assert min(rangos, key=lambda k: float(rangos[k])) == "nombre" and max(rangos, key=lambda k: float(rangos[k])) == "elemento"


def test_la_leyenda_en_una_linea_con_las_cinco_formas_sin_colores_nuevos():
    jsx = open(os.path.join(WEB, "componentes", "Nevera3D.tsx"), encoding="utf-8").read()
    assert 'className="leyenda-3d"' in jsx and "FORMAS.map" in jsx
    for tono in ("tono-danger", "tono-warn", "tono-done"):
        assert tono in jsx
    css = open(os.path.join(WEB, "styles", "app.css"), encoding="utf-8").read()
    bloque = css[css.index(".leyenda-3d {"):css.index(".escena-marco {")]
    assert "flex-wrap: nowrap" in bloque and "white-space: nowrap" in bloque
    assert not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(", bloque)
    assert "prefers-reduced-motion" in bloque  # el aro que late en la leyenda tampoco late con movimiento reducido
