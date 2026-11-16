"""6. Las anomalías del modelo siguen verdes: scripts/verificacion.py pasa contra el esquema ampliado (versión 2)."""
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_verificacion_del_modelo_pasa():
    r = subprocess.run([sys.executable, "-I", os.path.join(RAIZ, "scripts", "verificacion.py")],
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-3000:]
    assert "**VERIFICACIÓN OK**" in r.stdout
    assert "- FALLA " not in r.stdout
