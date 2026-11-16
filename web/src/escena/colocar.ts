// D2 (a), esquemática: la escena coloca cada cosa con una regla fija a partir de su `ubicacion`. No hay coordenadas
// guardadas en ninguna parte: cada vez que llegan los elementos, las posiciones se recalculan aquí.
// Sin three ni React: lógica pura, la misma que lee la sonda.
import { normal, porUrgencia, semaforo, type Semaforo, type Ubicaciones } from "../logica";
import type { Elemento } from "../tipos";

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

/** Una superficie donde se apoyan cosas, en su marco local: x de −ancho/2 a ancho/2, z de −fondo/2 (atrás) a fondo/2 (frente). */
export interface Superficie {
  ancho: number;
  fondo: number;
}

export interface Rejilla {
  columnas: number;
  filas: number;
  /** Separación entre columnas y entre filas, en metros. */
  pasoX: number;
  pasoZ: number;
  /** Radio de una cosa entera (saldo = cantidad inicial). */
  radio: number;
}

/**
 * La rejilla de un compartimento con `n` cosas repartidas en `s` superficies iguales: las columnas que dejan el paso
 * más grande (a igual paso, menos filas, para que todo quede lo más al frente posible). El radio es el menor entre
 * `radioMax` y el 42 % del paso: nunca se pisan.
 */
export function rejilla(n: number, s: number, sup: Superficie, radioMax: number): Rejilla {
  let mejor: Rejilla = { columnas: 1, filas: 1, pasoX: sup.ancho, pasoZ: sup.fondo, radio: radioMax };
  let mejorPaso = -1;
  const total = Math.max(1, n);
  for (let columnas = 1; columnas <= total; columnas++) {
    const filas = Math.ceil(total / (s * columnas));
    const pasoX = sup.ancho / columnas;
    const paso = Math.min(pasoX, sup.fondo / filas);
    if (paso > mejorPaso + 1e-9) {
      mejorPaso = paso;
      const radio = Math.min(radioMax, paso * 0.42);
      // Las filas van pegadas al frente: no se reparten por todo el fondo si caben más juntas.
      const pasoZ = Math.min(sup.fondo / filas, radio * 2.6);
      mejor = { columnas, filas, pasoX, pasoZ, radio };
    }
  }
  return mejor;
}

export interface Puesto {
  id: number;
  /** Índice de la superficie (0 = la primera en llenarse: la de arriba). */
  superficie: number;
  fila: number;
  columna: number;
  /** Posición local en su superficie (centro de la esfera). */
  x: number;
  y: number;
  z: number;
  radio: number;
  semaforo: Semaforo;
}

/** Radio según lo que queda: entera = 1; vacía, el mínimo legible (60 %). */
export const factorCantidad = (e: Elemento) =>
  0.6 + 0.4 * Math.sqrt(e.cantidad_inicial > 0 ? Math.min(1, Math.max(0, e.saldo / e.cantidad_inicial)) : 1);

/**
 * Coloca las cosas de un compartimento: ordenadas por urgencia (la misma `porUrgencia` de la lista: vencidos primero,
 * luego por días, sin fecha al final) y repartidas **por filas desde el frente**: la fila de delante de cada superficie
 * (de arriba abajo, de izquierda a derecha) se llena antes que cualquier segunda fila. Así lo vencido y lo que vence
 * antes queda siempre en el frente, a la vista al abrir.
 */
export function colocar(elementos: readonly Elemento[], superficies: readonly Superficie[], radioMax: number): { puestos: Puesto[]; rejilla: Rejilla } {
  const s = Math.max(1, superficies.length);
  const sup = superficies[0] ?? { ancho: 0.5, fondo: 0.4 };
  const r = rejilla(elementos.length, s, sup, radioMax);
  const orden = [...elementos].sort(porUrgencia);
  const porFila = s * r.columnas;
  const puestos = orden.map((e, i): Puesto => {
    const fila = Math.floor(i / porFila);
    const resto = i % porFila;
    const superficie = Math.floor(resto / r.columnas);
    const columna = resto % r.columnas;
    const radio = r.radio * factorCantidad(e);
    return {
      id: e.id,
      superficie,
      fila,
      columna,
      x: -sup.ancho / 2 + r.pasoX * (columna + 0.5),
      y: radio,
      z: sup.fondo / 2 - r.pasoZ * (fila + 0.5),
      radio,
      semaforo: semaforo(e.dias_para_vencer),
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
