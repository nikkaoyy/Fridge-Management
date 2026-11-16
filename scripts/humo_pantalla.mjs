// Humo del tablero contra el servicio REAL (PEDIDO-NEVERA-4, bloque 3). SOLO LEE: no escribe nada en la base.
//
//   node scripts/humo_pantalla.mjs http://127.0.0.1:8451 data/admin.token [docs]
//
// 1. Foto de la API (GET): elementos, indicadores, ?por_vencer=7, vencimientos, ubicaciones, movimientos, y una
//    huella de la lista entera.
// 2. Móvil (390×844, escala 2): entra con el token real por el formulario de la página (leído del archivo; nunca se
//    imprime), espera la sonda window.__nevera y la coteja con la API: elementos pintados, vencidos, ≤ 7 días, hoy,
//    ≤ 2 días, valor en riesgo, conteo por sección, semáforo de cada tarjeta y el dpr. Captura → <docs>/movil-4.png.
// 3. Escritorio (1280 de ancho, escala 1): la página entera → <docs>/dashboard-4.png (cifras + todas las secciones).
// 4. Al final: la página solo hizo GET, y la base sigue igual (mismo conteo de elementos y movimientos, misma huella).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { abrir } from "./navegador.mjs";

const BASE = (process.argv[2] || "http://127.0.0.1:8451").replace(/\/$/, "");
const TOKEN = readFileSync(process.argv[3] || "data/admin.token", "utf8").trim();
const DOCS = process.argv[4] || "docs";
let fallos = 0;
const ok = (cond, texto) => { console.log((cond ? "OK    " : "FALLA ") + texto); if (!cond) fallos++; };

async function api(ruta) {
  const r = await fetch(BASE + ruta, { headers: { Authorization: "Bearer " + TOKEN } });
  if (!r.ok) throw new Error(`GET ${ruta}: ${r.status}`);
  return r.json();
}
const huella = (lista) => createHash("sha256").update(JSON.stringify(lista.map((e) =>
  [e.id, e.saldo, e.vencimiento, e.vencimiento_origen, e.abierto_en, e.ubicacion_id]))).digest("hex").slice(0, 16);
const semaforo = (d) => d === null ? "sin-fecha" : d < 0 ? "vencido" : d <= 2 ? "urgente" : d <= 7 ? "pronto" : "bien";

const [els, ind, pv, venc, ubis, movs] = await Promise.all([api("/elementos"), api("/indicadores"),
  api("/elementos?por_vencer=7"), api("/vencimientos?dias=7"), api("/ubicaciones"), api("/movimientos")]);
const huellaInicio = huella(els);
console.log(`base real: ${els.length} elementos disponibles, ${movs.length} movimientos, huella ${huellaInicio}, hoy ${venc.hoy}`);
const raiz = new Map(ubis.map((u) => [u.id, u.padre_id ?? u.id]));
const porSeccion = {};
for (const u of ubis.filter((u) => u.padre_id === null)) porSeccion[u.nombre] = els.filter((e) => raiz.get(e.ubicacion_id) === u.id).length;
const conPrecio = pv.filter((e) => e.precio_unitario_cop !== null && e.precio_unitario_cop !== undefined);
const riesgo = conPrecio.length ? conPrecio.reduce((a, e) => a + Math.round(e.precio_unitario_cop * e.saldo / e.cantidad_inicial), 0) : null;

async function entrar(nav) {
  await nav.ir(BASE + "/");
  await nav.esperar("!!document.querySelector('#f-token')");
  await nav.evaluar(`(() => { const i = document.querySelector('#token');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(TOKEN)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#f-token').requestSubmit(); return true; })()`);
  await nav.esperar(`window.__nevera && window.__nevera.listo && window.__nevera.pintados === ${els.length}`, 15000);
  await nav.evaluar("document.fonts.ready.then(() => true)");
  await nav.evaluar("window.scrollTo(0, 0), true");
}
const soloGet = (nav) => nav.peticiones.filter((p) => p.url.startsWith(BASE)).every((p) => p.metodo === "GET");

