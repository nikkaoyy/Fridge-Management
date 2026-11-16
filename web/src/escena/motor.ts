// ORIGEN: recorte de `MotorSistema` de /opt/data/pythagoras/web/src/escena/motor.ts @ 1ac4185 (PYTHAGORAS 9). No es
// un motor nuevo: son las mismas piezas sin el sistema solar. Lo que viene de allí, tal cual o casi:
//   - el renderer: lienzo opaco con el --void-900 de fondo (con alpha, los halos aditivos dejan cuadrados negros),
//     antialias decidido al abrir según el modo ligero, `dpr()` topado a 2 (1,5 en ligero), `setLigero`;
//   - `medir`: calls y triangles de `renderer.info.render` del último cuadro; fps y ms de CPU por cuadro en ventanas
//     de 5 s; el bucle se para con la pestaña oculta y la ventana no cruza la pausa;
//   - el LOD de los cuerpos instanciados (`conCuerpo`: esfera si su radio en pantalla llega a un umbral, si no solo el
//     halo) sobre `CampoInstanciado` y el atlas con `aCelda` por instancia;
//   - la selección en espacio de pantalla, generosa con lo pequeño (`elegir`, 22 px con el dedo y 14 con el ratón);
//   - el aro de selección que mira a la cámara (`marcador`) y la colocación de etiquetas con su resolvedor;
//   - `RigCamara` (camara.ts) con el giro solo apagado.
// Lo propio de la nevera: el mueble (mueble.ts), dónde va cada cosa (colocar.ts) y el encuadre de un compartimento.
import * as THREE from "three";
import { semaforo, textoDias, type Semaforo, type Ubicaciones } from "../logica";
import type { Elemento } from "../tipos";
import { RigCamara } from "./camara";
import { colocar, compartimentoDe, sigla, type ClaveCompartimento } from "./colocar";
import { bajar, colocarEtiqueta, Etiqueta, hueco, MARGEN_ETIQUETA_PX, RANGO_ETIQUETA, type Caja } from "./etiquetas";
import { CampoInstanciado } from "./instancias";
import { construirMueble, NEVERA, type Compartimento, type Mueble } from "./mueble";
import { piel } from "./piel";
import { AtlasCategorias, materialAtlas } from "./texturas";

/**
 * Lo que cuesta dibujar la escena, en `window.__nevera.rendimiento` (los mismos nombres que
 * `window.__pythagoras.rendimiento`). `calls` y `triangles`, del último cuadro; `fps` y `msCuadro`, media de la última
 * ventana de 5 s (null hasta que se cierra la primera).
 */
export interface InfoRendimiento {
  fps: number | null;
  msCuadro: number | null;
  calls: number;
  triangles: number;
  /** Modo ligero: dpr ≤ 1,5, esferas de 16×12, sin antialias si estaba activo al abrir. */
  modoLigero: boolean;
  /** Por qué: `pointer: coarse`, `devicePixelRatio ≥ 2`, `elegido a mano` o `escritorio` (no se activó). */
  motivoLigero: string;
  antialias: boolean;
  dpr: number;
  lienzo: [number, number];
  /** Cosas con esfera en el último cuadro (LOD: cerca) y cosas en la escena (todas llevan halo). */
  cuerpos: number;
  halos: number;
  /** Segmentos de la esfera de una cosa: «24×16» o, en modo ligero, «16×12». */
  esfera: string;
  /** Celdas ocupadas del atlas de categorías (8×8 = 64). */
  atlas: number;
}

export interface InfoCompartimento {
  nombre: string;
  total: number;
  /** ids en orden de colocación (el primero, el más urgente: delante, arriba, a la izquierda). */
  orden: number[];
  /** ids de la fila de delante. */
  frente: number[];
  columnas: number;
  filas: number;
  superficies: number;
}

export interface EstadisticasEscena {
  rendimiento: InfoRendimiento;
  compartimentos: Record<string, InfoCompartimento>;
  /** La escena encuadra todo y nadie ha movido la cámara. */
  general: boolean;
  distancia: number;
  etiquetas: { visibles: string[]; ocultas: string[]; solapes: number; separacionMin: number | null };
  hover: number | null;
  seleccion: number | null;
  /** Dónde cae cada cosa en el lienzo ahora mismo (px CSS desde su esquina), para tocarla desde fuera. */
  enPantalla: () => { id: number; x: number; y: number; r: number }[];
  /** Centro en pantalla de un compartimento o de uno de sus niveles (para tocarlo desde fuera). */
  centroDe: (clave: string, zona?: number) => { x: number; y: number } | null;
  /** Lo último que se encuadró: «general», «nevera#0» (balda de arriba), «despensa#2», «puerta»… */
  encuadre: string;
}

