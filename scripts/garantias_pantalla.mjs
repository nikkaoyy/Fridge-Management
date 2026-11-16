// Garantías del tablero (PEDIDO-NEVERA-4; antes NEVERA-3) en Chrome headless a 390×844, contra un servicio vivo.
//
// CREA FILAS (un editor, un lector, seis elementos, altas y movimientos): se niega a correr si la base del servicio
// no está en /tmp.
//
//   mkdir /tmp/nevera-garantias
//   export NEVERA_DATOS=/tmp/nevera-garantias NEVERA_HOST=127.0.0.1 NEVERA_PUERTO=8452 \
//          NEVERA_ADMIN_TOKEN="$(openssl rand -hex 24)"
//   scripts/arrancar.sh && node scripts/garantias_pantalla.mjs http://127.0.0.1:8452 [docs]; scripts/parar.sh
//   rm -rf /tmp/nevera-garantias
//
// Comprueba, mirando el DOM, la sonda window.__nevera y TODAS las peticiones de red de la página:
//   1. Sin token: solo el formulario, ningún dato, ninguna petición a la API.
//   2. Token que no vale: lo dice, no deja seguir, no lo guarda; la única petición es GET /miembros/yo.
//   3. Lector: /miembros/yo primero; solo GET; cifras y secciones cuadran con la API (indicadores, ?por_vencer=7,
//      suma de precios); lo vencido arriba con su marca; semáforo; frases de vacío; ni acciones ni «Agregar»; 403 a
//      mano; tras recargar entra con el token guardado.
//   4. Revocado en el servidor: la pantalla lo olvida y saca los datos del DOM.
//   5. Editor: acciones (Fecha, Abrí, Se acabó, Botar) contra la API; plegar secciones; buscador sin tildes; filtro
//      «por vencer».
//   6. Alta rápida: foco automático, «siguiente» con Enter, producto existente (POST /elementos, no duplica),
//      producto nuevo (POST /importar) y producto nuevo con foto (D5: archivo en <datos>/fotos y fila en
//      producto_foto, vista en GET /elementos/{id}).
//   7. Móvil: sin scroll horizontal a 390 px, objetivos táctiles ≥ 40 px; sin excepciones ni avisos de CSP.
// Los tokens no se imprimen.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { abrir } from "./navegador.mjs";

const BASE = (process.argv[2] || "http://127.0.0.1:8452").replace(/\/$/, "");
const ADMIN = process.env.NEVERA_ADMIN_TOKEN;
const CAPTURAS = process.argv[3] || null;   // si se da, captura el semáforo completo → <dir>/semaforo-4.png
const P = "garantia-" + Math.random().toString(36).slice(2, 7); // prefijo de los productos de la base desechable
let fallos = 0;
const ok = (cond, texto) => { console.log((cond ? "OK    " : "FALLA ") + texto); if (!cond) fallos++; };

