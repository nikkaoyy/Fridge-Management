// La nevera en 3D en Chrome (PEDIDO-NEVERA-6, bloques 2 y 3). SOLO LEE salvo con --escribe (y entonces se niega a
// correr contra el 8451).
//
//   node scripts/nevera3d_pantalla.mjs http://127.0.0.1:8451 data/admin.token docs            # base real, solo lee
//   node scripts/nevera3d_pantalla.mjs http://127.0.0.1:8452 data/admin.token /tmp --escribe  # copia desechable
//
// WebGL por software (SwiftShader): la máquina no tiene GPU. Los fps que salen son de render por CPU en un servidor,
// no de un teléfono; sirven para comparar (antes/después del modo ligero), no como promesa.
//
// 1. Escritorio 1280×860: entra con el token por el formulario, pasa a «Nevera» con un toque y coteja la escena con
//    la API: cuántas cosas hay en cada compartimento y en qué orden (el de la lista: vencidos primero, luego por días);
//    la fila de delante es la de lo más urgente. Presupuesto (≤ 150 calls, ≤ 300 000 triángulos), LOD (ninguna esfera
//    en la vista general) y la sonda window.__nevera.rendimiento antes y después del modo ligero, en la vista general
//    y con una balda encuadrada. Capturas: <docs>/nevera3d-6.png y <docs>/nevera3d-detalle-6.png.
//    Ratón encima de una cosa → etiqueta con nombre y días, sin solapes. Clic → el panel con la tarjeta de la lista
//    (nombre, cantidad, dónde, días, Abrí/Se acabó/Botar/Fecha); «Fecha» abre su confirmación y «No» la cierra.
//    Recargar: la app vuelve sola a la nevera (localStorage).
// 2. Móvil emulado 390×844 (escala 3, táctil): modo ligero automático por `pointer: coarse`, fps, toque en una cosa →
//    hoja con la tarjeta. Capturas <docs>/nevera3d-movil-6.png y <docs>/nevera3d-movil-panel-6.png. Y el antes: fps
//    con el modo ligero apagado a mano.
// 3. Sin WebGL (Chrome con --disable-webgl): el interruptor dice por qué y se queda en la lista; con la nevera
//    guardada, abre en la lista y lo dice UNA vez (al recargar ya no).
// 4. --escribe (solo en la copia): «Abrí» y «Se acabó» desde el panel de la escena; la cosa acabada sale de la escena.
// Al final (sin --escribe): la página solo hizo GET y la base sigue igual.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { abrir } from "./navegador.mjs";

const BASE = (process.argv[2] || "http://127.0.0.1:8451").replace(/\/$/, "");
const TOKEN = readFileSync(process.argv[3] || "data/admin.token", "utf8").trim();
const DOCS = process.argv[4] || "docs";
const ESCRIBE = process.argv.includes("--escribe");
if (ESCRIBE && /:8451$/.test(BASE)) { console.error("--escribe crea filas: no se corre contra el 8451 (servicio real)"); process.exit(1); }

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

