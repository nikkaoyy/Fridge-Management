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
// NEVERA-7: las cosas tienen forma (formas.ts, familias.json). El LOD de esferas y halos de PYTHAGORAS deja de hacer
// falta: los cuerpos son de pocos polígonos y se dibujan siempre (cinco InstancedMesh, una por forma), y la urgencia
// pasa a un aro fino. Las instancias no se mueven: se suben al cambiar la lista o al desplegar un montón, no cada
// cuadro. Las etiquetas fijas de lo más urgente y la pastilla de los montones usan el mismo resolvedor de solapes.
// NEVERA-9: el mueble tiene cuerpo (caras opacas en un tono neutro de la piel, bisel claro, vidrio transparente con
// canto) y la luz direccional viene de arriba a la izquierda de quien mira. Sin sombras dinámicas ni postproceso.
import * as THREE from "three";
import { semaforo, textoDias, type Semaforo, type Ubicaciones } from "../logica";
import type { Elemento } from "../tipos";
import { RigCamara } from "./camara";
import { agrupar, colocar, compartimentoDe, piezasDe, sigla, type ClaveCompartimento } from "./colocar";
import { bajar, colocarEtiqueta, Etiqueta, hueco, MARGEN_ETIQUETA_PX, RANGO_ETIQUETA, type Caja } from "./etiquetas";
import { factorTamano, familiaDe, FORMAS, medidas, nombreCorto, nombreGrupo, tonoDe, type Forma } from "./familias";
import { CuerposConForma, LADOS, Senales } from "./formas";
import { construirMueble, medidaExtra, NEVERA, type Compartimento, type Mueble } from "./mueble";
import { piel, type Token } from "./piel";
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
  /** Modo ligero: dpr ≤ 1,5, cuerpos de 7 lados en vez de 12 (LADOS de formas.ts), sin antialias si estaba activo al abrir. */
  modoLigero: boolean;
  /** Por qué: `pointer: coarse`, `devicePixelRatio ≥ 2`, `elegido a mano` o `escritorio` (no se activó). */
  motivoLigero: string;
  antialias: boolean;
  dpr: number;
  lienzo: [number, number];
  /** Piezas dibujadas (un montón son tres), sitios ocupados (una cosa o un montón) y cosas de la lista. */
  cuerpos: number;
  sitios: number;
  cosas: number;
  /** Piezas por forma y triángulos de una pieza de cada forma con la geometría de ahora. */
  formas: Record<Forma, number>;
  triangulosPorForma: Record<Forma, number>;
  /** «12 lados» o, en modo ligero, «7 lados». */
  geometria: string;
  /** Aros de urgencia, sombras de contacto y halos que laten (lo que vence en ≤ 2 días). */
  aros: number;
  sombras: number;
  pulsan: number;
  /** Celdas ocupadas del atlas de categorías (8×8 = 64). */
  atlas: number;
}

export interface InfoCompartimento {
  nombre: string;
  total: number;
  /** ids en orden de colocación, montones incluidos (el primero, el más urgente: delante, arriba, a la izquierda). */
  orden: number[];
  /** ids de la cosa que manda en cada sitio de la fila de delante. */
  frente: number[];
  /** Los sitios en orden: la cosa que manda, todas las que lleva y si es un montón. */
  sitios: { id: number; ids: number[]; monton: boolean; forma: Forma; superficie: number; fila: number }[];
  columnas: number;
  filas: number;
  superficies: number;
}

export interface InfoMonton {
  clave: string;
  compartimento: string;
  nombre: string;
  ids: number[];
  abierto: boolean;
}

