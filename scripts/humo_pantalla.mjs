// Humo de la pantalla contra el servicio REAL (PEDIDO-NEVERA-3, bloque 4), en Chrome headless a 390×844.
//
//   node scripts/humo_pantalla.mjs http://127.0.0.1:8451 data/admin.token [docs]
//
// 1. Entra con el token real (leído del archivo; nunca se imprime) por el formulario de la página.
// 2. Pinta la lista y la coteja con GET /elementos: mismos elementos, orden por días, semáforo bien puesto.
// 3. Captura la lista → <docs>/pantalla-3.png.
// 4. Edita un vencimiento DESDE LA PANTALLA (+1 día), ve el cambio en GET /elementos/{id} y lo devuelve, también
//    desde la pantalla, a su fecha original. Solo toca un elemento con vencimiento_origen «manual»: al devolverlo, la
//    fila queda idéntica (PATCH vencimiento deja el origen en «manual»). No crea movimientos, ni filas, ni borra nada;
//    lo comprueba al final (mismo conteo de elementos y de movimientos, misma huella de la lista).
// 5. Abre «Agregar» SIN escribir nada y lo captura → <docs>/alta-3.png.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { abrir } from "./navegador.mjs";

const BASE = (process.argv[2] || "http://127.0.0.1:8451").replace(/\/$/, "");
const TOKEN = readFileSync(process.argv[3] || "data/admin.token", "utf8").trim();
const DOCS = process.argv[4] || "docs";
const ROJO = 2, AMBAR = 7;
let fallos = 0;
const ok = (cond, texto) => { console.log((cond ? "OK    " : "FALLA ") + texto); if (!cond) fallos++; };

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, { method: metodo, headers: { Authorization: "Bearer " + TOKEN,
    ...(cuerpo ? { "Content-Type": "application/json" } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status}`);
  return r.json();
}
const huella = (lista) => createHash("sha256").update(JSON.stringify(lista.map((e) =>
  [e.id, e.saldo, e.vencimiento, e.vencimiento_origen, e.abierto_en, e.ubicacion_id]))).digest("hex").slice(0, 16);
const semaforo = (d) => d === null ? "gris" : d <= ROJO ? "rojo" : d <= AMBAR ? "ambar" : "verde";
const masUnDia = (iso) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

const inicio = await api("GET", "/elementos");
const movsInicio = (await api("GET", "/movimientos")).length;
const huellaInicio = huella(inicio);
console.log(`base real: ${inicio.length} elementos disponibles, ${movsInicio} movimientos, huella ${huellaInicio}`);

const nav = await abrir({ ancho: 390, alto: 844, escala: 2 });
const fila = (id) => `document.querySelector('#lista li[data-id="${id}"]')`;
let restaurar = null;
try {
  await nav.ir(BASE + "/");
  await nav.esperar("!document.querySelector('#v-token').hidden");
  await nav.evaluar(`document.querySelector('#token').value = ${JSON.stringify(TOKEN)};
                     document.querySelector('#f-token').requestSubmit()`);
  await nav.esperar(`document.querySelectorAll('#lista li').length === ${inicio.length}`);
  await nav.evaluar("window.scrollTo(0, 0)");

  // la lista pintada contra el JSON
  const pintada = await nav.evaluar(`[...document.querySelectorAll('#lista li')].map((l) => ({
      id: Number(l.dataset.id), clase: (l.className.match(/sem-(\\w+)/) || [])[1],
      dias: l.querySelector('.dias').textContent, texto: l.innerText }))`);
  const porId = new Map(inicio.map((e) => [e.id, e]));
  ok(pintada.length === inicio.length && pintada.every((p) => porId.has(p.id)),
     `la lista pinta los ${inicio.length} elementos de GET /elementos`);
  const dias = pintada.map((p) => porId.get(p.id).dias_para_vencer);
  const conFecha = dias.filter((d) => d !== null);
  const iNulo = dias.indexOf(null);
  const cabeza = iNulo === -1 ? dias : dias.slice(0, iNulo);
  ok(cabeza.every((d, i) => i === 0 || cabeza[i - 1] <= d) && (iNulo === -1 || dias.slice(iNulo).every((d) => d === null)),
     "ordenada por días que quedan (vencidos arriba, sin fecha al final)");
  const malos = pintada.filter((p) => p.clase !== semaforo(porId.get(p.id).dias_para_vencer));
  ok(malos.length === 0, `semáforo de cada fila acorde a dias_para_vencer (${malos.length} discrepancias)`);
  const cuenta = (c) => pintada.filter((p) => p.clase === c).length;
  console.log(`      semáforo: rojo ${cuenta("rojo")} · ámbar ${cuenta("ambar")} · verde ${cuenta("verde")} · gris ${cuenta("gris")}` +
              ` · días de ${Math.min(...conFecha)} a ${Math.max(...conFecha)}`);
  ok(pintada.every((p) => porId.get(p.id).producto && p.texto.includes(porId.get(p.id).producto)),
     "cada fila muestra el nombre del producto");
  ok(await nav.evaluar("document.documentElement.scrollWidth") <= 390, "sin scroll horizontal");
  await nav.captura(`${DOCS}/pantalla-3.png`);
  ok(true, `captura de la lista → ${DOCS}/pantalla-3.png`);

  // editar un vencimiento desde la pantalla
  const blanco = inicio.find((e) => e.id === pintada[0].id);
  if (blanco.vencimiento_origen !== "manual" || !blanco.vencimiento) {
    throw new Error(`el primer elemento (${blanco.id}) no tiene vencimiento manual: no se edita para no cambiar su origen`);
  }
  const original = blanco.vencimiento, nueva = masUnDia(original);
  restaurar = { id: blanco.id, vencimiento: original };
  const editar = async (fecha) => {
    await nav.evaluar(`${fila(blanco.id)}.querySelector('[data-accion=fecha]').click()`);
    await nav.esperar(`${fila(blanco.id)}.querySelector('.confirma input[type=date]')`);
    await nav.evaluar(`(() => { const f = ${fila(blanco.id)}; f.querySelector('input[type=date]').value = ${JSON.stringify(fecha)};
                               f.querySelector('.si').click(); })()`);
    await nav.esperar(`${fila(blanco.id)} && ${fila(blanco.id)}.querySelector('.acciones')`);
  };
  console.log(`      elemento ${blanco.id} («${blanco.producto}»): vencimiento ${original} (${blanco.vencimiento_origen})`);
  await editar(nueva);
  const tras = await api("GET", `/elementos/${blanco.id}`);
  ok(tras.vencimiento === nueva && tras.vencimiento_origen === "manual",
     `editado desde la pantalla: GET /elementos/${blanco.id} → vencimiento ${tras.vencimiento} (${tras.vencimiento_origen})`);
  const enPantalla = await nav.evaluar(`${fila(blanco.id)}.querySelector('.dias').textContent`);
  ok(enPantalla === (tras.dias_para_vencer === 1 ? "1 día" : tras.dias_para_vencer + " días"),
     `la tarjeta muestra el cambio sin recargar (${enPantalla}; JSON dias_para_vencer ${tras.dias_para_vencer})`);
  await editar(original);
  const devuelto = await api("GET", `/elementos/${blanco.id}`);
  ok(devuelto.vencimiento === original && devuelto.vencimiento_origen === "manual",
     `devuelto desde la pantalla: vencimiento ${devuelto.vencimiento} (${devuelto.vencimiento_origen})`);
  if (devuelto.vencimiento === original) restaurar = null;

  // alta: el formulario vacío
  await nav.tocar("#ir-alta");
  await nav.esperar("!document.querySelector('#v-alta').hidden && document.activeElement.id === 'a-nombre'");
  await nav.evaluar("document.activeElement.blur(); window.scrollTo(0, 0)");
  ok(await nav.evaluar("document.documentElement.scrollWidth") <= 390, "alta: sin scroll horizontal");
  await nav.captura(`${DOCS}/alta-3.png`);
  ok(true, `captura del alta (sin escribir nada) → ${DOCS}/alta-3.png`);

  const excepciones = nav.consola.filter((l) => l.startsWith("EXCEPCIÓN"));
  ok(excepciones.length === 0, `sin excepciones de JavaScript (${excepciones.length})`);
} finally {
  await nav.cerrar();
  if (restaurar) {
    console.log(`ATENCIÓN: el elemento ${restaurar.id} no volvió a ${restaurar.vencimiento}; se devuelve por la API`);
    await api("PATCH", `/elementos/${restaurar.id}`, { vencimiento: restaurar.vencimiento });
  }
}

const fin = await api("GET", "/elementos");
const movsFin = (await api("GET", "/movimientos")).length;
ok(fin.length === inicio.length && movsFin === movsInicio && huella(fin) === huellaInicio,
   `la base queda como estaba: ${fin.length} elementos, ${movsFin} movimientos, huella ${huella(fin)}`);
console.log(fallos ? `HUMO PANTALLA: ${fallos} FALLA(S)` : "HUMO PANTALLA OK");
process.exit(fallos ? 1 : 0);