// ------------------------------------------------------------------ lo que la escena tiene que mostrar, desde la API
const [els, ubis, movs] = await Promise.all([api("/elementos"), api("/ubicaciones"), api("/movimientos")]);
const huellaInicio = huella(els);
console.log(`base: ${els.length} elementos, ${movs.length} movimientos, huella ${huellaInicio}${ESCRIBE ? " — modo --escribe" : " — solo lee"}`);
const porId = new Map(ubis.map((u) => [u.id, u]));
const normal = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function raiz(id) { let u = porId.get(id); for (let v = 0; u && u.padre_id !== null && v < 20; v++) u = porId.get(u.padre_id); return u; }
function compartimento(e) {   // la regla de D2 (a), escrita otra vez aquí para no fiarse de la de la escena
  const r = raiz(e.ubicacion_id);
  if (normal(r?.nombre) === "nevera") {
    for (let u = porId.get(e.ubicacion_id); u && u.id !== r.id; u = porId.get(u.padre_id)) {
      if (normal(u.nombre).startsWith("puerta")) return "puerta";
      if (normal(u.nombre).startsWith("cajon")) return "cajon";
    }
    return "nevera";
  }
  return normal(r?.nombre) === "despensa" ? "despensa" : `extra:${r?.id}`;
}
const urgencia = (a, b) => {
  const da = a.dias_para_vencer, db = b.dias_para_vencer;
  if ((da === null) !== (db === null)) return da === null ? 1 : -1;
  if (da !== null && db !== null && da !== db) return da - db;
  return a.producto.localeCompare(b.producto, "es") || a.id - b.id;
};
const esperado = {};
for (const e of els) (esperado[compartimento(e)] ??= []).push(e);
for (const k of Object.keys(esperado)) esperado[k].sort(urgencia);

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
}
const rend = (nav) => nav.evaluar("JSON.parse(JSON.stringify(window.__nevera.rendimiento))");
/** Una ventana de fps limpia: la que estaba abierta puede mezclar el antes y el después, así que se descarta y se
 *  espera a la siguiente entera (~10 s). El ratón sale antes del lienzo: su etiqueta sería una call más. */
async function esperarFps(nav) {
  if (!nav.movil) await nav.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  for (let i = 0; i < 2; i++) {
    await nav.evaluar("(window.__nevera.rendimiento.fps = null, true)");
    await nav.esperar("window.__nevera.rendimiento.fps !== null", 15000);
  }
  return rend(nav);
}
async function quieta(nav) {   // vuelo de 800 ms terminado y un cuadro más
  await espera(1100);
  await nav.pintado();
}
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
/** Encuadra un nivel tocando su hueco por encima de las cosas (tocar una cosa abriría su panel). */
async function encuadrarNivel(nav, clave, zona, tocarCon) {
  const l = await lienzo(nav);
  const p = await nav.evaluar(`(() => { const e = window.__nevera.escena; const c = e.centroDe(${JSON.stringify(clave)}, ${zona});
    const cosas = e.enPantalla(); let y = c.y;
    // sube desde el centro del hueco hasta un punto a más de 30 px de cualquier cosa
    for (let i = 0; i < 40 && cosas.some((k) => Math.hypot(k.x - c.x, k.y - y) < 30); i++) y -= 4;
    return { x: c.x, y }; })()`);
  await tocarCon(nav, l.x + p.x, l.y + p.y);
  await quieta(nav);
  return nav.evaluar("window.__nevera.escena.encuadre");
}
const resumen = (r) => `calls ${r.calls}, triangles ${r.triangles}, cuerpos ${r.cuerpos}/${r.halos}, esfera ${r.esfera}, dpr ${r.dpr}, lienzo ${r.lienzo.join("×")}, antialias ${r.antialias}, fps ${r.fps}, ms/cuadro ${r.msCuadro}`;
const soloGet = (nav) => nav.peticiones.filter((p) => p.url.startsWith(BASE) && !p.url.includes("/assets/") && !p.url.includes("/fonts/")).every((p) => p.metodo === "GET");
const cifras = {};

