// La pestaña «Recetas» en Chrome headless (PEDIDO-NEVERA-5, bloques 3 y 4).
//
//   node scripts/recetas_pantalla.mjs http://127.0.0.1:8451 data/admin.token docs/recetas-5.png
//       SOLO LEE (vale para la base real): coteja lo pintado con la API y captura. Comprueba al final que la página
//       solo hizo GET y que la base queda igual.
//   node scripts/recetas_pantalla.mjs http://127.0.0.1:8452 data/admin.token docs/recetas-copia-5.png --escribe
//       ADEMÁS cocina la primera sugerencia desde la pantalla, abre «Editar» y crea una receta con el formulario.
//       CREA FILAS: solo contra una copia desechable; se niega a hacerlo en el 8451.
//
// El token se lee del archivo y no se imprime nunca.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { abrir } from "./navegador.mjs";

const BASE = (process.argv[2] || "http://127.0.0.1:8451").replace(/\/$/, "");
const TOKEN = readFileSync(process.argv[3] || "data/admin.token", "utf8").trim();
const CAPTURA = process.argv[4] || "docs/recetas-5.png";
const ESCRIBE = process.argv.includes("--escribe");
const DIAS = 7;
if (ESCRIBE && /:8451$/.test(BASE)) { console.error("--escribe crea filas: no se corre contra el 8451 (servicio real)"); process.exit(1); }

let fallos = 0;
const ok = (cond, texto) => { console.log((cond ? "OK    " : "FALLA ") + texto); if (!cond) fallos++; };
async function api(ruta) {
  const r = await fetch(BASE + ruta, { headers: { Authorization: "Bearer " + TOKEN } });
  if (!r.ok) throw new Error(`GET ${ruta}: ${r.status}`);
  return r.json();
}
const huella = (lista) => createHash("sha256").update(JSON.stringify(lista.map((e) =>
  [e.id, e.saldo, e.vencimiento, e.vencimiento_origen, e.abierto_en, e.ubicacion_id]))).digest("hex").slice(0, 16);
const estadosDe = (sug) => ({
  vence: sug.reduce((a, s) => a + s.cubre.filter((i) => i.por_vencer).length, 0),
  tengo: sug.reduce((a, s) => a + s.cubre.filter((i) => !i.por_vencer).length, 0),
  falta: sug.reduce((a, s) => a + s.faltan.length, 0),
});
const VACIO = "Todavía no hay recetas: crea la primera con lo que sueles cocinar.";

async function foto() {
  const [recetas, sug, els, movs] = await Promise.all([api("/recetas"), api(`/recetas/sugeridas?dias=${DIAS}`),
    api("/elementos"), api("/movimientos")]);
  return { recetas, sug, els, movs, huella: huella(els) };
}

async function entrar(nav) {
  await nav.ir(BASE + "/");
  await nav.esperar("!!document.querySelector('#f-token')");
  await nav.evaluar(`(() => { const i = document.querySelector('#token');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(TOKEN)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#f-token').requestSubmit(); return true; })()`);
  await nav.esperar("window.__nevera && window.__nevera.listo", 15000);
  await nav.evaluar("document.fonts.ready.then(() => true)");
}
async function aRecetas(nav, n) {
  await nav.tocar("#pestana-recetas");
  await nav.esperar(`window.__neveraRecetas && window.__neveraRecetas.listo && window.__neveraRecetas.recetas === ${n}`, 10000);
  await nav.evaluar("window.scrollTo(0, 0), true");
}
const sonda = async (nav) => JSON.parse(JSON.stringify(await nav.evaluar("window.__neveraRecetas")));

function cotejar(s, f, donde) {
  ok(s.recetas === f.recetas.length, `${donde}: ${s.recetas} recetas = GET /recetas ${f.recetas.length}`);
  ok(JSON.stringify(s.sugeridas.map((x) => x.receta_id)) === JSON.stringify(f.sug.map((x) => x.receta_id)) && s.pintadas === f.sug.length,
     `${donde}: «qué puedes cocinar hoy» en el orden de GET /recetas/sugeridas (${f.sug.map((x) => `${x.nombre} ${x.dias_mas_urgente ?? "—"} d`).join(" > ") || "ninguna"})`);
  const e = estadosDe(f.sug);
  ok(JSON.stringify(s.estados) === JSON.stringify(e),
     `${donde}: ingredientes pintados por estado = API (se me vence ${e.vence}, lo tengo ${e.tengo}, me falta ${e.falta})`);
  if (f.recetas.length === 0) ok(s.vacio === VACIO, `${donde}: sin recetas, la frase «${s.vacio}»`);
  ok(!s.scroll_horizontal, `${donde}: sin scroll horizontal`);
}

