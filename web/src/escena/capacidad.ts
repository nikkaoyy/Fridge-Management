// Antes de cargar three: ¿se puede dibujar la nevera en 3D aquí, y en qué modo? Sin importar el motor, para que la
// lista no pague los ~500 kB de three si no se va a usar.

export interface Capacidad {
  /** null si se puede; si no, la frase que se le dice al usuario (una vez). */
  impedimento: string | null;
  /** Modo ligero automático y por qué (`pointer: coarse`, `devicePixelRatio ≥ 2` o `escritorio`). */
  ligero: boolean;
  motivo: string;
}

interface NavegadorConMemoria extends Navigator {
  deviceMemory?: number;
}

export function capacidad(): Capacidad {
  const tactil = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const dpr = window.devicePixelRatio || 1;
  const ligero = tactil || dpr >= 2;
  const motivo = tactil ? "pointer: coarse" : dpr >= 2 ? "devicePixelRatio ≥ 2" : "escritorio";
  const nav = navigator as NavegadorConMemoria;
  // Muy modesto: menos de 2 GB de memoria o un solo núcleo (lo que el navegador dice; si no lo dice, no se supone).
  if ((nav.deviceMemory ?? 8) < 2 || (nav.hardwareConcurrency ?? 8) < 2) {
    return { impedimento: "Este dispositivo es muy justo para la nevera en 3D: se abre la lista.", ligero, motivo };
  }
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const lienzo = document.createElement("canvas");
    gl = lienzo.getContext("webgl2") ?? lienzo.getContext("webgl");
  } catch {
    gl = null;
  }
  if (!gl) return { impedimento: "Este navegador no puede dibujar en 3D (sin WebGL): se abre la lista.", ligero, motivo };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { impedimento: null, ligero, motivo };
}

/** La sonda de la escena: el motor se registra aquí al crearse y `window.__nevera.rendimiento` lo lee. */
let actual: { rendimiento: unknown; [k: string]: unknown } | null = null;
export const registrarEscena = (e: typeof actual) => {
  actual = e;
};
export const escenaActual = () => actual;
