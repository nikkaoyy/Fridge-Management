// ORIGEN: /opt/data/pythagoras/web/src/escena/camara.ts @ 1ac4185 (PYTHAGORAS 9). Un solo cambio, marcado con
// «NEVERA-6»: la opción `giroSolo` (la nevera la pasa en false: el pedido no quiere movimiento automático que maree).
// Todo lo demás es el original: órbita con inercia, rueda y pellizco, desplazar, vuelo de 800 ms, teclado.
import * as THREE from "three";

/**
 * La cámara y los gestos. Patrón de `/opt/data/projects/aria-graph/brain/rig.js` (la red de ARIA): órbita esférica
 * (theta, phi, radio) alrededor de un objetivo, arrastrar gira con inercia al soltar, rueda y pellizco acercan
 * (la rueda, hacia lo que hay bajo el cursor), botón derecho o Mayús desplaza, y si nadie toca nada gira despacio.
 *
 * Adaptado a un sistema solar: aquí los cuerpos se mueven, así que el objetivo puede **seguir** a un cuerpo
 * (una función que devuelve su posición de cada cuadro) y el vuelo de 800 ms aterriza sobre donde está el
 * cuerpo al llegar, no donde estaba al salir. Con movimiento reducido: sin inercia, sin giro solo y vuelos
 * instantáneos.
 */

const MIN_PHI = 0.12;
const MAX_PHI = Math.PI - 0.12;
const TAU = Math.PI * 2;
/** Giro solo, en radianes por segundo, y cuánto hay que esperar sin tocar para que empiece. */
const GIRO_SOLO = 0.035;
const GIRO_SOLO_TRAS_MS = 4500;
export const DURACION_VUELO_MS = 800;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** easeInOutCubic, la misma curva del vuelo de aria-graph. */
const suavizar = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface Vista {
  theta: number;
  phi: number;
  radio: number;
}

export interface DestinoVuelo extends Partial<Vista> {
  /** Punto fijo o cuerpo que se mueve (se lee en cada cuadro). */
  objetivo: THREE.Vector3 | (() => THREE.Vector3);
}

export interface OpcionesRig {
  reducido: boolean;
  /** Radio mínimo y máximo según lo que se mira. */
  limites: (siguiendo: boolean) => { min: number; max: number };
  /** Hasta dónde puede irse el objetivo del centro al desplazar (radio de la vista general). */
  alcance: number;
  onTap: (x: number, y: number) => void;
  onHover: (x: number, y: number) => void;
  onSalir: () => void;
  /** El usuario movió la cámara a mano (para dejar de considerarla «vista general»). */
  onToque: () => void;
  /** NEVERA-6: si es false, la cámara no gira sola nunca (en PYTHAGORAS giraba tras 4,5 s sin tocar). */
  giroSolo?: boolean;
}

interface Vuelo {
  inicio: number;
  desde: Vista & { objetivo: THREE.Vector3 };
  dTheta: number;
  hasta: Vista;
  objetivo: THREE.Vector3 | (() => THREE.Vector3);
}

export class RigCamara {
  readonly objetivo = new THREE.Vector3();
  private estado: Vista = { theta: 0, phi: 1.2, radio: 60 };
  private seguir: (() => THREE.Vector3) | null = null;
  private vuelo: Vuelo | null = null;
  private inercia: { theta: number; phi: number } | null = null;
  private readonly punteros = new Map<number, { x: number; y: number }>();
  private pulsacion: { x: number; y: number; movido: number; ultimo: number; vx: number; vy: number; desplazar: boolean } | null = null;
  private pellizco: { distancia: number; x: number; y: number } | null = null;
  private ultimoToque = performance.now();
  private reducido: boolean;
  private ancho = 1;
  private alto = 1;

  private readonly offset = new THREE.Vector3();
  private readonly ejeX = new THREE.Vector3();
  private readonly ejeY = new THREE.Vector3();
  private readonly mundo = new THREE.Vector3();

  constructor(
    private readonly lienzo: HTMLCanvasElement,
    private readonly camara: THREE.PerspectiveCamera,
    private readonly opciones: OpcionesRig,
  ) {
    this.reducido = opciones.reducido;
    lienzo.addEventListener("pointerdown", this.alPulsar);
    lienzo.addEventListener("pointermove", this.alMover);
    lienzo.addEventListener("pointerup", this.alSoltar);
    lienzo.addEventListener("pointercancel", this.alSoltar);
    lienzo.addEventListener("pointerleave", this.alSalir);
    lienzo.addEventListener("wheel", this.alRueda, { passive: false });
    lienzo.addEventListener("contextmenu", this.sinMenu);
    window.addEventListener("keydown", this.alTeclear);
  }

