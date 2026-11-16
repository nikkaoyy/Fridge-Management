"""Cuerpos de petición del contrato (api/openapi.yaml). Campos desconocidos = 400: un campo mal escrito
(`vencimeinto`) no se ignora en silencio."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from .dominio import validar_fecha

Fecha = Annotated[str, AfterValidator(validar_fecha)]
Nombre = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Positivo = Annotated[float, Field(gt=0)]
Madurez = Literal["verde", "en_punto", "madura"]


class Modelo(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CategoriaNueva(Modelo):
    nombre: Nombre


class VidaUtilBase(Modelo):
    dias_base: Annotated[int, Field(ge=1)]
    dias_abierto: Annotated[int, Field(ge=1)] | None = None
    fuente: Literal["etiqueta", "experiencia", "referencia", "estimacion"]
    nota: str | None = None
    registrado_en: Fecha | None = None


class FactorMadurez(Modelo):
    madurez: Madurez
    factor: Positivo


class FactorConservacion(Modelo):
    ubicacion_id: int
    factor: Positivo


class VidaUtilCompleta(Modelo):
    base: VidaUtilBase | None
    madurez: list[FactorMadurez]
    conservacion: list[FactorConservacion]


class ProductoNuevo(Modelo):
    nombre: Nombre
    categoria_id: int
    unidad_base: Literal["g", "ml", "u"]
    perecedero: bool = True
    nota: str | None = None
    vida_util: VidaUtilBase | None = None


class ProductoEdicion(Modelo):
    nombre: Nombre | None = None
    categoria_id: int | None = None
    unidad_base: Literal["g", "ml", "u"] | None = None
    perecedero: bool | None = None
    activo: bool | None = None
    nota: str | None = None
    vida_util: VidaUtilBase | None = None


class PresentacionNueva(Modelo):
    producto_id: int
    nombre: Nombre
    contenido: Positivo | None = None
    unidad: str | None = None
    parte_id: int | None = None
    partes: Annotated[int, Field(ge=2)] | None = None
    codigo_barras: str | None = None


class PresentacionEdicion(Modelo):
    nombre: Nombre | None = None
    contenido: Positivo | None = None
    unidad: str | None = None
    parte_id: int | None = None
    partes: Annotated[int, Field(ge=2)] | None = None
    codigo_barras: str | None = None
    activo: bool | None = None


class ElementoNuevo(Modelo):
    presentacion_id: int
    ubicacion_id: int
    cantidad: Positivo | None = None
    unidad: str | None = None
    unidades: Annotated[int, Field(ge=1, le=200)] = 1
    fecha_compra: Fecha | None = None
    vencimiento: Fecha | None = None
    vencimiento_impreso: bool = False
    madurez: Madurez | None = None
    precio_unitario_cop: Annotated[int, Field(ge=0)] | None = None
    padre_id: int | None = None
    etiqueta: str | None = None
    nota: str | None = None
    foto: str | None = Field(default=None, description="Imagen en base64 (JPEG, PNG, WebP o HEIC).")


class ElementoEdicion(Modelo):
    ubicacion_id: int | None = None
    vencimiento: Fecha | None = None
    madurez: Madurez | None = None
    abierto_en: Fecha | None = None
    etiqueta: str | None = None
    nota: str | None = None


class MovimientoNuevo(Modelo):
    elemento_id: int
    tipo: Literal["consumo", "merma", "ajuste"]
    cantidad: float | None = None
    unidad: str | None = None
    fecha: Fecha | None = None
    motivo: str | None = None


class MiembroNuevo(Modelo):
    nombre: Nombre
    rol: Literal["admin", "editor", "lector"]


class MiembroEdicion(Modelo):
    nombre: Nombre | None = None
    rol: Literal["admin", "editor", "lector"] | None = None
    activo: bool | None = None
    renovar_token: bool = False


# ---------------------------------------------------------------- recetas (PEDIDO-NEVERA-5)

class IngredienteNuevo(Modelo):
    producto_id: int
    cantidad: Positivo
    unidad: Nombre
    opcional: bool = False
    producto: str | None = None  # de lectura en el contrato: se acepta para poder devolver lo leído, y se ignora


class RecetaVersionNueva(Modelo):
    porciones: Annotated[int, Field(ge=1)] = 1
    instrucciones: str | None = None
    ingredientes: Annotated[list[IngredienteNuevo], Field(min_length=1)]


class RecetaNueva(Modelo):
    nombre: Nombre
    nota: str | None = None
    version: RecetaVersionNueva


class ConsumoReceta(Modelo):
    elemento_id: int
    cantidad: Positivo
    unidad: str | None = None


class Cocinar(Modelo):
    consumos: Annotated[list[ConsumoReceta], Field(min_length=1)]
    fecha: Fecha | None = None
