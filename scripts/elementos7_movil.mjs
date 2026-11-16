// PEDIDO-NEVERA-7, bloque 3: fps del móvil 390×844 (×3, táctil, ligero automático) en la vista general y con la balda
// de arriba de la despensa encuadrada POR TOQUE, con el mismo método en la base de antes y en lo nuevo (el motor de
// NEVERA-6 no tenía `encuadrar` en la sonda, y con 37 cosas en la despensa el primer toque puede caer en una cosa:
// se prueban varios puntos del hueco y, si se abre una tarjeta, se cierra). SOLO LEE. Una línea JSON por pasada y la
// captura en /tmp. Para comparar, intercalar pasadas antes/después: los fps de SwiftShader dependen de la carga.
//
//   node scripts/elementos7_movil.mjs http://127.0.0.1:8451 data/admin.token          # lo nuevo (base real)
//   node scripts/elementos7_movil.mjs http://127.0.0.1:8452 data/admin.token          # la base 074a559 en una copia
import { readFileSync } from "node:fs";
import { abrir } from "./navegador.mjs";
const [BASE, TOKF] = process.argv.slice(2);
const TOKEN = readFileSync(TOKF, "utf8").trim();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const nav = await abrir({ ancho: 390, alto: 844, escala: 3, movil: true, webgl: true });
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
  await espera(1500);
  for (let i = 0; i < 2; i++) {
    await nav.evaluar("(window.__nevera.rendimiento.fps = null, true)");
    await nav.esperar("window.__nevera.rendimiento.fps !== null", 15000);
  }
  const fpsGeneral = await nav.evaluar("window.__nevera.rendimiento.fps");
  const l = await nav.evaluar("(() => { const r = document.querySelector('.escena').getBoundingClientRect(); return { x: r.left, y: r.top }; })()");
  const c = await nav.evaluar("window.__nevera.escena.centroDe('despensa', 0)");
  let enc = "", intentos = 0;
  for (const [dx, dy] of [[0, -14], [0, -20], [-20, -16], [20, -16], [0, -8], [-30, -12], [30, -12], [0, -26], [-10, -22], [10, -22]]) {
    intentos++;
    const x = l.x + c.x + dx, y = l.y + c.y + dy;
    await nav.cmd("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await nav.cmd("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await espera(1400);
    enc = await nav.evaluar("window.__nevera.escena.encuadre");
    if (enc === "despensa#0") break;
    if (await nav.evaluar("!!document.querySelector('#cerrar-panel')")) { await nav.tocar("#cerrar-panel"); await espera(400); }
    if (enc !== "general") { await nav.tocar("#encuadre"); await espera(1400); }
  }
  for (let i = 0; i < 2; i++) {
    await nav.evaluar("(window.__nevera.rendimiento.fps = null, true)");
    await nav.esperar("window.__nevera.rendimiento.fps !== null", 15000);
  }
  const r = await nav.evaluar("JSON.parse(JSON.stringify(window.__nevera.rendimiento))");
  console.log(JSON.stringify({ fpsGeneral, encuadre: enc, intentos, calls: r.calls, triangles: r.triangles, fps: r.fps, msCuadro: r.msCuadro, dpr: r.dpr, modoLigero: r.modoLigero }));
  await nav.captura(`/tmp/elementos7-movil-despensa-${BASE.slice(-4)}.png`);
} finally { await nav.cerrar(); }
