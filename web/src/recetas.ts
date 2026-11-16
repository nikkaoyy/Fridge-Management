// Lógica pura de la pestaña de recetas: estados de cada ingrediente y la propuesta de qué elementos usar al cocinar.
// Sin React ni red. El orden de las sugerencias NO se calcula aquí: es el del servidor (GET /recetas/sugeridas).
import type { Elemento, IngredienteSugerido, RecetaSugerida } from "./tipos";
import { PRONTO } from "./logica";

/** «Se me vence» = entre hoy y 7 días, el mismo umbral del filtro «Por vencer» del tablero. */
export const DIAS_RECETA = PRONTO;

export type EstadoIngrediente = "vence" | "tengo" | "falta";

export function estado(i: IngredienteSugerido, falta: boolean): EstadoIngrediente {
  if (falta) return "falta";
  return i.por_vencer ? "vence" : "tengo";
}

export const TEXTO_ESTADO: Record<EstadoIngrediente, string> = {
  vence: "se me vence",
  tengo: "lo tengo",
  falta: "me falta",
};

/** Una línea de la propuesta: de qué elemento sale y cuánto (en la unidad base). */
export interface Linea {
  clave: string;
  elemento: Elemento;
  producto: string;
  cantidad: number;
  usar: boolean;
  opcional: boolean;
}

const redondo = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Lo que se propone descontar: para cada ingrediente que hay, los elementos de ese producto que se vencen antes
 * primero (los mismos que cuentan en el servidor: con saldo y sin vencer), hasta cubrir la cantidad de la receta.
 * Los opcionales se proponen sin marcar. El usuario confirma o cambia: la receta no consume sola.
 */
export function propuesta(s: RecetaSugerida, elementos: Elemento[]): Linea[] {
  const lineas: Linea[] = [];
  for (const ing of s.cubre) {
    const candidatos = elementos
      .filter((e) => e.producto_id === ing.producto_id && e.saldo > 0 && (e.dias_para_vencer === null || e.dias_para_vencer >= 0))
      .sort((a, b) => {
        const da = a.dias_para_vencer, db = b.dias_para_vencer;
        if ((da === null) !== (db === null)) return da === null ? 1 : -1;
        return (da ?? 0) - (db ?? 0) || a.id - b.id;
      });
    let falta = ing.cantidad;
    for (const e of candidatos) {
      if (falta <= 0) break;
      const toma = redondo(Math.min(e.saldo, falta));
      lineas.push({ clave: `${ing.producto_id}-${e.id}`, elemento: e, producto: ing.producto, cantidad: toma,
                    usar: !ing.opcional, opcional: ing.opcional });
      falta = redondo(falta - toma);
    }
  }
  return lineas;
}

/** Los pasos se escriben uno por línea; las líneas vacías no cuentan. */
export const pasos = (texto: string | null | undefined) =>
  (texto ?? "").split("\n").map((p) => p.trim()).filter(Boolean);
