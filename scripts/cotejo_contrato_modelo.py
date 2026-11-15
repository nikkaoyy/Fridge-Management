"""Coteja cada campo de los esquemas de api/openapi.yaml contra db/esquema.sql.

Cada propiedad de cada esquema de componentes tiene que estar en una de tres
listas: columna real (tabla.columna, que debe existir en el DDL), derivada
(se calcula desde columnas que existen) o de entrada (solo viaja en la
petición y se traduce a columnas). Si una propiedad no está en ninguna, el
script falla: o se añade al esquema o se quita del contrato.

Uso: python3 -I scripts/cotejo_contrato_modelo.py  (necesita pyyaml)
Imprime la tabla en markdown por stdout.
"""
import re, sys, yaml

ddl = open("db/esquema.sql").read()
spec = yaml.safe_load(open("api/openapi.yaml"))

columnas = {}
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\) STRICT", ddl, re.S):
    cols = set()
    for line in m.group(2).splitlines():
        mm = re.match(r"\s*(\w+)\s+(INTEGER|TEXT|REAL)", line)
        if mm: cols.add(mm.group(1))
    columnas[m.group(1)] = cols

# propiedad -> (origen, destino). origen: columna | derivada | entrada
M = {
 "Salud": {"ok": ("derivada", "la app responde"), "version": ("derivada", "versión de la app"),
           "esquema": ("derivada", "PRAGMA user_version"), "base": ("derivada", "ruta de la base")},
 "Indicadores": {"productos": ("derivada", "COUNT producto.activo"), "elementos_disponibles": ("derivada", "COUNT v_elemento.saldo > 0"),
                 "vencidos": ("derivada", "v_elemento.vencimiento < hoy"), "por_vencer_7": ("derivada", "v_elemento.vencimiento en [hoy, hoy+7]"),
                 "sin_vencimiento": ("derivada", "v_elemento.vencimiento IS NULL y producto.perecedero"), "mermas_30_dias": ("derivada", "COUNT movimiento.tipo='merma'")},
 "Categoria": {"id": ("columna", "categoria.id"), "nombre": ("columna", "categoria.nombre")},
 "CategoriaNueva": {"nombre": ("columna", "categoria.nombre")},
 "Unidad": {"id": ("columna", "unidad.id"), "codigo": ("columna", "unidad.codigo"), "nombre": ("columna", "unidad.nombre"),
            "magnitud": ("columna", "unidad.magnitud"), "factor_a_base": ("columna", "unidad.factor_a_base")},
 "Ubicacion": {"id": ("columna", "ubicacion.id"), "nombre": ("columna", "ubicacion.nombre"), "padre_id": ("columna", "ubicacion.padre_id")},
 "VidaUtilBase": {"dias_base": ("columna", "vida_util.dias_base"), "dias_abierto": ("columna", "vida_util.dias_abierto"),
                  "fuente": ("columna", "vida_util.fuente"), "nota": ("columna", "vida_util.nota"), "registrado_en": ("columna", "vida_util.registrado_en")},
 "FactorMadurez": {"madurez": ("columna", "vida_util_madurez.madurez"), "factor": ("columna", "vida_util_madurez.factor")},
 "FactorConservacion": {"ubicacion_id": ("columna", "vida_util_conservacion.ubicacion_id"), "factor": ("columna", "vida_util_conservacion.factor")},
 "VidaUtilCompleta": {"base": ("derivada", "fila de vida_util"), "madurez": ("derivada", "filas de vida_util_madurez"), "conservacion": ("derivada", "filas de vida_util_conservacion")},
 "Producto": {"id": ("columna", "producto.id"), "nombre": ("columna", "producto.nombre"), "categoria_id": ("columna", "producto.categoria_id"),
              "categoria": ("derivada", "categoria.nombre por join"), "unidad_base": ("derivada", "unidad.codigo de producto.unidad_base_id"),
              "perecedero": ("columna", "producto.perecedero"), "activo": ("columna", "producto.activo"), "nota": ("columna", "producto.nota"),
              "vida_util": ("derivada", "fila de vida_util"), "creado_en": ("columna", "producto.creado_en")},
 "ProductoNuevo": {"nombre": ("columna", "producto.nombre"), "categoria_id": ("columna", "producto.categoria_id"),
                   "unidad_base": ("entrada", "unidad.codigo -> producto.unidad_base_id"), "perecedero": ("columna", "producto.perecedero"),
                   "nota": ("columna", "producto.nota"), "vida_util": ("entrada", "fila de vida_util")},
 "ProductoEdicion": {"nombre": ("columna", "producto.nombre"), "categoria_id": ("columna", "producto.categoria_id"),
                     "unidad_base": ("entrada", "unidad.codigo -> producto.unidad_base_id"), "perecedero": ("columna", "producto.perecedero"),
                     "activo": ("columna", "producto.activo"), "nota": ("columna", "producto.nota"), "vida_util": ("entrada", "fila de vida_util")},
 "Presentacion": {"id": ("columna", "presentacion.id"), "producto_id": ("columna", "presentacion.producto_id"), "nombre": ("columna", "presentacion.nombre"),
                  "contenido": ("columna", "presentacion.contenido"), "unidad": ("derivada", "unidad.codigo de presentacion.unidad_id"),
                  "parte_id": ("columna", "presentacion.parte_id"), "partes": ("columna", "presentacion.partes"),
                  "contenido_base": ("derivada", "v_presentacion_base.contenido_base"), "codigo_barras": ("columna", "presentacion.codigo_barras"),
                  "activo": ("columna", "presentacion.activo")},
 "PresentacionNueva": {"producto_id": ("columna", "presentacion.producto_id"), "nombre": ("columna", "presentacion.nombre"), "contenido": ("columna", "presentacion.contenido"),
                       "unidad": ("entrada", "unidad.codigo -> presentacion.unidad_id"), "parte_id": ("columna", "presentacion.parte_id"),
                       "partes": ("columna", "presentacion.partes"), "codigo_barras": ("columna", "presentacion.codigo_barras")},
 "PresentacionEdicion": {"nombre": ("columna", "presentacion.nombre"), "contenido": ("columna", "presentacion.contenido"),
                         "unidad": ("entrada", "unidad.codigo -> presentacion.unidad_id"), "parte_id": ("columna", "presentacion.parte_id"),
                         "partes": ("columna", "presentacion.partes"), "codigo_barras": ("columna", "presentacion.codigo_barras"), "activo": ("columna", "presentacion.activo")},
 "Elemento": {"id": ("columna", "elemento.id"), "compra_id": ("columna", "elemento.compra_id"), "fecha_compra": ("derivada", "compra.fecha por join (v_elemento)"),
              "producto_id": ("derivada", "presentacion.producto_id (v_elemento)"), "producto": ("derivada", "producto.nombre (v_elemento)"),
              "categoria_id": ("derivada", "producto.categoria_id (v_elemento)"), "presentacion_id": ("columna", "elemento.presentacion_id"),
              "presentacion": ("derivada", "presentacion.nombre (v_elemento)"), "ubicacion_id": ("columna", "elemento.ubicacion_id"),
              "unidad_base": ("derivada", "unidad.codigo de producto.unidad_base_id"), "cantidad_inicial": ("columna", "elemento.cantidad_inicial"),
              "saldo": ("derivada", "v_elemento.saldo = cantidad_inicial - SUM(movimiento.cantidad)"), "vencimiento": ("columna", "elemento.vencimiento"),
              "vencimiento_origen": ("columna", "elemento.vencimiento_origen"), "dias_para_vencer": ("derivada", "v_elemento.dias_para_vencer"),
              "madurez": ("columna", "elemento.madurez"), "abierto_en": ("columna", "elemento.abierto_en"), "padre_id": ("columna", "elemento.padre_id"),
              "etiqueta": ("columna", "elemento.etiqueta"), "nota": ("columna", "elemento.nota"), "precio_unitario_cop": ("derivada", "compra_linea.precio_unitario_cop por join"),
              "alta_por": ("columna", "elemento.alta_por")},
 "ElementoNuevo": {"presentacion_id": ("columna", "elemento.presentacion_id"), "ubicacion_id": ("columna", "elemento.ubicacion_id"),
                   "cantidad": ("entrada", "× unidad.factor_a_base -> elemento.cantidad_inicial"), "unidad": ("entrada", "unidad.codigo (conversión)"),
                   "unidades": ("entrada", "cuántas filas de elemento (D1)"), "fecha_compra": ("entrada", "compra.fecha (crea/reutiliza compra)"),
                   "vencimiento": ("columna", "elemento.vencimiento"), "vencimiento_impreso": ("entrada", "elemento.vencimiento_origen = impreso|manual"),
                   "madurez": ("columna", "elemento.madurez"), "precio_unitario_cop": ("entrada", "compra_linea.precio_unitario_cop"),
                   "padre_id": ("columna", "elemento.padre_id"), "etiqueta": ("columna", "elemento.etiqueta"), "nota": ("columna", "elemento.nota"),
                   "foto": ("entrada", "archivo en disco -> producto_foto.ruta")},
 "ElementoEdicion": {"ubicacion_id": ("columna", "elemento.ubicacion_id"), "vencimiento": ("columna", "elemento.vencimiento"), "madurez": ("columna", "elemento.madurez"),
                     "abierto_en": ("columna", "elemento.abierto_en"), "etiqueta": ("columna", "elemento.etiqueta"), "nota": ("columna", "elemento.nota")},
 "ResumenVencimientos": {"hoy": ("derivada", "date('now')"), "dias": ("entrada", "parámetro"), "vencidos": ("derivada", "v_elemento filtrada"),
                         "hoy_vencen": ("derivada", "v_elemento filtrada"), "proximos": ("derivada", "v_elemento filtrada"), "sin_vencimiento": ("derivada", "COUNT v_elemento.vencimiento IS NULL")},
 "Movimiento": {"id": ("columna", "movimiento.id"), "elemento_id": ("columna", "movimiento.elemento_id"), "fecha": ("columna", "movimiento.fecha"),
                "tipo": ("columna", "movimiento.tipo"), "cantidad": ("columna", "movimiento.cantidad"), "motivo": ("columna", "movimiento.motivo"),
                "saldo": ("derivada", "v_elemento.saldo tras el movimiento"), "creado_en": ("columna", "movimiento.creado_en"),
                "miembro_id": ("columna", "movimiento.miembro_id"), "miembro": ("derivada", "miembro.nombre por join")},
 "MovimientoNuevo": {"elemento_id": ("columna", "movimiento.elemento_id"), "tipo": ("columna", "movimiento.tipo"),
                     "cantidad": ("entrada", "× unidad.factor_a_base -> movimiento.cantidad; sin ella, el saldo"), "unidad": ("entrada", "unidad.codigo (conversión)"),
                     "fecha": ("columna", "movimiento.fecha"), "motivo": ("columna", "movimiento.motivo")},
 "ResumenImportacion": {"simulado": ("entrada", "parámetro ?simular"), "filas": ("derivada", "filas del CSV"), "creados": ("derivada", "COUNT elemento creados"),
                        "productos_nuevos": ("derivada", "producto.nombre creados"), "compras": ("derivada", "COUNT compra"), "omitidos": ("derivada", "filas del CSV saltadas")},
 "Proveedor": {"id": ("columna", "proveedor.id"), "nombre": ("columna", "proveedor.nombre"), "nota": ("columna", "proveedor.nota")},
 "ProveedorNuevo": {"nombre": ("columna", "proveedor.nombre"), "nota": ("columna", "proveedor.nota")},
 "Precio": {"presentacion_id": ("columna", "precio.presentacion_id"), "proveedor_id": ("columna", "precio.proveedor_id"),
            "vigente_desde": ("columna", "precio.vigente_desde"), "precio_cop": ("columna", "precio.precio_cop")},
 "Ingrediente": {"producto_id": ("columna", "receta_ingrediente.producto_id"), "producto": ("derivada", "producto.nombre por join"),
                 "cantidad": ("columna", "receta_ingrediente.cantidad"), "unidad": ("entrada", "unidad.codigo -> receta_ingrediente.unidad_id"),
                 "opcional": ("columna", "receta_ingrediente.opcional")},
 "RecetaVersion": {"id": ("columna", "receta_version.id"), "receta_id": ("columna", "receta_version.receta_id"), "numero": ("columna", "receta_version.numero"),
                   "porciones": ("columna", "receta_version.porciones"), "instrucciones": ("columna", "receta_version.instrucciones"),
                   "ingredientes": ("derivada", "filas de receta_ingrediente"), "creado_en": ("columna", "receta_version.creado_en")},
 "RecetaVersionNueva": {"porciones": ("columna", "receta_version.porciones"), "instrucciones": ("columna", "receta_version.instrucciones"), "ingredientes": ("entrada", "filas de receta_ingrediente")},
 "Receta": {"id": ("columna", "receta.id"), "nombre": ("columna", "receta.nombre"), "nota": ("columna", "receta.nota"), "version_vigente": ("derivada", "receta_version con MAX(numero)")},
 "RecetaNueva": {"nombre": ("columna", "receta.nombre"), "nota": ("columna", "receta.nota"), "version": ("entrada", "receta_version numero 1")},
 "RecetaDetalle": {"versiones": ("derivada", "filas de receta_version")},
 "RecetaSugerida": {"receta_id": ("columna", "receta.id"), "nombre": ("columna", "receta.nombre"), "receta_version_id": ("columna", "receta_version.id"),
                    "ingredientes": ("derivada", "COUNT receta_ingrediente"), "disponibles": ("derivada", "COUNT con v_elemento.saldo > 0"), "por_vencer": ("derivada", "COUNT con v_elemento.vencimiento <= hoy+dias")},
 "PlanComida": {"id": ("columna", "plan_comida.id"), "fecha": ("columna", "plan_comida.fecha"), "receta_version_id": ("columna", "plan_comida.receta_version_id"),
                "receta": ("derivada", "receta.nombre por join"), "porciones": ("columna", "plan_comida.porciones"), "nota": ("columna", "plan_comida.nota")},
 "PlanComidaNuevo": {"fecha": ("columna", "plan_comida.fecha"), "receta_id": ("entrada", "receta -> versión vigente -> plan_comida.receta_version_id"),
                     "porciones": ("columna", "plan_comida.porciones"), "nota": ("columna", "plan_comida.nota")},
 "ElementoDetalle": {"movimientos": ("derivada", "filas de movimiento"), "hijos": ("derivada", "elemento.id con padre_id = este"),
                     "fotos": ("derivada", "filas de producto_foto del elemento")},
 "FotoProducto": {"id": ("columna", "producto_foto.id"), "producto_id": ("columna", "producto_foto.producto_id"), "ruta": ("columna", "producto_foto.ruta"),
                  "tomada_en": ("columna", "producto_foto.tomada_en"), "elemento_id": ("columna", "producto_foto.elemento_id")},
 "Miembro": {"id": ("columna", "miembro.id"), "nombre": ("columna", "miembro.nombre"), "rol": ("columna", "miembro.rol"),
             "activo": ("columna", "miembro.activo"), "creado_en": ("columna", "miembro.creado_en")},
 "MiembroConToken": {"token": ("derivada", "generado al crear o renovar; solo su hash va a miembro.token_hash")},
 "MiembroNuevo": {"nombre": ("columna", "miembro.nombre"), "rol": ("columna", "miembro.rol")},
 "MiembroEdicion": {"nombre": ("columna", "miembro.nombre"), "rol": ("columna", "miembro.rol"), "activo": ("columna", "miembro.activo"),
                    "renovar_token": ("entrada", "nuevo token -> miembro.token_hash")},
 "Error": {"error": ("derivada", "no se guarda")}, "Fecha": {},
}