async function fijar(nav, selector, valor, tipo = "input") {
  await nav.evaluar(`(() => { const n = document.querySelector(${JSON.stringify(selector)});
    const proto = n instanceof HTMLSelectElement ? HTMLSelectElement.prototype : n instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, ${JSON.stringify(String(valor))});
    n.dispatchEvent(new Event(${JSON.stringify(tipo)}, { bubbles: true })); return true; })()`);
}

const inicio = await foto();
console.log(`base ${BASE}: ${inicio.recetas.length} recetas, ${inicio.sug.length} sugeridas, ${inicio.els.length} elementos, ` +
            `${inicio.movs.length} movimientos, huella ${inicio.huella}${ESCRIBE ? " — modo --escribe" : " — solo lee"}`);

// ------------------------------------------------------------------ móvil
const movil = await abrir({ ancho: 390, alto: 844, escala: 2 });
let soloGet = false;
try {
  await entrar(movil);
  await aRecetas(movil, inicio.recetas.length);
  cotejar(await sonda(movil), inicio, "móvil");
  await movil.captura(CAPTURA);
  ok(true, `captura móvil → ${CAPTURA}`);

  if (ESCRIBE && inicio.sug.length) {
    // ---- cocinar la primera sugerencia, desde la pantalla
    const s = inicio.sug[0];
    await movil.tocar(`[data-sugerida="${s.receta_id}"] [data-accion="cocinar"]`);
    await movil.esperar("!!document.querySelector('.confirma.cocinar')");
    const lineas = await movil.evaluar(`[...document.querySelectorAll('.confirma.cocinar [data-linea]')].map((n) => ({
      elemento_id: Number(n.dataset.linea), usar: n.querySelector('input[type=checkbox]').checked,
      cantidad: Number(n.querySelector('.linea-cant input').value) }))`);
    // lo esperado: por ingrediente, lo que vence antes primero, hasta la cantidad de la receta
    const esperado = [];
    for (const ing of s.cubre) {
      let falta = ing.cantidad;
      const cand = inicio.els.filter((e) => e.producto_id === ing.producto_id && (e.dias_para_vencer === null || e.dias_para_vencer >= 0))
        .sort((a, b) => ((a.dias_para_vencer ?? 1e9) - (b.dias_para_vencer ?? 1e9)) || a.id - b.id);
      for (const e of cand) { if (falta <= 0) break; const t = Math.min(e.saldo, falta); esperado.push({ elemento_id: e.id, usar: !ing.opcional, cantidad: t }); falta -= t; }
    }
    ok(JSON.stringify(lineas) === JSON.stringify(esperado),
       `cocinar «${s.nombre}»: la confirmación propone ${lineas.map((l) => `${l.cantidad} de ${l.elemento_id}${l.usar ? "" : " (sin marcar)"}`).join(", ")}`);
    const archivo = CAPTURA.replace(/\.png$/, "-cocinar.png");
    await movil.captura(archivo);
    ok(true, `captura de la confirmación → ${archivo}`);
    const n0 = (await api("/movimientos")).length;
    await movil.tocar(".confirma.cocinar .si");
    await movil.esperar("!document.querySelector('.confirma.cocinar') && !!document.querySelector('#aviso')", 10000);
    const aviso = await movil.evaluar("document.querySelector('#aviso').textContent");
    const movs = await api("/movimientos");
    const nuevos = movs.slice(n0);
    const usados = lineas.filter((l) => l.usar);
    ok(nuevos.length === usados.length && nuevos.every((m) => m.tipo === "consumo" && m.motivo === `receta ${s.nombre}`),
       `«Sí, descontar» registró ${nuevos.length} consumos con motivo «receta ${s.nombre}» (aviso: «${aviso}»)`);
    const elsDespues = await api("/elementos");
    const porId = new Map(elsDespues.map((e) => [e.id, e]));
    const bien = usados.every((l) => {
      const antes = inicio.els.find((e) => e.id === l.elemento_id);
      const ahora = porId.get(l.elemento_id);
      return antes.saldo - l.cantidad <= 1e-9 ? ahora === undefined : Math.abs(ahora.saldo - (antes.saldo - l.cantidad)) < 1e-6;
    });
    ok(bien, "lo consumido bajó de saldo, y lo que se gastó entero ya no está en GET /elementos");
    await movil.esperar(`window.__neveraRecetas && window.__neveraRecetas.listo`);
    const sug2 = await api(`/recetas/sugeridas?dias=${DIAS}`);
    cotejar(await sonda(movil), { ...inicio, sug: sug2 }, "al volver a la lista");
    await movil.tocar("#pestana-nevera");
    await movil.esperar(`window.__nevera && window.__nevera.listo && window.__nevera.pintados === ${elsDespues.length}`, 10000);
    ok(true, `en la pestaña Nevera: ${elsDespues.length} tarjetas = GET /elementos después de cocinar (antes ${inicio.els.length})`);

    // ---- editar avisa de la versión nueva
    await aRecetas(movil, inicio.recetas.length);
    const r = inicio.recetas.find((x) => x.id === s.receta_id);
    await movil.tocar(`[data-receta="${r.id}"] [data-accion="editar"]`);
    await movil.esperar("!!document.querySelector('[data-aviso-version]')");
    const avisoV = await movil.evaluar("document.querySelector('[data-aviso-version]').textContent");
    ok(avisoV.includes(`versión ${r.version_vigente.numero + 1}`) && avisoV.includes(`versión ${r.version_vigente.numero}`),
       `editar «${r.nombre}» avisa: «${avisoV.trim()}»`);
    await movil.tocar(".form-receta .volver");

    // ---- crear una receta con el formulario
    await aRecetas(movil, inicio.recetas.length);
    await movil.tocar("#nueva-receta");
    await movil.esperar("!!document.querySelector('#receta-nombre')");
    const prod = inicio.els.find((e) => e.unidad_base === "g");
    await fijar(movil, "#receta-nombre", "Receta desde la pantalla");
    await fijar(movil, "#receta-porciones", "3");
    await fijar(movil, "[data-linea-receta='1'] select", prod.producto_id, "change");
    await movil.esperar(`document.querySelector("[data-linea-receta='1'] select:nth-of-type(2)").value === "g"`);
    await fijar(movil, "[data-linea-receta='1'] input[type=text]", "0,25");
    await fijar(movil, "[data-linea-receta='1'] select:nth-of-type(2)", "kg", "change");
    await fijar(movil, "#receta-pasos", "Primero esto\nDespués aquello");
    await movil.tocar("#guardar-receta");
    await movil.esperar("!document.querySelector('#guardar-receta') || !!document.querySelector('.form-receta .error')", 10000);
    const errForm = await movil.evaluar("document.querySelector('.form-receta .error')?.textContent ?? ''");
    if (errForm) throw new Error(`el formulario no guardó: «${errForm}»`);
    await aRecetas(movil, inicio.recetas.length + 1);
    const creada = (await api("/recetas")).find((x) => x.nombre === "Receta desde la pantalla");
    ok(creada && creada.version_vigente.porciones === 3 && creada.version_vigente.ingredientes[0].cantidad === 250 &&
       creada.version_vigente.ingredientes[0].unidad === "g" && creada.version_vigente.instrucciones === "Primero esto\nDespués aquello",
       `crear con el formulario: «Receta desde la pantalla», 3 comensales, 0,25 kg de ${prod.producto} → 250 g, dos pasos`);
  } else {
    soloGet = movil.peticiones.filter((p) => p.url.startsWith(BASE)).every((p) => p.metodo === "GET");
  }
  const exc = movil.consola.filter((l) => l.startsWith("EXCEPCIÓN") || /Content Security Policy|Refused/.test(l));
  ok(exc.length === 0, `móvil: sin excepciones ni avisos de CSP (${exc.length})`);
} finally {
  await movil.cerrar();
}