export interface OpcionesMotor {
  ligero: boolean;
  motivoLigero: string;
  reducido: boolean;
  alElegir: (id: number | null) => void;
  /** El contexto WebGL se perdió: la app vuelve a la lista. */
  alFallar: (motivo: string) => void;
}

export interface DatosEscena {
  elementos: Elemento[];
  ubic: Ubicaciones;
  categorias: Map<number, string>;
}

interface Cosa {
  id: number;
  nombre: string;
  dias: number | null;
  sem: Semaforo;
  pos: THREE.Vector3; // mundo
  radio: number;
  color: THREE.Color;
  celda: string;
}

interface Rotulo {
  comp: Compartimento;
  etiqueta: Etiqueta;
  firma: string;
}

const FOV = 40;
const RAD = Math.PI / 180;
/**
 * LOD: una cosa lleva esfera solo si su radio en pantalla llega a estos px; por debajo es su halo (con tamaño mínimo
 * en px). En PYTHAGORAS el umbral era 2 px porque una luna en la vista general medía menos de un píxel; en la nevera,
 * con el mueble entero a la vista una cosa mide 6–14 px de radio, así que el umbral sube a 16: en la vista general no
 * se dibuja ninguna esfera, y al acercarse a un compartimento (30–40 px) aparecen con su sigla.
 */
