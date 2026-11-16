"""Fase 2 del contrato (x-estado: declarado): existe, exige token y rol, y responde 501.

Las recetas salieron de aquí en PEDIDO-NEVERA-5 (app/rutas_recetas.py); quedan proveedores, precios y planes."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .deps import autorizar
from .errores import ErrorApi

router = APIRouter(dependencies=[Depends(autorizar)])

DECLARADAS = [
    ("GET", "/proveedores"), ("POST", "/proveedores"),
    ("GET", "/precios"), ("POST", "/precios"),
    ("GET", "/planes"), ("POST", "/planes"),
]


def _no_implementado():
    raise ErrorApi(501, "no_implementado", "fase 2: declarado, no implementado")


for metodo, ruta in DECLARADAS:
    router.add_api_route(ruta, _no_implementado, methods=[metodo], name=f"{metodo} {ruta}")
