// Garantías de la pantalla (PEDIDO-NEVERA-3, bloque 3) en Chrome headless a 390×844, contra un servicio vivo.
//
// CREA FILAS (un editor, un lector y un elemento): se niega a correr si la base del servicio no está en /tmp.
//
//   mkdir /tmp/nevera-garantias
//   export NEVERA_DATOS=/tmp/nevera-garantias NEVERA_HOST=127.0.0.1 NEVERA_PUERTO=8452 \
//          NEVERA_ADMIN_TOKEN="$(openssl rand -hex 24)"
//   scripts/arrancar.sh && node scripts/garantias_pantalla.mjs http://127.0.0.1:8452; scripts/parar.sh
//   rm -rf /tmp/nevera-garantias
//
// Comprueba, mirando el DOM y TODAS las peticiones de red de la página:
//   1. Sin token: se ve el formulario del token y ningún dato; la página no pide nada a la API.
//   2. Token que no vale: lo dice, no deja seguir, no lo guarda; la única petición es GET /miembros/yo.
//   3. Lector: /miembros/yo va antes que cualquier otra petición a la API; ve la lista y ningún botón que no puede
//      usar (ni acciones ni «Agregar»); el servidor igual le responde 403 si lo intenta a mano.
//   4. Token revocado en el servidor: la pantalla lo olvida y saca los datos del DOM.
//   5. Editor: sí ve las cuatro acciones y «Agregar»; sin scroll horizontal en la lista ni en el alta.
// Los tokens no se imprimen.
import { abrir } from "./navegador.mjs";

const BASE = (process.argv[2] || "http://127.0.0.1:8452").replace(/\/$/, "");
const ADMIN = process.env.NEVERA_ADMIN_TOKEN;
const NOMBRE = "garantia-" + Math.random().toString(36).slice(2, 8);   // producto de la base desechable
let fallos = 0;
const ok = (cond, texto) => { console.log((cond ? "OK    " : "FALLA ") + texto); if (!cond) fallos++; };

