// D2 (a), esquemática: la escena coloca cada cosa con una regla fija a partir de su `ubicacion`. No hay coordenadas
// guardadas en ninguna parte: cada vez que llegan los elementos, las posiciones se recalculan aquí.
// Sin three ni React: lógica pura, la misma que lee la sonda.
import { normal, porUrgencia, semaforo, type Semaforo, type Ubicaciones } from "../logica";
import type { Elemento } from "../tipos";
import { grupoDe, MONTON_MAS_DE, type Forma } from "./familias";

/** Compartimentos de la escena. Las raíces que no son nevera ni despensa (congelador, frutero…) van como `extra:<id>`. */
export type ClaveCompartimento = "nevera" | "puerta" | "cajon" | "despensa" | `extra:${number}`;

/**
 * Regla de D2: la raíz de la ubicación decide el mueble; dentro de la nevera, una ubicación (o un ancestro) que se
 * llame «puerta…» va a la puerta y «cajón…» al cajón de verduras; lo demás de la nevera, a las baldas.
 */
export function compartimentoDe(e: Elemento, u: Ubicaciones): ClaveCompartimento {
  const raiz = u.raizDe.get(e.ubicacion_id) ?? e.ubicacion_id;
  const nombreRaiz = normal(u.porId.get(raiz)?.nombre);
  if (nombreRaiz === "nevera") {
    for (let id: number | null = e.ubicacion_id, v = 0; id !== null && id !== raiz && v < 20; v++) {
      const ub = u.porId.get(id);
      if (!ub) break;
      const n = normal(ub.nombre);
      if (n.startsWith("puerta")) return "puerta";
      if (n.startsWith("cajon")) return "cajon";
      id = ub.padre_id;
    }
    return "nevera";
  }
  if (nombreRaiz === "despensa") return "despensa";
  return `extra:${raiz}`;
}

/**
 * Una superficie donde se apoyan cosas, en su marco local: x de −ancho/2 a ancho/2, z de −fondo/2 (atrás) a fondo/2
 * (frente). `alto`: el hueco libre encima (hasta la balda de arriba), para que nada la atraviese.
 */
export interface Superficie {
  ancho: number;
  fondo: number;
  alto?: number;
}

export interface Rejilla {
  columnas: number;
  filas: number;
  /** Separación entre columnas y entre filas, en metros. */
  pasoX: number;
  pasoZ: number;
}

/**
 * La rejilla de un compartimento con `n` cosas en `s` superficies iguales. NEVERA-7: si alguna rejilla deja celdas de
 * al menos `objetivo` metros (lo que pide la cosa más ancha), gana la de **menos filas** (todo lo posible en la fila de
 * delante, a la vista); si ninguna llega, la de paso más grande (las cosas se encogen hasta caber).
 */
export function rejilla(n: number, s: number, sup: Superficie, objetivo: number): Rejilla {
  const total = Math.max(1, n);
  let mejor: { r: Rejilla; paso: number } | null = null;
  let mejorQueLlega: { r: Rejilla; paso: number } | null = null;
  for (let columnas = 1; columnas <= total; columnas++) {
    const filas = Math.ceil(total / (s * columnas));
    const pasoX = sup.ancho / columnas;
    const paso = Math.min(pasoX, sup.fondo / filas);
    const r = { columnas, filas, pasoX, pasoZ: sup.fondo / filas };
    if (!mejor || paso > mejor.paso + 1e-9) mejor = { r, paso };
    if (paso + 1e-9 >= objetivo && (!mejorQueLlega || filas < mejorQueLlega.r.filas || (filas === mejorQueLlega.r.filas && paso > mejorQueLlega.paso + 1e-9))) {
      mejorQueLlega = { r, paso };
    }
  }
  return (mejorQueLlega ?? mejor)!.r;
}

export interface Medidas {
  ancho: number;
  alto: number;
  fondo: number;
}