// ------------------------------------------------------------------ 1. escritorio
const esc = await abrir({ ancho: 1280, alto: 860, escala: 1, movil: false, webgl: true });
esc.movil = false;
let getEsc = false;
try {
  await entrar(esc);
  ok(await esc.evaluar("window.__nevera.vista") === "lista", "al entrar la primera vez, la lista (la 3D se añade, no la sustituye)");
  await esc.tocar("#vista-nevera");
  await esc.esperar("window.__nevera.vista === 'nevera' && window.__nevera.rendimiento && window.__nevera.rendimiento.calls > 0", 20000);
  ok(await esc.evaluar("localStorage.getItem('nevera.vista')") === "nevera", "el interruptor guarda «nevera» en localStorage");
  await esc.evaluar("document.fonts.ready.then(() => true)");

  const comp = await esc.evaluar("JSON.parse(JSON.stringify(window.__nevera.escena.compartimentos))");
  for (const [k, lista] of Object.entries(esperado)) {
    const c = comp[k];
    ok(c && c.total === lista.length && JSON.stringify(c.orden) === JSON.stringify(lista.map((e) => e.id)),
       `${k}: ${lista.length} cosas, colocadas en el orden de urgencia de la lista (la primera, ${lista[0].producto}, ${lista[0].dias_para_vencer} días)`);
    if (c) {
      const frente = lista.slice(0, c.frente.length);
      const peorDetras = lista.slice(c.frente.length).reduce((m, e) => Math.min(m, e.dias_para_vencer ?? Infinity), Infinity);
      ok(JSON.stringify(c.frente) === JSON.stringify(frente.map((e) => e.id)) && frente.every((e) => (e.dias_para_vencer ?? Infinity) <= peorDetras),
         `${k}: fila de delante = las ${c.frente.length} más urgentes (${c.columnas} columnas × ${c.superficies} niveles; detrás, nada vence antes)`);
    }
  }
  const vacios = Object.entries(comp).filter(([k]) => !esperado[k]).map(([k, c]) => `${k} ${c.total}`);
  ok(Object.entries(comp).filter(([k]) => !esperado[k]).every(([, c]) => c.total === 0), `compartimentos sin cosas en la API, vacíos en la escena: ${vacios.join(", ") || "ninguno"}`);
  const vencidos = els.filter((e) => e.dias_para_vencer !== null && e.dias_para_vencer < 0);
  ok(vencidos.every((e) => comp[compartimento(e)].frente.includes(e.id)), `lo vencido (${vencidos.length}) está en la fila de delante`);

  let r = await esperarFps(esc);
  cifras.escGeneral = r;
  ok(r.calls <= 150 && r.triangles <= 300000, `vista general: ${resumen(r)}`);
  ok(r.cuerpos === 0 && r.halos === els.length, `LOD: en la vista general ninguna esfera, ${r.halos} halos`);
  ok(r.modoLigero === false && r.motivoLigero === "escritorio", `escritorio: modo ligero ${r.modoLigero} (${r.motivoLigero})`);
  const etq = await esc.evaluar("JSON.parse(JSON.stringify(window.__nevera.escena.etiquetas))");
  ok(etq.solapes === 0, `rótulos de compartimento sin solapes: ${etq.visibles.join(", ")} (separación mínima ${etq.separacionMin} px)`);
  await esc.captura(`${DOCS}/nevera3d-6.png`);
  console.log(`      ${DOCS}/nevera3d-6.png: ${medir(`${DOCS}/nevera3d-6.png`)}`);

  const zona = await encuadrarNivel(esc, "nevera", 0, clic);
  ok(zona === "nevera#0", `clic en el hueco de la balda de arriba → la encuadra (${zona})`);
  r = await esperarFps(esc);
  cifras.escDetalle = r;
  ok(r.calls <= 150 && r.triangles <= 300000 && r.cuerpos > 0, `balda encuadrada: ${resumen(r)}`);
  await esc.captura(`${DOCS}/nevera3d-detalle-6.png`);
  console.log(`      ${DOCS}/nevera3d-detalle-6.png: ${medir(`${DOCS}/nevera3d-detalle-6.png`)}`);

  // hover: el ratón encima de la primera cosa de la balda (la más urgente)
  const l = await lienzo(esc);
  const primera = comp.nevera.orden[0];
  const enP = await esc.evaluar(`window.__nevera.escena.enPantalla().find((k) => k.id === ${primera})`);
  const elPrimera = els.find((e) => e.id === primera);
  await esc.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: l.x + enP.x, y: l.y + enP.y });
  await esc.esperar(`window.__nevera.escena.hover === ${primera}`, 3000);
  await espera(600);
  const etqH = await esc.evaluar("JSON.parse(JSON.stringify(window.__nevera.escena.etiquetas))");
  ok(etqH.visibles.includes(elPrimera.producto) && etqH.solapes === 0,
     `ratón encima de ${elPrimera.producto} → su etiqueta (nombre y días), sin solapes: ${etqH.visibles.join(", ")}${etqH.ocultas.length ? `; ceden: ${etqH.ocultas.join(", ")}` : ""}`);
  await esc.captura(`${DOCS}/nevera3d-hover-6.png`);

  // clic: el panel es la tarjeta de la lista
  await clic(esc, l.x + enP.x, l.y + enP.y);
  await esc.esperar(`!!document.querySelector('.panel-3d [data-elemento="${primera}"]')`, 3000);
  const panel = await esc.evaluar(`(() => { const t = document.querySelector('.panel-3d [data-elemento="${primera}"]');
    return { texto: t.innerText.replace(/\\s+/g, " "), acciones: [...t.querySelectorAll('[data-accion]')].map((b) => b.dataset.accion),
             seleccion: window.__nevera.escena.seleccion }; })()`);
  ok(panel.texto.includes(elPrimera.producto) && /Cantidad/.test(panel.texto) && /Dónde\s+nevera/i.test(panel.texto) && panel.seleccion === primera,
     `clic → panel: «${panel.texto.slice(0, 110)}…»`);
  ok(JSON.stringify(panel.acciones) === JSON.stringify(["abri", "acabo", "botar", "fecha"]) ||
     JSON.stringify(panel.acciones) === JSON.stringify(["acabo", "botar", "fecha"]),
     `las acciones de la lista: ${panel.acciones.join(", ")}`);
  await esc.tocar(`.panel-3d [data-accion="fecha"]`);
  await esc.esperar(`!!document.querySelector('.panel-3d form.confirma[data-accion="fecha"] input[type=date]')`, 3000);
  ok(true, "«Fecha» abre la confirmación con el campo de fecha");
  await esc.captura(`${DOCS}/nevera3d-panel-6.png`);
  await esc.tocar(".panel-3d .confirma .no");
  await esc.esperar("!document.querySelector('.panel-3d form.confirma')", 3000);
  await esc.tocar("#cerrar-panel");
  await esc.esperar("!document.querySelector('.panel-3d') && window.__nevera.escena.seleccion === null", 3000);
  ok(true, "«No» cierra la confirmación sin tocar nada y «Cerrar» cierra el panel");

  // modo ligero: después (en el escritorio el dpr ya es 1: cambian las esferas)
  await esc.tocar("#modo-ligero");
  r = await esperarFps(esc);
  cifras.escDetalleLigero = r;
  ok(r.modoLigero && r.esfera === "16×12" && r.triangles < cifras.escDetalle.triangles,
     `balda, modo ligero: ${resumen(r)} (triángulos ${cifras.escDetalle.triangles} → ${r.triangles})`);
  await esc.tocar("#encuadre");
  await quieta(esc);
  r = await esperarFps(esc);
  cifras.escGeneralLigero = r;
  ok(r.cuerpos === 0 && r.calls === cifras.escGeneral.calls, `vista general, modo ligero: ${resumen(r)}`);
  await esc.tocar("#modo-ligero");   // se deja como estaba

  // recargar: vuelve sola a la nevera
  await esc.ir(BASE + "/");
  await esc.esperar("window.__nevera && window.__nevera.listo && window.__nevera.vista === 'nevera' && window.__nevera.rendimiento && window.__nevera.rendimiento.calls > 0", 20000);
  ok(true, "al recargar abre directamente en la nevera (la elección se recuerda)");
  const exc = esc.consola.filter((x) => x.startsWith("EXCEPCIÓN") || /Content Security Policy|Refused/.test(x));
  ok(exc.length === 0, `escritorio: sin excepciones ni avisos de CSP (${exc.length})${exc.length ? ": " + exc.slice(0, 3).join(" | ") : ""}`);
  getEsc = soloGet(esc);
} finally {
  await esc.cerrar();
}