const UMBRAL_CUERPO_PX = 16;
const VENTANA_MS = 5000;
const DPR_MAX = { normal: 2, ligero: 1.5 };
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const M1 = new THREE.Matrix4();
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export class MotorNevera {
  readonly estadisticas: EstadisticasEscena;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly escena = new THREE.Scene();
  private readonly camara = new THREE.PerspectiveCamera(FOV, 1, 0.02, 60);
  /** Todo cuelga de aquí, desplazado para que el centro de la escena quede en el origen (el rig orbita el origen). */
  private readonly raiz = new THREE.Group();
  private readonly lienzo: HTMLCanvasElement;
  private readonly rig: RigCamara;
  private readonly observador: ResizeObserver;
  private mueble: Mueble;
  private firmaMueble = "";
  private readonly campo: CampoInstanciado;
  private readonly geo = new THREE.SphereGeometry(1, 24, 16);
  private readonly geoLigera = new THREE.SphereGeometry(1, 16, 12);
  private readonly atlas = new AtlasCategorias();
  private readonly uMundoPorPx = { value: 0.001 };
  private readonly marcador: THREE.Mesh;
  private readonly colores: Record<Semaforo, THREE.Color>;
  private cosas: Cosa[] = [];
  private readonly porId = new Map<number, Cosa>();
  private rotulos: Rotulo[] = [];
  private etiquetaHover: { id: number; e: Etiqueta } | null = null;
  private readonly celdaUv = { u: 0, v: 0 };
  private ligero: boolean;
  private reducido: boolean;
  private ancho = 1;
  private alto = 1;
  private pxPorUnidad = 1;
  private raf = 0;
  private ultimo = 0;
  private readonly ventana = { inicio: 0, cuadros: 0, ms: 0 };
  private puntero: { x: number; y: number } | null = null;
  private punteroCambio = false;
  private seleccion: number | null = null;
  private enGeneral = true;
  private destruido = false;

  constructor(
    private readonly contenedor: HTMLElement,
    private readonly opciones: OpcionesMotor,
  ) {
    this.ligero = opciones.ligero;
    this.reducido = opciones.reducido;
    const p = piel();
    this.colores = {
      vencido: new THREE.Color(p.danger),
      urgente: new THREE.Color(p.danger),
      pronto: new THREE.Color(p.warn),
      bien: new THREE.Color(p.done),
      "sin-fecha": new THREE.Color(p.muted),
    };
    this.estadisticas = {
      rendimiento: {
        fps: null,
        msCuadro: null,
        calls: 0,
        triangles: 0,
        modoLigero: this.ligero,
        motivoLigero: opciones.motivoLigero,
        antialias: !this.ligero,
        dpr: 1,
        lienzo: [0, 0],
        cuerpos: 0,
        halos: 0,
        esfera: this.ligero ? "16×12" : "24×16",
        atlas: 0,
      },
      compartimentos: {},
      general: true,
      distancia: 0,
      etiquetas: { visibles: [], ocultas: [], solapes: 0, separacionMin: null },
      hover: null,
      seleccion: null,
      enPantalla: () => this.enPantalla(),
      centroDe: (clave, zona) => this.centroDe(clave, zona),
      encuadre: "general",
    };

    // Lienzo opaco (ver cabecera) y, en modo ligero, sin antialias: solo se decide al crear el contexto.
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.ligero, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.dpr());
    this.renderer.setClearColor(new THREE.Color(p.void), 1);
    this.lienzo = this.renderer.domElement;
    this.lienzo.className = "escena-lienzo";
    this.lienzo.setAttribute("aria-hidden", "true");
    this.lienzo.addEventListener("webglcontextlost", this.alPerderContexto);
    contenedor.appendChild(this.lienzo);

    this.escena.add(this.raiz);
    this.escena.add(new THREE.AmbientLight(new THREE.Color(p.muted), 1.1));
    const luz = new THREE.DirectionalLight(new THREE.Color(p.ink), 2.2);
    luz.position.set(0.6, 2.5, 3);
    this.escena.add(luz);

    this.mueble = this.crearMueble([]);

    this.campo = new CampoInstanciado(this.ligero ? this.geoLigera : this.geo, materialAtlas(this.atlas.textura), 512, {
      // Más contenido que en PYTHAGORAS (4,2 y 0,8): aquí las cosas van en filas apretadas y los halos se suman.
      tam: 1.9,
      intensidad: 0.42,
      minPx: 6,
      mundoPorPx: this.uMundoPorPx,
    });
    this.campo.atributo("aCelda", 2);
    this.raiz.add(this.campo.malla, this.campo.halo);

    this.marcador = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.1, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(p.cyan), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
    );
    this.marcador.renderOrder = 15;
    this.marcador.visible = false;
    this.escena.add(this.marcador);

    this.rig = new RigCamara(this.lienzo, this.camara, {
      reducido: this.reducido,
      giroSolo: false,
      limites: () => ({ min: 0.3, max: this.distanciaGeneral() * 1.8 }),
      alcance: 2.5,
      onTap: this.alTocar,
      onHover: (x, y) => {
        this.puntero = { x, y };
        this.punteroCambio = true;
      },
      onSalir: () => {
        this.puntero = null;
        this.punteroCambio = true;
      },
      onToque: () => {
        this.enGeneral = false;
      },
    });

    this.observador = new ResizeObserver(() => this.redimensionar());
    this.observador.observe(contenedor);
    this.redimensionar();
    this.rig.colocar(this.vistaGeneral(), new THREE.Vector3());

    void document.fonts?.ready.then(() => {
      if (!this.destruido) this.redibujarEtiquetas();
    });
    document.addEventListener("visibilitychange", this.alCambiarVisibilidad);
    this.arrancar();
  }

  /* ---------- API para React ---------- */

  /** Recoloca todo con los elementos de ahora: las posiciones salen de la ubicación, nunca de algo guardado. */
  actualizar(d: DatosEscena) {
    const porComp = new Map<ClaveCompartimento, Elemento[]>();
    for (const e of d.elementos) {
      const c = compartimentoDe(e, d.ubic);
      (porComp.get(c) ?? porComp.set(c, []).get(c)!).push(e);
    }
    const extras = [...porComp.keys()]
      .filter((k): k is `extra:${number}` => k.startsWith("extra:"))
      .map((k) => Number(k.slice(6)))
      .sort((a, b) => a - b)
      .map((id) => ({ id, nombre: d.ubic.porId.get(id)?.nombre ?? `ubicación ${id}` }));
    const firma = extras.map((x) => `${x.id}:${x.nombre}`).join("|");
    if (firma !== this.firmaMueble) {
      this.raiz.remove(this.mueble.opaco, this.mueble.vidrio, this.mueble.aristas);
      for (const o of [this.mueble.opaco, this.mueble.vidrio, this.mueble.aristas]) o.geometry.dispose();
      this.mueble = this.crearMueble(extras);
      this.firmaMueble = firma;
      if (this.enGeneral) this.rig.reencuadrar(this.vistaGeneral(), new THREE.Vector3());
    }

    const catDe = new Map(d.elementos.map((e) => [e.id, e.categoria_id ?? 0]));
    this.atlas.sincronizar(
      [...new Set(d.elementos.map((e) => `cat:${e.categoria_id ?? 0}`))],
      (clave) => sigla(d.categorias.get(Number(clave.slice(4)))),
    );
    this.estadisticas.rendimiento.atlas = this.atlas.ocupadas;

    const elementoDe = new Map(d.elementos.map((e) => [e.id, e]));
    this.cosas = [];
    this.porId.clear();
    const info: Record<string, InfoCompartimento> = {};
    for (const comp of this.mueble.compartimentos) {
      const lista = porComp.get(comp.clave) ?? [];
      const { puestos, rejilla } = colocar(lista, comp.superficies.map((s) => s.sup), comp.radioMax);
      info[comp.clave] = {
        nombre: comp.nombre,
        total: lista.length,
        orden: puestos.map((p) => p.id),
        frente: puestos.filter((p) => p.fila === 0).map((p) => p.id),
        columnas: rejilla.columnas,
        filas: rejilla.filas,
        superficies: comp.superficies.length,
      };
      for (const p of puestos) {
        const e = elementoDe.get(p.id)!;
        const pos = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(comp.superficies[p.superficie].matriz).add(this.raiz.position);
        const cosa: Cosa = {
          id: e.id,
          nombre: e.producto,
          dias: e.dias_para_vencer,
          sem: p.semaforo,
          pos,
          radio: p.radio,
          color: this.colores[p.semaforo],
          celda: `cat:${catDe.get(e.id) ?? 0}`,
        };
        this.cosas.push(cosa);
        this.porId.set(e.id, cosa);
      }
      this.rotular(comp, lista);
    }
    this.estadisticas.compartimentos = info;
    if (this.etiquetaHover && !this.porId.has(this.etiquetaHover.id)) this.quitarHover();
    if (this.seleccion !== null && !this.porId.has(this.seleccion)) this.seleccionar(null);
  }

  seleccionar(id: number | null) {
    this.seleccion = id;
    this.estadisticas.seleccion = id;
  }

  /** Vuelve al encuadre de todo el mueble (vuelo de 800 ms; al instante con movimiento reducido). */
  encuadrar() {
    this.enGeneral = true;
    this.estadisticas.encuadre = "general";
    this.rig.volarA({ ...this.vistaGeneral(), objetivo: new THREE.Vector3() });
  }

  /** Encuadra un compartimento o, si se da, uno de sus niveles (una balda): lo que hace tocar dentro de él. */
  encuadrarCompartimento(clave: string, zona?: number) {
    const comp = this.mueble.compartimentos.find((c) => c.clave === clave);
    if (!comp) return;
    this.enGeneral = false;
    const nivel = zona !== undefined ? comp.zonas[zona] : undefined;
    this.estadisticas.encuadre = nivel ? `${clave}#${zona}` : clave;
    const caja = (nivel ?? comp.caja).clone().translate(this.raiz.position);
    const centro = caja.getCenter(new THREE.Vector3());
    const tam = caja.getSize(new THREE.Vector3());
    if (nivel) {
      // Las cosas están en el suelo del nivel: se apunta ahí y se encuadra una franja baja, no el hueco entero.
      tam.y = Math.min(tam.y, 0.25);
      centro.y = caja.min.y + 0.07;
    }
    // La puerta se mira de frente a su cara interior; el cajón y las baldas, algo desde arriba.
    const vista =
      comp.clave === "puerta"
        ? { theta: Math.atan2(Math.sin(NEVERA.apertura * RAD), -Math.cos(NEVERA.apertura * RAD)) - 0.15, phi: 1.3 }
        : comp.clave === "cajon"
          ? { theta: 0.1, phi: 0.95 }
          : nivel
            ? { theta: 0.12, phi: 1.12 }
            : { theta: 0.12, phi: 1.22 };
    const lado = Math.max(tam.x, tam.z * 0.8);
    const radio = (this.distanciaPara(lado * 0.62, tam.y * 0.6) + Math.min(tam.z, 0.6) / 2) * (nivel ? 1.3 : 1);
    this.rig.volarA({ ...vista, radio, objetivo: centro });
  }

  /** Modo ligero: dpr ≤ 1,5 y esferas de 16×12. El antialias solo cambia al volver a abrir. */
  setLigero(l: boolean, motivo: string) {
    this.estadisticas.rendimiento.motivoLigero = motivo;
    if (l === this.ligero) return;
    this.ligero = l;
    const r = this.estadisticas.rendimiento;
    r.modoLigero = l;
    r.esfera = l ? "16×12" : "24×16";
    this.campo.cambiarGeometria(l ? this.geoLigera : this.geo);
    // La ventana de fps empieza de nuevo: el antes y el después no se mezclan.
    r.fps = null;
    r.msCuadro = null;
    this.ventana.inicio = 0;
    this.redimensionar();
    this.redibujarEtiquetas();
  }

  destruir() {
    this.destruido = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener("visibilitychange", this.alCambiarVisibilidad);
    this.lienzo.removeEventListener("webglcontextlost", this.alPerderContexto);
    this.observador.disconnect();
    this.rig.destruir();
    for (const r of this.rotulos) r.etiqueta.destruir();
    this.quitarHover();
    for (const o of [this.mueble.opaco, this.mueble.vidrio, this.mueble.aristas]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.campo.destruir();
    this.geo.dispose();
    this.geoLigera.dispose();
    this.atlas.destruir();
    this.marcador.geometry.dispose();
    (this.marcador.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.lienzo.remove();
  }

  /* ---------- Construcción ---------- */

  private crearMueble(extras: { id: number; nombre: string }[]): Mueble {
    const p = piel();
    const m = construirMueble(extras);
    m.opaco.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.elevado),
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    m.vidrio.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.cyan),
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    });
    m.aristas.material = new THREE.LineBasicMaterial({ color: new THREE.Color(p.cyan), transparent: true, opacity: 0.42, depthWrite: false });
    m.opaco.renderOrder = 1;
    m.vidrio.renderOrder = 1;
    // El centro de la escena en el origen: el rig orbita el origen y limita el desplazamiento desde él.
    this.raiz.position.copy(m.caja.getCenter(new THREE.Vector3())).negate();
    this.raiz.add(m.opaco, m.vidrio, m.aristas);
    return m;
  }

  /** Rótulo de un compartimento: su nombre y, debajo, cuántas cosas lleva y lo que vence antes, del color de su urgencia. */
  private rotular(comp: Compartimento, lista: Elemento[]) {
    const masUrgente = lista.reduce<number | null>(
      (m, e) => (e.dias_para_vencer === null ? m : m === null ? e.dias_para_vencer : Math.min(m, e.dias_para_vencer)),
      null,
    );
    const sub = lista.length ? `${lista.length} · ${masUrgente === null ? "sin fecha" : `lo primero: ${textoDias(masUrgente)}`}` : "vacío";
    const color = lista.length ? this.colores[semaforo(masUrgente)] : this.colores["sin-fecha"];
    const firma = `${comp.nombre}|${sub}|${color.getHexString()}`;
    const previo = this.rotulos.find((r) => r.comp.clave === comp.clave);
    if (previo && previo.firma === firma) {
      previo.comp = comp;
      return;
    }
    if (previo) {
      this.escena.remove(previo.etiqueta.sprite);
      previo.etiqueta.destruir();
      this.rotulos = this.rotulos.filter((r) => r !== previo);
    }
    const e = new Etiqueta(comp.nombre, sub, "compartimento", `#${color.getHexString()}`);
    this.ajustarEtiqueta(e);
    this.escena.add(e.sprite);
    this.rotulos.push({ comp, etiqueta: e, firma });
  }

  /* ---------- Cuadro a cuadro ---------- */

  private arrancar() {
    if (this.raf || document.hidden || this.destruido) return;
    this.ultimo = performance.now();
    this.ventana.inicio = 0;
    this.ventana.cuadros = 0;
    this.ventana.ms = 0;
    this.raf = requestAnimationFrame(this.cuadro);
  }

  private readonly alCambiarVisibilidad = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.arrancar();
  };

  private readonly alPerderContexto = (ev: Event) => {
    ev.preventDefault();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.opciones.alFallar("se perdió el contexto WebGL");
  };

  private readonly cuadro = (ahora: number) => {
    this.raf = requestAnimationFrame(this.cuadro);
    const dt = clamp((ahora - this.ultimo) / 1000, 0, 0.05);
    this.ultimo = ahora;
    const t0 = performance.now();
    this.paso(dt);
    this.renderer.render(this.escena, this.camara);
    this.medir(ahora, performance.now() - t0);
  };

  /** De PYTHAGORAS: presupuesto del último cuadro y, cada 5 s, fps y ms de CPU por cuadro de esa ventana. */
  private medir(ahora: number, ms: number) {
    const r = this.estadisticas.rendimiento;
    const info = this.renderer.info.render;
    r.calls = info.calls;
    r.triangles = info.triangles;
    const v = this.ventana;
    if (v.inicio === 0) v.inicio = ahora;
    v.cuadros++;
    v.ms += ms;
    if (ahora - v.inicio >= VENTANA_MS) {
      r.fps = Math.round(((v.cuadros - 1) * 10000) / (ahora - v.inicio)) / 10;
      r.msCuadro = Math.round((v.ms / v.cuadros) * 100) / 100;
      v.inicio = ahora;
      v.cuadros = 1;
      v.ms = ms;
    }
  }

  private paso(dt: number) {
    this.rig.actualizar(dt, performance.now());
    this.escena.updateMatrixWorld();
    this.estadisticas.general = this.enGeneral;
    this.estadisticas.distancia = Math.round(this.camara.position.distanceTo(this.rig.objetivo) * 100) / 100;

    // LOD cada cuadro: la malla se compacta con las cercanas; las lejanas son solo su halo.
    const campo = this.campo;
    campo.empezar();
    const local = V2;
    for (const c of this.cosas) {
      local.copy(c.pos).sub(this.raiz.position);
      M1.makeScale(c.radio, c.radio, c.radio).setPosition(local);
      const celda = this.atlas.origen(c.celda, this.celdaUv);
      campo.poner(M1, c.color, this.conCuerpo(c.pos, c.radio), null, [celda.u, celda.v]);
    }
    campo.terminar();
    this.estadisticas.rendimiento.cuerpos = campo.cuerpos;
    this.estadisticas.rendimiento.halos = campo.halos;

    if (this.punteroCambio) this.actualizarHover();
    this.actualizarMarcador();
    this.actualizarEtiquetas(dt);
  }

  /** ¿Una cosa de radio r en p se ve con más de UMBRAL_CUERPO_PX de radio? (si no, basta su halo). */
  private conCuerpo(p: THREE.Vector3, r: number) {
    return (r * this.pxPorUnidad) / Math.max(1e-3, this.camara.position.distanceTo(p)) >= UMBRAL_CUERPO_PX;
  }

  private actualizarMarcador() {
    const c = this.seleccion !== null ? this.porId.get(this.seleccion) : undefined;
    this.marcador.visible = !!c;
    if (!c) return;
    this.marcador.position.copy(c.pos);
    this.marcador.quaternion.copy(this.camara.quaternion);
    // Con la cosa lejos (solo halo), el aro no baja de unos 12 px.
    const minimo = (12 * this.camara.position.distanceTo(c.pos)) / this.pxPorUnidad;
    this.marcador.scale.setScalar(Math.max(c.radio * 1.7, minimo));
  }

  /* ---------- Etiquetas ---------- */

  private etiquetas(): Etiqueta[] {
    const l = this.rotulos.map((r) => r.etiqueta);
    if (this.etiquetaHover) l.push(this.etiquetaHover.e);
    return l;
  }

  private ajustarEtiqueta(e: Etiqueta) {
    e.dibujar(this.dpr());
    e.escalar(2 / (this.camara.projectionMatrix.elements[5] * this.alto));
  }

  private redibujarEtiquetas() {
    for (const e of this.etiquetas()) this.ajustarEtiqueta(e);
  }

  /**
   * Como en PYTHAGORAS: cada etiqueta cuelga de su punto; se colocan por jerarquía (la del elemento señalado primero,
   * luego los rótulos, a igual rango lo más cercano) y, si una pisa a otra ya puesta o queda a menos de 14 px, se
   * aparta arriba o abajo de 2 en 2 px hasta 72; si no cabe, se oculta. Nunca dos comparten un píxel.
   */
  private actualizarEtiquetas(dt: number) {
    const arriba = V1.setFromMatrixColumn(this.camara.matrixWorld, 1).clone();
    const tan = Math.tan((FOV * RAD) / 2);
    const candidatas: { e: Etiqueta; caja: Caja; prof: number; nombre: string }[] = [];
    const base = new Map<Etiqueta, { pos: THREE.Vector3; mundoPorPx: number }>();
    const considerar = (e: Etiqueta, p: THREE.Vector3, r: number, nombre: string) => {
      const pos = p.clone().addScaledVector(arriba, -r * 1.18);
      const prof = -V2.copy(pos).applyMatrix4(this.camara.matrixWorldInverse).z;
      const mundoPorPx = (2 * Math.max(prof, 0.01) * tan) / this.alto;
      base.set(e, { pos, mundoPorPx });
      const v = V2.copy(pos).project(this.camara);
      if (prof <= 0 || v.z > 1) {
        e.objetivo = 0;
        return;
      }
      const sx = ((v.x + 1) / 2) * this.ancho;
      const sy = ((1 - v.y) / 2) * this.alto;
      const m = MARGEN_ETIQUETA_PX;
      candidatas.push({ e, prof, nombre, caja: { x0: sx - e.anchoCss / 2 + m, x1: sx + e.anchoCss / 2 - m, y0: sy + m, y1: sy + e.altoCss - m } });
    };
    for (const r of this.rotulos) considerar(r.etiqueta, r.comp.ancla.clone().add(this.raiz.position), 0, r.comp.nombre);
    if (this.etiquetaHover) {
      const c = this.porId.get(this.etiquetaHover.id);
      if (c) considerar(this.etiquetaHover.e, c.pos, Math.max(c.radio, (8 * this.camara.position.distanceTo(c.pos)) / this.pxPorUnidad), c.nombre);
    }
    candidatas.sort((a, b) => RANGO_ETIQUETA[b.e.estilo] - RANGO_ETIQUETA[a.e.estilo] || a.prof - b.prof);
    const puestas: Caja[] = [];
    const info = this.estadisticas.etiquetas;
    info.visibles = [];
    info.ocultas = [];
    for (const k of candidatas) {
      const d = colocarEtiqueta(k.caja, puestas, k.e.desplazamientoObjetivo);
      if (d === null) {
        k.e.objetivo = 0;
        info.ocultas.push(k.nombre);
        continue;
      }
      k.e.objetivo = 1;
      k.e.desplazamientoObjetivo = d;
      puestas.push(bajar(k.caja, d));
    }
    const vistas: Caja[] = [];
    for (const k of candidatas) {
      if (k.e.objetivo <= 0.01) continue;
      vistas.push(bajar(k.caja, k.e.desplazamiento));
      info.visibles.push(k.nombre);
    }
    let solapes = 0;
    let separacionMin = Infinity;
    for (let i = 0; i < vistas.length; i++) {
      for (let j = i + 1; j < vistas.length; j++) {
        const h = hueco(vistas[i], vistas[j]);
        if (h < 0) solapes++;
        separacionMin = Math.min(separacionMin, h);
      }
    }
    info.solapes = solapes;
    info.separacionMin = Number.isFinite(separacionMin) ? Math.round(separacionMin * 10) / 10 : null;
    for (const [e, b] of base) {
      e.avanzar(dt, this.reducido);
      e.sprite.position.copy(b.pos).addScaledVector(arriba, -e.desplazamiento * b.mundoPorPx);
    }
  }

  /* ---------- Puntero ---------- */

  /** De PYTHAGORAS (`elegir`): en espacio de pantalla, con tolerancia mínima en px; gana lo más centrado respecto a su tamaño. */
  private elegir(x: number, y: number): Cosa | null {
    const cam = this.camara.position;
    const tan = Math.tan((FOV * RAD) / 2);
    const tactil = window.matchMedia("(pointer: coarse)").matches;
    let mejor: Cosa | null = null;
    let mejorPuntos = Infinity;
    for (const c of this.cosas) {
      const v = V1.copy(c.pos).project(this.camara);
      if (v.z < -1 || v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * this.ancho;
      const sy = ((1 - v.y) / 2) * this.alto;
      const dist = cam.distanceTo(c.pos);
      const rpx = (c.radio / (dist * tan)) * (this.alto / 2);
      const tolerancia = Math.max(rpx * 1.15, tactil ? 22 : 14);
      const d = Math.hypot(sx - x, sy - y);
      if (d > tolerancia) continue;
      // A igual centrado, la más cercana a la cámara (la de delante tapa a la de atrás).
      const puntos = d / tolerancia + dist * 1e-3;
      if (puntos < mejorPuntos) {
        mejorPuntos = puntos;
        mejor = c;
      }
    }
    return mejor;
  }

  /** El compartimento bajo el puntero (el más cercano a la cámara cuya caja corta el rayo). */
  private compartimentoEn(x: number, y: number): Compartimento | null {
    const rayo = new THREE.Raycaster();
    rayo.setFromCamera(new THREE.Vector2((x / this.ancho) * 2 - 1, -(y / this.alto) * 2 + 1), this.camara);
    let mejor: Compartimento | null = null;
    let mejorD = Infinity;
    for (const c of this.mueble.compartimentos) {
      const punto = rayo.ray.intersectBox(c.caja.clone().translate(this.raiz.position), V2);
      if (!punto) continue;
      const d = punto.distanceTo(this.camara.position);
      if (d < mejorD) {
        mejorD = d;
        mejor = c;
      }
    }
    return mejor;
  }

  /** El nivel de un compartimento bajo el puntero (el más cercano a la cámara), o null si no tiene niveles. */
  private zonaEn(comp: Compartimento, x: number, y: number): number | null {
    const rayo = new THREE.Raycaster();
    rayo.setFromCamera(new THREE.Vector2((x / this.ancho) * 2 - 1, -(y / this.alto) * 2 + 1), this.camara);
    let mejor: number | null = null;
    let mejorD = Infinity;
    comp.zonas.forEach((z, i) => {
      const punto = rayo.ray.intersectBox(z.clone().translate(this.raiz.position), V2);
      if (!punto) return;
      const d = punto.distanceTo(this.camara.position);
      if (d < mejorD) {
        mejorD = d;
        mejor = i;
      }
    });
    return mejor;
  }

  /** Toque sin arrastre: una cosa abre su panel; fuera de las cosas, dentro de un compartimento, lo encuadra. */
  private readonly alTocar = (x: number, y: number) => {
    const c = this.elegir(x, y);
    if (c) {
      this.opciones.alElegir(c.id);
      return;
    }
    const comp = this.compartimentoEn(x, y);
    if (!comp) {
      this.opciones.alElegir(null);
      return;
    }
    // Con niveles (baldas), el nivel que corta el rayo.
    const zona = this.zonaEn(comp, x, y);
    this.encuadrarCompartimento(comp.clave, zona ?? undefined);
  };

  private actualizarHover() {
    this.punteroCambio = false;
    const c = this.puntero && !this.rig.arrastrando ? this.elegir(this.puntero.x, this.puntero.y) : null;
    this.lienzo.style.cursor = c ? "pointer" : "";
    this.estadisticas.hover = c?.id ?? null;
    if (!c) {
      this.quitarHover();
      return;
    }
    if (this.etiquetaHover?.id === c.id) return;
    this.quitarHover();
    const e = new Etiqueta(c.nombre, textoDias(c.dias), "elemento", `#${c.color.getHexString()}`);
    this.ajustarEtiqueta(e);
    this.escena.add(e.sprite);
    this.etiquetaHover = { id: c.id, e };
  }

  private quitarHover() {
    if (!this.etiquetaHover) return;
    this.escena.remove(this.etiquetaHover.e.sprite);
    this.etiquetaHover.e.destruir();
    this.etiquetaHover = null;
  }

  private enPantalla() {
    const lista: { id: number; x: number; y: number; r: number }[] = [];
    const tan = Math.tan((FOV * RAD) / 2);
    for (const c of this.cosas) {
      const v = V1.copy(c.pos).project(this.camara);
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      const rpx = (c.radio / (this.camara.position.distanceTo(c.pos) * tan)) * (this.alto / 2);
      lista.push({ id: c.id, x: Math.round(((v.x + 1) / 2) * this.ancho), y: Math.round(((1 - v.y) / 2) * this.alto), r: Math.round(rpx * 10) / 10 });
    }
    return lista;
  }

  private centroDe(clave: string, zona?: number) {
    const comp = this.mueble.compartimentos.find((c) => c.clave === clave);
    if (!comp) return null;
    const caja = zona !== undefined ? comp.zonas[zona] : comp.caja;
    if (!caja) return null;
    const v = caja.getCenter(V1).add(this.raiz.position).project(this.camara);
    return { x: Math.round(((v.x + 1) / 2) * this.ancho), y: Math.round(((1 - v.y) / 2) * this.alto) };
  }

  /* ---------- Tamaño y encuadre ---------- */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, this.ligero ? DPR_MAX.ligero : DPR_MAX.normal);
  }

  /** Distancia a la que un rectángulo de semiancho `w` y semialto `h` cabe en el lienzo. */
  private distanciaPara(w: number, h: number) {
    const tan = Math.tan((FOV * RAD) / 2);
    const aspecto = this.ancho / this.alto;
    return Math.max(h / tan, w / (tan * aspecto));
  }

  private distanciaGeneral() {
    const tam = this.mueble.caja.getSize(V1);
    return this.distanciaPara((tam.x / 2) * 1.06, (tam.y / 2) * 1.22) + tam.z / 2;
  }

  /** El encuadre inicial: el mueble entero, un poco desde la derecha (se ve el interior de la puerta) y desde arriba. */
  private vistaGeneral() {
    return { theta: 0.22, phi: 1.36, radio: this.distanciaGeneral() };
  }

  private redimensionar() {
    const r = this.contenedor.getBoundingClientRect();
    this.ancho = Math.max(1, Math.round(r.width));
    this.alto = Math.max(1, Math.round(r.height));
    const dpr = this.dpr();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.ancho, this.alto, false);
    const rend = this.estadisticas.rendimiento;
    rend.dpr = dpr;
    rend.lienzo = [this.lienzo.width, this.lienzo.height];
    this.camara.aspect = this.ancho / this.alto;
    this.camara.updateProjectionMatrix();
    const tan = Math.tan((FOV * RAD) / 2);
    this.uMundoPorPx.value = (2 * tan) / this.alto;
    this.pxPorUnidad = this.alto / (2 * tan);
    const k = 2 / (this.camara.projectionMatrix.elements[5] * this.alto);
    for (const e of this.etiquetas()) e.escalar(k);
    this.rig.tamano(this.ancho, this.alto);
    if (this.enGeneral) this.rig.reencuadrar(this.vistaGeneral(), new THREE.Vector3());
  }
}