// ------------------------------------------------------------------ escritorio
const ahora = await foto();
const escritorio = await abrir({ ancho: 1280, alto: 900, escala: 1, movil: false });
try {
  await entrar(escritorio);
  await aRecetas(escritorio, ahora.recetas.length);
  cotejar(await sonda(escritorio), ahora, "escritorio");
  const archivo = CAPTURA.replace(/\.png$/, "-escritorio.png");
  const t = await escritorio.capturaCompleta(archivo);
  ok(true, `captura de escritorio → ${archivo} (${t.ancho}×${t.alto} CSS)`);
  if (!ESCRIBE) soloGet = soloGet && escritorio.peticiones.filter((p) => p.url.startsWith(BASE)).every((p) => p.metodo === "GET");
} finally {
  await escritorio.cerrar();
}

if (!ESCRIBE) {
  ok(soloGet, "la página solo hizo GET (ninguna escritura)");
  const fin = await foto();
  ok(fin.recetas.length === inicio.recetas.length && fin.movs.length === inicio.movs.length && fin.huella === inicio.huella,
     `la base queda como estaba: ${fin.recetas.length} recetas, ${fin.els.length} elementos, ${fin.movs.length} movimientos, huella ${fin.huella}`);
}
console.log(fallos ? `RECETAS PANTALLA: ${fallos} FALLA(S)` : "RECETAS PANTALLA OK");
process.exit(fallos ? 1 : 0);