async function api(token, metodo, ruta, cuerpo, tipo) {
  const h = { Authorization: "Bearer " + token };
  if (cuerpo !== undefined) h["Content-Type"] = tipo || "application/json";
  const r = await fetch(BASE + ruta, { method: metodo, headers: h,
                                       body: cuerpo === undefined ? undefined : (tipo ? cuerpo : JSON.stringify(cuerpo)) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

if (!ADMIN) { console.error("falta NEVERA_ADMIN_TOKEN (el admin de la base desechable)"); process.exit(2); }
const salud = await (await fetch(BASE + "/salud")).json();
if (!String(salud.base).startsWith("/tmp/")) {
  console.error(`la base del servicio es ${salud.base}: este script crea filas y solo corre contra una base en /tmp`);
  process.exit(2);
}

const ed = await api(ADMIN, "POST", "/miembros", { nombre: NOMBRE + "-editor", rol: "editor" });
const lec = await api(ADMIN, "POST", "/miembros", { nombre: NOMBRE + "-lector", rol: "lector" });
if (ed.status !== 201 || lec.status !== 201) { console.error("no se pudieron crear los miembros", ed.status, lec.status); process.exit(2); }
const hoy = (await api(ADMIN, "GET", "/vencimientos?dias=1")).json.hoy;
const imp = await api(ADMIN, "POST", "/importar",
  `nombre,categoria,unidad,cantidad,fecha_compra,fecha_vencimiento,precio_unitario\n${NOMBRE},garantias,u,1,${hoy},${hoy},\n`,
  "text/csv");
if (imp.status !== 200) { console.error("no se pudo importar el elemento de prueba", imp.status); process.exit(2); }

const nav = await abrir({ ancho: 390, alto: 844 });
const deApi = () => nav.peticiones.filter((p) => !p.url.startsWith(BASE + "/estatico/") && p.url !== BASE + "/" &&
                                                 p.url.startsWith(BASE));
const texto = () => nav.evaluar("document.body.innerText");
const entrar = (t) => nav.evaluar(`document.querySelector('#token').value = ${JSON.stringify(t)};
                                  document.querySelector('#f-token').requestSubmit()`);
try {
  // 1. sin token
  await nav.ir(BASE + "/");
  await nav.esperar("!document.querySelector('#v-token').hidden");
  await nav.pintado();
  ok(deApi().length === 0, `sin token la página no pide nada a la API (${deApi().length} peticiones)`);
  ok(!(await texto()).includes(NOMBRE) && (await nav.evaluar("document.querySelectorAll('#lista li').length")) === 0,
     "sin token no se ve ningún dato");
  ok(await nav.evaluar("document.querySelector('#v-lista').hidden && document.querySelector('#pie').hidden"),
     "sin token no hay lista ni navegación");

  // 2. token que no vale
  await entrar("este-token-no-vale-0123456789");
  await nav.esperar("!document.querySelector('#token-error').hidden");
  const err = await nav.evaluar("document.querySelector('#token-error').textContent");
  ok(/no vale/.test(err), `token malo: lo dice claro («${err}»)`);
  ok(await nav.evaluar("document.querySelector('#v-lista').hidden && localStorage.getItem('nevera.token') === null"),
     "token malo: no deja seguir y no se guarda");
  ok(deApi().length === 1 && deApi()[0].url === BASE + "/miembros/yo",
     "token malo: la única petición a la API fue GET /miembros/yo");

  // 3. lector
  const antes = deApi().length;
  await entrar(lec.json.token);
  await nav.esperar("document.querySelectorAll('#lista li').length > 0");
  await nav.pintado();
  const tras = deApi().slice(antes);
  ok(tras[0] && tras[0].url === BASE + "/miembros/yo" && tras.every((p) => p.conToken),
     `lector: /miembros/yo va primero (${tras.length} peticiones, todas con token)`);
  ok(tras.every((p) => p.metodo === "GET"), "lector: la pantalla solo hizo GET");
  ok((await texto()).includes(NOMBRE), "lector: ve la lista");
  const botones = await nav.evaluar("document.querySelectorAll('.acciones, .confirma, button.accion, [data-accion]').length");
  ok(botones === 0, `lector: ningún botón de acción en la lista (${botones})`);
  ok(await nav.evaluar("document.querySelector('#ir-alta').hidden"), "lector: «Agregar» no aparece");
  await nav.evaluar("document.querySelector('#ir-alta').click()");
  ok(await nav.evaluar("document.querySelector('#v-alta').hidden"), "lector: el formulario de alta no se abre ni forzando el clic");
  const elId = (await api(lec.json.token, "GET", "/elementos")).json.find((e) => e.producto === NOMBRE).id;
  const prohibido = await api(lec.json.token, "POST", "/movimientos", { elemento_id: elId, tipo: "merma" });
  ok(prohibido.status === 403, `lector: el servidor igual responde 403 a una merma a mano (${prohibido.status})`);
  await nav.evaluar("location.reload()");
  await nav.esperar("document.querySelectorAll('#lista li').length > 0");
  ok(true, "lector: tras recargar entra con el token guardado (validado otra vez)");

  // 4. token revocado
  await api(ADMIN, "PATCH", `/miembros/${lec.json.id}`, { activo: false });
  await nav.evaluar("document.querySelector('#ir-lista').click()");
  await nav.esperar("!document.querySelector('#v-token').hidden");
  ok(!(await texto()).includes(NOMBRE) && (await nav.evaluar("document.querySelectorAll('#lista li').length")) === 0,
     "revocado: los datos salen del DOM");
  ok(await nav.evaluar("localStorage.getItem('nevera.token') === null"), "revocado: el token se olvida en el dispositivo");

  // 5. editor
  await entrar(ed.json.token);
  await nav.esperar("document.querySelectorAll('#lista li').length > 0");
  await nav.pintado();
  const acc = await nav.evaluar("[...document.querySelectorAll('.acciones')[0].children].map((b) => b.textContent).join('|')");
  ok(acc === "Abrí|Se acabó|Botar|Fecha", `editor: ve las cuatro acciones (${acc})`);
  ok(!(await nav.evaluar("document.querySelector('#ir-alta').hidden")), "editor: ve «Agregar»");
  const anchoLista = await nav.evaluar("document.documentElement.scrollWidth");
  await nav.evaluar("document.querySelector('#ir-alta').click()");
  await nav.esperar("!document.querySelector('#v-alta').hidden");
  const anchoAlta = await nav.evaluar("document.documentElement.scrollWidth");
  ok(anchoLista <= 390 && anchoAlta <= 390, `sin scroll horizontal a 390 px (lista ${anchoLista}, alta ${anchoAlta})`);
  const chicos = await nav.evaluar(`[...document.querySelectorAll('button, input, select')]
      .filter((n) => n.offsetParent !== null && n.getBoundingClientRect().height < 40).length`);
  ok(chicos === 0, `objetivos táctiles de 40 px o más (${chicos} más chicos)`);

  const excepciones = nav.consola.filter((l) => l.startsWith("EXCEPCIÓN"));
  ok(excepciones.length === 0, `sin excepciones de JavaScript (${excepciones.join("; ") || "ninguna"})`);
} finally {
  await nav.cerrar();
}
console.log(fallos ? `GARANTÍAS: ${fallos} FALLA(S)` : "GARANTÍAS OK");
process.exit(fallos ? 1 : 0);
