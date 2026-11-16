// El mueble (D2 esquemática): una nevera —cuerpo, puerta abierta con tres estantes, tres baldas de vidrio y un cajón
// de verduras entreabierto— y una despensa aparte, una caja abierta por delante con dos baldas. Geometría simple, sin
// modelos ni descargas: cajas. Todo lo opaco va fusionado en una malla, el vidrio en otra y las aristas en un solo
// LineSegments: tres llamadas de dibujo para el mueble entero, con cualquier número de compartimentos.
// Unidades: metros. y arriba, +z hacia quien mira.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ClaveCompartimento, Superficie } from "./colocar";

export interface Compartimento {
  clave: ClaveCompartimento;
  nombre: string;
  /** Superficies en orden de llenado (la de arriba primero) con su matriz: del marco local de la superficie al mundo. */
  superficies: { sup: Superficie; matriz: THREE.Matrix4 }[];
  /** Caja que lo envuelve (tocar dentro encuadra el compartimento) y punto del que cuelga su rótulo. */
  caja: THREE.Box3;
  ancla: THREE.Vector3;
  /** Radio máximo de una cosa aquí. */
  radioMax: number;
  /** El hueco de cada superficie (de ella a la de arriba), en su orden: tocar dentro encuadra solo ese nivel. */
  zonas: THREE.Box3[];
}

export interface Mueble {
  opaco: THREE.Mesh;
  vidrio: THREE.Mesh;
  aristas: THREE.LineSegments;
  compartimentos: Compartimento[];
  /** Caja de toda la escena (para el encuadre inicial). */
  caja: THREE.Box3;
}

/** Medidas de la nevera y de la despensa. */
export const NEVERA = { ancho: 0.7, alto: 1.78, fondo: 0.66, pared: 0.035, x: -0.5, apertura: 118 };
export const DESPENSA = { ancho: 0.78, alto: 1.3, fondo: 0.42, pared: 0.03, x: 0.62 };
const BALDAS_Y = [1.16, 0.74, 0.34]; // de arriba abajo; la de abajo es la tapa del cajón
const CAJON = { alto: 0.22, salida: 0.16 };
const PUERTA = { grosor: 0.05, estantes: [1.3, 0.86, 0.42], fondoEstante: 0.1 };
const EXTRA = { ancho: 0.5, alto: 0.14, fondo: 0.4, separacion: 0.14 };

class Constructor {
  readonly opacas: THREE.BufferGeometry[] = [];
  readonly vidrios: THREE.BufferGeometry[] = [];
  readonly aristas: THREE.BufferGeometry[] = [];