// ------------------------------------------------------------------ 2. móvil emulado
const mov = await abrir({ ancho: 390, alto: 844, escala: 3, movil: true, webgl: true });
mov.movil = true;
let getMov = false;
try {
  await entrar(mov);
  await mov.tocar("#vista-nevera");
  await mov.esperar("window.__nevera.vista === 'nevera' && window.__nevera.rendimiento && window.__nevera.rendimiento.calls > 0", 20000);
  let r = await esperarFps(mov);
  cifras.movil = r;
  ok(r.modoLigero && r.motivoLigero === "pointer: coarse" && r.dpr === 1.5 && !r.antialias, `móvil 390×844 (escala 3), modo ligero automático: ${resumen(r)}`);
  ok(r.calls <= 150 && r.triangles <= 300000, "móvil: dentro del presupuesto");
  const s = await mov.evaluar("({ ancho: window.__nevera.ancho, scroll: window.__nevera.scroll_horizontal })");
  ok(s.ancho === 390 && !s.scroll, "móvil: 390 de ancho, sin scroll horizontal");
  await mov.captura(`${DOCS}/nevera3d-movil-6.png`);
  console.log(`      ${DOCS}/nevera3d-movil-6.png: ${medir(`${DOCS}/nevera3d-movil-6.png`)}`);
  const zona = await encuadrarNivel(mov, "despensa", 0, toque);
  r = await esperarFps(mov);
  cifras.movilDetalle = r;
  ok(zona === "despensa#0" && r.cuerpos > 0, `toque en el hueco de la balda de arriba de la despensa → la encuadra (${zona}) y las cosas pasan a esfera: ${resumen(r)}`);
  const l = await lienzo(mov);
  const cosa = await mov.evaluar("window.__nevera.escena.enPantalla().filter((k) => k.r > 10).sort((a, b) => b.r - a.r)[0]");
  await toque(mov, l.x + cosa.x, l.y + cosa.y);
  await mov.esperar(`!!document.querySelector('.panel-3d [data-elemento]')`, 3000);
  const id = await mov.evaluar("Number(document.querySelector('.panel-3d [data-elemento]').dataset.elemento)");
  ok(id === cosa.id, `toque en una cosa (${els.find((e) => e.id === id)?.producto}) → la hoja con su tarjeta`);
  await mov.captura(`${DOCS}/nevera3d-movil-panel-6.png`);
  await mov.tocar("#cerrar-panel");
  await mov.esperar("!document.querySelector('.panel-3d')", 3000);
  // antes del modo ligero: apagado a mano, misma balda
  await mov.tocar("#modo-ligero");
  r = await esperarFps(mov);
  cifras.movilDetalleSinLigero = r;
  ok(!r.modoLigero && r.dpr === 2, `móvil, modo ligero apagado a mano (el antes): ${resumen(r)}`);
  await mov.tocar("#encuadre");
  await quieta(mov);
  r = await esperarFps(mov);
  cifras.movilSinLigero = r;
  ok(true, `móvil, vista general sin modo ligero: ${resumen(r)}`);
  getMov = soloGet(mov);
} finally {
  await mov.cerrar();
}