async function api(token, metodo, ruta, cuerpo, tipo) {
  const h = { Authorization: "Bearer " + token };
  if (cuerpo !== undefined) h["Content-Type"] = tipo || "application/json";
  const r = await fetch(BASE + ruta, { method: metodo, headers: h,
                                       body: cuerpo === undefined ? undefined : (tipo ? cuerpo : JSON.stringify(cuerpo)) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const dia = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

if (!ADMIN) { console.error("falta NEVERA_ADMIN_TOKEN (el admin de la base desechable)"); process.exit(2); }
const salud = await (await fetch(BASE + "/salud")).json();
if (!String(salud.base).startsWith("/tmp/")) {
  console.error(`la base del servicio es ${salud.base}: este script crea filas y solo corre contra una base en /tmp`);
  process.exit(2);
}
const DATOS = String(salud.base).replace(/\/nevera\.db$/, "");

// ------------------------------------------------------------------ la base desechable
const ed = await api(ADMIN, "POST", "/miembros", { nombre: P + "-editor", rol: "editor" });
const lec = await api(ADMIN, "POST", "/miembros", { nombre: P + "-lector", rol: "lector" });
if (ed.status !== 201 || lec.status !== 201) { console.error("no se pudieron crear los miembros"); process.exit(2); }
const hoy = (await api(ADMIN, "GET", "/vencimientos?dias=1")).json.hoy;
const compra = dia(hoy, -10);
// nombre, días hasta vencer (null = sin fecha), precio, ubicación
const FILAS = [
  [`${P} vencido`, -3, 5000, "nevera"],
  [`${P} hoy`, 0, 2000, "puerta de la nevera"],
  [`${P} pasado`, 2, "", "despensa"],
  [`${P} cinco`, 5, 10000, "despensa"],
  [`${P} lejos`, 30, 3000, "nevera"],
  [`${P} sin fecha`, null, 1500, "nevera"],
];
const csv = "nombre,categoria,unidad,cantidad,fecha_compra,fecha_vencimiento,precio_unitario,ubicacion\n" +
  FILAS.map(([n, d, p, u]) => `${n},garantías,u,1,${compra},${d === null ? "" : dia(hoy, d)},${p},${u}`).join("\n") + "\n";
const imp = await api(ADMIN, "POST", "/importar", csv, "text/csv");
if (imp.status !== 200 || imp.json.creados !== 6) { console.error("no se pudo importar", imp.status, imp.json); process.exit(2); }

// una foto PNG de verdad, 8×8, para el alta con foto
function png() {
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const trozo = (tipo, datos) => { const l = Buffer.alloc(4); l.writeUInt32BE(datos.length);
    const td = Buffer.concat([Buffer.from(tipo), datos]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const cab = Buffer.alloc(13); cab.writeUInt32BE(8, 0); cab.writeUInt32BE(8, 4); cab[8] = 8; cab[9] = 2;
  const filas = Buffer.concat([...Array(8)].map((_, y) => Buffer.from([0, ...[...Array(8)].flatMap((_, x) => [x * 30, y * 30, 200])])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", cab),
                        trozo("IDAT", deflateSync(filas)), trozo("IEND", Buffer.alloc(0))]);
}
const dirFoto = mkdtempSync(join(tmpdir(), "nevera-foto-"));
const FOTO = join(dirFoto, "foto.png");
writeFileSync(FOTO, png());

// ------------------------------------------------------------------ el navegador
const nav = await abrir({ ancho: 390, alto: 844 });
const ESTATICO = /^\/(assets|fonts)\/|^\/favicon\.svg$|^\/$/;
const deApi = () => nav.peticiones.filter((p) => p.url.startsWith(BASE) && !ESTATICO.test(p.url.slice(BASE.length)));
const texto = () => nav.evaluar("document.body.innerText");
const sonda = () => nav.evaluar("JSON.parse(JSON.stringify(window.__nevera || null))");
const hay = (sel) => nav.evaluar(`!!document.querySelector(${JSON.stringify(sel)})`);
const cuantos = (sel) => nav.evaluar(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
async function escribir(sel, valor) {   // como el teclado: el setter nativo y el evento input que React escucha
  await nav.evaluar(`(() => { const n = document.querySelector(${JSON.stringify(sel)});
    const proto = n instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, ${JSON.stringify(valor)});
    n.dispatchEvent(new Event(n instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true; })()`);
}
const entrar = async (t) => { await escribir("#token", t); await nav.evaluar("document.querySelector('#f-token').requestSubmit(), true"); };
const tarjeta = (nombre) => `[...document.querySelectorAll('[data-elemento]')].find((n) => n.querySelector('.tarjeta-nombre').textContent.includes(${JSON.stringify(nombre)}))`;
async function accion(nombre, a, fecha) {
  await nav.evaluar(`${tarjeta(nombre)}.querySelector('[data-accion="${a}"]').click(), true`);
  await nav.esperar(`!!${tarjeta(nombre)}?.querySelector('form.confirma')`);
  if (fecha) {
    await nav.evaluar(`(() => { const i = ${tarjeta(nombre)}.querySelector('form.confirma input[type=date]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(fecha)});
      i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  }
  await nav.evaluar(`${tarjeta(nombre)}.querySelector('form.confirma').requestSubmit(), true`);
}
const deLaApi = async (token, nombre) => (await api(token, "GET", "/elementos?estado=todos")).json.filter((e) => e.producto === nombre);

try {
  // 1. sin token
  await nav.ir(BASE + "/");
  await nav.esperar("!!document.querySelector('#f-token')");
  await nav.pintado();
  ok(deApi().length === 0, `sin token la página no pide nada a la API (${deApi().length} peticiones)`);
  ok(!(await texto()).includes(P) && (await cuantos("[data-elemento], .cifras, .seccion")) === 0,
     "sin token no se ve ningún dato (ni cifras, ni secciones, ni tarjetas)");

  // 2. token que no vale
  await entrar("este-token-no-vale-0123456789");
  await nav.esperar("!!document.querySelector('#token-error')");
  const err = await nav.evaluar("document.querySelector('#token-error').textContent");
  ok(/no vale/.test(err), `token malo: lo dice claro («${err}»)`);
  ok(!(await hay(".cifras")) && (await nav.evaluar("localStorage.getItem('nevera.token') === null")),
     "token malo: no deja seguir y no se guarda");
  ok(deApi().length === 1 && deApi()[0].url === BASE + "/miembros/yo", "token malo: la única petición a la API fue GET /miembros/yo");

  // 3. lector
  const antes = deApi().length;
  await entrar(lec.json.token);
  await nav.esperar("window.__nevera && window.__nevera.listo");
  await nav.pintado();
  const tras = deApi().slice(antes);
  ok(tras[0] && tras[0].url === BASE + "/miembros/yo" && tras.every((p) => p.conToken),
     `lector: /miembros/yo va primero (${tras.length} peticiones, todas con token)`);
  ok(tras.every((p) => p.metodo === "GET"), "lector: la pantalla solo hizo GET");

  const s = await sonda();
  const ind = (await api(lec.json.token, "GET", "/indicadores")).json;
  const pv = (await api(lec.json.token, "GET", "/elementos?por_vencer=7")).json;
  const suma = pv.filter((e) => e.precio_unitario_cop !== null).reduce((a, e) => a + e.precio_unitario_cop, 0);
  ok(s.elementos === ind.elementos_disponibles && s.pintados === 6, `cifras: ${s.pintados} pintados = ${ind.elementos_disponibles} disponibles`);
  ok(s.vencidos === ind.vencidos && s.vencidos === 1, `cifras: vencidas ${s.vencidos} = indicadores.vencidos ${ind.vencidos}`);
  ok(s.en7 === ind.por_vencer_7 && s.en7 === 3, `cifras: en ≤ 7 días ${s.en7} = indicadores.por_vencer_7 ${ind.por_vencer_7}`);
  ok(s.hoy_vencen === 1 && s.en2 === 2, `cifras: vencen hoy ${s.hoy_vencen}, en ≤ 2 días ${s.en2}`);
  ok(s.por_vencer === pv.length && s.riesgo_cop === suma && suma === 17000 && s.riesgo_sin_precio === 1,
     `valor en riesgo: ${s.riesgo_cop} COP = suma de GET /elementos?por_vencer=7 (${pv.length} cosas, 1 sin precio que no suma)`);
  const cifrasTexto = await nav.evaluar("document.querySelector('[data-cifra=riesgo]').innerText");
  ok(/17\.000/.test(cifrasTexto) && /1 sin precio/.test(cifrasTexto), `el tile lo dice («${cifrasTexto.replace(/\s+/g, " ")}»)`);
  ok(s.secciones.nevera.total === 4 && s.secciones.despensa.total === 2 && s.secciones.congelador.total === 0 &&
     s.secciones.frutero.total === 0, `secciones: nevera 4 (con la puerta), despensa 2, congelador 0, frutero 0`);
  const orden = await nav.evaluar(`[...document.querySelectorAll('[data-seccion=nevera] [data-elemento]')].map((n) => n.dataset.semaforo).join(',')`);
  ok(orden === "vencido,urgente,bien,sin-fecha", `nevera por urgencia: ${orden}`);
  ok(/^Vencido/.test(await nav.evaluar("document.querySelector('[data-seccion=nevera] [data-elemento] .tarjeta-nombre').textContent")),
     "lo vencido arriba de todo, con su marca «Vencido»");
  const vacio = await nav.evaluar("document.querySelector('[data-seccion=congelador] .vacio').innerText");
  ok(vacio.trim() === "El congelador está vacío.", `lector: frase de vacío sin invitar a agregar («${vacio.trim()}»)`);
  ok((await cuantos("[data-accion], .acciones, .confirma")) === 0, "lector: ningún botón de acción");
  ok(!(await hay("#ir-alta")) && !(await hay("#f-alta")), "lector: «Agregar» no existe en el DOM");
  if (CAPTURAS) {   // el rojo, el ámbar, el verde y lo vencido, que la base real hoy no tiene
    await nav.evaluar("document.querySelector('.herramientas').scrollIntoView(), true");
    await nav.evaluar("document.fonts.ready.then(() => true)");
    await nav.captura(`${CAPTURAS}/semaforo-4.png`);
    ok(true, `captura del semáforo (base desechable) → ${CAPTURAS}/semaforo-4.png`);
  }
  const elId = (await deLaApi(lec.json.token, `${P} lejos`))[0].id;
  const prohibido = await api(lec.json.token, "POST", "/movimientos", { elemento_id: elId, tipo: "merma" });
  ok(prohibido.status === 403, `lector: el servidor igual responde 403 a una merma a mano (${prohibido.status})`);
  await nav.evaluar("location.reload(), true");
  await nav.esperar("window.__nevera && window.__nevera.listo && window.__nevera.pintados === 6");
  ok(true, "lector: tras recargar entra con el token guardado (validado otra vez)");

  // 4. revocado
  await api(ADMIN, "PATCH", `/miembros/${lec.json.id}`, { activo: false });
  await nav.evaluar("document.dispatchEvent(new Event('visibilitychange')), true");   // el móvil vuelve a la app
  await nav.esperar("!!document.querySelector('#f-token')");
  ok(!(await texto()).includes(P) && (await cuantos("[data-elemento], .cifras")) === 0, "revocado: los datos salen del DOM");
  ok(await nav.evaluar("localStorage.getItem('nevera.token') === null"), "revocado: el token se olvida en el dispositivo");
  ok(await nav.evaluar("window.__nevera === undefined"), "revocado: la sonda también se borra (ni las cifras quedan en window)");

  // 5. editor
  await entrar(ed.json.token);
  await nav.esperar("window.__nevera && window.__nevera.listo && window.__nevera.pintados === 6");
  const acc = await nav.evaluar(`[...${tarjeta(`${P} lejos`)}.querySelectorAll('.acciones > *')].map((b) => b.textContent).join('|')`);
  ok(acc === "Abrí|Se acabó|Botar|Fecha", `editor: ve las cuatro acciones (${acc})`);
  const vacioEd = await nav.evaluar("document.querySelector('[data-seccion=frutero] .vacio p').innerText");
  ok(vacioEd === "El frutero está vacío: agrega lo primero.", `editor: frase de vacío («${vacioEd}»)`);
  ok(await hay("#ir-alta"), "editor: ve «Agregar»");

  await nav.evaluar("document.querySelector('[data-seccion=nevera] .seccion-titulo button').click(), true");
  await nav.esperar("window.__nevera.secciones.nevera.plegada === true");
  ok((await sonda()).secciones.nevera.pintados === 0 &&
     (await nav.evaluar("document.querySelector('[data-seccion=nevera] .seccion-titulo button').getAttribute('aria-expanded')")) === "false",
     "plegar: la nevera se cierra (aria-expanded=false, sin tarjetas) y conserva su conteo");
  await nav.evaluar("document.querySelector('[data-seccion=nevera] .seccion-titulo button').click(), true");
  await nav.esperar("window.__nevera.secciones.nevera.pintados === 4");

  await escribir("#buscar", "GARANTÍA-" + P.slice(9) + " CINCO".toLowerCase());
  await nav.esperar("window.__nevera.pintados === 1");
  ok(true, "buscador: sin tildes ni mayúsculas encuentra 1");
  await escribir("#buscar", "");
  await nav.evaluar("document.querySelector('#por-vencer').click(), true");
  await nav.esperar("window.__nevera.pintados === 4");
  ok((await nav.evaluar("document.querySelector('#por-vencer').getAttribute('aria-pressed')")) === "true",
     "filtro «por vencer»: 4 (lo vencido y lo de ≤ 7 días)");
  await nav.evaluar("document.querySelector('#por-vencer').click(), true");
  await nav.esperar("window.__nevera.pintados === 6");

  const lejos = (await deLaApi(ed.json.token, `${P} lejos`))[0];
  await accion(`${P} lejos`, "fecha", dia(lejos.vencimiento, 1));
  await nav.esperar(`${tarjeta(`${P} lejos`)}.querySelector('.dias').textContent === '31 días'`);
  ok((await deLaApi(ed.json.token, `${P} lejos`))[0].vencimiento === dia(lejos.vencimiento, 1), "Fecha: la API tiene la fecha nueva y la tarjeta dice 31 días");
  await accion(`${P} lejos`, "abri");
  await nav.esperar(`!!${tarjeta(`${P} lejos`)}?.querySelector('.tarjeta-extra')`);
  ok((await deLaApi(ed.json.token, `${P} lejos`))[0].abierto_en === hoy, "Abrí: abierto_en = hoy del servidor");
  await accion(`${P} sin fecha`, "acabo");
  await nav.esperar(`!${tarjeta(`${P} sin fecha`)}`);
  const sf = (await deLaApi(ed.json.token, `${P} sin fecha`))[0];
  const movSf = (await api(ed.json.token, "GET", `/movimientos?elemento_id=${sf.id}`)).json;
  ok(sf.saldo === 0 && movSf.length === 1 && movSf[0].tipo === "consumo" && movSf[0].miembro_id === ed.json.id,
     "Se acabó: consumo por el saldo entero, a nombre del editor, y sale de la lista");
  await accion(`${P} vencido`, "botar");
  await nav.esperar(`!${tarjeta(`${P} vencido`)}`);
  const ve = (await deLaApi(ed.json.token, `${P} vencido`))[0];
  const movVe = (await api(ed.json.token, "GET", `/movimientos?elemento_id=${ve.id}`)).json;
  ok(ve.saldo === 0 && movVe[0].tipo === "merma" && movVe[0].motivo === "vencido", "Botar: merma con motivo «vencido»");
  ok((await sonda()).vencidos === 0, "las cifras se rehacen tras la acción (0 vencidas)");

  // 6. alta rápida
  const anchoTablero = await nav.evaluar("document.documentElement.scrollWidth");
  await nav.tocar("#ir-alta");
  await nav.esperar("!!document.querySelector('#f-alta')");
  ok(await nav.evaluar("document.activeElement && document.activeElement.id === 'a-nombre'"), "alta: el foco va solo a «Nombre»");
  ok((await nav.evaluar("[...document.querySelectorAll('#f-alta input:not([type=file]), #f-alta select')].map((n) => n.id).join(',')")) ===
     "a-nombre,a-categoria,a-cantidad,a-unidad,a-ubicacion,a-vence", "alta: los cinco campos (nombre, categoría, cantidad+unidad, ubicación, vencimiento)");
  const hints = await nav.evaluar("[...document.querySelectorAll('#f-alta [enterkeyhint]')].map((n) => n.getAttribute('enterkeyhint')).join(',')");
  ok(hints === "next,next,next,done", `alta: teclado «siguiente» en nombre, categoría y cantidad; «listo» en la fecha (${hints})`);
  await nav.cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await nav.cmd("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  ok(await nav.evaluar("document.activeElement.id === 'a-categoria'") && !(await hay("#a-msg")),
     "alta: Enter en «Nombre» pasa a «Categoría» sin enviar");
  const anchoAlta = await nav.evaluar("document.documentElement.scrollWidth");
  const chicos = await nav.evaluar(`[...document.querySelectorAll('button, input:not([type=file]), select')]
      .filter((n) => n.offsetParent !== null && n.getBoundingClientRect().height < 40).map((n) => n.id || n.className)`);

  const productosAntes = (await api(ed.json.token, "GET", "/productos")).json.length;
  // existente, escrito distinto
  await escribir("#a-nombre", `${P.toUpperCase()} CINCO`);
  await escribir("#a-cantidad", "2");
  await escribir("#a-vence", dia(hoy, 4));
  await nav.evaluar("document.querySelector('#f-alta').requestSubmit(), true");
  await nav.esperar("!!document.querySelector('#a-msg')");
  const m1 = await nav.evaluar("document.querySelector('#a-msg').textContent");
  const cinco = await deLaApi(ed.json.token, `${P} cinco`);
  ok(/^Agregado/.test(m1) && cinco.length === 2 && (await api(ed.json.token, "GET", "/productos")).json.length === productosAntes &&
     (await nav.evaluar("window.__neveraAlta.camino")) === "elementos",
     `alta de un existente: POST /elementos, no duplica el producto («${m1}»)`);
  ok(await nav.evaluar("document.activeElement.id === 'a-nombre' && document.querySelector('#a-nombre').value === ''"),
     "alta: tras guardar, el foco vuelve a «Nombre» vacío");
  // nuevo sin foto
  await escribir("#a-nombre", `${P} nuevo`);
  await escribir("#a-categoria", "garantías");
  await escribir("#a-cantidad", "1.5");
  await escribir("#a-unidad", "kg");
  await escribir("#a-ubicacion", String((await api(ed.json.token, "GET", "/ubicaciones")).json.find((u) => u.nombre === "congelador").id));
  await nav.evaluar("document.querySelector('#f-alta').requestSubmit(), true");
  await nav.esperar(`/nuevo/.test(document.querySelector('#a-msg')?.textContent || '')`);
  const nuevo = (await deLaApi(ed.json.token, `${P} nuevo`))[0];
  ok(nuevo && nuevo.saldo === 1500 && nuevo.unidad_base === "g" && (await nav.evaluar("window.__neveraAlta.camino")) === "importar",
     `alta de un nuevo: POST /importar, 1,5 kg → ${nuevo && nuevo.saldo} g en el congelador`);
  // nuevo con foto
  await escribir("#a-nombre", `${P} con foto`);
  await escribir("#a-categoria", "garantías");
  await escribir("#a-cantidad", "1");
  await escribir("#a-unidad", "u");
  const { root } = await nav.cmd("DOM.getDocument", { depth: 0 });
  const { nodeId } = await nav.cmd("DOM.querySelector", { nodeId: root.nodeId, selector: "#a-foto" });
  await nav.cmd("DOM.setFileInputFiles", { nodeId, files: [FOTO] });
  await nav.esperar("!!document.querySelector('.foto-vista')");
  await nav.evaluar("document.querySelector('#f-alta').requestSubmit(), true");
  await nav.esperar(`/con foto/.test(document.querySelector('#a-msg')?.textContent || '')`, 15000);
  const cf = (await deLaApi(ed.json.token, `${P} con foto`))[0];
  const det = cf && (await api(ed.json.token, "GET", `/elementos/${cf.id}`)).json;
  const ruta = det && det.fotos[0] && join(DATOS, det.fotos[0].ruta);
  ok(det && det.fotos.length === 1 && /^fotos\//.test(det.fotos[0].ruta) && existsSync(ruta) &&
     (await nav.evaluar("window.__neveraAlta.camino")) === "producto+elementos",
     `alta con foto (D5): producto_foto ${det && det.fotos[0] && det.fotos[0].ruta} y el archivo en <datos>/fotos`);
  const ms = await nav.evaluar("window.__neveraAlta.ms_servidor");
  console.log(`      última alta (con foto, cuatro peticiones): ${ms} ms de red y servidor`);

  // 7. móvil
  ok(anchoTablero <= 390 && anchoAlta <= 390, `sin scroll horizontal a 390 px (tablero ${anchoTablero}, alta ${anchoAlta})`);
  ok(chicos.length === 0, `objetivos táctiles de 40 px o más (${chicos.length ? chicos.join(", ") : "todos"})`);
  await nav.evaluar("document.querySelector('.volver').click(), true");
  await nav.esperar("window.__nevera && window.__nevera.listo");
  const chicosT = await nav.evaluar(`[...document.querySelectorAll('button, input, select')]
      .filter((n) => n.offsetParent !== null && n.getBoundingClientRect().height < 40).map((n) => n.id || n.className)`);
  ok(chicosT.length === 0, `tablero: objetivos táctiles de 40 px o más (${chicosT.length ? chicosT.join(", ") : "todos"})`);
  const cong = (await sonda()).secciones.congelador.total;   // el nuevo y el de foto: la ubicación se mantiene entre altas
  ok(cong === 2, `de vuelta al tablero, el congelador ya tiene lo agregado (${cong})`);

  const malas = nav.consola.filter((l) => l.startsWith("EXCEPCIÓN") || /Content Security Policy|Refused/.test(l));
  ok(malas.length === 0, `sin excepciones ni avisos de CSP (${malas.join("; ") || "ninguno"})`);
} finally {
  await nav.cerrar();
  rmSync(dirFoto, { recursive: true, force: true });
}
console.log(fallos ? `GARANTÍAS: ${fallos} FALLA(S)` : "GARANTÍAS OK");
process.exit(fallos ? 1 : 0);