  /** Una caja de tamaño (x, y, z) con su esquina inferior trasera izquierda en `desde`, transformada por `m`. */
  caja(dx: number, dy: number, dz: number, desde: THREE.Vector3, m: THREE.Matrix4 | null, vidrio = false, conAristas = true) {
    const g = new THREE.BoxGeometry(dx, dy, dz);
    g.translate(desde.x + dx / 2, desde.y + dy / 2, desde.z + dz / 2);
    if (m) g.applyMatrix4(m);
    (vidrio ? this.vidrios : this.opacas).push(g.toNonIndexed());
    if (conAristas) this.aristas.push(new THREE.EdgesGeometry(g, 30));
    g.dispose();
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Matriz de una superficie: centrada en (x, y, z), girada `giroY` y, si va en la puerta, por la matriz de la puerta. */
function matrizSuperficie(x: number, y: number, z: number, giroY = 0, padre: THREE.Matrix4 | null = null) {
  const m = new THREE.Matrix4().makeRotationY(giroY).setPosition(x, y, z);
  return padre ? padre.clone().multiply(m) : m;
}

/** Construye el mueble con un hueco para cada raíz extra que tenga cosas (congelador, frutero…), a la derecha. */
export function construirMueble(extras: { id: number; nombre: string }[]): Mueble {
  const b = new Constructor();
  const compartimentos: Compartimento[] = [];
  const N = NEVERA;
  const x0 = N.x - N.ancho / 2;
  const z0 = -N.fondo / 2;
  const t = N.pared;

  // Cuerpo: fondo, laterales, techo y suelo. Abierto por delante.
  b.caja(N.ancho, N.alto, t, V(x0, 0, z0), null);
  b.caja(t, N.alto, N.fondo, V(x0, 0, z0), null);
  b.caja(t, N.alto, N.fondo, V(x0 + N.ancho - t, 0, z0), null);
  b.caja(N.ancho, t, N.fondo, V(x0, N.alto - t, z0), null);
  b.caja(N.ancho, t, N.fondo, V(x0, 0, z0), null);

  // Baldas de vidrio.
  const anchoDentro = N.ancho - 2 * t;
  const fondoDentro = N.fondo - t;
  for (const y of BALDAS_Y) b.caja(anchoDentro, 0.008, fondoDentro - 0.03, V(x0 + t, y, z0 + t), null, true);
  const supBalda: Superficie = { ancho: anchoDentro - 0.04, fondo: fondoDentro - 0.07 };
  const zBalda = z0 + t + 0.02 + supBalda.fondo / 2;
  compartimentos.push({
    clave: "nevera",
    nombre: "nevera",
    superficies: BALDAS_Y.map((y) => ({ sup: supBalda, matriz: matrizSuperficie(N.x, y + 0.008, zBalda) })),
    caja: new THREE.Box3(V(x0, BALDAS_Y[2], z0), V(x0 + N.ancho, N.alto, N.fondo / 2)),
    ancla: V(N.x, N.alto + 0.2, 0),
    radioMax: 0.045,
    zonas: BALDAS_Y.map((y, i) => new THREE.Box3(V(x0, y, z0), V(x0 + N.ancho, i === 0 ? N.alto : BALDAS_Y[i - 1], N.fondo / 2))),
  });

  // Cajón de verduras, entreabierto: suelo, laterales y fondo opacos; el frente, de vidrio para ver lo que lleva.
  const anchoCajon = anchoDentro - 0.03;
  const fondoCajon = fondoDentro - 0.1;
  const xc = x0 + t + 0.015;
  const zc = N.fondo / 2 - fondoCajon + CAJON.salida;
  const yc = t + 0.02;
  b.caja(anchoCajon, 0.012, fondoCajon, V(xc, yc, zc), null);
  b.caja(0.012, CAJON.alto, fondoCajon, V(xc, yc, zc), null);
  b.caja(0.012, CAJON.alto, fondoCajon, V(xc + anchoCajon - 0.012, yc, zc), null);
  b.caja(anchoCajon, CAJON.alto, 0.012, V(xc, yc, zc), null);
  b.caja(anchoCajon, CAJON.alto, 0.014, V(xc, yc, zc + fondoCajon - 0.014), null, true);
  const supCajon: Superficie = { ancho: anchoCajon - 0.05, fondo: fondoCajon - 0.06 };
  compartimentos.push({
    clave: "cajon",
    nombre: "cajón de verduras",
    superficies: [{ sup: supCajon, matriz: matrizSuperficie(N.x, yc + 0.012, zc + fondoCajon / 2) }],
    caja: new THREE.Box3(V(xc, 0, zc), V(xc + anchoCajon, BALDAS_Y[2], zc + fondoCajon)),
    ancla: V(N.x, -0.02, zc + fondoCajon),
    radioMax: 0.05,
    zonas: [],
  });

  // Puerta: bisagra en la arista delantera izquierda, abierta `apertura` grados hacia fuera. Su cara interior mira a
  // la derecha y al frente, y lleva tres estantes.
  const mPuerta = new THREE.Matrix4().makeRotationY((-N.apertura * Math.PI) / 180).setPosition(x0, 0, N.fondo / 2);
  b.caja(N.ancho, N.alto, PUERTA.grosor, V(0, 0, 0), mPuerta);
  const supEstante: Superficie = { ancho: N.ancho - 0.14, fondo: PUERTA.fondoEstante - 0.02 };
  for (const y of PUERTA.estantes) {
    b.caja(N.ancho - 0.1, 0.01, PUERTA.fondoEstante, V(0.05, y, -PUERTA.fondoEstante), mPuerta);
    b.caja(N.ancho - 0.1, 0.07, 0.008, V(0.05, y, -PUERTA.fondoEstante), mPuerta, true);
  }
  const cajaPuerta = new THREE.Box3();
  for (const p of [V(0, 0, 0), V(N.ancho, 0, 0), V(0, N.alto, -0.12), V(N.ancho, N.alto, -0.12), V(N.ancho, 0, -0.12), V(0, N.alto, 0)]) {
    cajaPuerta.expandByPoint(p.applyMatrix4(mPuerta));
  }
  compartimentos.push({
    clave: "puerta",
    nombre: "puerta de la nevera",
    // El marco de la superficie gira 180°: su frente (+z) es el borde del estante, lejos de la puerta.
    superficies: PUERTA.estantes.map((y) => ({ sup: supEstante, matriz: matrizSuperficie(N.ancho / 2, y + 0.01, -PUERTA.fondoEstante / 2, Math.PI, mPuerta) })),
    caja: cajaPuerta,
    ancla: V(N.ancho * 0.3, N.alto + 0.2, -0.05).applyMatrix4(mPuerta),
    radioMax: 0.04,
    zonas: [],
  });

  // Despensa: caja abierta por delante con dos baldas (tres niveles: arriba, en medio y el suelo).
  const D = DESPENSA;
  const dx0 = D.x - D.ancho / 2;
  const dz0 = -D.fondo / 2;
  const dt = D.pared;
  b.caja(D.ancho, D.alto, dt, V(dx0, 0, dz0), null);
  b.caja(dt, D.alto, D.fondo, V(dx0, 0, dz0), null);
  b.caja(dt, D.alto, D.fondo, V(dx0 + D.ancho - dt, 0, dz0), null);
  b.caja(D.ancho, dt, D.fondo, V(dx0, D.alto - dt, dz0), null);
  b.caja(D.ancho, dt, D.fondo, V(dx0, 0, dz0), null);
  const nivelesDespensa = [0.88, 0.45];
  for (const y of nivelesDespensa) b.caja(D.ancho - 2 * dt, 0.02, D.fondo - dt, V(dx0 + dt, y, dz0 + dt), null);
  const supDespensa: Superficie = { ancho: D.ancho - 2 * dt - 0.04, fondo: D.fondo - dt - 0.04 };
  const zDespensa = dz0 + dt + 0.02 + supDespensa.fondo / 2;
  compartimentos.push({
    clave: "despensa",
    nombre: "despensa",
    superficies: [...nivelesDespensa.map((y) => y + 0.02), dt].map((y) => ({ sup: supDespensa, matriz: matrizSuperficie(D.x, y, zDespensa) })),
    caja: new THREE.Box3(V(dx0, 0, dz0), V(dx0 + D.ancho, D.alto, D.fondo / 2)),
    ancla: V(D.x, D.alto + 0.2, 0),
    radioMax: 0.045,
    zonas: [D.alto - dt, ...nivelesDespensa].map((techo, i, l) =>
      new THREE.Box3(V(dx0, i + 1 < l.length ? l[i + 1] : 0, dz0), V(dx0 + D.ancho, techo, D.fondo / 2))),
  });

  // Raíces extra con cosas: una bandeja abierta cada una, a la derecha de la despensa, en el suelo.
  extras.forEach((ex, i) => {
    const E = EXTRA;
    const ex0 = D.x + D.ancho / 2 + E.separacion + i * (E.ancho + E.separacion);
    const ez0 = -E.fondo / 2;
    b.caja(E.ancho, 0.015, E.fondo, V(ex0, 0, ez0), null);
    b.caja(E.ancho, E.alto, 0.012, V(ex0, 0, ez0), null);
    b.caja(0.012, E.alto, E.fondo, V(ex0, 0, ez0), null);
    b.caja(0.012, E.alto, E.fondo, V(ex0 + E.ancho - 0.012, 0, ez0), null);
    b.caja(E.ancho, E.alto, 0.012, V(ex0, 0, ez0 + E.fondo - 0.012), null, true);
    compartimentos.push({
      clave: `extra:${ex.id}`,
      nombre: ex.nombre,
      superficies: [{ sup: { ancho: E.ancho - 0.06, fondo: E.fondo - 0.06 }, matriz: matrizSuperficie(ex0 + E.ancho / 2, 0.015, 0) }],
      caja: new THREE.Box3(V(ex0, 0, ez0), V(ex0 + E.ancho, 0.4, ez0 + E.fondo)),
      ancla: V(ex0 + E.ancho / 2, 0.55, 0),
      radioMax: 0.045,
      zonas: [],
    });
  });

  const opaco = new THREE.Mesh(mergeGeometries(b.opacas)!);
  const vidrio = new THREE.Mesh(mergeGeometries(b.vidrios)!);
  const aristas = new THREE.LineSegments(mergeGeometries(b.aristas)!);
  for (const g of [...b.opacas, ...b.vidrios, ...b.aristas]) g.dispose();

  const caja = new THREE.Box3().setFromBufferAttribute(opaco.geometry.getAttribute("position") as THREE.BufferAttribute);
  for (const c of compartimentos) caja.union(c.caja);
  return { opaco, vidrio, aristas, compartimentos, caja };
}
