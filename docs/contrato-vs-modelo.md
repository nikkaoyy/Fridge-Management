# Contrato contra modelo: cada campo tiene dónde vivir

Generado por `scripts/cotejo_contrato_modelo.py` sobre `api/openapi.yaml` y `db/esquema.sql`. Origen `columna` = la columna
existe tal cual en el DDL; `derivada` = se calcula desde columnas que existen (vistas, joins, conteos); `entrada` = solo
viaja en la petición y se traduce a columnas al escribir.

Resultado del cotejo: **ningún campo del contrato pide algo que el esquema no tenga**. No hubo que añadir nada al
esquema ni quitar nada del contrato. Lo que sí cambió respecto a `PEDIDO-NEVERA-1.md`: `item` pasa a `elemento`,
`expiring_within` a `por_vencer`, `lote` desaparece como campo (es la decisión D1), `precio unitario` vive en
`compra_linea` y no en el elemento, `ubicacion` deja de ser un enumerado y es tabla, y `POST /mermas` es
`POST /movimientos` con `tipo: merma`.

Actualizado en `PEDIDO-NEVERA-2` (bloque 2): el contrato gana miembros (`Miembro*`), la foto del alta
(`ElementoNuevo.foto`, `FotoProducto`) y la atribución (`Elemento.alta_por`, `Movimiento.miembro_id`/`miembro`), y
el esquema gana las tablas y columnas que los sostienen (`miembro`, `producto_foto`, `elemento.alta_por`,
`movimiento.miembro_id`). Sigue sin haber un campo del contrato sin dónde vivir. `compra.registrada_por` no tiene
campo en el contrato porque la fase 1 no expone compras.