// ------------------------------------------------------------------ 3. sin WebGL
const sin = await abrir({ ancho: 390, alto: 844, escala: 2, movil: true, webgl: false });
try {
  await entrar(sin);
  await sin.tocar("#vista-nevera");
  await sin.esperar("!!document.querySelector('#aviso')", 3000);
  const aviso = await sin.evaluar("document.querySelector('#aviso').innerText");
  ok(await sin.evaluar("window.__nevera.vista") === "lista" && /3D/.test(aviso), `sin WebGL, el interruptor se queda en la lista y dice por qué: «${aviso}»`);
  await sin.evaluar("localStorage.setItem('nevera.vista', 'nevera'), localStorage.removeItem('nevera.aviso3d'), true");
  await sin.ir(BASE + "/");
  await sin.esperar("window.__nevera && window.__nevera.listo && !!document.querySelector('#aviso')", 15000);
  ok(await sin.evaluar("window.__nevera.vista === 'lista' && window.__nevera.pintados > 0"), `con la nevera guardada y sin WebGL abre en la lista y lo dice: «${await sin.evaluar("document.querySelector('#aviso').innerText")}»`);
  await sin.ir(BASE + "/");
  await sin.esperar("window.__nevera && window.__nevera.listo", 15000);
  await espera(800);
  ok(await sin.evaluar("!document.querySelector('#aviso') && window.__nevera.vista === 'lista'"), "al recargar ya no lo repite (una vez, sin drama)");
  ok(!sin.peticiones.some((p) => p.url.includes("Nevera3D")), "sin WebGL ni siquiera se descarga el trozo de three");
} finally {
  await sin.cerrar();
}

