// PEDIDO-NEVERA-7: las cosas dejan de ser puntos de luz y tienen forma. Cinco geometrías de pocos polígonos (botella,
// caja, bolsa, lata y esfera), una InstancedMesh por forma con el mismo material del atlas (materialAtlas, el de las
// lunas de PYTHAGORAS: color por instancia y la sigla de la categoría en `aCelda`), así que las 81 cosas cuestan 5
// llamadas de dibujo, y no una por cosa. Encima, tres capas instanciadas más, una llamada cada una:
//   - el **aro** de urgencia: un contorno fino (px constantes, con fwidth) que mira a la cámara alrededor de la cosa;
//   - la **sombra de contacto**: un disco oscuro difuminado en la balda, bajo cada cosa, para que se vea apoyada;
//   - el **pulso** de lo que vence en ≤ 2 días: el halo de PYTHAGORAS (shaders.ts, sin cambios), suave y lento.
// Las geometrías van normalizadas a una caja de 1 × 1 × 1 con la base en y = 0; la matriz de cada instancia lleva las
// medidas reales (familias.json). Ninguna se mueve cuadro a cuadro: se suben al cambiar la lista.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FORMAS, type Forma } from "./familias";
import { FRAG_HALO_INSTANCIADO, VERT_HALO_INSTANCIADO } from "./shaders";

/** Lados de los cuerpos de revolución: normal y en modo ligero. */
export const LADOS = { normal: 12, ligero: 7 } as const;

/**
 * El UV vertical de un cuerpo de revolución o de la caja, por altura: la sigla del atlas (centrada en v = 0,5, unos
 * ±0,15 de alto) cae en la zona de la etiqueta de cada forma (`yc`) y no en el cuello ni en la tapa. Se recorta a
 * [0,02, 0,98] para no muestrear la celda vecina.
 */
function uvPorAltura(geo: THREE.BufferGeometry, yc: number, k: number) {
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setY(i, Math.min(0.98, Math.max(0.02, 0.5 + (pos.getY(i) - yc) * k)));
  uv.needsUpdate = true;
}

