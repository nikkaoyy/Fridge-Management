// PEDIDO-NEVERA-9: la sonda de la vista 3D y una captura, en una línea JSON. SOLO LEE (no crea filas): sirve igual
// contra la base de antes (un worktree de 6f4ade7) que contra lo nuevo, para comparar la misma vista.
//
//   node scripts/sonda_3d.mjs http://127.0.0.1:8463 /tmp/nevera9/admin.token /tmp/nevera9/capturas/x.png
//        [--ancho=1440] [--alto=900] [--movil] [--fps] [--encuadre=despensa] [--solo-mueble]
//
// - Escritorio: escala 1, ratón fuera del lienzo (su etiqueta sería una call más). --movil: táctil, escala 3.
// - Espera a que la escena esté quieta (vuelo terminado, fuentes cargadas) y lee `window.__nevera.rendimiento`;
//   con --fps descarta la ventana de 5 s abierta y espera una entera (los fps de SwiftShader solo sirven para
//   comparar, no son de una GPU).
// - Si la escena expone `cajaMueble()` (NEVERA-9), devuelve el rectángulo en px de captura de todo el mueble, para
//   medir con `medir_png.py --caja`. La misma caja vale para la captura de antes si la cámara es la misma.
// - --solo-mueble: pone `window.__soloMueble = true` antes de la captura. Solo hace algo en un build con el parche de
//   medición (no está en el repo: oculta cosas, aros, sombras y rótulos para medir el mueble solo); `soloMueble` dice
//   si de verdad se aplicó (las calls bajan a las del mueble).
// - El encabezado de la vista («81 cosas · 45 vencidas…») se lee del DOM tal cual.
import { readFileSync } from "node:fs";
import { abrir } from "./navegador.mjs";

const [BASE0, TOKF, CAPTURA] = process.argv.slice(2);
const BASE = BASE0.replace(/\/$/, "");
const TOKEN = readFileSync(TOKF, "utf8").trim();
const opt = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split("=")[1];
const MOVIL = process.argv.includes("--movil");
const ANCHO = Number(opt("ancho", MOVIL ? 390 : 1440));
const ALTO = Number(opt("alto", MOVIL ? 844 : 900));
const ESCALA = MOVIL ? 3 : 1;
const ENCUADRE = opt("encuadre", "");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const nav = await abrir({ ancho: ANCHO, alto: ALTO, escala: ESCALA, movil: MOVIL, webgl: true });
try {
  await nav.ir(BASE + "/");
  await nav.esperar("!!document.querySelector('#f-token') || (window.__nevera && window.__nevera.listo)", 15000);
  if (await nav.evaluar("!!document.querySelector('#f-token')")) {
    await nav.evaluar(`(() => { const i = document.querySelector('#token');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(TOKEN)});
      i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#f-token').requestSubmit(); return true; })()`);
  }
  await nav.esperar("window.__nevera && window.__nevera.listo", 15000);
  await nav.tocar("#vista-nevera");
  await nav.esperar("window.__nevera.vista === 'nevera' && window.__nevera.rendimiento && window.__nevera.rendimiento.calls > 0", 20000);
  await nav.evaluar("document.fonts.ready.then(() => true)");
  if (!MOVIL) await nav.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  if (ENCUADRE) {
    const [clave, zona] = ENCUADRE.split("#");
    await nav.evaluar(`(window.__nevera.escena.encuadrar(${JSON.stringify(clave)}${zona !== undefined ? `, ${Number(zona)}` : ""}), true)`);
  }
  if (process.argv.includes("--solo-mueble")) await nav.evaluar("(window.__soloMueble = true, true)");
  await espera(2500);
  await nav.pintado();
  if (process.argv.includes("--fps")) {
    for (let i = 0; i < 2; i++) {
      await nav.evaluar("(window.__nevera.rendimiento.fps = null, true)");
      await nav.esperar("window.__nevera.rendimiento.fps !== null", 20000);
    }
  }
  const sonda = await nav.evaluar(`(() => {
    const e = window.__nevera.escena, r = window.__nevera.rendimiento;
    const marco = document.querySelector('.escena').getBoundingClientRect();
    const caja = typeof e.cajaMueble === 'function' ? e.cajaMueble() : null;
    return JSON.parse(JSON.stringify({
      rendimiento: r, encuadre: e.encuadre, general: e.general, distancia: e.distancia,
      etiquetas: e.etiquetas, marco: { x: marco.left, y: marco.top, w: marco.width, h: marco.height },
      cajaMueble: caja, encabezado: document.querySelector('.resumen-3d')?.textContent ?? null,
    }));
  })()`);
  if (CAPTURA) await nav.captura(CAPTURA);
  // la caja del mueble, en px de la captura (escala incluida)
  if (sonda.cajaMueble) {
    const c = sonda.cajaMueble, m = sonda.marco;
    sonda.cajaCaptura = [c.x0 + m.x, c.y0 + m.y, c.x1 + m.x, c.y1 + m.y].map((v) => Math.round(v * ESCALA));
  }
  sonda.soloMueble = process.argv.includes("--solo-mueble") ? sonda.rendimiento.calls <= 4 : false;
  sonda.vista = { ancho: ANCHO, alto: ALTO, escala: ESCALA, movil: MOVIL, captura: CAPTURA || null };
  sonda.consola = nav.consola.filter((l) => !/GPU stall|swiftshader|WebGL-|GL Driver Message/i.test(l));
  console.log(JSON.stringify(sonda));
} finally {
  await nav.cerrar();
}