// ------------------------------------------------------------------ 4. escribir desde el panel (solo en la copia)
if (ESCRIBE) {
  const w = await abrir({ ancho: 1280, alto: 860, escala: 1, movil: false, webgl: true });
  try {
    await entrar(w);
    if (await w.evaluar("window.__nevera.vista") !== "nevera") await w.tocar("#vista-nevera");
    await w.esperar("window.__nevera.rendimiento && window.__nevera.rendimiento.calls > 0", 20000);
    await encuadrarNivel(w, "nevera", 0, clic);
    const l = await lienzo(w);
    const abrirCosa = async (id) => {
      const p = await w.evaluar(`window.__nevera.escena.enPantalla().find((k) => k.id === ${id})`);
      await clic(w, l.x + p.x, l.y + p.y);
      await w.esperar(`!!document.querySelector('.panel-3d [data-elemento="${id}"]')`, 3000);
    };
    const orden = await w.evaluar("window.__nevera.escena.compartimentos.nevera.orden.slice()");
    const sinAbrir = orden.find((id) => !els.find((e) => e.id === id).abierto_en);
    await abrirCosa(sinAbrir);
    await w.tocar('.panel-3d [data-accion="abri"]');
    await w.tocar(".panel-3d .confirma .si");
    await w.esperar(`!!document.querySelector('.panel-3d [data-elemento="${sinAbrir}"] .accion.apagada')`, 5000);
    const e1 = (await api("/elementos")).find((e) => e.id === sinAbrir);
    ok(e1 && e1.abierto_en !== null, `«Abrí» desde la escena: PATCH abierto_en = ${e1?.abierto_en} y el panel dice «Abierto»`);
    await w.tocar("#cerrar-panel");
    const otra = orden.find((id) => id !== sinAbrir);
    await abrirCosa(otra);
    await w.tocar('.panel-3d [data-accion="acabo"]');
    await w.tocar(".panel-3d .confirma .si");
    await w.esperar(`!document.querySelector('.panel-3d') && !window.__nevera.escena.compartimentos.nevera.orden.includes(${otra})`, 5000);
    const total = await w.evaluar("window.__nevera.escena.compartimentos.nevera.total");
    ok(total === orden.length - 1 && !(await api("/elementos")).some((e) => e.id === otra),
       `«Se acabó» desde la escena: la cosa sale de la API y de la escena (nevera ${orden.length} → ${total}) y el panel se cierra`);
    await w.captura(`${DOCS}/nevera3d-copia-6.png`);
  } finally {
    await w.cerrar();
  }
} else {
  ok(getEsc && getMov, "la página solo hizo GET (ninguna escritura)");
  const [fin, movsFin] = await Promise.all([api("/elementos"), api("/movimientos")]);
  ok(fin.length === els.length && movsFin.length === movs.length && huella(fin) === huellaInicio,
     `la base queda como estaba: ${fin.length} elementos, ${movsFin.length} movimientos, huella ${huella(fin)}`);
}

console.log("\nCIFRAS " + JSON.stringify(Object.fromEntries(Object.entries(cifras).map(([k, r]) =>
  [k, { calls: r.calls, triangles: r.triangles, cuerpos: r.cuerpos, fps: r.fps, msCuadro: r.msCuadro, dpr: r.dpr, modoLigero: r.modoLigero, esfera: r.esfera, lienzo: r.lienzo }]))));
console.log(fallos ? `NEVERA 3D: ${fallos} FALLA(S)` : "NEVERA 3D OK");
process.exit(fallos ? 1 : 0);