/** Cuerpo de revolución con su perfil (radio, altura). El atlas pinta la sigla en u = 0,25 y 0,75: se gira para que la primera mire al frente (+z). */
function revolucion(perfil: [number, number][], lados: number, yc: number, k: number, deformar?: (v: THREE.Vector3, fi: number) => void) {
  const geo = new THREE.LatheGeometry(perfil.map(([r, y]) => new THREE.Vector2(r, y)), lados);
  if (deformar) {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      deformar(v, Math.atan2(v.x, v.z));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  uvPorAltura(geo, yc, k);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Botella: cuerpo, hombro, cuello y tapón algo más ancho que el cuello. */
const PERFIL_BOTELLA: [number, number][] = [
  [0, 0], [0.42, 0], [0.5, 0.035], [0.5, 0.56], [0.46, 0.64], [0.3, 0.73], [0.19, 0.79], [0.19, 0.87], [0.25, 0.875], [0.25, 0.99], [0.2, 1], [0, 1],
];
/** Lata: cilindro con el canto marcado arriba y abajo. */
const PERFIL_LATA: [number, number][] = [[0, 0], [0.44, 0], [0.5, 0.04], [0.5, 0.93], [0.45, 0.965], [0.47, 1], [0, 0.99]];
/** Bolsa: base redondeada, panza, boca fruncida (estrecha) y el borde que se abre encima. */
const PERFIL_BOLSA: [number, number][] = [
  [0, 0], [0.26, 0.008], [0.4, 0.05], [0.48, 0.15], [0.5, 0.3], [0.49, 0.48], [0.44, 0.64], [0.31, 0.76], [0.17, 0.83], [0.15, 0.87], [0.25, 0.94], [0.3, 1], [0, 0.985],
];

/** Las cinco geometrías, normalizadas a 1 × 1 × 1 con la base en y = 0 y el centro en x = z = 0. */
export function geometrias(ligero: boolean): Record<Forma, THREE.BufferGeometry> {
  const lados = ligero ? LADOS.ligero : LADOS.normal;
  // La caja: aristas suaves (un chaflán redondeado); en modo ligero, un prisma de 12 triángulos.
  const caja = ligero ? new THREE.BoxGeometry(1, 1, 1) : new RoundedBoxGeometry(1, 1, 1, 1, 0.09);
  caja.translate(0, 0.5, 0);
  // UV de la caja: la cara de delante lleva media celda (la sigla de u = 0,25) y la de atrás la otra media; los
  // lados, techo y suelo, el fondo liso de la celda.
  {
    const pos = caja.getAttribute("position");
    const nor = caja.getAttribute("normal");
    const uv = caja.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      const x = pos.getX(i);
      let u = 0.5;
      if (Math.abs(nz) >= Math.abs(nx) && Math.abs(nz) >= Math.abs(ny)) u = nz > 0 ? (x + 0.5) * 0.5 : 0.5 + (0.5 - x) * 0.5;
      uv.setXY(i, Math.min(0.98, Math.max(0.02, u)), Math.min(0.98, Math.max(0.02, 0.5 + (pos.getY(i) - 0.5) * 1.1)));
    }
    uv.needsUpdate = true;
  }
  const esfera = new THREE.SphereGeometry(0.5, lados, ligero ? 5 : 8);
  esfera.translate(0, 0.5, 0);
  return {
    botella: revolucion(PERFIL_BOTELLA, lados, 0.3, 1.25),
    caja,
    bolsa: revolucion(PERFIL_BOLSA, lados, 0.4, 1.05, (v, fi) => {
      // El frunce: la boca ondula en siete pliegues que crecen hacia el borde.
      const s = THREE.MathUtils.smoothstep(v.y, 0.8, 0.97);
      const f = 1 + 0.2 * s * Math.sin(fi * 7);
      v.x *= f;
      v.z *= f;
    }),
    lata: revolucion(PERFIL_LATA, lados, 0.5, 1.0),
    esfera,
  };
}

/** Triángulos de una geometría (para la sonda). */
export const triangulos = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

/** Cuerpos instanciados por forma: cinco InstancedMesh con el mismo material y el atributo `aCelda` del atlas. */
export class CuerposConForma {
  readonly mallas: Record<Forma, THREE.InstancedMesh>;
  private readonly celdas: Record<Forma, THREE.InstancedBufferAttribute>;
  private readonly n: Record<Forma, number>;
  private geos: Record<Forma, THREE.BufferGeometry>;

  constructor(material: THREE.Material, readonly capacidad: number, ligero: boolean) {
    this.geos = geometrias(ligero);
    this.mallas = {} as Record<Forma, THREE.InstancedMesh>;
    this.celdas = {} as Record<Forma, THREE.InstancedBufferAttribute>;
    this.n = {} as Record<Forma, number>;
    for (const f of FORMAS) {
      const m = new THREE.InstancedMesh(this.geos[f], material, capacidad);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.name = `cuerpos-${f}`;
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacidad * 2), 2);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geos[f].setAttribute("aCelda", a);
      this.mallas[f] = m;
      this.celdas[f] = a;
      this.n[f] = 0;
    }
  }

  /** Modo ligero: otras geometrías (menos lados), los mismos atributos por instancia. */
  setLigero(ligero: boolean) {
    const nuevas = geometrias(ligero);
    for (const f of FORMAS) {
      nuevas[f].setAttribute("aCelda", this.celdas[f]);
      this.mallas[f].geometry = nuevas[f];
      this.geos[f].dispose();
    }
    this.geos = nuevas;
  }

  /** Triángulos de una pieza de cada forma, con la geometría de ahora. */
  triangulosPorForma(): Record<Forma, number> {
    return Object.fromEntries(FORMAS.map((f) => [f, triangulos(this.geos[f])])) as Record<Forma, number>;
  }

  empezar() {
    for (const f of FORMAS) this.n[f] = 0;
  }

  poner(f: Forma, m: THREE.Matrix4, color: THREE.Color, u: number, v: number) {
    const j = this.n[f];
    if (j >= this.capacidad) return;
    this.mallas[f].setMatrixAt(j, m);
    this.mallas[f].setColorAt(j, color);
    this.celdas[f].setXY(j, u, v);
    this.n[f] = j + 1;
  }

  terminar() {
    for (const f of FORMAS) {
      const m = this.mallas[f];
      m.count = this.n[f];
      m.visible = this.n[f] > 0;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
      this.celdas[f].needsUpdate = true;
    }
  }

  /** Piezas puestas de cada forma. */
  conteo(): Record<Forma, number> {
    return { ...this.n };
  }

  destruir() {
    for (const f of FORMAS) {
      this.geos[f].dispose();
      this.mallas[f].dispose();
    }
  }
}