  destruir() {
    const l = this.lienzo;
    l.removeEventListener("pointerdown", this.alPulsar);
    l.removeEventListener("pointermove", this.alMover);
    l.removeEventListener("pointerup", this.alSoltar);
    l.removeEventListener("pointercancel", this.alSoltar);
    l.removeEventListener("pointerleave", this.alSalir);
    l.removeEventListener("wheel", this.alRueda);
    l.removeEventListener("contextmenu", this.sinMenu);
    window.removeEventListener("keydown", this.alTeclear);
  }

  setReducido(r: boolean) {
    this.reducido = r;
    if (r) {
      this.inercia = null;
      if (this.vuelo) this.terminarVuelo();
    }
  }

  tamano(ancho: number, alto: number) {
    this.ancho = ancho;
    this.alto = alto;
  }

  get siguiendo() {
    return this.seguir !== null;
  }

  get arrastrando() {
    return this.punteros.size > 0;
  }

  get volando() {
    return this.vuelo !== null;
  }

  /** Dónde está la cámara ahora mismo: se guarda al entrar en un cuerpo para volver con el vuelo inverso. */
  instantanea(): Vista & { objetivo: THREE.Vector3 } {
    return { ...this.estado, objetivo: this.objetivo.clone() };
  }

  /** Cambia solo la distancia de destino (del vuelo en curso o de la vista actual), sin tocar ángulos ni objetivo. */
  ajustarRadio(radio: number) {
    if (this.vuelo) this.vuelo.hasta.radio = radio;
    else this.estado.radio = radio;
  }

  /** Coloca la cámara sin transición. */
  colocar(v: Vista, objetivo: THREE.Vector3 | (() => THREE.Vector3)) {
    this.vuelo = null;
    this.inercia = null;
    this.estado = { theta: v.theta, phi: clamp(v.phi, MIN_PHI, MAX_PHI), radio: v.radio };
    this.fijarObjetivo(objetivo);
    this.aplicar();
  }

  /** Vuela hasta el destino en 800 ms con easing (al instante con movimiento reducido). */
  volarA(d: DestinoVuelo) {
    const hasta: Vista = {
      theta: d.theta ?? this.estado.theta,
      phi: clamp(d.phi ?? this.estado.phi, MIN_PHI, MAX_PHI),
      radio: d.radio ?? this.estado.radio,
    };
    this.inercia = null;
    if (this.reducido) {
      this.colocar(hasta, d.objetivo);
      return;
    }
    let dTheta = (hasta.theta - this.estado.theta) % TAU;
    if (dTheta > Math.PI) dTheta -= TAU;
    if (dTheta < -Math.PI) dTheta += TAU;
    this.seguir = null;
    this.vuelo = {
      inicio: performance.now(),
      desde: { ...this.estado, objetivo: this.objetivo.clone() },
      dTheta,
      hasta,
      objetivo: d.objetivo,
    };
  }

  /**
   * Cambia el destino sin perder la transición: si hay un vuelo en curso se reapunta, si no se coloca. Para la
   * vista general cuando cambia el hueco libre (se abre el panel, se gira el móvil).
   */
  reencuadrar(v: Vista, objetivo: THREE.Vector3 | (() => THREE.Vector3)) {
    if (this.vuelo) {
      this.vuelo.hasta = { ...v, phi: clamp(v.phi, MIN_PHI, MAX_PHI) };
      this.vuelo.objetivo = objetivo;
    } else this.colocar(v, objetivo);
  }

  /** Avanza vuelo, inercia o giro solo, sigue al cuerpo y coloca la cámara. */
  actualizar(dt: number, ahora: number) {
    const v = this.vuelo;
    if (v) {
      const t = clamp((ahora - v.inicio) / DURACION_VUELO_MS, 0, 1);
      const k = suavizar(t);
      const e = this.estado;
      e.theta = v.desde.theta + v.dTheta * k;
      e.phi = v.desde.phi + (v.hasta.phi - v.desde.phi) * k;
      // Interpolación geométrica del radio: el acercamiento se siente uniforme a cualquier escala.
      e.radio = v.desde.radio * (v.hasta.radio / v.desde.radio) ** k;
      const destino = typeof v.objetivo === "function" ? v.objetivo() : v.objetivo;
      this.objetivo.lerpVectors(v.desde.objetivo, destino, k);
      if (t >= 1) this.terminarVuelo();
    } else {
      if (this.seguir) this.objetivo.copy(this.seguir());
      if (this.inercia) {
        const g = this.inercia;
        this.estado.theta += g.theta * dt;
        this.estado.phi = clamp(this.estado.phi + g.phi * dt, MIN_PHI, MAX_PHI);
        const caida = Math.exp(-dt / 0.28);
        g.theta *= caida;
        g.phi *= caida;
        if (Math.abs(g.theta) + Math.abs(g.phi) < 0.01) this.inercia = null;
      } else if (this.opciones.giroSolo !== false && !this.reducido && !this.punteros.size && ahora - this.ultimoToque > GIRO_SOLO_TRAS_MS) {
        this.estado.theta += GIRO_SOLO * dt;
      }
    }
    this.aplicar();
  }

