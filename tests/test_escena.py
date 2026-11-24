"""La nevera en 3D (PEDIDO-NEVERA-6): el motor es el de PYTHAGORAS, copiado con su origen, y no hay un segundo motor.

Las copias se cotejan con el original cuando el repositorio de PYTHAGORAS está en la máquina (como los tokens en
test_pantalla.py); sin él, se comprueba solo lo que se puede comprobar desde aquí.

NEVERA-9: el original es el del commit que dice la cabecera de cada copia (1ac4185), leído con `git show`, y no el
árbol de trabajo de PYTHAGORAS: PYTHAGORAS siguió (PYTHAGORAS 11 cambió camara.ts y el resolvedor de rótulos) y estas
pruebas fallaban ya en 6f4ade7 por eso, no por la copia.
"""
from __future__ import annotations

import functools
import glob
import json
import os
import re
import subprocess

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESCENA = os.path.join(RAIZ, "web", "src", "escena")
PY = "/opt/data/pythagoras"
PY_ESCENA = os.path.join(PY, "web", "src", "escena")
ORIGEN = "1ac4185"  # el commit de PYTHAGORAS del que salieron las copias (cabecera «// ORIGEN: … @ 1ac4185»)
hay_pythagoras = pytest.mark.skipif(not os.path.isdir(PY_ESCENA), reason="PYTHAGORAS no está en esta máquina")


@functools.cache
def _original(nombre: str) -> str:
    """El archivo de la escena de PYTHAGORAS tal como estaba en ORIGEN."""
    return subprocess.run(["git", "-C", PY, "show", f"{ORIGEN}:web/src/escena/{nombre}"], check=True,
                          capture_output=True, text=True).stdout


def _leer(ruta: str) -> str:
    return open(ruta, encoding="utf-8").read()


def _sin_cabecera(texto: str) -> str:
    """Quita las líneas `// ORIGEN…` y su continuación del principio de una copia."""
    lineas = texto.split("\n")
    assert lineas[0].startswith("// ORIGEN: /opt/data/pythagoras/"), "la copia no dice de dónde salió"
    i = 0
    while lineas[i].startswith("//"):
        i += 1
    return "\n".join(lineas[i:])


def test_cada_pieza_copiada_dice_de_donde_salio():
    for nombre in ("azar.ts", "instancias.ts", "shaders.ts", "camara.ts", "etiquetas.ts", "texturas.ts", "motor.ts"):
        cabeza = _leer(os.path.join(ESCENA, nombre)).split("\n", 1)[0]
        assert cabeza.startswith("// ORIGEN:") and "/opt/data/pythagoras/web/src/escena/" in cabeza and "1ac4185" in cabeza, nombre


@hay_pythagoras
@pytest.mark.parametrize("nombre", ["azar.ts", "instancias.ts"])
def test_las_copias_sin_cambios_son_identicas(nombre):
    assert _sin_cabecera(_leer(os.path.join(ESCENA, nombre))) == _original(nombre)


@hay_pythagoras
def test_el_halo_instanciado_es_el_mismo():
    original = _original("shaders.ts")
    i = original.index("/**\n * Halo de cuerpos instanciados")
    j = original.index("/** Anillo de PYTHAGORAS")
    assert _sin_cabecera(_leer(os.path.join(ESCENA, "shaders.ts"))) == original[i:j].rstrip() + "\n"


@hay_pythagoras
def test_la_camara_solo_cambia_el_giro_solo():
    copia = _sin_cabecera(_leer(os.path.join(ESCENA, "camara.ts")))
    copia = re.sub(r"  /\*\* NEVERA-6:[^\n]*\n  giroSolo\?: boolean;\n", "", copia)
    copia = copia.replace("this.opciones.giroSolo !== false && ", "")
    assert copia == _original("camara.ts")


def _funcion(texto: str, nombre: str) -> str:
    i = texto.index(f"function {nombre}(")
    j = texto.index("\n}\n", i)
    return texto[i:j]


@hay_pythagoras
def test_el_resolvedor_de_etiquetas_es_el_de_pythagoras():
    original = _original("motor.ts")
    copia = _leer(os.path.join(ESCENA, "etiquetas.ts"))
    for nombre in ("hueco", "colocarEtiqueta"):
        assert _funcion(copia, nombre) == _funcion(original, nombre), nombre
    for constante in ("SEPARACION_ETIQUETAS_PX = 14", "DESPLAZAMIENTO_MAX_PX = 72", "PASO_DESPLAZAMIENTO_PX = 2"):
        assert constante in copia and constante in original, constante


@hay_pythagoras
def test_el_material_del_atlas_es_el_de_las_lunas():
    """El truco del atlas por instancia (aCelda que encoge el UV a la celda) es el de `materialLunas`, línea a línea."""
    original = _original("motor.ts")
    copia = _leer(os.path.join(ESCENA, "texturas.ts"))
    i = original.index("  m.onBeforeCompile = (sh) => {")
    j = original.index("  m.customProgramCacheKey", i)
    assert original[i:j] in copia


def test_un_solo_motor():
    """Un único WebGLRenderer y un único bucle en todo el front: la vista 3D no trae un segundo motor."""
    fuentes = {f: _leer(f) for f in glob.glob(os.path.join(RAIZ, "web", "src", "**", "*.ts*"), recursive=True)}
    renderers = [f for f, t in fuentes.items() for _ in re.finditer(r"new THREE\.WebGLRenderer\(", t)]
    assert [os.path.relpath(f, ESCENA) for f in renderers] == ["motor.ts"]
    for f, t in fuentes.items():
        for otro in ("@react-three", "babylonjs", "playcanvas", "OrbitControls"):
            assert otro not in t, f"{f}: {otro}"
    paquete = json.loads(_leer(os.path.join(RAIZ, "web", "package.json")))
    assert set(paquete["dependencies"]) == {"react", "react-dom", "three"}


@hay_pythagoras
def test_three_es_la_misma_version_que_en_pythagoras():
    nuestro = json.loads(_leer(os.path.join(RAIZ, "web", "package.json")))["dependencies"]["three"]
    instalado = os.path.join(PY, "node_modules", "three", "package.json")
    if not os.path.isfile(instalado):
        pytest.skip("PYTHAGORAS sin node_modules")
    assert nuestro == json.loads(_leer(instalado))["version"]


def test_sin_coordenadas_guardadas():
    """D2 (a): ni el modelo ni el contrato tienen dónde guardar una posición; la escena la calcula (colocar.ts)."""
    for ruta in ("db/esquema.sql", "db/referencia.sql", "api/openapi.yaml"):
        texto = _leer(os.path.join(RAIZ, ruta)).lower()
        for palabra in ("posicion", "posición", "coordenad", "elemento_posicion"):
            assert palabra not in texto, f"{ruta}: {palabra}"
    colocar = _leer(os.path.join(ESCENA, "colocar.ts"))
    assert "porUrgencia" in colocar and "localStorage" not in colocar and "api(" not in colocar