/**
 * Lo que ocupa un sitio en la balda: una cosa o, NEVERA-7, un **montón** (más de MONTON_MAS_DE cosas del mismo grupo
 * en el compartimento: se dibujan tres piezas y el número, y se despliega al tocarlo).
 */
export interface Unidad {
  /** La cosa que manda: la más urgente del montón (o la única). */
  id: number;
  ids: number[];
  grupo: string;
  /** Dibujada como montón (plegado). */
  monton: boolean;
  /** Si es parte de un montón desplegado: su grupo, para plegarlo. */
  desplegadaDe: string | null;
  forma: Forma;
  /** Medidas de una pieza a su tamaño por cantidad, antes de encajar en la celda. */
  medidas: Medidas;
  semaforo: Semaforo;
}

export interface Pieza {
  dx: number;
  dy: number;
  dz: number;
}

/** Las piezas de un montón, en unidades de la pieza: las botellas se juntan de pie; lo demás, dos abajo y una encima. */
export function piezasDe(forma: Forma, n: number): Pieza[] {
  if (n <= 1) return [{ dx: 0, dy: 0, dz: 0 }];
  const de = forma === "botella"
    ? [{ dx: -0.52, dy: 0, dz: 0.3 }, { dx: 0.52, dy: 0, dz: 0.3 }, { dx: 0, dy: 0, dz: -0.55 }]
    : [{ dx: -0.52, dy: 0, dz: 0 }, { dx: 0.52, dy: 0, dz: 0 }, { dx: 0, dy: 0.96, dz: 0 }];
  return de.slice(0, Math.min(3, n));
}

/** Lo que ocupa una unidad entera (sus piezas juntas), en múltiplos de la pieza. */
function huella(u: Unidad): Medidas {
  const n = u.monton ? Math.min(3, u.ids.length) : 1;
  if (n === 1) return u.medidas;
  const m = u.medidas;
  return u.forma === "botella"
    ? { ancho: m.ancho * 2.04, alto: m.alto, fondo: m.fondo * (n > 2 ? 1.85 : 1) }
    : { ancho: m.ancho * 2.04, alto: m.alto * (n > 2 ? 1.96 : 1), fondo: m.fondo };
}

/**
 * Agrupa las cosas de un compartimento: por urgencia (la misma `porUrgencia` de la lista) y, NEVERA-7, los grupos con
 * más de `masDe` cosas en un montón que ocupa el sitio de la más urgente. Un montón desplegado (`abiertos`) pone sus
 * cosas juntas, una tras otra, en ese mismo sitio. Los grupos pequeños no se tocan: manda la urgencia.
 */
export function agrupar(
  elementos: readonly Elemento[],
  como: (e: Elemento) => { forma: Forma; medidas: Medidas },
  abiertos: ReadonlySet<string> = new Set(),
  masDe = MONTON_MAS_DE,
): Unidad[] {
  const orden = [...elementos].sort(porUrgencia);
  const info = new Map(orden.map((e) => [e.id, como(e)]));
  const grupos = new Map<string, Elemento[]>();
  for (const e of orden) {
    const g = grupoDe(e.producto, info.get(e.id)!.forma);
    (grupos.get(g) ?? grupos.set(g, []).get(g)!).push(e);
  }
  const unidades: Unidad[] = [];
  const hechos = new Set<string>();
  const una = (e: Elemento, grupo: string, desplegadaDe: string | null): Unidad => ({
    id: e.id,
    ids: [e.id],
    grupo,
    monton: false,
    desplegadaDe,
    forma: info.get(e.id)!.forma,
    medidas: info.get(e.id)!.medidas,
    semaforo: semaforo(e.dias_para_vencer),
  });
  for (const e of orden) {
    const grupo = grupoDe(e.producto, info.get(e.id)!.forma);
    const g = grupos.get(grupo)!;
    if (g.length <= masDe) {
      unidades.push(una(e, grupo, null));
      continue;
    }
    if (hechos.has(grupo)) continue;
    hechos.add(grupo);
    if (abiertos.has(grupo)) {
      for (const m of g) unidades.push(una(m, grupo, grupo));
    } else {
      unidades.push({ ...una(e, grupo, null), ids: g.map((m) => m.id), monton: true });
    }
  }
  return unidades;
}

