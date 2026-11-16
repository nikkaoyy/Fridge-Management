// PEDIDO-NEVERA-7, bloque 3: la misma vista antes y después de dar forma a las cosas. SOLO LEE: se puede correr
// contra el 8451 (la base real) y la deja idéntica (lo comprueba al final con la huella de la lista).
//
//   node scripts/elementos7_pantalla.mjs http://127.0.0.1:8451 data/admin.token docs antes
//   node scripts/elementos7_pantalla.mjs http://127.0.0.1:8451 data/admin.token docs despues
//
// Qué hace, igual en las dos fases (para que la comparación sea de la misma vista):
// 1. Escritorio 1280×860: entra, pasa a «Nevera», espera a que la escena esté quieta, saca el ratón del lienzo y
//    captura la vista general → <docs>/elementos-7-<fase>.png. Mide calls/triángulos/fps de la vista general, de
//    cerca (la balda de arriba de la nevera y el frutero) y con el modo ligero.
// 2. Móvil 390×844 ×3 (táctil, ligero automático): fps de la vista general y de la balda de la despensa; captura
//    <docs>/elementos-7-movil-<fase>.png.
// 3. La base sigue igual. Al final, una línea CIFRAS con todo en JSON.
// WebGL por SwiftShader (sin GPU): los fps son de CPU y solo sirven para comparar las dos fases entre sí.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { abrir } from "./navegador.mjs";

const BASE = (process.argv[2] || "http://127.0.0.1:8451").replace(/\/$/, "");
const TOKEN = readFileSync(process.argv[3] || "data/admin.token", "utf8").trim();
const DOCS = process.argv[4] || "docs";
const FASE = process.argv[5] || "despues";