/* ---------- Aro de urgencia ---------- */

const VERT_ARO = /* glsl */ `
attribute vec2 aAro;
varying vec2 vP;
varying vec3 vColor;
varying vec2 vAro;
void main() {
  vec4 centro = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 lado = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  centro.xy += position.xy * lado * 0.5;
  vP = position.xy;
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  vAro = aAro;
  gl_Position = projectionMatrix * centro;
}`;

/**
 * Un contorno redondeado (rectángulo de esquinas redondas) de grosor constante en píxeles: el ancho de la línea se mide con fwidth, así
 * que de lejos y de cerca es el mismo trazo fino. `aAro.x` es su opacidad (lo que vence fuerte, lo que no, tenue) y
 * `aAro.y` si late: entonces la opacidad sube y baja despacio (≈ 2,4 s), sin cambiar de tamaño.
 */
const FRAG_ARO = /* glsl */ `
uniform float uTiempo;
uniform float uGrosorPx;
uniform float uLatido;
varying vec2 vP;
varying vec3 vColor;
varying vec2 vAro;
void main() {
  // Distancia con signo a un rectángulo redondeado (semilado 0,9, radio 0,35): sin pow, que en SwiftShader y en
  // GPUs modestas se pagaba en cada píxel del cuadrado.
  vec2 q = abs(vP) - vec2(0.55);
  float r = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.35;
  float w = fwidth(r);
  float d = abs(r) - uGrosorPx * w * 0.5;
  float a = 1.0 - smoothstep(0.0, w * 1.1, d);
  float latido = 0.5 + 0.5 * sin(uTiempo * 2.6);
  float alfa = vAro.x * mix(1.0, 0.4 + 0.6 * latido, vAro.y * uLatido);
  if (a * alfa < 0.01) discard;
  gl_FragColor = vec4(vColor, a * alfa);
  #include <colorspace_fragment>
}`;

/* ---------- Sombra de contacto ---------- */