// ------------------------------------------------------------------ móvil
const movil = await abrir({ ancho: 390, alto: 844, escala: 2 });
let getMovil = false;
try {
  await entrar(movil);
  const s = JSON.parse(JSON.stringify(await movil.evaluar("window.__nevera")));
  ok(s.pintados === els.length && s.elementos === ind.elementos_disponibles,
     `pintados ${s.pintados} = GET /elementos ${els.length} = indicadores.elementos_disponibles ${ind.elementos_disponibles}`);
  ok(s.vencidos === ind.vencidos, `vencidas ${s.vencidos} = indicadores.vencidos ${ind.vencidos}`);
  ok(s.en7 === ind.por_vencer_7, `en ≤ 7 días ${s.en7} = indicadores.por_vencer_7 ${ind.por_vencer_7}`);
  ok(s.hoy_vencen === venc.hoy_vencen.length, `vencen hoy ${s.hoy_vencen} = vencimientos.hoy_vencen ${venc.hoy_vencen.length}`);
  const en2 = els.filter((e) => e.dias_para_vencer !== null && e.dias_para_vencer >= 0 && e.dias_para_vencer <= 2).length;
  ok(s.en2 === en2, `en ≤ 2 días ${s.en2} = dias_para_vencer 0..2 en GET /elementos ${en2}`);
  ok(s.por_vencer === pv.length && s.riesgo_cop === riesgo && s.riesgo_sin_precio === pv.length - conPrecio.length,
     `valor en riesgo ${s.riesgo_cop} COP = suma de precio_unitario_cop de GET /elementos?por_vencer=7 (${pv.length} cosas, ${pv.length - conPrecio.length} sin precio)`);
  ok(JSON.stringify(Object.fromEntries(Object.entries(s.secciones).map(([k, v]) => [k, v.total]))) === JSON.stringify(porSeccion),
     `secciones: ${Object.entries(porSeccion).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  const tarjetas = await movil.evaluar(`[...document.querySelectorAll('[data-elemento]')].map((n) => [Number(n.dataset.elemento), n.dataset.semaforo])`);
  const porId = new Map(els.map((e) => [e.id, e]));
  const malas = tarjetas.filter(([id, sem]) => semaforo(porId.get(id).dias_para_vencer) !== sem);
  ok(malas.length === 0, `semáforo de cada tarjeta acorde a dias_para_vencer (${malas.length} discrepancias): ${JSON.stringify(s.semaforo)}`);
  ok(s.dpr === 2 && s.ancho === 390 && !s.scroll_horizontal, `dpr ${s.dpr}, ancho ${s.ancho}, sin scroll horizontal`);
  const tile = await movil.evaluar("document.querySelector('[data-cifra=riesgo]').innerText.replace(/\\s+/g, ' ')");
  console.log(`      tile de riesgo: «${tile}»`);
  await movil.captura(`${DOCS}/movil-4.png`);
  ok(true, `captura móvil → ${DOCS}/movil-4.png`);
  getMovil = soloGet(movil);
  const exc = movil.consola.filter((l) => l.startsWith("EXCEPCIÓN") || /Content Security Policy|Refused/.test(l));
  ok(exc.length === 0, `móvil: sin excepciones ni avisos de CSP (${exc.length})`);
} finally {
  await movil.cerrar();
}

// ------------------------------------------------------------------ escritorio
const escritorio = await abrir({ ancho: 1280, alto: 900, escala: 1, movil: false });
let getEscritorio = false;
try {
  await entrar(escritorio);
  const s = JSON.parse(JSON.stringify(await escritorio.evaluar("window.__nevera")));
  ok(s.pintados === els.length && s.dpr === 1 && !s.scroll_horizontal, `escritorio: ${s.pintados} pintados, dpr ${s.dpr}, sin scroll horizontal`);
  const t = await escritorio.capturaCompleta(`${DOCS}/dashboard-4.png`);
  ok(true, `captura del tablero entero → ${DOCS}/dashboard-4.png (${t.ancho}×${t.alto} CSS)`);
  getEscritorio = soloGet(escritorio);
} finally {
  await escritorio.cerrar();
}

ok(getMovil && getEscritorio, "la página solo hizo GET (ninguna escritura)");
const [fin, movsFin] = await Promise.all([api("/elementos"), api("/movimientos")]);
ok(fin.length === els.length && movsFin.length === movs.length && huella(fin) === huellaInicio,
   `la base queda como estaba: ${fin.length} elementos, ${movsFin.length} movimientos, huella ${huella(fin)}`);
console.log(fallos ? `HUMO PANTALLA: ${fallos} FALLA(S)` : "HUMO PANTALLA OK");
process.exit(fallos ? 1 : 0);