export interface Puesto {
  id: number;
  ids: number[];
  /** Índice de la superficie (0 = la primera en llenarse: la de arriba). */
  superficie: number;
  fila: number;
  columna: number;
  /** Centro de la base en su superficie (y = 0: apoyada). */
  x: number;
  z: number;
  /** Medidas finales de una pieza (ya encajada en su celda y bajo la balda de arriba). */
  ancho: number;
  alto: number;
  fondo: number;
  semaforo: Semaforo;
  unidad: Unidad;
}

/** Hueco que se deja entre una cosa y la de al lado (fracción de la celda que puede ocupar). */
const LLENO = 0.9;
/** La cosa más ancha pide celdas de su huella más este margen; por encima de TOPE no se pide más (se encoge). */
const MARGEN_OBJETIVO = 1.12;
const TOPE_OBJETIVO = 0.17;

/**
 * Coloca las unidades de un compartimento, ya en orden, **por filas desde el frente**: la fila de delante de cada
 * superficie (de arriba abajo, de izquierda a derecha) se llena antes que cualquier segunda fila. Así lo vencido y lo
 * que vence antes queda siempre en el frente, a la vista al abrir. Cada cosa conserva su tamaño por cantidad mientras
 * quepa en su celda y bajo la balda de arriba; si no, se encoge entera (sin deformarse).
 */
export function colocar(unidades: readonly Unidad[], superficies: readonly Superficie[]): { puestos: Puesto[]; rejilla: Rejilla } {
  const s = Math.max(1, superficies.length);
  const sup = superficies[0] ?? { ancho: 0.5, fondo: 0.4 };
  const huellas = unidades.map(huella);
  const objetivo = Math.min(TOPE_OBJETIVO, sup.ancho, Math.max(0.01, ...huellas.map((h) => Math.max(h.ancho, h.fondo) * MARGEN_OBJETIVO)));
  const r = rejilla(unidades.length, s, sup, objetivo);
  // Filas pegadas al frente: no se reparten por todo el fondo si caben más juntas.
  const fondoMax = Math.max(0.01, ...huellas.map((h) => h.fondo));
  r.pasoZ = Math.min(r.pasoZ, fondoMax * 1.35);
  const porFila = s * r.columnas;
  const puestos = unidades.map((u, i): Puesto => {
    const fila = Math.floor(i / porFila);
    const resto = i % porFila;
    const superficie = Math.floor(resto / r.columnas);
    const columna = resto % r.columnas;
    const h = huellas[i];
    const alto = superficies[superficie]?.alto ?? Infinity;
    const k = Math.min(1, (LLENO * r.pasoX) / h.ancho, (LLENO * r.pasoZ) / h.fondo, (0.86 * alto) / h.alto);
    return {
      id: u.id,
      ids: u.ids,
      superficie,
      fila,
      columna,
      x: -sup.ancho / 2 + r.pasoX * (columna + 0.5),
      z: sup.fondo / 2 - r.pasoZ * (fila + 0.5),
      ancho: u.medidas.ancho * k,
      alto: u.medidas.alto * k,
      fondo: u.medidas.fondo * k,
      semaforo: u.semaforo,
      unidad: u,
    };
  });
  return { puestos, rejilla: r };
}

/** Sigla de una categoría para su celda del atlas: iniciales si son varias palabras («frutas y verduras» → FV), si no las tres primeras letras. */
export function sigla(nombre: string | undefined): string {
  const palabras = normal(nombre).split(/\s+/).filter((p) => p && !["y", "de", "la", "el", "del"].includes(p));
  if (!palabras.length) return "?";
  if (palabras.length > 1) return palabras.slice(0, 3).map((p) => p[0]).join("").toUpperCase();
  return palabras[0].slice(0, 3).toUpperCase();
}
