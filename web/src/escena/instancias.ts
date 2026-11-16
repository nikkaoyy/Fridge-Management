// ORIGEN: /opt/data/pythagoras/web/src/escena/instancias.ts @ 1ac4185 (PYTHAGORAS 9), copiado sin cambios.
// tests/test_escena.py lo coteja byte a byte con el original. No se edita aquí: si PYTHAGORAS cambia, se vuelve a copiar.
import * as THREE from "three";
import { azarDe } from "./azar";
import { FRAG_HALO_INSTANCIADO, VERT_HALO_INSTANCIADO } from "./shaders";

/**
 * Geometría de asteroide: icosaedro subdividido con cada vértice desplazado por una semilla de su posición
 * (los vértices repetidos de caras vecinas reciben el mismo desplazamiento, así que no se abren grietas).
 * Con sombreado plano y la escala por eje de cada instancia, ninguno parece una esfera ni se repite.
 */
export function geometriaAsteroide(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const clave = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    const azar = azarDe(clave);
    v.multiplyScalar(0.72 + azar() * 0.5);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Pool de objetos: los estados de los asteroides se reciclan entre refrescos en vez de recrearse. */
export class Pool<T> {
  private readonly libres: T[] = [];
  constructor(private readonly crear: () => T) {}
  tomar(): T {
    return this.libres.pop() ?? this.crear();
  }
  soltar(x: T) {
    this.libres.push(x);
  }
}

/**
 * Un campo de cuerpos instanciados (asteroides, lunas, misiones): un InstancedMesh para los cuerpos y otro para sus
 * halos (cuadrados que miran a la cámara, con tamaño mínimo en píxeles). Dos llamadas de dibujo para todo el campo.
 *
 * LOD (PEDIDO-9): cada instancia lleva siempre su halo; el cuerpo solo cuando el motor dice que se ve con más de unos
 * píxeles (`poner(..., cuerpo)`). La malla se compacta cada cuadro con las cercanas, así que en la vista general no
 * se dibuja ninguna esfera (y si no queda ninguna, la malla ni se manda: visible = false).
 */
export class CampoInstanciado {
  readonly malla: THREE.InstancedMesh;
  readonly halo: THREE.InstancedMesh;
  private readonly matHalo: THREE.ShaderMaterial;
  private nMalla = 0;
  private nHalo = 0;
  /** Atributos por instancia de la malla (p. ej. la celda del atlas de las lunas), que se compactan con ella. */
  private readonly extra: THREE.InstancedBufferAttribute[] = [];

  constructor(
    geometria: THREE.BufferGeometry,
    material: THREE.Material,
    readonly capacidad: number,
    halo: { tam: number; intensidad: number; minPx: number; mundoPorPx: { value: number } },
  ) {
    this.malla = new THREE.InstancedMesh(geometria, material, capacidad);
    this.malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.malla.setColorAt(0, new THREE.Color(1, 1, 1)); // crea instanceColor
    this.malla.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.malla.count = 0;
    // Se mueven cada cuadro: la esfera envolvente calculada una vez no serviría para descartarlos.
    this.malla.frustumCulled = false;

    this.matHalo = new THREE.ShaderMaterial({
      vertexShader: VERT_HALO_INSTANCIADO,
      fragmentShader: FRAG_HALO_INSTANCIADO,
      uniforms: {
        uTam: { value: halo.tam },
        uIntensidad: { value: halo.intensidad },
        // Compartido con el motor, que lo recalcula al cambiar el tamaño: unidades de mundo por píxel a distancia 1.
        uMundoPorPx: halo.mundoPorPx,
        uMinPx: { value: halo.minPx },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), this.matHalo, capacidad);
    this.halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halo.setColorAt(0, new THREE.Color(1, 1, 1));
    this.halo.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.halo.count = 0;
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 2;
  }

  /** Un atributo por instancia de la malla (itemSize floats): se escribe con `poner(..., valores)`. */
  atributo(nombre: string, itemSize: number): THREE.InstancedBufferAttribute {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(this.capacidad * itemSize), itemSize);
    a.setUsage(THREE.DynamicDrawUsage);
    this.malla.geometry.setAttribute(nombre, a);
    this.extra.push(a);
    return a;
  }

  /** Cambia la geometría de los cuerpos (modo ligero) conservando los atributos por instancia. */
  cambiarGeometria(geo: THREE.BufferGeometry) {
    if (geo === this.malla.geometry) return;
    for (const [nombre, a] of Object.entries(this.malla.geometry.attributes)) {
      if (a instanceof THREE.InstancedBufferAttribute) geo.setAttribute(nombre, a);
    }
    this.malla.geometry = geo;
  }

  /** Empieza un cuadro: no hay ninguna instancia puesta. */
  empezar() {
    this.nMalla = this.nHalo = 0;
  }

  /**
   * Pone una instancia: su halo siempre y, si `cuerpo`, también su cuerpo. La escala de la matriz es el tamaño del
   * cuerpo (el halo la multiplica por su `tam`); escala 0 = oculta. `colorHalo`: si el halo no es del color del
   * cuerpo. `valores`: los de los atributos por instancia, en el orden en que se crearon.
   */
  poner(m: THREE.Matrix4, color: THREE.Color, cuerpo: boolean, colorHalo: THREE.Color | null = null, valores: readonly number[] = []) {
    if (this.nHalo >= this.capacidad) return;
    this.halo.setMatrixAt(this.nHalo, m);
    this.halo.setColorAt(this.nHalo, colorHalo ?? color);
    this.nHalo++;
    if (!cuerpo) return;
    const j = this.nMalla++;
    this.malla.setMatrixAt(j, m);
    this.malla.setColorAt(j, color);
    let k = 0;
    for (const a of this.extra) {
      for (let c = 0; c < a.itemSize; c++) a.array[j * a.itemSize + c] = valores[k++] ?? 0;
    }
  }

  /** Cierra el cuadro: cuenta y sube lo puesto. Un InstancedMesh sin instancias no se manda a dibujar. */
  terminar() {
    this.malla.count = this.nMalla;
    this.halo.count = this.nHalo;
    this.malla.visible = this.nMalla > 0;
    this.halo.visible = this.nHalo > 0;
    this.malla.instanceMatrix.needsUpdate = true;
    this.malla.instanceColor!.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    this.halo.instanceColor!.needsUpdate = true;
    for (const a of this.extra) a.needsUpdate = true;
  }

  /** Cuerpos y halos puestos en el último cuadro. */
  get cuerpos() {
    return this.nMalla;
  }
  get halos() {
    return this.nHalo;
  }

  destruir() {
    this.malla.geometry.dispose();
    (this.malla.material as THREE.Material).dispose();
    this.halo.geometry.dispose();
    this.matHalo.dispose();
    this.malla.dispose();
    this.halo.dispose();
  }
}