let fallos = 0;
const ok = (cond, texto) => { console.log((cond ? "OK    " : "FALLA ") + texto); if (!cond) fallos++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(ruta) {
  const r = await fetch(BASE + ruta, { headers: { Authorization: "Bearer " + TOKEN } });
  if (!r.ok) throw new Error(`GET ${ruta}: ${r.status}`);
  return r.json();
}
const huella = (lista) => createHash("sha256").update(JSON.stringify(lista.map((e) =>
  [e.id, e.saldo, e.vencimiento, e.vencimiento_origen, e.abierto_en, e.ubicacion_id]))).digest("hex").slice(0, 16);
const medir = (ruta) => execFileSync(".venv/bin/python", ["-I", "scripts/medir_png.py", ruta], { encoding: "utf8" }).trim();

const [els, ubis, movs] = await Promise.all([api("/elementos"), api("/ubicaciones"), api("/movimientos")]);
const huellaInicio = huella(els);
const porUbic = {};
for (const e of els) porUbic[ubis.find((u) => u.id === e.ubicacion_id)?.nombre] = (porUbic[ubis.find((u) => u.id === e.ubicacion_id)?.nombre] ?? 0) + 1;
console.log(`fase ${FASE} — base: ${els.length} elementos (${Object.entries(porUbic).map(([k, v]) => `${k} ${v}`).join(", ")}), ${movs.length} movimientos, huella ${huellaInicio}`);
const frutero = ubis.find((u) => u.nombre === "frutero");

async function entrar(nav) {
  await nav.ir(BASE + "/");
  await nav.esperar("!!document.querySelector('#f-token') || (window.__nevera && window.__nevera.listo)", 15000);
  if (await nav.evaluar("!!document.querySelector('#f-token')")) {
    await nav.evaluar(`(() => { const i = document.querySelector('#token');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(TOKEN)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#f-token').requestSubmit(); return true; })()`);
  }
  await nav.esperar("window.__nevera && window.__nevera.listo", 15000);
  await nav.evaluar("document.fonts.ready.then(() => true)");
  await nav.tocar("#vista-nevera");
  await nav.esperar("window.__nevera.vista === 'nevera' && window.__nevera.rendimiento && window.__nevera.rendimiento.calls > 0", 20000);
  await nav.evaluar("document.fonts.ready.then(() => true)");
}
const rend = (nav) => nav.evaluar("JSON.parse(JSON.stringify(window.__nevera.rendimiento))");
async function esperarFps(nav) {   // ventana de 5 s limpia (se descarta la que estaba abierta)
  if (!nav.movil) await nav.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  for (let i = 0; i < 2; i++) {
    await nav.evaluar("(window.__nevera.rendimiento.fps = null, true)");
    await nav.esperar("window.__nevera.rendimiento.fps !== null", 15000);
  }
  return rend(nav);
}
async function quieta(nav) { await espera(1400); await nav.pintado(); }
async function lienzo(nav) {
  return nav.evaluar("(() => { const r = document.querySelector('.escena').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
}
async function clic(nav, x, y) {
  for (const type of ["mousePressed", "mouseReleased"]) await nav.cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
async function toque(nav, x, y) {
  await nav.cmd("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await nav.cmd("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
/** Encuadra un compartimento (o un nivel) tocando su hueco lejos de las cosas; si no hay hueco libre, por la sonda. */
async function encuadrar(nav, clave, zona, tocarCon) {
  const l = await lienzo(nav);
  const z = zona === undefined ? "undefined" : zona;
  const p = await nav.evaluar(`(() => { const e = window.__nevera.escena; const c = e.centroDe(${JSON.stringify(clave)}, ${z});
    if (!c) return null; const cosas = e.enPantalla(); let y = c.y;
    for (let i = 0; i < 40 && cosas.some((k) => Math.hypot(k.x - c.x, k.y - y) < Math.max(30, k.r + 12)); i++) y -= 4;
    return { x: c.x, y }; })()`);
  if (p) await tocarCon(nav, l.x + p.x, l.y + p.y);
  await quieta(nav);
  let enc = await nav.evaluar("window.__nevera.escena.encuadre");
  const quiero = zona === undefined ? clave : `${clave}#${zona}`;
  if (enc !== quiero && (await nav.evaluar("typeof window.__nevera.escena.encuadrar === 'function'"))) {
    await nav.evaluar(`(window.__nevera.escena.encuadrar(${JSON.stringify(clave)}, ${z}), true)`);
    await quieta(nav);
    enc = await nav.evaluar("window.__nevera.escena.encuadre") + " (por la sonda)";
  }
  return enc;
}
// Antes (NEVERA-6) la sonda contaba esferas/halos; después, piezas, sitios y formas: se dice lo que haya.
const cuerpos = (r) => (r.halos !== undefined ? `esferas ${r.cuerpos}, halos ${r.halos}` : `piezas ${r.cuerpos} en ${r.sitios} sitios (${Object.entries(r.formas).map(([f, n]) => `${f} ${n}`).join(", ")})`);
const resumen = (r) => `calls ${r.calls}, triangles ${r.triangles}, ${cuerpos(r)}, dpr ${r.dpr}, lienzo ${r.lienzo.join("×")}, fps ${r.fps}, ms/cuadro ${r.msCuadro}`;
const cifras = {};
const soloGet = (nav) => nav.peticiones.filter((p) => p.url.startsWith(BASE) && !p.url.includes("/assets/") && !p.url.includes("/fonts/")).every((p) => p.metodo === "GET");
const enPresupuesto = (r) => r.calls <= 150 && r.triangles <= 300000;
let gets = true;

// ------------------------------------------------------------------ 1. escritorio
const esc = await abrir({ ancho: 1280, alto: 860, escala: 1, movil: false, webgl: true });
esc.movil = false;
try {
  await entrar(esc);
  if (await esc.evaluar("window.__nevera.rendimiento.modoLigero")) await esc.tocar("#modo-ligero");
  await quieta(esc);
  let r = await esperarFps(esc);
  cifras.general = r;
  ok(enPresupuesto(r), `vista general: ${resumen(r)}`);
  await quieta(esc);
  await esc.captura(`${DOCS}/elementos-7-${FASE}.png`);
  console.log(`      ${DOCS}/elementos-7-${FASE}.png: ${medir(`${DOCS}/elementos-7-${FASE}.png`)}`);
  const etq = await esc.evaluar("JSON.parse(JSON.stringify(window.__nevera.escena.etiquetas))");
  console.log(`      etiquetas sin ratón: ${etq.visibles.length} visibles (${etq.visibles.join(", ")}), solapes ${etq.solapes}`);
  ok(etq.solapes === 0, "vista general: ninguna etiqueta pisa a otra");

  await esc.tocar("#modo-ligero");
  r = await esperarFps(esc);
  cifras.generalLigero = r;
  ok(enPresupuesto(r) && r.modoLigero, `vista general, modo ligero: ${resumen(r)}`);
  await esc.tocar("#modo-ligero");

  let enc = await encuadrar(esc, "nevera", 0, clic);
  r = await esperarFps(esc);
  cifras.baldaNevera = r;
  ok(enPresupuesto(r), `balda de arriba de la nevera (${enc}): ${resumen(r)}`);
  await esc.captura(`${DOCS}/elementos-7-balda-${FASE}.png`);
  await esc.tocar("#modo-ligero");
  r = await esperarFps(esc);
  cifras.baldaNeveraLigero = r;
  ok(enPresupuesto(r), `la misma balda, modo ligero: ${resumen(r)}`);
  await esc.tocar("#modo-ligero");

  if (frutero) {
    await esc.tocar("#encuadre");
    await quieta(esc);
    enc = await encuadrar(esc, `extra:${frutero.id}`, await esc.evaluar(`(window.__nevera.escena.centroDe("extra:${frutero.id}", 0) ? 0 : undefined)`) ?? undefined, clic);
    r = await esperarFps(esc);
    cifras.frutero = r;
    ok(enPresupuesto(r), `el frutero de cerca (${enc}): ${resumen(r)}`);
    await esc.captura(`${DOCS}/elementos-7-frutero-${FASE}.png`);
  }
  gets &&= soloGet(esc);
  const exc = esc.consola.filter((x) => x.startsWith("EXCEPCIÓN"));
  ok(exc.length === 0, `escritorio sin excepciones (${exc.length})${exc.length ? ": " + exc.slice(0, 3).join(" | ") : ""}`);
} finally {
  await esc.cerrar();
}

// ------------------------------------------------------------------ 2. móvil
const mov = await abrir({ ancho: 390, alto: 844, escala: 3, movil: true, webgl: true });
mov.movil = true;
try {
  await entrar(mov);
  await quieta(mov);
  let r = await esperarFps(mov);
  cifras.movil = r;
  ok(enPresupuesto(r) && r.modoLigero, `móvil 390×844, vista general (ligero automático): ${resumen(r)}`);
  await mov.captura(`${DOCS}/elementos-7-movil-${FASE}.png`);
  console.log(`      ${DOCS}/elementos-7-movil-${FASE}.png: ${medir(`${DOCS}/elementos-7-movil-${FASE}.png`)}`);
  const enc = await encuadrar(mov, "despensa", 0, toque);
  r = await esperarFps(mov);
  cifras.movilDespensa = r;
  ok(enPresupuesto(r), `móvil, balda de arriba de la despensa (${enc}): ${resumen(r)}`);
  await mov.captura(`${DOCS}/elementos-7-movil-despensa-${FASE}.png`);
  gets &&= soloGet(mov);
} finally {
  await mov.cerrar();
}

ok(gets, "la página solo hizo GET");
const [fin, movsFin] = await Promise.all([api("/elementos"), api("/movimientos")]);
ok(fin.length === els.length && movsFin.length === movs.length && huella(fin) === huellaInicio,
   `la base queda como estaba: ${fin.length} elementos, ${movsFin.length} movimientos, huella ${huella(fin)}`);
console.log("\nCIFRAS " + JSON.stringify(Object.fromEntries(Object.entries(cifras).map(([k, r]) =>
  [k, { calls: r.calls, triangles: r.triangles, cuerpos: r.cuerpos, halos: r.halos, sitios: r.sitios, fps: r.fps, msCuadro: r.msCuadro, dpr: r.dpr, modoLigero: r.modoLigero, lienzo: r.lienzo }]))));
console.log(fallos ? `ELEMENTOS 7: ${fallos} FALLA(S)` : "ELEMENTOS 7 OK");
process.exit(fallos ? 1 : 0);
