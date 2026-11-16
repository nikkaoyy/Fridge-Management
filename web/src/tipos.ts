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
