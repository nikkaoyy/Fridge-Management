// ORIGEN: /opt/data/pythagoras/web/src/escena/etiquetas.ts @ 1ac4185 (PYTHAGORAS 9), con cambios marcados «NEVERA-6»:
// los estilos son los de la nevera (compartimento y elemento) en vez de los del sistema solar, los colores salen de
// los tokens (piel.ts) y no de data/sistema.ts, y aquí vive también el resolvedor de solapes, que en PYTHAGORAS
// estaba en motor.ts (`hueco`, `bajar`, `colocarEtiqueta` y las constantes de 14/72/2 px), copiado tal cual.
import * as THREE from "three";
import { piel } from "./piel";

// NEVERA-6: dos estilos. El rótulo de un compartimento («balda 1», «puerta») y la etiqueta de un elemento al pasar
// el ratón (nombre y días). Si se pisan, cede el compartimento: lo que el usuario está señalando manda.
// NEVERA-7: dos más. «nombre», la etiqueta fija (nombre corto y días) de lo más urgente de cada balda, que cede ante
// todo lo demás; y «monton», la pastilla con el número de un montón, que solo cede ante lo señalado.
export type EstiloEtiqueta = "compartimento" | "elemento" | "nombre" | "monton";

/** Jerarquía para resolver solapes: la de menor rango es la que se aparta. */
export const RANGO_ETIQUETA: Record<EstiloEtiqueta, number> = { nombre: 0, compartimento: 1, monton: 1.5, elemento: 2 };

/** Margen transparente alrededor del texto dentro del lienzo de la etiqueta, en px CSS. */
export const MARGEN_ETIQUETA_PX = 6;

const TAMANOS: Record<EstiloEtiqueta, { titulo: number; sub: number; espaciado: number; lineaMax?: number }> = {
  // NEVERA-6: los tamaños de «anillo» y «menor» de PYTHAGORAS; el nombre de un producto se parte como un curso.
  compartimento: { titulo: 10.5, sub: 9, espaciado: 0.08 },
  elemento: { titulo: 11.5, sub: 9.5, espaciado: 0.03, lineaMax: 22 },
  nombre: { titulo: 10.5, sub: 9, espaciado: 0.02, lineaMax: 20 },
  monton: { titulo: 11, sub: 9, espaciado: 0.02 },
};

/** Parte un texto en líneas de hasta `max` caracteres por los espacios (una palabra más larga va sola). */
export function partirLineas(texto: string, max: number | undefined): string[] {
  if (!max || texto.length <= max) return [texto];
  const lineas: string[] = [];
  let linea = "";
  for (const palabra of texto.split(/\s+/)) {
    if (linea && linea.length + 1 + palabra.length > max) {
      lineas.push(linea);
      linea = palabra;
    } else linea = linea ? `${linea} ${palabra}` : palabra;
  }
  if (linea) lineas.push(linea);
  return lineas;
}

/**
 * Etiqueta de texto como sprite: mira siempre a la cámara y mantiene tamaño fijo en pantalla
 * (sizeAttenuation desactivado). Se dibuja encima de todo y la escena la oculta cuando su cuerpo
 * queda detrás del núcleo.
 */
export class Etiqueta {
  readonly sprite: THREE.Sprite;
  private readonly lienzo = document.createElement("canvas");
  private readonly textura: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private _ancho = 1;
  private _alto = 1;
  /** Opacidad visible actual y la que persigue (0 detrás del núcleo, lejos de su nivel o tapada por otra). */
  opacidad = 0;
  objetivo = 1;
  /** Desplazamiento vertical en px CSS (positivo = hacia abajo) para no pisar otra etiqueta: actual y objetivo. */
  desplazamiento = 0;
  desplazamientoObjetivo = 0;