  /* ---------- Internos ---------- */

  private terminarVuelo() {
    const v = this.vuelo!;
    this.vuelo = null;
    this.estado = { ...v.hasta };
    this.fijarObjetivo(v.objetivo);
  }

  private fijarObjetivo(o: THREE.Vector3 | (() => THREE.Vector3)) {
    if (typeof o === "function") {
      this.seguir = o;
      this.objetivo.copy(o());
    } else {
      this.seguir = null;
      this.objetivo.copy(o);
    }
  }

  private aplicar() {
    const { theta, phi, radio } = this.estado;
    const s = Math.sin(phi);
    this.offset.set(s * Math.sin(theta), Math.cos(phi), s * Math.cos(theta)).multiplyScalar(radio);
    const c = this.camara;
    c.position.copy(this.objetivo).add(this.offset);
    c.lookAt(this.objetivo);
    const near = clamp(radio * 0.01, 0.02, 0.5);
    if (Math.abs(c.near - near) > 1e-4) {
      c.near = near;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  }

  private tocar() {
    this.ultimoToque = performance.now();
    this.opciones.onToque();
  }

  /** Deja de seguir y de volar: el usuario toma el control del objetivo (desplazar, acercar al cursor). */
  private soltarObjetivo() {
    if (this.vuelo) this.terminarVuelo();
    this.seguir = null;
  }

  private limitarRadio(r: number) {
    const { min, max } = this.opciones.limites(this.seguir !== null);
    return clamp(r, min, max);
  }

  private mundoPorPx(distancia: number) {
    return (2 * distancia * Math.tan((this.camara.fov * Math.PI) / 360)) / this.alto;
  }

  private sujetarObjetivo() {
    this.objetivo.clampLength(0, this.opciones.alcance);
  }

  private desplazar(dx: number, dy: number) {
    this.soltarObjetivo();
    const u = this.mundoPorPx(this.estado.radio);
    this.ejeX.setFromMatrixColumn(this.camara.matrixWorld, 0);
    this.ejeY.setFromMatrixColumn(this.camara.matrixWorld, 1);
    this.objetivo.addScaledVector(this.ejeX, -dx * u).addScaledVector(this.ejeY, dy * u);
    this.sujetarObjetivo();
  }

  /** Acerca o aleja. Siguiendo un cuerpo, hacia él; si no, lo que está bajo el cursor sigue bajo el cursor. */
  private acercar(x: number, y: number, factor: number) {
    if (this.vuelo) this.terminarVuelo();
    const siguiente = this.limitarRadio(this.estado.radio * factor);
    if (!this.seguir) {
      const ratio = siguiente / this.estado.radio;
      const u = this.mundoPorPx(this.estado.radio);
      this.ejeX.setFromMatrixColumn(this.camara.matrixWorld, 0);
      this.ejeY.setFromMatrixColumn(this.camara.matrixWorld, 1);
      // El centro óptico puede estar desplazado (setViewOffset con el panel abierto): se mide desde él.
      const vo = this.camara.view;
      const cx = this.ancho / 2 - (vo?.enabled ? vo.offsetX : 0);
      const cy = this.alto / 2 - (vo?.enabled ? vo.offsetY : 0);
      this.mundo
        .copy(this.objetivo)
        .addScaledVector(this.ejeX, (x - cx) * u)
        .addScaledVector(this.ejeY, (cy - y) * u);
      this.objetivo.sub(this.mundo).multiplyScalar(ratio).add(this.mundo);
      this.sujetarObjetivo();
    }
    this.estado.radio = siguiente;
    this.tocar();
  }

  private girar(dx: number, dy: number) {
    const porPx = (TAU / Math.max(this.alto, 480)) * 0.62;
    this.estado.theta -= dx * porPx;
    this.estado.phi = clamp(this.estado.phi - dy * porPx, MIN_PHI, MAX_PHI);
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.lienzo.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly alPulsar = (e: PointerEvent) => {
    this.lienzo.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.punteros.set(e.pointerId, p);
    this.inercia = null;
    this.lienzo.classList.add("arrastrando");
    this.ultimoToque = performance.now();
    if (this.punteros.size === 1) {
      this.pulsacion = { ...p, movido: 0, ultimo: performance.now(), vx: 0, vy: 0, desplazar: e.button === 2 || e.shiftKey };
    } else if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      this.pellizco = { distancia: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.pulsacion = null;
    }
  };

  private readonly alMover = (e: PointerEvent) => {
    const p = this.local(e);
    if (!this.punteros.has(e.pointerId)) {
      if (e.pointerType === "mouse") this.opciones.onHover(p.x, p.y);
      return;
    }
    const previo = this.punteros.get(e.pointerId)!;
    this.punteros.set(e.pointerId, p);
    if (this.punteros.size === 2 && this.pellizco) {
      const [a, b] = [...this.punteros.values()];
      const distancia = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      if (this.vuelo) this.terminarVuelo();
      this.estado.radio = this.limitarRadio(this.estado.radio * (this.pellizco.distancia / distancia));
      // Mover los dos dedos desplaza, salvo siguiendo un cuerpo: entonces solo acerca.
      if (!this.seguir) this.desplazar(x - this.pellizco.x, y - this.pellizco.y);
      this.pellizco = { distancia, x, y };
      this.tocar();
      return;
    }
    const pul = this.pulsacion;
    if (!pul) return;
    const dx = p.x - previo.x;
    const dy = p.y - previo.y;
    pul.movido += Math.abs(dx) + Math.abs(dy);
    if (pul.movido < 5) return;
    this.opciones.onSalir();
    if (this.vuelo) this.terminarVuelo();
    if (pul.desplazar) this.desplazar(dx, dy);
    else this.girar(dx, dy);
    const ahora = performance.now();
    const pasado = Math.max(ahora - pul.ultimo, 1);
    pul.vx = dx / pasado;
    pul.vy = dy / pasado;
    pul.ultimo = ahora;
    this.tocar();
  };

  private readonly alSoltar = (e: PointerEvent) => {
    const p = this.local(e);
    const pul = this.pulsacion;
    this.punteros.delete(e.pointerId);
    if (this.punteros.size < 2) this.pellizco = null;
    if (!this.punteros.size) this.lienzo.classList.remove("arrastrando");
    if (!pul || this.punteros.size) return;
    this.pulsacion = null;
    if (e.type !== "pointerup") return;
    if (pul.movido < 6) {
      this.opciones.onTap(p.x, p.y);
      return;
    }
    // Soltar en marcha deja la inercia (como en aria-graph); con movimiento reducido, se para en seco.
    if (performance.now() - pul.ultimo < 60 && !this.reducido && !pul.desplazar) {
      const porPx = (TAU / Math.max(this.alto, 480)) * 0.62;
      this.inercia = { theta: -pul.vx * 1000 * porPx, phi: -pul.vy * 1000 * porPx };
    }
    this.tocar();
  };

  private readonly alSalir = () => {
    if (!this.punteros.size) this.opciones.onSalir();
  };

  private readonly alRueda = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    // deltaMode 1 = líneas (Firefox): se pasa a píxeles aproximados.
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.acercar(p.x, p.y, Math.exp(clamp(delta, -240, 240) * 0.0011));
  };

  private readonly sinMenu = (e: Event) => e.preventDefault();

  /** Flechas giran, + y − acercan; nunca mientras se escribe en un campo. */
  private readonly alTeclear = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const paso = 0.12;
    const giros: Record<string, [number, number]> = {
      ArrowLeft: [-paso, 0],
      ArrowRight: [paso, 0],
      ArrowUp: [0, -paso],
      ArrowDown: [0, paso],
    };
    const g = giros[e.key];
    if (g) {
      e.preventDefault();
      if (this.vuelo) this.terminarVuelo();
      this.estado.theta += g[0];
      this.estado.phi = clamp(this.estado.phi + g[1], MIN_PHI, MAX_PHI);
      this.tocar();
    } else if (e.key === "+" || e.key === "=") {
      this.acercarCentro(0.85);
    } else if (e.key === "-") {
      this.acercarCentro(1.18);
    }
  };

  private acercarCentro(factor: number) {
    if (this.vuelo) this.terminarVuelo();
    this.estado.radio = this.limitarRadio(this.estado.radio * factor);
    this.tocar();
  }
}