| Esquema | Campo | Origen | Dónde está en el modelo |
|---|---|---|---|
| Error | error | derivada | no se guarda |
| Salud | ok | derivada | la app responde |
| Salud | version | derivada | versión de la app |
| Salud | esquema | derivada | PRAGMA user_version |
| Salud | base | derivada | ruta de la base |
| Indicadores | productos | derivada | COUNT producto.activo |
| Indicadores | elementos_disponibles | derivada | COUNT v_elemento.saldo > 0 |
| Indicadores | vencidos | derivada | v_elemento.vencimiento < hoy |
| Indicadores | por_vencer_7 | derivada | v_elemento.vencimiento en [hoy, hoy+7] |
| Indicadores | sin_vencimiento | derivada | v_elemento.vencimiento IS NULL y producto.perecedero |
| Indicadores | mermas_30_dias | derivada | COUNT movimiento.tipo='merma' |
| Categoria | id | columna | categoria.id |
| Categoria | nombre | columna | categoria.nombre |
| CategoriaNueva | nombre | columna | categoria.nombre |
| Unidad | id | columna | unidad.id |
| Unidad | codigo | columna | unidad.codigo |
| Unidad | nombre | columna | unidad.nombre |
| Unidad | magnitud | columna | unidad.magnitud |
| Unidad | factor_a_base | columna | unidad.factor_a_base |
| Ubicacion | id | columna | ubicacion.id |
| Ubicacion | nombre | columna | ubicacion.nombre |
| Ubicacion | padre_id | columna | ubicacion.padre_id |
| VidaUtilBase | dias_base | columna | vida_util.dias_base |
| VidaUtilBase | dias_abierto | columna | vida_util.dias_abierto |
| VidaUtilBase | fuente | columna | vida_util.fuente |
| VidaUtilBase | nota | columna | vida_util.nota |
| VidaUtilBase | registrado_en | columna | vida_util.registrado_en |
| FactorMadurez | madurez | columna | vida_util_madurez.madurez |
| FactorMadurez | factor | columna | vida_util_madurez.factor |
| FactorConservacion | ubicacion_id | columna | vida_util_conservacion.ubicacion_id |
| FactorConservacion | factor | columna | vida_util_conservacion.factor |
| VidaUtilCompleta | base | derivada | fila de vida_util |
| VidaUtilCompleta | madurez | derivada | filas de vida_util_madurez |
| VidaUtilCompleta | conservacion | derivada | filas de vida_util_conservacion |
| Producto | id | columna | producto.id |
| Producto | nombre | columna | producto.nombre |
| Producto | categoria_id | columna | producto.categoria_id |
| Producto | categoria | derivada | categoria.nombre por join |
| Producto | unidad_base | derivada | unidad.codigo de producto.unidad_base_id |
| Producto | perecedero | columna | producto.perecedero |
| Producto | activo | columna | producto.activo |
| Producto | nota | columna | producto.nota |
| Producto | vida_util | derivada | fila de vida_util |
| Producto | creado_en | columna | producto.creado_en |
| ProductoNuevo | nombre | columna | producto.nombre |
| ProductoNuevo | categoria_id | columna | producto.categoria_id |
| ProductoNuevo | unidad_base | entrada | unidad.codigo -> producto.unidad_base_id |
| ProductoNuevo | perecedero | columna | producto.perecedero |
| ProductoNuevo | nota | columna | producto.nota |
| ProductoNuevo | vida_util | entrada | fila de vida_util |
| ProductoEdicion | nombre | columna | producto.nombre |
| ProductoEdicion | categoria_id | columna | producto.categoria_id |
| ProductoEdicion | unidad_base | entrada | unidad.codigo -> producto.unidad_base_id |
| ProductoEdicion | perecedero | columna | producto.perecedero |
| ProductoEdicion | activo | columna | producto.activo |
| ProductoEdicion | nota | columna | producto.nota |
| ProductoEdicion | vida_util | entrada | fila de vida_util |
| Presentacion | id | columna | presentacion.id |
| Presentacion | producto_id | columna | presentacion.producto_id |
| Presentacion | nombre | columna | presentacion.nombre |
| Presentacion | contenido | columna | presentacion.contenido |
| Presentacion | unidad | derivada | unidad.codigo de presentacion.unidad_id |
| Presentacion | parte_id | columna | presentacion.parte_id |
| Presentacion | partes | columna | presentacion.partes |
| Presentacion | contenido_base | derivada | v_presentacion_base.contenido_base |
| Presentacion | codigo_barras | columna | presentacion.codigo_barras |
| Presentacion | activo | columna | presentacion.activo |
| PresentacionNueva | producto_id | columna | presentacion.producto_id |
| PresentacionNueva | nombre | columna | presentacion.nombre |
| PresentacionNueva | contenido | columna | presentacion.contenido |
| PresentacionNueva | unidad | entrada | unidad.codigo -> presentacion.unidad_id |
| PresentacionNueva | parte_id | columna | presentacion.parte_id |
| PresentacionNueva | partes | columna | presentacion.partes |
| PresentacionNueva | codigo_barras | columna | presentacion.codigo_barras |
| PresentacionEdicion | nombre | columna | presentacion.nombre |
| PresentacionEdicion | contenido | columna | presentacion.contenido |
| PresentacionEdicion | unidad | entrada | unidad.codigo -> presentacion.unidad_id |
| PresentacionEdicion | parte_id | columna | presentacion.parte_id |
| PresentacionEdicion | partes | columna | presentacion.partes |
| PresentacionEdicion | codigo_barras | columna | presentacion.codigo_barras |
| PresentacionEdicion | activo | columna | presentacion.activo |
| Elemento | id | columna | elemento.id |
| Elemento | compra_id | columna | elemento.compra_id |
| Elemento | fecha_compra | derivada | compra.fecha por join (v_elemento) |
| Elemento | producto_id | derivada | presentacion.producto_id (v_elemento) |
| Elemento | producto | derivada | producto.nombre (v_elemento) |
| Elemento | categoria_id | derivada | producto.categoria_id (v_elemento) |
| Elemento | presentacion_id | columna | elemento.presentacion_id |
| Elemento | presentacion | derivada | presentacion.nombre (v_elemento) |
| Elemento | ubicacion_id | columna | elemento.ubicacion_id |
| Elemento | unidad_base | derivada | unidad.codigo de producto.unidad_base_id |
| Elemento | cantidad_inicial | columna | elemento.cantidad_inicial |
| Elemento | saldo | derivada | v_elemento.saldo = cantidad_inicial - SUM(movimiento.cantidad) |
| Elemento | vencimiento | columna | elemento.vencimiento |
| Elemento | vencimiento_origen | columna | elemento.vencimiento_origen |
| Elemento | dias_para_vencer | derivada | v_elemento.dias_para_vencer |
| Elemento | madurez | columna | elemento.madurez |
| Elemento | abierto_en | columna | elemento.abierto_en |
| Elemento | padre_id | columna | elemento.padre_id |
| Elemento | etiqueta | columna | elemento.etiqueta |
| Elemento | nota | columna | elemento.nota |
| Elemento | precio_unitario_cop | derivada | compra_linea.precio_unitario_cop por join |
| Elemento | alta_por | columna | elemento.alta_por |
| ElementoDetalle | movimientos | derivada | filas de movimiento |
| ElementoDetalle | hijos | derivada | elemento.id con padre_id = este |
| ElementoDetalle | fotos | derivada | filas de producto_foto del elemento |
| FotoProducto | id | columna | producto_foto.id |
| FotoProducto | producto_id | columna | producto_foto.producto_id |
| FotoProducto | ruta | columna | producto_foto.ruta |
| FotoProducto | tomada_en | columna | producto_foto.tomada_en |
| FotoProducto | elemento_id | columna | producto_foto.elemento_id |
| ElementoNuevo | presentacion_id | columna | elemento.presentacion_id |
| ElementoNuevo | ubicacion_id | columna | elemento.ubicacion_id |
| ElementoNuevo | cantidad | entrada | × unidad.factor_a_base -> elemento.cantidad_inicial |
| ElementoNuevo | unidad | entrada | unidad.codigo (conversión) |
| ElementoNuevo | unidades | entrada | cuántas filas de elemento (D1) |
| ElementoNuevo | fecha_compra | entrada | compra.fecha (crea/reutiliza compra) |
| ElementoNuevo | vencimiento | columna | elemento.vencimiento |
| ElementoNuevo | vencimiento_impreso | entrada | elemento.vencimiento_origen = impreso|manual |
| ElementoNuevo | madurez | columna | elemento.madurez |
| ElementoNuevo | precio_unitario_cop | entrada | compra_linea.precio_unitario_cop |
| ElementoNuevo | padre_id | columna | elemento.padre_id |
| ElementoNuevo | etiqueta | columna | elemento.etiqueta |
| ElementoNuevo | nota | columna | elemento.nota |
| ElementoNuevo | foto | entrada | archivo en disco -> producto_foto.ruta |
| ElementoEdicion | ubicacion_id | columna | elemento.ubicacion_id |
| ElementoEdicion | vencimiento | columna | elemento.vencimiento |
| ElementoEdicion | madurez | columna | elemento.madurez |
| ElementoEdicion | abierto_en | columna | elemento.abierto_en |
| ElementoEdicion | etiqueta | columna | elemento.etiqueta |
| ElementoEdicion | nota | columna | elemento.nota |
| ResumenVencimientos | hoy | derivada | date('now') |
| ResumenVencimientos | dias | entrada | parámetro |
| ResumenVencimientos | vencidos | derivada | v_elemento filtrada |
| ResumenVencimientos | hoy_vencen | derivada | v_elemento filtrada |
| ResumenVencimientos | proximos | derivada | v_elemento filtrada |
| ResumenVencimientos | sin_vencimiento | derivada | COUNT v_elemento.vencimiento IS NULL |
| Movimiento | id | columna | movimiento.id |
| Movimiento | elemento_id | columna | movimiento.elemento_id |
| Movimiento | fecha | columna | movimiento.fecha |
| Movimiento | tipo | columna | movimiento.tipo |
| Movimiento | cantidad | columna | movimiento.cantidad |
| Movimiento | motivo | columna | movimiento.motivo |
| Movimiento | saldo | derivada | v_elemento.saldo tras el movimiento |
| Movimiento | creado_en | columna | movimiento.creado_en |
| Movimiento | miembro_id | columna | movimiento.miembro_id |
| Movimiento | miembro | derivada | miembro.nombre por join |
| MovimientoNuevo | elemento_id | columna | movimiento.elemento_id |
| MovimientoNuevo | tipo | columna | movimiento.tipo |
| MovimientoNuevo | cantidad | entrada | × unidad.factor_a_base -> movimiento.cantidad; sin ella, el saldo |
| MovimientoNuevo | unidad | entrada | unidad.codigo (conversión) |
| MovimientoNuevo | fecha | columna | movimiento.fecha |
| MovimientoNuevo | motivo | columna | movimiento.motivo |
| ResumenImportacion | simulado | entrada | parámetro ?simular |
| ResumenImportacion | filas | derivada | filas del CSV |
| ResumenImportacion | creados | derivada | COUNT elemento creados |
| ResumenImportacion | productos_nuevos | derivada | producto.nombre creados |
| ResumenImportacion | compras | derivada | COUNT compra |
| ResumenImportacion | omitidos | derivada | filas del CSV saltadas |
| Miembro | id | columna | miembro.id |
| Miembro | nombre | columna | miembro.nombre |
| Miembro | rol | columna | miembro.rol |
| Miembro | activo | columna | miembro.activo |
| Miembro | creado_en | columna | miembro.creado_en |
| MiembroConToken | token | derivada | generado al crear o renovar; solo su hash va a miembro.token_hash |
| MiembroNuevo | nombre | columna | miembro.nombre |
| MiembroNuevo | rol | columna | miembro.rol |
| MiembroEdicion | nombre | columna | miembro.nombre |
| MiembroEdicion | rol | columna | miembro.rol |
| MiembroEdicion | activo | columna | miembro.activo |
| MiembroEdicion | renovar_token | entrada | nuevo token -> miembro.token_hash |
| Proveedor | id | columna | proveedor.id |
| Proveedor | nombre | columna | proveedor.nombre |
| Proveedor | nota | columna | proveedor.nota |
| ProveedorNuevo | nombre | columna | proveedor.nombre |
| ProveedorNuevo | nota | columna | proveedor.nota |
| Precio | presentacion_id | columna | precio.presentacion_id |
| Precio | proveedor_id | columna | precio.proveedor_id |
| Precio | vigente_desde | columna | precio.vigente_desde |
| Precio | precio_cop | columna | precio.precio_cop |
| Ingrediente | producto_id | columna | receta_ingrediente.producto_id |
| Ingrediente | producto | derivada | producto.nombre por join |
| Ingrediente | cantidad | columna | receta_ingrediente.cantidad |
| Ingrediente | unidad | entrada | unidad.codigo -> receta_ingrediente.unidad_id |
| Ingrediente | opcional | columna | receta_ingrediente.opcional |
| RecetaVersion | id | columna | receta_version.id |
| RecetaVersion | receta_id | columna | receta_version.receta_id |
| RecetaVersion | numero | columna | receta_version.numero |
| RecetaVersion | porciones | columna | receta_version.porciones |
| RecetaVersion | instrucciones | columna | receta_version.instrucciones |
| RecetaVersion | ingredientes | derivada | filas de receta_ingrediente |
| RecetaVersion | creado_en | columna | receta_version.creado_en |
| RecetaVersionNueva | porciones | columna | receta_version.porciones |
| RecetaVersionNueva | instrucciones | columna | receta_version.instrucciones |
| RecetaVersionNueva | ingredientes | entrada | filas de receta_ingrediente |
| Receta | id | columna | receta.id |
| Receta | nombre | columna | receta.nombre |
| Receta | nota | columna | receta.nota |
| Receta | version_vigente | derivada | receta_version con MAX(numero) |
| RecetaNueva | nombre | columna | receta.nombre |
| RecetaNueva | nota | columna | receta.nota |
| RecetaNueva | version | entrada | receta_version numero 1 |
| RecetaDetalle | versiones | derivada | filas de receta_version |
| RecetaSugerida | receta_id | columna | receta.id |
| RecetaSugerida | nombre | columna | receta.nombre |
| RecetaSugerida | receta_version_id | columna | receta_version.id |
| RecetaSugerida | ingredientes | derivada | COUNT receta_ingrediente |
| RecetaSugerida | disponibles | derivada | COUNT con v_elemento.saldo > 0 |
| RecetaSugerida | por_vencer | derivada | COUNT con v_elemento.vencimiento <= hoy+dias |
| PlanComida | id | columna | plan_comida.id |
| PlanComida | fecha | columna | plan_comida.fecha |
| PlanComida | receta_version_id | columna | plan_comida.receta_version_id |
| PlanComida | receta | derivada | receta.nombre por join |
| PlanComida | porciones | columna | plan_comida.porciones |
| PlanComida | nota | columna | plan_comida.nota |
| PlanComidaNuevo | fecha | columna | plan_comida.fecha |
| PlanComidaNuevo | receta_id | entrada | receta -> versión vigente -> plan_comida.receta_version_id |
| PlanComidaNuevo | porciones | columna | plan_comida.porciones |
| PlanComidaNuevo | nota | columna | plan_comida.nota |

Campos cotejados: 219 · columna: 145 · derivada: 52 · entrada: 22
COTEJO CONTRATO-MODELO OK