  constructor(
    private readonly titulo: string,
    private readonly sub: string | null,
    readonly estilo: EstiloEtiqueta,
    private readonly color: string,
  ) {
    this.textura = new THREE.CanvasTexture(this.lienzo);
    this.textura.colorSpace = THREE.SRGBColorSpace;
    this.textura.minFilter = THREE.LinearFilter;
    this.textura.generateMipmaps = false;
    this.material = new THREE.SpriteMaterial({
      map: this.textura,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
      opacity: 0,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.center.set(0.5, 1); // anclada por arriba: cuelga bajo el cuerpo
    this.sprite.renderOrder = 20;
    this.dibujar(1);
  }

  /** Redibuja el texto a la resolución del dispositivo (se llama de nuevo cuando cargan las fuentes). */
  dibujar(dpr: number) {
    const t = TAMANOS[this.estilo];
    const s = Math.min(4, Math.max(2, dpr * 2));
    const ctx = this.lienzo.getContext("2d")!;
    const fuenteTitulo = `500 ${t.titulo * s}px "Space Grotesk", Inter, system-ui, sans-serif`;
    const fuenteSub = `400 ${t.sub * s}px "JetBrains Mono", ui-monospace, monospace`;
    const espaciado = `${t.espaciado * t.titulo * s}px`;
    const lineas = partirLineas(this.titulo, t.lineaMax);
    ctx.font = fuenteTitulo;
    ctx.letterSpacing = espaciado;
    const wT = Math.max(...lineas.map((l) => ctx.measureText(l).width));
    ctx.font = fuenteSub;
    ctx.letterSpacing = "0px";
    const wS = this.sub ? ctx.measureText(this.sub).width : 0;
    const pad = MARGEN_ETIQUETA_PX * s;
    const altoLinea = t.titulo * 1.25 * s;
    const altoTitulo = altoLinea * lineas.length;
    const altoSub = this.sub ? t.sub * 1.3 * s : 0;
    const w = Math.ceil(Math.max(wT, wS) + pad * 2);
    const h = Math.ceil(altoTitulo + altoSub + pad * 2);
    this.lienzo.width = w;
    this.lienzo.height = h;
    this._ancho = w / s;
    this._alto = h / s;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const p = piel(); // NEVERA-6: la sombra es el --void-900 de la piel
    if (this.estilo === "monton") {
      // NEVERA-7: la pastilla del montón, en el panel elevado con el borde fuerte, para que el número se lea encima de
      // cualquier cosa.
      const m = 2 * s;
      ctx.fillStyle = p.elevado;
      ctx.strokeStyle = p.bordeFuerte;
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.roundRect(m, m, w - 2 * m, h - 2 * m, (h - 2 * m) / 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.shadowColor = p.void;
    ctx.shadowBlur = 5 * s;
    const pintar = (texto: string, fuente: string, color: string, y: number, esp: string) => {
      ctx.font = fuente;
      ctx.letterSpacing = esp;
      ctx.fillStyle = color;
      // Dos pasadas de sombra para que se lea sobre el halo del núcleo o sobre un planeta claro.
      ctx.fillText(texto, w / 2, y);
      ctx.fillText(texto, w / 2, y);
    };
    // NEVERA-6: el rótulo de un compartimento va en gris tenue y su recuento del color que se le pase (el del más
    // urgente que lleva); el elemento, en tinta, y sus días del color de su urgencia.
    const colorTitulo = this.estilo === "compartimento" ? p.muted : p.ink; // NEVERA-7: «nombre» y «monton», en tinta
    lineas.forEach((l, i) => pintar(l, fuenteTitulo, colorTitulo, pad + altoLinea * i, espaciado));
    if (this.sub) pintar(this.sub, fuenteSub, this.color, pad + altoTitulo, "0px");
    this.textura.needsUpdate = true;
  }

  /** Tamaño en pantalla, en px CSS, con el margen transparente incluido. */
  get anchoCss() {
    return this._ancho;
  }
  get altoCss() {
    return this._alto;
  }

  /** k = unidades de sprite por píxel CSS (depende del alto del lienzo y del fov). */
  escalar(k: number) {
    this.sprite.scale.set(this._ancho * k, this._alto * k, 1);
  }

  /** Persigue la opacidad y el desplazamiento objetivo; con movimiento reducido salta directo. */
  avanzar(dt: number, inmediato: boolean) {
    const paso = inmediato ? 1 : Math.min(1, dt * 7);
    this.opacidad += (this.objetivo - this.opacidad) * paso;
    if (Math.abs(this.objetivo - this.opacidad) < 0.01) this.opacidad = this.objetivo;
    const pasoD = inmediato ? 1 : Math.min(1, dt * 10);
    this.desplazamiento += (this.desplazamientoObjetivo - this.desplazamiento) * pasoD;
    if (Math.abs(this.desplazamientoObjetivo - this.desplazamiento) < 0.25) this.desplazamiento = this.desplazamientoObjetivo;
    this.material.opacity = this.opacidad;
    this.sprite.visible = this.opacidad > 0.01;
  }

  destruir() {
    this.textura.dispose();
    this.material.dispose();
  }
}

/* ---------- Resolvedor de solapes (NEVERA-6: copiado de motor.ts de PYTHAGORAS, sin cambios) ---------- */

/** Hueco mínimo entre los textos de dos etiquetas, en px CSS. */
export const SEPARACION_ETIQUETAS_PX = 14;
/** Hasta dónde se aparta una etiqueta, arriba o abajo, antes de rendirse y ocultarse; y el paso de búsqueda. */
const DESPLAZAMIENTO_MAX_PX = 72;
const PASO_DESPLAZAMIENTO_PX = 2;

export interface Caja {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Hueco entre dos cajas en px: positivo si están separadas (el mayor de los dos ejes), negativo si se pisan. */
export function hueco(a: Caja, b: Caja): number {
  const dx = Math.max(b.x0 - a.x1, a.x0 - b.x1);
  const dy = Math.max(b.y0 - a.y1, a.y0 - b.y1);
  return Math.max(dx, dy);
}

export const bajar = (c: Caja, d: number): Caja => ({ x0: c.x0, x1: c.x1, y0: c.y0 + d, y1: c.y1 + d });

/**
 * Desplazamiento vertical (px, positivo = abajo) que deja la caja a 14 px o más de todas las ya puestas: primero su
 * sitio natural, luego de 2 en 2 px alternando arriba y abajo (empezando por el lado al que ya estaba apartada, para
 * que no salte de un lado a otro). null si no cabe en 72 px.
 */
export function colocarEtiqueta(caja: Caja, puestas: readonly Caja[], previo: number): number | null {
  const libre = (d: number) => {
    const c = bajar(caja, d);
    return puestas.every((p) => hueco(c, p) >= SEPARACION_ETIQUETAS_PX);
  };
  if (libre(0)) return 0;
  const primero = previo < 0 ? -1 : 1;
  for (let m = PASO_DESPLAZAMIENTO_PX; m <= DESPLAZAMIENTO_MAX_PX; m += PASO_DESPLAZAMIENTO_PX) {
    if (libre(primero * m)) return primero * m;
    if (libre(-primero * m)) return -primero * m;
  }
  return null;
}
