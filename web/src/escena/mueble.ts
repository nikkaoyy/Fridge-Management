// El mueble (D2 esquemática): una nevera —cuerpo, puerta abierta con tres estantes, tres baldas de vidrio y un cajón
// de verduras entreabierto— y una despensa aparte, una caja abierta por delante con dos baldas. Geometría simple, sin
// modelos ni descargas: cajas. Todo lo opaco va fusionado en una malla, el vidrio en otra y las aristas en un solo
// LineSegments: tres llamadas de dibujo para el mueble entero, con cualquier número de compartimentos.
// NEVERA-9: lo opaco deja de ser un velo y es superficie (el material lo pone motor.ts). Las aristas llevan color por
// vértice (RGBA): las de lo opaco son el bisel claro que separa la silueta del fondo y las del vidrio, su canto, más
// marcado, para que una balda transparente se vea. Siguen siendo una sola llamada.
// Unidades: metros. y arriba, +z hacia quien mira.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ClaveCompartimento, Superficie } from "./colocar";

export interface Compartimento {
  clave: ClaveCompartimento;
  nombre: string;
  /** Superficies en orden de llenado (la de arriba primero) con su matriz: del marco local de la superficie al mundo. */
  superficies: { sup: Superficie; matriz: THREE.Matrix4 }[];
  /** Caja que lo envuelve (tocar dentro encuadra el compartimento) y punto del que cuelga su rótulo. NEVERA-9: el
   *  punto está en el borde inferior delantero de su cuerpo (el suelo del mueble), así el rótulo va en una franja
   *  debajo, nunca sobre la boca del mueble ni sobre lo que lleva. */
  caja: THREE.Box3;
  ancla: THREE.Vector3;
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
// NEVERA-7: las bandejas de las raíces extra (frutero, congelador…) crecen con lo que llevan: hasta 5 cosas, una
// bandeja estrecha; hasta 10, más ancha; con más, dos pisos (como un frutero de dos alturas).
const EXTRA = { fondo: 0.44, alto: 0.07, separacion: 0.14, piso: 0.32, techo: 0.66 };
export const medidaExtra = (n: number) => ({ ancho: n > 10 ? 0.82 : n > 5 ? 0.6 : 0.46, pisos: n > 10 ? 2 : 1 });

/** NEVERA-9: color (con alfa) de las aristas de lo opaco (bisel) y de las del vidrio (canto). Los pone motor.ts desde la piel. */
export interface TonosAristas {
  bisel: THREE.Color;
  alfaBisel: number;
  canto: THREE.Color;
  alfaCanto: number;
}

class Constructor {
  readonly opacas: THREE.BufferGeometry[] = [];
  readonly vidrios: THREE.BufferGeometry[] = [];
  readonly aristas: THREE.BufferGeometry[] = [];

  constructor(private readonly tonos: TonosAristas | null) {}

