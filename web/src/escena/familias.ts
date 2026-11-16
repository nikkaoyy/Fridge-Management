// PEDIDO-NEVERA-7: de qué familia (forma) es cada cosa, de qué tamaño se dibuja, de qué tono va su cuerpo, con quién
// se amontona y qué nombre corto lleva su etiqueta. Todo sale de familias.json: aquí solo está la regla, ningún nombre
// de producto ni color. Sin three, sin React y sin imports en tiempo de ejecución (salvo el JSON), para que la misma
// función la puedan ejecutar las pruebas con Node (tests/test_escena.py).
import datos from "./familias.json" with { type: "json" };

export const FORMAS = ["botella", "caja", "bolsa", "lata", "esfera"] as const;
export type Forma = (typeof FORMAS)[number];

/** Lo que hace falta de un elemento (el tipo de la API lo cumple). */
export interface CosaDeLista {
  producto: string;
  unidad_base: string;
  saldo: number;
}

export interface Tono {
  token: string;
  hacia?: string;
  t?: number;
}

/** Minúsculas, sin tildes y con los espacios colapsados (la misma idea que `normal` de logica.ts). */
export const normalizar = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const esForma = (x: unknown): x is Forma => typeof x === "string" && (FORMAS as readonly string[]).includes(x);

const porCategoria = new Map(Object.entries(datos.porCategoria).map(([k, v]) => [normalizar(k), v as Forma]));
// Las claves más largas primero: «leche plv» se prueba antes que una posible «leche».
const excepciones = [...datos.excepciones]
  .map((x) => ({ empieza: normalizar(x.empieza) + (x.empieza.endsWith(" ") ? " " : ""), forma: x.forma as Forma }))
  .sort((a, b) => b.empieza.length - a.empieza.length);

/** La familia: primero la excepción por nombre, luego la categoría, si no la de por defecto. */
export function familiaDe(producto: string, categoria: string | null | undefined): Forma {
  const n = normalizar(producto) + " ";
  for (const x of excepciones) if (n.startsWith(x.empieza)) return x.forma;
  const f = porCategoria.get(normalizar(categoria));
  return esForma(f) ? f : (datos.porDefecto as Forma);
}

/** Medidas (m) de una forma a tamaño 1: ancho (x), alto (y) y fondo (z). */
export function medidas(f: Forma): { ancho: number; alto: number; fondo: number } {
  const m = datos.formas[f];
  return { ancho: m.ancho, alto: m.alto, fondo: m.fondo };
}

/** Qué cosas lleva cada forma, para la leyenda. */
export const queLleva = (f: Forma): string => datos.formas[f].que;

/** Factor de tamaño por lo que queda: en g/ml por volumen (raíz cúbica), en unidades un paso por unidad; con tope. */
export function factorTamano(e: CosaDeLista): number {
  const saldo = Math.max(0, e.saldo);
  if (e.unidad_base === "u") {
    const c = datos.tamano.conteo;
    return Math.min(c.max, Math.max(c.min, 1 + c.paso * (saldo - 1)));
  }
  const m = datos.tamano.masa;
  return Math.min(m.max, Math.max(m.min, Math.cbrt(saldo / m.ref)));
}

/** El tono del cuerpo: un token de la piel (y, si se mezcla, con cuál y cuánto). Sin categoría conocida, uno fijo por nombre. */
export function tonoDe(categoria: string | null | undefined): Tono {
  const t = (datos.tonos as Record<string, Tono>)[normalizar(categoria)];
  if (t) return t;
  const l = datos.tonosSinCategoria;
  let h = 0;
  for (const c of normalizar(categoria)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { token: l[h % l.length] };
}

/** A partir de cuántas cosas del mismo grupo se dibuja un montón (más de esto). */
export const MONTON_MAS_DE: number = datos.monton.masDe;

/** El grupo de una cosa dentro de su compartimento: la primera palabra del nombre y su forma («papa|bolsa»). */
export function grupoDe(producto: string, forma: Forma): string {
  return `${normalizar(producto).split(" ")[0] || "?"}|${forma}`;
}

const NC = datos.nombreCorto;
const abreviaturas = new Map(Object.entries(NC.abreviaturas));
const sobran = new Set(NC.sobran);
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** «LECHE PLV ENT KLIM» → «Leche en polvo»; «BANANO CORRIENTE» → «Banano». */
export function nombreCorto(producto: string): string {
  const palabras: string[] = [];
  let largo = 0;
  for (const cruda of producto.toLowerCase().split(/\s+/)) {
    const clave = normalizar(cruda);
    if (!clave || sobran.has(clave) || /\d|\(|\)/.test(clave)) continue;
    const p = abreviaturas.get(clave) ?? cruda;
    if (palabras.length && largo + 1 + p.length > NC.largoMax) break;
    palabras.push(p);
    largo += (palabras.length > 1 ? 1 : 0) + p.length;
    if (palabras.length >= 2) break;
  }
  return capital(palabras.join(" ") || producto.toLowerCase());
}

/** El nombre de un montón: su primera palabra, con mayúscula («Papa»). */
export function nombreGrupo(producto: string): string {
  return nombreCorto(producto).split(" ")[0];
}