const VERT_SOMBRA = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position.x, 0.0, position.y, 1.0);
}`;

const FRAG_SOMBRA = /* glsl */ `
uniform vec3 uColor;
uniform float uFuerza;
varying vec2 vP;
void main() {
  float r = length(vP);
  float a = (1.0 - smoothstep(0.25, 1.0, r)) * uFuerza;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

/**
 * El aro se dibuja sobre un marco cuadrado de ±1 con el centro hueco (±hueco), no sobre el cuadrado entero: la línea
 * va en el borde (0,9 en los lados; en las esquinas redondeadas, hasta ≈ 0,8 hacia dentro) y el interior solo
 * gastaba píxeles transparentes. Con 0,7 se ahorra la mitad del área (el aro era lo que más costaba en el móvil).
 */
const HUECO_ARO = 0.7;
function marco(h: number) {
  const g = new THREE.BufferGeometry();
  // 0-3: esquinas de fuera; 4-7: las de dentro (mismo orden: abajo-izq, abajo-der, arriba-der, arriba-izq).
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0], 3));
  g.setIndex([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return g;
}

export interface OpcionesSenales {
  /** Color de la sombra (el --void-900 de la piel). */
  sombra: THREE.Color;
  /** Unidades de mundo por px a distancia 1, compartido con el motor (para el halo). */
  mundoPorPx: { value: number };
}

/** Aros, sombras y pulso: tres InstancedMesh, una llamada cada una (y ninguna si no hay nada que poner). */
export class Senales {
  readonly aros: THREE.InstancedMesh;
  readonly sombras: THREE.InstancedMesh;
  readonly pulso: THREE.InstancedMesh;
  private readonly aAro: THREE.InstancedBufferAttribute;
  private readonly matAro: THREE.ShaderMaterial;
  private readonly matSombra: THREE.ShaderMaterial;
  private readonly matPulso: THREE.ShaderMaterial;
  private nAro = 0;
  private nSombra = 0;
  private nPulso = 0;

  constructor(readonly capacidad: number, o: OpcionesSenales) {
    const plano = new THREE.PlaneGeometry(2, 2);
    this.matAro = new THREE.ShaderMaterial({
      vertexShader: VERT_ARO,
      fragmentShader: FRAG_ARO,
      uniforms: { uTiempo: { value: 0 }, uGrosorPx: { value: 1.4 }, uLatido: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });
    const geoAro = marco(HUECO_ARO);
    this.aAro = new THREE.InstancedBufferAttribute(new Float32Array(capacidad * 2), 2);
    this.aAro.setUsage(THREE.DynamicDrawUsage);
    geoAro.setAttribute("aAro", this.aAro);
    this.aros = this.instanciada(geoAro, this.matAro, true, 3, "aros");

    this.matSombra = new THREE.ShaderMaterial({
      vertexShader: VERT_SOMBRA,
      fragmentShader: FRAG_SOMBRA,
      uniforms: { uColor: { value: o.sombra }, uFuerza: { value: 0.62 } },
      transparent: true,
      depthWrite: false,
    });
    this.sombras = this.instanciada(plano.clone(), this.matSombra, false, 2, "sombras");

    // El halo de PYTHAGORAS tal cual (shaders.ts), solo para lo que vence en ≤ 2 días; su intensidad late.
    this.matPulso = new THREE.ShaderMaterial({
      vertexShader: VERT_HALO_INSTANCIADO,
      fragmentShader: FRAG_HALO_INSTANCIADO,
      uniforms: { uTam: { value: 1.6 }, uIntensidad: { value: 0.3 }, uMundoPorPx: o.mundoPorPx, uMinPx: { value: 10 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pulso = this.instanciada(plano, this.matPulso, true, 4, "pulso");
  }

  private instanciada(geo: THREE.BufferGeometry, mat: THREE.Material, conColor: boolean, orden: number, nombre: string) {
    const m = new THREE.InstancedMesh(geo, mat, this.capacidad);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (conColor) {
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    }
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = orden;
    m.name = nombre;
    return m;
  }

  empezar() {
    this.nAro = this.nSombra = this.nPulso = 0;
  }

  /** Aro centrado en `centro`, de `ancho` × `alto` (m, en pantalla), con su opacidad y si late. */
  aro(centro: THREE.Vector3, ancho: number, alto: number, color: THREE.Color, opacidad: number, late: boolean) {
    const j = this.nAro;
    if (j >= this.capacidad) return;
    M.makeScale(ancho, alto, 1).setPosition(centro);
    this.aros.setMatrixAt(j, M);
    this.aros.setColorAt(j, color);
    this.aAro.setXY(j, opacidad, late ? 1 : 0);
    this.nAro++;
  }

  /** Sombra de contacto: un disco en el plano de la balda (la matriz ya trae posición, giro y escala x/z). */
  sombra(m: THREE.Matrix4) {
    if (this.nSombra >= this.capacidad) return;
    this.sombras.setMatrixAt(this.nSombra++, m);
  }

  /** Halo que late, para lo que vence en ≤ 2 días. */
  latir(centro: THREE.Vector3, tam: number, color: THREE.Color) {
    const j = this.nPulso;
    if (j >= this.capacidad) return;
    M.makeScale(tam, tam, tam).setPosition(centro);
    this.pulso.setMatrixAt(j, M);
    this.pulso.setColorAt(j, color);
    this.nPulso++;
  }

  terminar() {
    for (const [m, n] of [[this.aros, this.nAro], [this.sombras, this.nSombra], [this.pulso, this.nPulso]] as const) {
      m.count = n;
      m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.aAro.needsUpdate = true;
  }

  /** Cada cuadro: el reloj del latido (con movimiento reducido no late: se queda firme). */
  avanzar(t: number, reducido: boolean) {
    this.matAro.uniforms.uTiempo.value = t;
    this.matAro.uniforms.uLatido.value = reducido ? 0 : 1;
    this.matPulso.uniforms.uIntensidad.value = reducido ? 0.24 : 0.14 + 0.16 * (0.5 + 0.5 * Math.sin(t * 2.6));
  }

  get cuantos() {
    return { aros: this.nAro, sombras: this.nSombra, pulsan: this.nPulso };
  }

  destruir() {
    for (const m of [this.aros, this.sombras, this.pulso]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}

const M = new THREE.Matrix4();