export interface EstadisticasEscena {
  rendimiento: InfoRendimiento;
  compartimentos: Record<string, InfoCompartimento>;
  montones: InfoMonton[];
  /** La escena encuadra todo y nadie ha movido la cámara. */
  general: boolean;
  distancia: number;
  etiquetas: {
    visibles: string[];
    ocultas: string[];
    solapes: number;
    separacionMin: number | null;
    /** Etiquetas fijas con nombre que se ven ahora, y cuántas por balda («nevera#0»: 2). */
    nombres: string[];
    porBalda: Record<string, number>;
  };
  hover: number | null;
  seleccion: number | null;
  /** Dónde cae cada sitio en el lienzo ahora mismo (px CSS desde su esquina), para tocarlo desde fuera. */
  enPantalla: () => { id: number; x: number; y: number; r: number; monton: string | null; forma: Forma }[];
  /** Centro en pantalla de un compartimento o de uno de sus niveles (para tocarlo desde fuera). */
  centroDe: (clave: string, zona?: number) => { x: number; y: number } | null;
  /** Centro en pantalla de la pastilla de un montón, si se ve. */
  pastillaDe: (clave: string) => { x: number; y: number } | null;
  /** Lo último que se encuadró: «general», «nevera#0» (balda de arriba), «despensa#2», «puerta»… */
  encuadre: string;
  /** Encuadra un compartimento o una balda como si se tocara su hueco (para las pruebas: sin buscar dónde tocar). */
  encuadrar: (clave: string, zona?: number) => void;
  /** NEVERA-9: rectángulo en pantalla (px CSS desde la esquina del lienzo, recortado a él) de todo el mueble. */
  cajaMueble: () => { x0: number; y0: number; x1: number; y1: number };
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

/** Un sitio de la escena: una cosa o un montón. Lo que se toca, se etiqueta y lleva aro. */
interface Cosa {
  /** «nevera/123» o, si es un montón, su clave «nevera/papa|bolsa». */
  clave: string;
  id: number;
  ids: number[];
  /** Clave del montón si está plegado (tocarlo lo despliega). */
  monton: string | null;
  /** Clave del montón al que pertenece, si está desplegado. */
  desplegadaDe: string | null;
  comp: string;
  superficie: number;
  fila: number;
  columna: number;
  nombre: string;
  producto: string;
  dias: number | null;
  sem: Semaforo;
  forma: Forma;
  /** Centro de lo que ocupa y su base (mundo). */
  pos: THREE.Vector3;
  base: THREE.Vector3;
  ancho: number;
  alto: number;
  radio: number;
  colorAro: THREE.Color;
}

interface Rotulo {
  comp: Compartimento;
  etiqueta: Etiqueta;
  firma: string;
}

/** Una etiqueta que aparece y desaparece (nombre fijo, pastilla de montón, hover, selección). */
interface Flotante {
  e: Etiqueta;
  clave: string; // de la cosa
  arriba: boolean; // cuelga por encima de la cosa (pastilla) o por debajo (nombre)
  quiero: boolean;
  balda: string;
  caja: Caja | null; // dónde quedó en pantalla en el último cuadro (para tocar la pastilla)
  monton: string | null; // si es la pastilla de un montón («×3» o «plegar»), cuál
}

/** Una etiqueta flotante que toca ahora: qué dice, de quién cuelga y, si es la pastilla de un montón, cuál. */
interface Quiero {
  titulo: string;
  sub: string | null;
  estilo: "elemento" | "nombre" | "monton";
  color: string;
  cosa: Cosa;
  arriba: boolean;
  balda: string;
  monton: string | null;
}

const FOV = 40;
const RAD = Math.PI / 180;
const VENTANA_MS = 5000;
const DPR_MAX = { normal: 2, ligero: 1.5 };
/** Etiquetas fijas: hasta dos por compartimento de lejos y hasta tres por balda de cerca (o encuadrada). */
const NOMBRES_POR_COMPARTIMENTO = 2;
const NOMBRES_POR_BALDA = 3;
/** «De cerca»: la cosa que manda en la balda mide al menos esto de alto en pantalla. */
const CERCA_PX = 46;
/** Por debajo de esto una cosa no lleva etiqueta fija (no se sabría a quién señala). */
const MIN_ETIQUETA_PX = 9;
/** Opacidad del aro por urgencia: lo que vence fuerte, lo que va bien tenue. */
const OPACIDAD_ARO: Record<Semaforo, number> = { vencido: 1, urgente: 1, pronto: 0.85, bien: 0.5, "sin-fecha": 0.32 };
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const M1 = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
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
  private readonly cuerpos: CuerposConForma;
  private readonly senales: Senales;
  private readonly atlas = new AtlasCategorias();
  private readonly uMundoPorPx = { value: 0.001 };
  private readonly marcador: THREE.Mesh;
  private readonly colores: Record<Semaforo, THREE.Color>;
  private readonly tonos = new Map<string, THREE.Color>();
  private datos: DatosEscena | null = null;
  private cosas: Cosa[] = [];
  /** Cada id de elemento → el sitio donde se ve (un montón plegado es el sitio de todas sus cosas). */
  private readonly porId = new Map<number, Cosa>();
  private readonly porClave = new Map<string, Cosa>();
  /** Montones desplegados («nevera/papa|bolsa»). */
  private readonly abiertos = new Set<string>();
  private rotulos: Rotulo[] = [];
  private readonly flotantes = new Map<string, Flotante>();
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
  private hover: Cosa | null = null;
  private seleccion: number | null = null;
  private enGeneral = true;
  private destruido = false;
  /** Puntero grueso (dedo): sin hover ni etiquetas fijas, solo la de lo elegido. Se mira al cambiar de tamaño. */
  private tactil = false;

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
    const nada = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<Forma, number>;
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
        sitios: 0,
        cosas: 0,
        formas: { ...nada },
        triangulosPorForma: { ...nada },
        geometria: `${this.ligero ? LADOS.ligero : LADOS.normal} lados`,
        aros: 0,
        sombras: 0,
        pulsan: 0,
        atlas: 0,
      },
      compartimentos: {},
      montones: [],
      general: true,
      distancia: 0,
      etiquetas: { visibles: [], ocultas: [], solapes: 0, separacionMin: null, nombres: [], porBalda: {} },
      hover: null,
      seleccion: null,
      enPantalla: () => this.enPantalla(),
      centroDe: (clave, zona) => this.centroDe(clave, zona),
      pastillaDe: (clave) => this.pastillaDe(clave),
      encuadre: "general",
      encuadrar: (clave, zona) => this.encuadrarCompartimento(clave, zona),
      cajaMueble: () => this.cajaMueble(),
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
    // NEVERA-9: ambiente más bajo y la direccional desde arriba a la izquierda de quien mira (y algo por delante), para
    // que las caras del mueble se distingan entre sí: techo y lateral izquierdo claros, el derecho en penumbra.
    this.escena.add(new THREE.AmbientLight(new THREE.Color(p.muted), 0.9));
    const luz = new THREE.DirectionalLight(new THREE.Color(p.ink), 2.4);
    luz.position.set(-1.6, 3, 2.2);
    this.escena.add(luz);

    this.mueble = this.crearMueble([]);

    this.cuerpos = new CuerposConForma(materialAtlas(this.atlas.textura), 512, this.ligero);
    this.senales = new Senales(512, { sombra: new THREE.Color(p.void), mundoPorPx: this.uMundoPorPx });
    this.raiz.add(...Object.values(this.cuerpos.mallas), this.senales.sombras, this.senales.aros, this.senales.pulso);
    this.estadisticas.rendimiento.triangulosPorForma = this.cuerpos.triangulosPorForma();

    this.marcador = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.08, 48),
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
    this.datos = d;
    const porComp = new Map<ClaveCompartimento, Elemento[]>();
    for (const e of d.elementos) {
      const c = compartimentoDe(e, d.ubic);
      (porComp.get(c) ?? porComp.set(c, []).get(c)!).push(e);
    }
    const extras = [...porComp.keys()]
      .filter((k): k is `extra:${number}` => k.startsWith("extra:"))
      .map((k) => Number(k.slice(6)))
      .sort((a, b) => a - b)
      .map((id) => ({ id, nombre: d.ubic.porId.get(id)?.nombre ?? `ubicación ${id}`, n: porComp.get(`extra:${id}`)?.length ?? 0 }));
    const firma = extras.map((x) => `${x.id}:${x.nombre}:${JSON.stringify(medidaExtra(x.n))}`).join("|");
    if (firma !== this.firmaMueble) {
      this.raiz.remove(this.mueble.opaco, this.mueble.vidrio, this.mueble.aristas);
      for (const o of [this.mueble.opaco, this.mueble.vidrio, this.mueble.aristas]) o.geometry.dispose();
      this.mueble = this.crearMueble(extras);
      this.firmaMueble = firma;
      if (this.enGeneral) this.rig.reencuadrar(this.vistaGeneral(), new THREE.Vector3());
    }

    this.atlas.sincronizar(
      [...new Set(d.elementos.map((e) => `cat:${e.categoria_id ?? 0}`))],
      (clave) => sigla(d.categorias.get(Number(clave.slice(4)))),
    );
    this.estadisticas.rendimiento.atlas = this.atlas.ocupadas;

    // Las cosas que ya no están no dejan montones abiertos colgando.
    const vigentes = new Set<string>();
    const como = (e: Elemento) => {
      const forma = familiaDe(e.producto, d.categorias.get(e.categoria_id ?? -1));
      const m = medidas(forma);
      const f = factorTamano(e);
      return { forma, medidas: { ancho: m.ancho * f, alto: m.alto * f, fondo: m.fondo * f } };
    };
    const elementoDe = new Map(d.elementos.map((e) => [e.id, e]));
    this.cosas = [];
    this.porId.clear();
    this.porClave.clear();
    const info: Record<string, InfoCompartimento> = {};
    const montones: InfoMonton[] = [];
    const celdaUv = { u: 0, v: 0 };
    this.cuerpos.empezar();
    this.senales.empezar();
    for (const comp of this.mueble.compartimentos) {
      const lista = porComp.get(comp.clave) ?? [];
      const abiertosAqui = new Set([...this.abiertos].filter((k) => k.startsWith(`${comp.clave}/`)).map((k) => k.slice(comp.clave.length + 1)));
      const unidades = agrupar(lista, como, abiertosAqui);
      const { puestos, rejilla } = colocar(unidades, comp.superficies.map((s) => s.sup));
      info[comp.clave] = {
        nombre: comp.nombre,
        total: lista.length,
        orden: puestos.flatMap((p) => p.ids),
        frente: puestos.filter((p) => p.fila === 0).map((p) => p.id),
        sitios: puestos.map((p) => ({ id: p.id, ids: p.ids, monton: p.unidad.monton, forma: p.unidad.forma, superficie: p.superficie, fila: p.fila })),
        columnas: rejilla.columnas,
        filas: rejilla.filas,
        superficies: comp.superficies.length,
      };
      for (const p of puestos) {
        const u = p.unidad;
        const lider = elementoDe.get(p.id)!;
        const claveMonton = `${comp.clave}/${u.grupo}`;
        if (u.monton || u.desplegadaDe) {
          vigentes.add(claveMonton);
          let m = montones.find((x) => x.clave === claveMonton);
          if (!m) montones.push((m = { clave: claveMonton, compartimento: comp.clave, nombre: nombreGrupo(lider.producto), ids: [], abierto: !u.monton }));
          m.ids.push(...u.ids);
        }
        // Piezas: la matriz de la superficie (mueble) × la posición en ella × un giro leve (cajas y bolsas no van en
        // fila de soldados) × las medidas de la pieza.
        const sup = comp.superficies[p.superficie].matriz;
        const piezas = piezasDe(u.forma, u.monton ? u.ids.length : 1);
        let top = 0;
        let anchoTotal = p.ancho;
        piezas.forEach((pz, k) => {
          const e = elementoDe.get(u.ids[k] ?? u.id)!;
          const giro = u.forma === "caja" || u.forma === "bolsa" ? ((((e.id * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 0.32 : 0;
          M2.makeRotationY(giro).scale(V1.set(p.ancho, p.alto, p.fondo));
          M1.makeTranslation(p.x + pz.dx * p.ancho, pz.dy * p.alto, p.z + pz.dz * p.fondo).multiply(M2);
          M1.premultiply(sup);
          this.atlas.origen(`cat:${e.categoria_id ?? 0}`, celdaUv);
          this.cuerpos.poner(u.forma, M1, this.tonoCategoria(d.categorias.get(e.categoria_id ?? -1)), celdaUv.u, celdaUv.v);
          top = Math.max(top, (pz.dy + 1) * p.alto);
          anchoTotal = Math.max(anchoTotal, (Math.abs(pz.dx) * 2 + 1) * p.ancho);
        });
        const fondoTotal = piezas.reduce((m, pz) => Math.max(m, (Math.abs(pz.dz) * 2 + 1) * p.fondo), p.fondo);
        // Sombra de contacto: un disco algo mayor que lo que ocupa, en el plano de la balda.
        M1.makeTranslation(p.x, 0.002, p.z).multiply(M2.makeScale(anchoTotal * 0.68, 1, fondoTotal * 0.78)).premultiply(sup);
        this.senales.sombra(M1);
        // Centro y base en el mundo (el mueble está dentro de `raiz`, desplazado).
        const base = V1.set(p.x, 0, p.z).applyMatrix4(sup).clone();
        const centroLocal = V2.set(p.x, top / 2, p.z).applyMatrix4(sup).clone();
        const sem = semaforo(lider.dias_para_vencer);
        const n = u.monton ? u.ids.length : 1;
        const cosa: Cosa = {
          clave: u.monton ? claveMonton : `${comp.clave}/${p.id}`,
          id: p.id,
          ids: u.ids,
          monton: u.monton ? claveMonton : null,
          desplegadaDe: u.desplegadaDe ? claveMonton : null,
          comp: comp.clave,
          superficie: p.superficie,
          fila: p.fila,
          columna: p.columna,
          nombre: u.monton ? `${nombreGrupo(lider.producto)} ×${n}` : nombreCorto(lider.producto),
          producto: lider.producto,
          dias: lider.dias_para_vencer,
          sem,
          forma: u.forma,
          pos: centroLocal.clone().add(this.raiz.position),
          base: base.add(this.raiz.position),
          ancho: anchoTotal,
          alto: top,
          radio: Math.max(anchoTotal, top) / 2,
          colorAro: this.colores[sem],
        };
        // Aro de urgencia alrededor de lo que ocupa; y, si vence en ≤ 2 días, el halo que late.
        this.senales.aro(centroLocal, (anchoTotal * 1.18 + 0.014) / 0.9, (top * 1.1 + 0.014) / 0.9, cosa.colorAro, OPACIDAD_ARO[sem], sem === "vencido" || sem === "urgente");
        if (sem === "vencido" || sem === "urgente") this.senales.latir(centroLocal, Math.max(anchoTotal, top) * 0.6, cosa.colorAro);
        this.cosas.push(cosa);
        this.porClave.set(cosa.clave, cosa);
        for (const id of u.ids) this.porId.set(id, cosa);
      }
      this.rotular(comp, lista);
    }
    this.cuerpos.terminar();
    this.senales.terminar();
    for (const k of [...this.abiertos]) if (!vigentes.has(k)) this.abiertos.delete(k);
    const r = this.estadisticas.rendimiento;
    r.formas = this.cuerpos.conteo();
    r.cuerpos = Object.values(r.formas).reduce((a, b) => a + b, 0);
    r.sitios = this.cosas.length;
    r.cosas = d.elementos.length;
    Object.assign(r, this.senales.cuantos);
    this.estadisticas.compartimentos = info;
    this.estadisticas.montones = montones;
    if (this.hover && !this.porClave.has(this.hover.clave)) this.hover = null;
    this.punteroCambio = true;
    if (this.seleccion !== null && !this.porId.has(this.seleccion)) this.seleccionar(null);
  }

  seleccionar(id: number | null) {
    this.seleccion = id;
    this.estadisticas.seleccion = id;
  }

  /** Despliega o pliega un montón (lo que hace tocarlo o tocar su pastilla). */
  alternarMonton(clave: string) {
    if (this.abiertos.has(clave)) this.abiertos.delete(clave);
    else this.abiertos.add(clave);
    if (this.datos) this.actualizar(this.datos);
  }

  /** Pliega todos los montones desplegados. */
  plegar() {
    if (!this.abiertos.size) return;
    this.abiertos.clear();
    if (this.datos) this.actualizar(this.datos);
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
      tam.y = Math.min(tam.y, 0.3);
      centro.y = caja.min.y + 0.1;
    }
    // La puerta se mira de frente a su cara interior; el cajón y las baldas, algo desde arriba.
    const vista =
      comp.clave === "puerta"
        ? { theta: Math.atan2(Math.sin(NEVERA.apertura * RAD), -Math.cos(NEVERA.apertura * RAD)) - 0.15, phi: 1.3 }
        : comp.clave === "cajon"
          ? { theta: 0.1, phi: 0.95 }
          : nivel
            ? { theta: 0.12, phi: 1.18 }
            : { theta: 0.12, phi: 1.22 };
    const lado = Math.max(tam.x, tam.z * 0.8);
    const prof = Math.min(tam.z, 0.6) / 2;
    let radio = (this.distanciaPara(lado * 0.62, tam.y * 0.6) + prof) * (nivel ? 1.3 : 1);
    // En vertical (teléfono) manda el ancho: el nivel llena ~90 % del ancho y las cosas se leen.
    if (nivel && this.ancho < this.alto) radio = Math.min(radio, this.distanciaPara(lado * 0.5, 0) + prof * 0.5);
    this.rig.volarA({ ...vista, radio, objetivo: centro });
  }

  /** Modo ligero: dpr ≤ 1,5 y cuerpos de menos lados. El antialias solo cambia al volver a abrir. */
  setLigero(l: boolean, motivo: string) {
    this.estadisticas.rendimiento.motivoLigero = motivo;
    if (l === this.ligero) return;
    this.ligero = l;
    const r = this.estadisticas.rendimiento;
    r.modoLigero = l;
    r.geometria = `${l ? LADOS.ligero : LADOS.normal} lados`;
    this.cuerpos.setLigero(l);
    r.triangulosPorForma = this.cuerpos.triangulosPorForma();
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
    for (const f of this.flotantes.values()) f.e.destruir();
    this.flotantes.clear();
    for (const o of [this.mueble.opaco, this.mueble.vidrio, this.mueble.aristas]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    (this.cuerpos.mallas.caja.material as THREE.Material).dispose();
    this.cuerpos.destruir();
    this.senales.destruir();
    this.atlas.destruir();
    this.marcador.geometry.dispose();
    (this.marcador.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.lienzo.remove();
  }

  /* ---------- Construcción ---------- */

  /** El tono del cuerpo de una categoría: su token de la piel, mezclado si familias.json lo dice. */
  private tonoCategoria(categoria: string | undefined): THREE.Color {
    const clave = categoria ?? "";
    let c = this.tonos.get(clave);
    if (!c) {
      const p = piel();
      const t = tonoDe(categoria);
      c = new THREE.Color(p[t.token as Token] || p.muted);
      if (t.hacia) c.lerp(new THREE.Color(p[t.hacia as Token] || p.void), t.t ?? 0.5);
      this.tonos.set(clave, c);
    }
    return c;
  }

  private crearMueble(extras: { id: number; nombre: string; n: number }[]): Mueble {
    const p = piel();
    // NEVERA-9: bisel en tinta tenue y canto del vidrio en tinta: el mueble no tiene color propio (ni cian ni verde).
    const m = construirMueble(extras, {
      bisel: new THREE.Color(p.faint),
      alfaBisel: 0.5,
      canto: new THREE.Color(p.ink),
      alfaCanto: 0.55,
    });
    // Caras opacas: escriben profundidad (tapan lo de detrás, como un mueble) y se empujan un poco hacia atrás
    // (polygonOffset) para que el bisel, que cae justo en sus bordes, gane siempre. El tono: --ink-faint llevado
    // hacia --line-strong; con la luz física de three (albedo/π) queda un gris azulado oscuro, sin color propio. Un
    // token más oscuro (--line, --void-*) se perdía contra el fondo.
    m.opaco.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.faint).lerp(new THREE.Color(p.bordeFuerte), 0.45),
      roughness: 0.92,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    // Vidrio: transparencia real, sin escribir profundidad (no tapa lo que hay detrás); lo que se ve es su canto.
    m.vidrio.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.ink),
      roughness: 0.15,
      metalness: 0,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    });
    m.aristas.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    m.vidrio.renderOrder = 1;
    m.aristas.renderOrder = 1;
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
    this.paso(dt, ahora / 1000);
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

  private paso(dt: number, t: number) {
    this.rig.actualizar(dt, performance.now());
    this.escena.updateMatrixWorld();
    this.estadisticas.general = this.enGeneral;
    this.estadisticas.distancia = Math.round(this.camara.position.distanceTo(this.rig.objetivo) * 100) / 100;
    this.senales.avanzar(t, this.reducido);
    if (this.punteroCambio) this.actualizarHover();
    this.actualizarMarcador();
    this.actualizarEtiquetas(dt);
  }

  /** Alto en pantalla (px) de una cosa. */
  private altoPx(c: Cosa) {
    return (c.alto * this.pxPorUnidad) / Math.max(1e-3, this.camara.position.distanceTo(c.pos));
  }

  /** ¿Cae dentro del lienzo? */
  private enLienzo(p: THREE.Vector3) {
    const v = V2.copy(p).project(this.camara);
    return v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  }

  private actualizarMarcador() {
    const c = this.seleccion !== null ? this.porId.get(this.seleccion) : undefined;
    this.marcador.visible = !!c;
    if (!c) return;
    this.marcador.position.copy(c.pos);
    this.marcador.quaternion.copy(this.camara.quaternion);
    // Con la cosa lejos, el aro no baja de unos 12 px.
    const minimo = (12 * this.camara.position.distanceTo(c.pos)) / this.pxPorUnidad;
    this.marcador.scale.setScalar(Math.max(c.radio * 1.45, minimo));
  }

  /* ---------- Etiquetas ---------- */

  private etiquetas(): Etiqueta[] {
    return [...this.rotulos.map((r) => r.etiqueta), ...[...this.flotantes.values()].map((f) => f.e)];
  }

  private ajustarEtiqueta(e: Etiqueta) {
    e.dibujar(this.dpr());
    e.escalar(2 / (this.camara.projectionMatrix.elements[5] * this.alto));
  }

  private redibujarEtiquetas() {
    for (const e of this.etiquetas()) this.ajustarEtiqueta(e);
  }

  /**
   * Qué etiquetas flotantes tocan ahora (NEVERA-7):
   * - la de la cosa señalada con el ratón y la de la elegida (con su nombre entero y los días);
   * - en escritorio, el nombre corto de lo más urgente: de lejos, la primera cosa de las dos primeras baldas de cada
   *   compartimento; de cerca (o con la balda encuadrada), las tres primeras de cada balda. En un teléfono no hay
   *   etiquetas fijas: solo la de la elegida;
   * - la pastilla de cada montón («×4»), o «plegar» encima de la primera cosa de uno desplegado.
   */
  private quiero(): Map<string, Quiero> {
    const l = new Map<string, Quiero>();
    // La clave lleva todo lo que se pinta (texto, días, color): si algo cambia, es otra etiqueta y la vieja se apaga.
    // Así «×3» y «plegar» del mismo montón no comparten sprite, ni se queda un día viejo tras recargar la lista.
    const poner = (tipo: string, q: Quiero) => l.set(`${tipo}:${q.cosa.clave}|${q.titulo}|${q.sub ?? ""}|${q.color}`, q);
    const hex = (c: THREE.Color) => `#${c.getHexString()}`;
    const balda = (c: Cosa) => `${c.comp}#${c.superficie}`;
    const sub = (c: Cosa) => (c.monton ? `lo primero: ${textoDias(c.dias)}` : textoDias(c.dias));
    const sel = this.seleccion !== null ? this.porId.get(this.seleccion) : undefined;
    for (const c of [this.hover, sel]) {
      if (!c) continue;
      const titulo = c.monton ? `${c.nombre} · toca para desplegar` : c.producto;
      poner("e", { titulo, sub: sub(c), estilo: "elemento", color: hex(c.colorAro), cosa: c, arriba: false, balda: balda(c), monton: null });
    }
    if (!this.tactil) {
      const porComp = new Map<string, Cosa[]>();
      for (const c of this.cosas) (porComp.get(c.comp) ?? porComp.set(c.comp, []).get(c.comp)!).push(c);
      const [compEnc, zonaEnc] = this.enGeneral ? ["", ""] : this.estadisticas.encuadre.split("#");
      for (const [comp, lista] of porComp) {
        const porBalda = new Map<number, Cosa[]>();
        for (const c of lista) (porBalda.get(c.superficie) ?? porBalda.set(c.superficie, []).get(c.superficie)!).push(c);
        const baldas = [...porBalda.keys()].sort((a, b) => a - b);
        // De cerca: el compartimento encuadrado o, sin encuadre (la cámara se movió a mano), uno que se ve grande.
        // Con una balda encuadrada, solo esa lleva tres; las otras del compartimento, la primera.
        const enfocado = compEnc === comp;
        const cerca = enfocado || ((!compEnc || compEnc === "general") && lista.some((c) => c.fila === 0 && this.altoPx(c) >= CERCA_PX));
        const legible = (c: Cosa) => this.altoPx(c) >= MIN_ETIQUETA_PX && this.enLienzo(c.pos);
        const elegidas: Cosa[] = [];
        if (cerca) {
          for (const b of baldas) {
            const cuantas = enfocado && zonaEnc !== undefined && Number(zonaEnc) !== b ? 1 : NOMBRES_POR_BALDA;
            elegidas.push(...porBalda.get(b)!.filter(legible).slice(0, cuantas));
          }
        } else {
          for (const b of baldas.slice(0, NOMBRES_POR_COMPARTIMENTO)) {
            const c = porBalda.get(b)![0];
            if (legible(c)) elegidas.push(c);
          }
        }
        for (const c of elegidas) {
          if (c === this.hover || c === sel) continue;
          poner("n", { titulo: c.nombre, sub: textoDias(c.dias), estilo: "nombre", color: hex(c.colorAro), cosa: c, arriba: false, balda: balda(c), monton: null });
        }
      }
    }
    const plegar = new Set<string>();
    for (const c of this.cosas) {
      if (c.monton) {
        poner("m", { titulo: `×${c.ids.length}`, sub: null, estilo: "monton", color: hex(c.colorAro), cosa: c, arriba: true, balda: balda(c), monton: c.monton });
      } else if (c.desplegadaDe && !plegar.has(c.desplegadaDe)) {
        plegar.add(c.desplegadaDe);
        poner("m", { titulo: "plegar", sub: null, estilo: "monton", color: hex(c.colorAro), cosa: c, arriba: true, balda: balda(c), monton: c.desplegadaDe });
      }
    }
    return l;
  }

  /** Crea las flotantes que faltan, apaga las que sobran (se desvanecen) y borra las ya apagadas. */
  private sincronizarFlotantes() {
    const quiero = this.quiero();
    for (const [k, f] of this.flotantes) {
      const q = quiero.get(k);
      f.quiero = !!q;
      if (q) {
        f.clave = q.cosa.clave;
        f.balda = q.balda;
      }
      if (!q && f.e.opacidad <= 0.01) {
        this.escena.remove(f.e.sprite);
        f.e.destruir();
        this.flotantes.delete(k);
      }
    }
    for (const [k, q] of quiero) {
      if (this.flotantes.has(k)) continue;
      const e = new Etiqueta(q.titulo, q.sub, q.estilo, q.color);
      if (q.arriba) e.sprite.center.set(0.5, 0); // la pastilla se apoya encima de la cosa
      e.opacidad = 0;
      this.ajustarEtiqueta(e);
      this.escena.add(e.sprite);
      this.flotantes.set(k, { e, clave: q.cosa.clave, arriba: q.arriba, quiero: true, balda: q.balda, caja: null, monton: q.monton });
    }
  }

  /**
   * Como en PYTHAGORAS: cada etiqueta cuelga de su punto; se colocan por jerarquía (la señalada primero, luego las
   * pastillas, los rótulos y al final los nombres fijos; a igual rango lo más cercano) y, si una pisa a otra ya puesta
   * o queda a menos de 14 px, se aparta arriba o abajo de 2 en 2 px hasta 72; si no cabe, se oculta. Nunca dos
   * comparten un píxel.
   */
  private actualizarEtiquetas(dt: number) {
    this.sincronizarFlotantes();
    const arriba = V1.setFromMatrixColumn(this.camara.matrixWorld, 1).clone();
    const tan = Math.tan((FOV * RAD) / 2);
    type Candidata = { e: Etiqueta; caja: Caja; prof: number; nombre: string; f: Flotante | null };
    const candidatas: Candidata[] = [];
    const base = new Map<Etiqueta, { pos: THREE.Vector3; mundoPorPx: number }>();
    const considerar = (e: Etiqueta, p: THREE.Vector3, nombre: string, f: Flotante | null, haciaArriba: boolean) => {
      const pos = p.clone();
      const prof = -V2.copy(pos).applyMatrix4(this.camara.matrixWorldInverse).z;
      const mundoPorPx = (2 * Math.max(prof, 0.01) * tan) / this.alto;
      base.set(e, { pos, mundoPorPx });
      const v = V2.copy(pos).project(this.camara);
      if (prof <= 0 || v.z > 1 || (f && !f.quiero)) {
        e.objetivo = 0;
        if (f) f.caja = null;
        return;
      }
      const sx = ((v.x + 1) / 2) * this.ancho;
      const sy = ((1 - v.y) / 2) * this.alto;
      const m = MARGEN_ETIQUETA_PX;
      const y0 = haciaArriba ? sy - e.altoCss + m : sy + m;
      candidatas.push({ e, prof, nombre, f, caja: { x0: sx - e.anchoCss / 2 + m, x1: sx + e.anchoCss / 2 - m, y0, y1: y0 + e.altoCss - 2 * m } });
    };
    for (const r of this.rotulos) considerar(r.etiqueta, r.comp.ancla.clone().add(this.raiz.position), r.comp.nombre, null, false);
    for (const f of this.flotantes.values()) {
      const c = this.porClave.get(f.clave);
      if (!c) {
        // Su cosa ya no está (p. ej. un montón que se plegó): se desvanece donde estaba y luego se borra. Sin este
        // avanzar su opacidad no bajaba y la etiqueta quedaba dibujada para siempre.
        f.quiero = false;
        f.caja = null;
        f.e.objetivo = 0;
        f.e.avanzar(dt, this.reducido);
        continue;
      }
      // El nombre cuelga bajo la base (como el precio en el borde de la balda); la pastilla, sobre lo más alto.
      const d = this.camara.position.distanceTo(c.pos);
      const p = f.arriba
        ? c.pos.clone().addScaledVector(arriba, c.alto / 2 + (4 * d) / this.pxPorUnidad)
        : c.base.clone().addScaledVector(arriba, -(3 * d) / this.pxPorUnidad);
      const nombre = f.e.estilo === "monton" ? `${c.monton ? c.nombre : nombreGrupo(c.producto)} (pastilla «${f.e.titulo}»)` : f.e.estilo === "elemento" && !c.monton ? c.producto : c.nombre;
      considerar(f.e, p, nombre, f, f.arriba);
    }
    candidatas.sort((a, b) => RANGO_ETIQUETA[b.e.estilo] - RANGO_ETIQUETA[a.e.estilo] || a.prof - b.prof);
    const puestas: Caja[] = [];
    const info = this.estadisticas.etiquetas;
    info.visibles = [];
    info.ocultas = [];
    info.nombres = [];
    info.porBalda = {};
    for (const k of candidatas) {
      const d = colocarEtiqueta(k.caja, puestas, k.e.desplazamientoObjetivo);
      if (d === null) {
        k.e.objetivo = 0;
        if (k.f) k.f.caja = null;
        info.ocultas.push(k.nombre);
        continue;
      }
      k.e.objetivo = 1;
      k.e.desplazamientoObjetivo = d;
      const caja = bajar(k.caja, d);
      puestas.push(caja);
      if (k.f) k.f.caja = caja;
    }
    const vistas: Caja[] = [];
    for (const k of candidatas) {
      if (k.e.objetivo <= 0.01) continue;
      vistas.push(bajar(k.caja, k.e.desplazamiento));
      info.visibles.push(k.nombre);
      if (k.e.estilo === "nombre" && k.f) {
        info.nombres.push(k.nombre);
        info.porBalda[k.f.balda] = (info.porBalda[k.f.balda] ?? 0) + 1;
      }
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
    let mejor: Cosa | null = null;
    let mejorPuntos = Infinity;
    for (const c of this.cosas) {
      const v = V1.copy(c.pos).project(this.camara);
      if (v.z < -1 || v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * this.ancho;
      const sy = ((1 - v.y) / 2) * this.alto;
      const dist = cam.distanceTo(c.pos);
      const rpx = (c.radio / (dist * tan)) * (this.alto / 2);
      const tolerancia = Math.max(rpx * 1.1, this.tactil ? 22 : 14);
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

  /** La pastilla de montón bajo el puntero, si la hay (se toca antes que las cosas). */
  private pastillaEn(x: number, y: number): string | null {
    for (const f of this.flotantes.values()) {
      if (!f.monton || !f.quiero || !f.caja || f.e.opacidad < 0.3) continue;
      const m = 4;
      if (x >= f.caja.x0 - m && x <= f.caja.x1 + m && y >= f.caja.y0 - m && y <= f.caja.y1 + m) return f.monton;
    }
    return null;
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

  /**
   * Toque sin arrastre: la pastilla de un montón lo despliega o lo pliega; un montón plegado se despliega; una cosa
   * abre su panel; fuera de las cosas, dentro de un compartimento, lo encuadra; fuera de todo, cierra y pliega.
   */
  private readonly alTocar = (x: number, y: number) => {
    const pastilla = this.pastillaEn(x, y);
    if (pastilla) {
      this.alternarMonton(pastilla);
      return;
    }
    const c = this.elegir(x, y);
    if (c?.monton) {
      this.alternarMonton(c.monton);
      return;
    }
    if (c) {
      this.opciones.alElegir(c.id);
      return;
    }
    const comp = this.compartimentoEn(x, y);
    if (!comp) {
      this.opciones.alElegir(null);
      this.plegar();
      return;
    }
    // Con niveles (baldas), el nivel que corta el rayo.
    const zona = this.zonaEn(comp, x, y);
    this.encuadrarCompartimento(comp.clave, zona ?? undefined);
  };

  private actualizarHover() {
    this.punteroCambio = false;
    const c = this.puntero && !this.rig.arrastrando ? this.elegir(this.puntero.x, this.puntero.y) : null;
    const pastilla = this.puntero && !c ? this.pastillaEn(this.puntero.x, this.puntero.y) : null;
    this.lienzo.style.cursor = c || pastilla ? "pointer" : "";
    this.estadisticas.hover = c?.id ?? null;
    this.hover = c;
  }

  private enPantalla() {
    const lista: { id: number; x: number; y: number; r: number; monton: string | null; forma: Forma }[] = [];
    const tan = Math.tan((FOV * RAD) / 2);
    for (const c of this.cosas) {
      const v = V1.copy(c.pos).project(this.camara);
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      const rpx = (c.radio / (this.camara.position.distanceTo(c.pos) * tan)) * (this.alto / 2);
      lista.push({
        id: c.id,
        x: Math.round(((v.x + 1) / 2) * this.ancho),
        y: Math.round(((1 - v.y) / 2) * this.alto),
        r: Math.round(rpx * 10) / 10,
        monton: c.monton,
        forma: c.forma,
      });
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

  /** NEVERA-9: el rectángulo en pantalla de las 8 esquinas de la caja del mueble, recortado al lienzo. */
  private cajaMueble() {
    const b = this.mueble.caja.clone().translate(this.raiz.position);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const v = V1.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camara);
      const sx = ((v.x + 1) / 2) * this.ancho;
      const sy = ((1 - v.y) / 2) * this.alto;
      x0 = Math.min(x0, sx);
      y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx);
      y1 = Math.max(y1, sy);
    }
    const r = (v: number, max: number) => Math.round(clamp(v, 0, max));
    return { x0: r(x0, this.ancho), y0: r(y0, this.alto), x1: r(x1, this.ancho), y1: r(y1, this.alto) };
  }

  private pastillaDe(clave: string) {
    const f = [...this.flotantes.values()].find((x) => x.monton === clave && x.quiero);
    if (!f?.caja || f.e.opacidad < 0.3) return null;
    return { x: Math.round((f.caja.x0 + f.caja.x1) / 2), y: Math.round((f.caja.y0 + f.caja.y1) / 2) };
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
    this.tactil = window.matchMedia?.("(pointer: coarse)").matches ?? false;
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
