// Tipos de lo que devuelve la API, copiados de api/openapi.yaml (components/schemas). Solo lectura: si el contrato
// cambia, se cambia allí primero. Lo que el contrato no tiene, aquí no está.

export type Rol = "admin" | "editor" | "lector";

export interface Miembro {
  id: number;
  nombre: string;
  rol: Rol;
  activo: boolean;
  creado_en: string;
}

export interface Ubicacion {
  id: number;
  nombre: string;
  padre_id: number | null;
}

export interface Unidad {
  id: number;
  codigo: string;
  nombre: string;
  magnitud: "masa" | "volumen" | "conteo";
  factor_a_base: number;
}

export interface Categoria {
  id: number;
  nombre: string;
}

export interface Producto {
  id: number;
  nombre: string;
  categoria_id: number;
  categoria?: string;
  unidad_base: "g" | "ml" | "u";
  perecedero: boolean;
  activo: boolean;
  nota?: string | null;
}

export interface Presentacion {
  id: number;
  producto_id: number;
  nombre: string;
  contenido: number | null;
  unidad: string | null;
  parte_id: number | null;
  partes: number | null;
  activo: boolean;
}

export interface Elemento {
  id: number;
  compra_id: number;
  fecha_compra: string;
  producto_id: number;
  producto: string;
  categoria_id?: number;
  presentacion_id: number;
  presentacion: string;
  ubicacion_id: number;
  unidad_base: string;
  cantidad_inicial: number;
  saldo: number;
  vencimiento: string | null;
  vencimiento_origen: "impreso" | "estimado" | "manual" | null;
  dias_para_vencer: number | null;
  madurez: "verde" | "en_punto" | "madura" | null;
  abierto_en: string | null;
  padre_id: number | null;
  etiqueta: string | null;
  nota?: string | null;
  precio_unitario_cop?: number | null;
  alta_por?: number | null;
}

export interface ResumenVencimientos {
  hoy: string;
  dias: number;
  vencidos: Elemento[];
  hoy_vencen: Elemento[];
  proximos: Elemento[];
  sin_vencimiento: number;
}

export interface ResumenImportacion {
  simulado: boolean;
  filas: number;
  creados: number;
  productos_nuevos: string[];
  compras: number;
  omitidos: { fila: number; motivo: string }[];
}

// ------------------------------------------------------------------ recetas (PEDIDO-NEVERA-5)

export interface Movimiento {
  id: number;
  elemento_id: number;
  fecha: string;
  tipo: "consumo" | "merma" | "ajuste";
  cantidad: number;
  motivo: string | null;
  saldo: number;
  creado_en?: string;
  miembro_id?: number | null;
  miembro?: string | null;
}

/** Al leer, `cantidad` y `unidad` vienen en la unidad base del producto. */
export interface Ingrediente {
  producto_id: number;
  producto?: string;
  cantidad: number;
  unidad: string;
  opcional?: boolean;
}

export interface RecetaVersion {
  id: number;
  receta_id: number;
  numero: number;
  porciones: number;
  instrucciones?: string | null;
  ingredientes: Ingrediente[];
  creado_en: string;
}

export interface Receta {
  id: number;
  nombre: string;
  nota?: string | null;
  version_vigente: RecetaVersion;
}

export interface RecetaDetalle extends Receta {
  versiones: RecetaVersion[];
}

export interface IngredienteSugerido {
  producto_id: number;
  producto: string;
  cantidad: number;
  unidad: string;
  opcional: boolean;
  saldo: number;
  dias_para_vencer: number | null;
  por_vencer: boolean;
  alcanza: boolean;
}

export interface RecetaSugerida {
  receta_id: number;
  nombre: string;
  receta_version_id: number;
  porciones?: number;
  ingredientes: number;
  disponibles: number;
  por_vencer: number;
  dias_mas_urgente: number | null;
  cubre: IngredienteSugerido[];
  faltan: IngredienteSugerido[];
}

export interface Cocinado {
  receta_id: number;
  receta_version_id: number;
  motivo: string;
  movimientos: Movimiento[];
}