def props(s):
    if "properties" in s: return list(s["properties"])
    if "allOf" in s:
        out=[]
        for p in s["allOf"]:
            if "properties" in p: out += list(p["properties"])
        return out
    return []

errores=[]; filas=[]
for nombre, esquema in spec["components"]["schemas"].items():
    if nombre not in M: errores.append(f"esquema {nombre} sin mapa"); continue
    for prop in props(esquema):
        if prop not in M[nombre]: errores.append(f"{nombre}.{prop} no está en el mapa: ¿existe en el modelo?"); continue
        origen, destino = M[nombre][prop]
        if origen == "columna":
            t, c = destino.split(".")
            if t not in columnas or c not in columnas[t]: errores.append(f"{nombre}.{prop} apunta a {destino}, que no existe en el DDL")
        filas.append((nombre, prop, origen, destino))
    for prop in M[nombre]:
        if prop not in props(esquema): errores.append(f"mapa tiene {nombre}.{prop} pero el contrato no")

print("| Esquema | Campo | Origen | Dónde está en el modelo |")
print("|---|---|---|---|")
for f in filas: print("| " + " | ".join(f) + " |")
print()
n=len(filas); print(f"Campos cotejados: {n} · columna: {sum(1 for f in filas if f[2]=='columna')} · derivada: {sum(1 for f in filas if f[2]=='derivada')} · entrada: {sum(1 for f in filas if f[2]=='entrada')}")
if errores:
    print("\nERRORES:"); [print(" -", e) for e in errores]; sys.exit(1)
print("COTEJO CONTRATO-MODELO OK")
