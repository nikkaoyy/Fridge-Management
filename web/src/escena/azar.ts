// ORIGEN: /opt/data/pythagoras/web/src/escena/azar.ts @ 1ac4185 (PYTHAGORAS 9), copiado sin cambios.
// tests/test_escena.py lo coteja byte a byte con el original. No se edita aquí: si PYTHAGORAS cambia, se vuelve a copiar.
/** Azar determinista: el mismo id da siempre la misma fase, inclinación y giro, refresco tras refresco. */

/** FNV-1a de 32 bits. */
export function hashTexto(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: generador pequeño y suficiente para colocar cuerpos. */
export function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const azarDe = (texto: string) => generador(hashTexto(texto));
