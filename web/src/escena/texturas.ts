// ORIGEN: /opt/data/pythagoras/web/src/escena/texturas.ts @ 1ac4185 (PYTHAGORAS 9), clase `AtlasLunas`, y
// /opt/data/pythagoras/web/src/escena/motor.ts, función `materialLunas`. Cambios marcados «NEVERA-6»: la clave de una
// celda es la categoría del producto (no la skill) y la celda no lleva terreno procedural sino la sigla de la
// categoría; los colores son tokens de la piel. Lo que costó caro y se conserva tal cual: una textura de 1024² en
// 8×8 celdas generada en runtime (nada en disco), margen de 4 texels contra los mipmaps, asignación por semilla con
// sondeo lineal, y el material estándar con `aCelda` por instancia que encoge el UV de la esfera a su celda: todas
// las cosas de la nevera van en un InstancedMesh con un solo material y una sola textura (una llamada de dibujo).
import * as THREE from "three";
import { hashTexto } from "./azar";
import { piel } from "./piel";

/**
 * Atlas de las categorías: cada celda, la sigla de una categoría pintada en gris sobre claro. La tiñe el color de la
 * instancia (su urgencia) en el shader: así cada cosa lleva su categoría escrita y su color, y el InstancedMesh de
 * todas usa un solo material y una sola textura. Con más de 64 categorías, las que no tienen celda libre comparten la
 * de su semilla.
 */
export class AtlasCategorias {
  static readonly LADO = 1024;
  static readonly CELDAS = 8;
  static readonly CELDA = AtlasCategorias.LADO / AtlasCategorias.CELDAS;
  /** Margen en texels dentro de cada celda que no se muestrea: los mipmaps no mezclan celdas vecinas. */
  static readonly MARGEN = 4;
  readonly textura: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  /** Celda de cada clave y qué clave ocupa cada celda. */
  private readonly celdaDe = new Map<string, number>();
  private readonly ocupante: (string | null)[] = Array(AtlasCategorias.CELDAS ** 2).fill(null);
  private readonly pintada: (string | null)[] = Array(AtlasCategorias.CELDAS ** 2).fill(null);

  constructor() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = AtlasCategorias.LADO;
    this.ctx = lienzo.getContext("2d")!;
    this.textura = new THREE.CanvasTexture(lienzo);
    this.textura.colorSpace = THREE.SRGBColorSpace;
    this.textura.anisotropy = 4;
  }

  /** Lado útil de una celda en UV (de 0 a 1 en la esfera → este tramo de la celda). */
  static get escalaUv() {
    return (AtlasCategorias.CELDA - 2 * AtlasCategorias.MARGEN) / AtlasCategorias.LADO;
  }

  /**
   * Deja en el atlas exactamente las claves dadas: suelta las celdas de las que ya no están, asigna celda a las nuevas
   * (la de su semilla o la siguiente libre) y pinta solo lo que cambió. NEVERA-6: `sigla` dice qué escribir.
   */
  sincronizar(claves: readonly string[], sigla: (clave: string) => string) {
    const vigentes = new Set(claves);
    for (const [clave, i] of this.celdaDe) {
      if (vigentes.has(clave)) continue;
      this.celdaDe.delete(clave);
      if (this.ocupante[i] === clave) this.ocupante[i] = null;
    }
    const n = this.ocupante.length;
    let cambios = false;
    for (const clave of claves) {
      if (this.celdaDe.has(clave)) continue;
      const semilla = hashTexto(clave);
      let i = semilla % n;
      for (let k = 0; k < n && this.ocupante[i] !== null; k++) i = (i + 1) % n;
      if (this.ocupante[i] !== null) i = semilla % n;
      else this.ocupante[i] = clave;
      this.celdaDe.set(clave, i);
      const texto = sigla(clave);
      if (this.pintada[i] !== texto && this.ocupante[i] === clave) {
        this.pintarCelda(i, texto);
        cambios = true;
      }
    }
    if (cambios) this.textura.needsUpdate = true;
  }

  /** Origen UV de la celda de una clave (esquina inferior izquierda de su parte útil). */
  origen(clave: string, out: { u: number; v: number }) {
    const i = this.celdaDe.get(clave) ?? 0;
    const C = AtlasCategorias.CELDAS;
    const col = i % C;
    const fila = Math.floor(i / C);
    // flipY del lienzo: la fila 0 del lienzo es v = 1.
    out.u = (col * AtlasCategorias.CELDA + AtlasCategorias.MARGEN) / AtlasCategorias.LADO;
    out.v = 1 - ((fila + 1) * AtlasCategorias.CELDA - AtlasCategorias.MARGEN) / AtlasCategorias.LADO;
    return out;
  }

  /** Celdas ocupadas (para la sonda). */
  get ocupadas() {
    return this.ocupante.filter((x) => x !== null).length;
  }

  /**
   * NEVERA-6: fondo en --ink con una banda en --line-strong por el ecuador y la sigla en --void-900, dos veces (en
   * u = 0,25 mira al frente, +z, y en u = 0,75 a la espalda): la esfera se lee de frente y desde detrás. La celda
   * cubre 360° × 180°, así que el texto se comprime a la mitad en horizontal para no salir ensanchado.
   */
  private pintarCelda(i: number, texto: string) {
    const C = AtlasCategorias.CELDAS;
    const T = AtlasCategorias.CELDA;
    const x0 = (i % C) * T;
    const y0 = Math.floor(i / C) * T;
    const p = piel();
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, T, T);
    ctx.clip();
    ctx.fillStyle = p.ink;
    ctx.fillRect(x0, y0, T, T);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = p.bordeFuerte;
    ctx.fillRect(x0, y0 + T * 0.72, T, T * 0.08);
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.void;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tam = texto.length > 2 ? T * 0.3 : T * 0.36;
    ctx.font = `600 ${tam}px "Space Grotesk", Inter, system-ui, sans-serif`;
    for (const u of [0.25, 0.75]) {
      ctx.save();
      ctx.translate(x0 + T * u, y0 + T * 0.5);
      ctx.scale(0.5, 1);
      ctx.fillText(texto, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    this.pintada[i] = texto;
  }

  destruir() {
    this.textura.dispose();
  }
}

/**
 * Material de las cosas instanciadas (de `materialLunas` de PYTHAGORAS, sin cambios salvo el nombre y la escala del
 * atlas): el estándar iluminado con la textura del atlas. Cada instancia lleva en `aCelda` el origen de su celda; el
 * UV de la esfera (0–1) se encoge a la celda, y el color de la instancia tiñe también la luz propia.
 */
export function materialAtlas(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: atlas,
    roughness: 0.95,
    metalness: 0,
    emissive: new THREE.Color(1, 1, 1),
    emissiveMap: atlas,
    emissiveIntensity: 0.45,
  });
  const escala = AtlasCategorias.escalaUv.toFixed(6);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aCelda;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = aCelda + vMapUv * ${escala};
#endif
#ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = aCelda + vEmissiveMapUv * ${escala};
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  totalEmissiveRadiance *= vColor.rgb;
#endif`,
    );
  };
  m.customProgramCacheKey = () => "nevera-atlas";
  return m;
}