  /** Una caja de tamaño (x, y, z) con su esquina inferior trasera izquierda en `desde`, transformada por `m`. */
  caja(dx: number, dy: number, dz: number, desde: THREE.Vector3, m: THREE.Matrix4 | null, vidrio = false, conAristas = true) {
    const g = new THREE.BoxGeometry(dx, dy, dz);
    g.translate(desde.x + dx / 2, desde.y + dy / 2, desde.z + dz / 2);
    if (m) g.applyMatrix4(m);
    (vidrio ? this.vidrios : this.opacas).push(g.toNonIndexed());
    if (conAristas) {
      const a = new THREE.EdgesGeometry(g, 30);
      // NEVERA-9: el color va por vértice, así bisel y canto comparten una sola llamada de dibujo.
      const t = this.tonos;
      const c = t ? (vidrio ? t.canto : t.bisel) : new THREE.Color(1, 1, 1);
      const alfa = t ? (vidrio ? t.alfaCanto : t.alfaBisel) : 1;
      const n = a.getAttribute("position").count;
      const rgba = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) rgba.set([c.r, c.g, c.b, alfa], i * 4);
      a.setAttribute("color", new THREE.Float32BufferAttribute(rgba, 4));
      this.aristas.push(a);
    }
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
export function construirMueble(extras: { id: number; nombre: string; n: number }[], tonos: TonosAristas | null = null): Mueble {
  const b = new Constructor(tonos);
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
    superficies: BALDAS_Y.map((y, i) => ({
      sup: { ...supBalda, alto: (i === 0 ? N.alto - t : BALDAS_Y[i - 1]) - y - 0.008 },
      matriz: matrizSuperficie(N.x, y + 0.008, zBalda),
    })),
    caja: new THREE.Box3(V(x0, BALDAS_Y[2], z0), V(x0 + N.ancho, N.alto, N.fondo / 2)),
    ancla: V(N.x, 0, N.fondo / 2),
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
  const supCajon: Superficie = { ancho: anchoCajon - 0.05, fondo: fondoCajon - 0.06, alto: BALDAS_Y[2] - yc - 0.03 };
  compartimentos.push({
    clave: "cajon",
    nombre: "cajón de verduras",
    superficies: [{ sup: supCajon, matriz: matrizSuperficie(N.x, yc + 0.012, zc + fondoCajon / 2) }],
    caja: new THREE.Box3(V(xc, 0, zc), V(xc + anchoCajon, BALDAS_Y[2], zc + fondoCajon)),
    ancla: V(N.x, 0, N.fondo / 2 + CAJON.salida),
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
    superficies: PUERTA.estantes.map((y, i) => ({ sup: { ...supEstante, alto: (i === 0 ? N.alto : PUERTA.estantes[i - 1]) - y - 0.02 }, matriz: matrizSuperficie(N.ancho / 2, y + 0.01, -PUERTA.fondoEstante / 2, Math.PI, mPuerta) })),
    caja: cajaPuerta,
    ancla: V(N.ancho / 2, 0, 0).applyMatrix4(mPuerta),
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
    superficies: [...nivelesDespensa.map((y) => y + 0.02), dt].map((y, i) => ({
      sup: { ...supDespensa, alto: (i === 0 ? D.alto - dt : nivelesDespensa[i - 1]) - y },
      matriz: matrizSuperficie(D.x, y, zDespensa),
    })),
    caja: new THREE.Box3(V(dx0, 0, dz0), V(dx0 + D.ancho, D.alto, D.fondo / 2)),
    ancla: V(D.x, 0, D.fondo / 2),
    zonas: [D.alto - dt, ...nivelesDespensa].map((techo, i, l) =>
      new THREE.Box3(V(dx0, i + 1 < l.length ? l[i + 1] : 0, dz0), V(dx0 + D.ancho, techo, D.fondo / 2))),
  });

  // Raíces extra con cosas: una bandeja abierta cada una, a la derecha de la despensa, en el suelo; con muchas cosas,
  // dos pisos (el de arriba, una tabla sobre cuatro postes). NEVERA-7: el tamaño sale de cuántas lleva (medidaExtra).
  let xSig = D.x + D.ancho / 2 + EXTRA.separacion;
  extras.forEach((ex) => {
    const E = { ...EXTRA, ...medidaExtra(ex.n) };
    const ex0 = xSig;
    xSig += E.ancho + E.separacion;
    const ez0 = -E.fondo / 2;
    const bandeja = (y: number) => {
      b.caja(E.ancho, 0.015, E.fondo, V(ex0, y, ez0), null);
      b.caja(E.ancho, E.alto, 0.012, V(ex0, y, ez0), null);
      b.caja(0.012, E.alto, E.fondo, V(ex0, y, ez0), null);
      b.caja(0.012, E.alto, E.fondo, V(ex0 + E.ancho - 0.012, y, ez0), null);
      b.caja(E.ancho, E.alto, 0.012, V(ex0, y, ez0 + E.fondo - 0.012), null, true);
    };
    bandeja(0);
    const pisos = E.pisos === 2 ? [E.piso, 0.015] : [0.015];
    if (E.pisos === 2) {
      bandeja(E.piso - 0.015);
      for (const [px, pz] of [[ex0, ez0], [ex0 + E.ancho - 0.02, ez0], [ex0, ez0 + E.fondo - 0.02], [ex0 + E.ancho - 0.02, ez0 + E.fondo - 0.02]]) {
        b.caja(0.02, E.piso, 0.02, V(px, 0, pz), null);
      }
    }
    const techo = E.pisos === 2 ? E.techo : 0.4;
    compartimentos.push({
      clave: `extra:${ex.id}`,
      nombre: ex.nombre,
      superficies: pisos.map((y, i) => ({
        sup: { ancho: E.ancho - 0.06, fondo: E.fondo - 0.06, alto: (i === 0 ? techo : pisos[i - 1] - 0.015) - y },
        matriz: matrizSuperficie(ex0 + E.ancho / 2, y, 0),
      })),
      caja: new THREE.Box3(V(ex0, 0, ez0), V(ex0 + E.ancho, techo, ez0 + E.fondo)),
      ancla: V(ex0 + E.ancho / 2, 0, ez0 + E.fondo),
      zonas: E.pisos === 2
        ? [new THREE.Box3(V(ex0, E.piso - 0.015, ez0), V(ex0 + E.ancho, techo, ez0 + E.fondo)), new THREE.Box3(V(ex0, 0, ez0), V(ex0 + E.ancho, E.piso - 0.015, ez0 + E.fondo))]
        : [],
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
