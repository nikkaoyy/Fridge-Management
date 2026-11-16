// Lógica pura del tablero: semáforo, cifras, orden por urgencia, secciones por ubicación y formatos.
// Sin React ni red: lo que se pinta sale de aquí y la sonda window.__nevera cuenta con lo mismo.
import type { Elemento, Ubicacion } from "./tipos";

export const URGENTE = 2; // ≤ 2 días (y lo vencido): --danger
export const PRONTO = 7; //  ≤ 7 días: --warn; el resto --done

export type Semaforo = "vencido" | "urgente" | "pronto" | "bien" | "sin-fecha";

export function semaforo(d: number | null): Semaforo {
  if (d === null) return "sin-fecha";
  if (d < 0) return "vencido";
  if (d <= URGENTE) return "urgente";
  if (d <= PRONTO) return "pronto";
  return "bien";
}

/** Lo que entra en «por vencer» y en el valor en riesgo: lo vencido y lo que vence en ≤ 7 días (= ?por_vencer=7). */
export const porVencer = (e: Elemento) => e.dias_para_vencer !== null && e.dias_para_vencer <= PRONTO;

export interface Riesgo {
  /** Suma en COP de lo que tiene precio; null si ninguno de los que están en riesgo tiene precio. */
  cop: number | null;
  cosas: number;
  sinPrecio: number;
}

export interface Cifras {
  total: number;
  hoy: number; //     vencen hoy (0 días)
  en2: number; //     entre hoy y 2 días
  en7: number; //     entre hoy y 7 días (= indicadores.por_vencer_7)
  vencidos: number; // antes de hoy (= indicadores.vencidos)
  riesgo: Riesgo;
}

/** El precio de un elemento es el unitario de su línea de compra (una cosa física, D1), en proporción a lo que queda. */
export function valorRestante(e: Elemento): number | null {
  if (e.precio_unitario_cop === null || e.precio_unitario_cop === undefined) return null;
  if (!(e.cantidad_inicial > 0)) return e.precio_unitario_cop;
  return Math.round((e.precio_unitario_cop * e.saldo) / e.cantidad_inicial);
}

export function cifras(lista: Elemento[]): Cifras {
  const d = (e: Elemento) => e.dias_para_vencer;
  const entre = (a: number, b: number) => lista.filter((e) => d(e) !== null && d(e)! >= a && d(e)! <= b).length;
  const enRiesgo = lista.filter(porVencer);
  const valores = enRiesgo.map(valorRestante);
  const conPrecio = valores.filter((v): v is number => v !== null);
  return {
    total: lista.length,
    hoy: entre(0, 0),
    en2: entre(0, URGENTE),
    en7: entre(0, PRONTO),
    vencidos: lista.filter((e) => d(e) !== null && d(e)! < 0).length,
    riesgo: {
      cop: conPrecio.length ? conPrecio.reduce((a, b) => a + b, 0) : null,
      cosas: enRiesgo.length,
      sinPrecio: valores.length - conPrecio.length,
    },
  };
}

/** Urgencia: vencidos arriba (más vencido primero), luego por días que quedan; sin fecha al final. */
export function porUrgencia(a: Elemento, b: Elemento): number {
  const da = a.dias_para_vencer, db = b.dias_para_vencer;
  if ((da === null) !== (db === null)) return da === null ? 1 : -1;
  if (da !== null && db !== null && da !== db) return da - db;
  return a.producto.localeCompare(b.producto, "es") || a.id - b.id;
}

// ------------------------------------------------------------------ ubicaciones

export interface Ubicaciones {
  porId: Map<number, Ubicacion>;
  raizDe: Map<number, number>;
  raices: Ubicacion[];
}

export function ubicaciones(lista: Ubicacion[]): Ubicaciones {
  const porId = new Map(lista.map((u) => [u.id, u]));
  const raizDe = new Map<number, number>();
  for (const u of lista) {
    let r = u;
    for (let v = 0; r.padre_id !== null && porId.has(r.padre_id) && v < 20; v++) r = porId.get(r.padre_id)!;
    raizDe.set(u.id, r.id);
  }
  return { porId, raizDe, raices: lista.filter((u) => u.padre_id === null) };
}

// Las cuatro del pedido van en este orden; si el catálogo trae otras raíces, van después, por id.
const ORDEN = ["nevera", "congelador", "despensa", "frutero"];
export function ordenSecciones(raices: Ubicacion[]): Ubicacion[] {
  const pos = (u: Ubicacion) => (ORDEN.includes(u.nombre) ? ORDEN.indexOf(u.nombre) : ORDEN.length);
  return [...raices].sort((a, b) => pos(a) - pos(b) || a.id - b.id);
}

const FEMENINAS = new Set(["nevera", "despensa", "alacena", "puerta de la nevera"]);
export function conArticulo(nombre: string): string {
  return (FEMENINAS.has(nombre) ? "la " : "el ") + nombre;
}

/** La frase de una sección vacía: nunca una pantalla en blanco. */
export function fraseVacia(nombre: string, motivo: "vacia" | "busqueda" | "por-vencer", puede: boolean): string {
  const art = conArticulo(nombre);
  if (motivo === "busqueda") return `Nada en ${art} coincide con la búsqueda.`;
  if (motivo === "por-vencer") return `Nada por vencer en ${art}: todo bien aquí.`;
  const vacia = FEMENINAS.has(nombre) ? "vacía" : "vacío";
  const frase = `${art.charAt(0).toUpperCase()}${art.slice(1)} está ${vacia}`;
  return puede ? `${frase}: agrega lo primero.` : `${frase}.`;
}

// ------------------------------------------------------------------ formatos

export const normal = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
export const num = (x: number) => nf.format(x);

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
export const pesos = (x: number) => cop.format(x);

export function cantidad(valor: number, unidad: string): string {
  if (unidad === "g" && valor >= 1000) return num(valor / 1000) + " kg";
  if (unidad === "ml" && valor >= 1000) return num(valor / 1000) + " l";
  return num(valor) + " " + unidad;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fecha(iso: string | null, hoy?: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.split("-").map(Number);
  const anio = hoy && Number(hoy.slice(0, 4)) !== a ? " " + a : "";
  return `${d} ${MESES[m - 1]}${anio}`;
}

export function textoDias(d: number | null): string {
  if (d === null) return "sin fecha";
  if (d < -1) return `venció hace ${-d} días`;
  if (d === -1) return "venció ayer";
  if (d === 0) return "vence hoy";
  if (d === 1) return "mañana";
  return `${d} días`;
}

export const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
