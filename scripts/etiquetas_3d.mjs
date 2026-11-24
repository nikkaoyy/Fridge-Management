// PEDIDO-NEVERA-9, bloque 2: los rótulos de la vista 3D, contados. SOLO LEE (no crea filas).
//
//   node scripts/etiquetas_3d.mjs http://127.0.0.1:8463 /tmp/nevera9/admin.token [carpeta-capturas]
//
// A 1440×900 (escritorio, ratón fuera del lienzo) y a 390×844 (táctil, ×3), sin interacción, cuenta con las cajas que
// da la escena (`window.__nevera.escena.etiquetas.cajas`: lo que se pinta, en px CSS desde la esquina del lienzo):
//   - pares de rótulos solapados (intersección con área > 0), calculado aquí, no con el contador del motor;
//   - rótulos fuera del contenedor (alguna esquina fuera de [0, ancho] × [0, alto] del lienzo);
//   - rótulos visibles.
// Criterio: solapados 0, fuera 0, visibles ≤ 6. Después encuadra un compartimento como al tocar su hueco (la despensa
// en escritorio; en el móvil también, con `encuadrar`, el mismo camino que el toque) y vuelve a contar: se suman sus
// rótulos, y siguen 0 solapados y 0 fuera.
// Además coteja el encabezado de la vista («81 cosas · 45 vencidas · 8 en ≤ 7») con la API en ese momento:
// `/indicadores` y `/vencimientos` (el pedido decía `/resumen`, que no existe en el contrato: se prueba y se dice).
import { readFileSync } from "node:fs";
import { abrir } from "./navegador.mjs";

const BASE = process.argv[2].replace(/\/$/, "");
const TOKEN = readFileSync(process.argv[3], "utf8").trim();
const DIR = process.argv[4] || null;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const ok = (cond, texto) => { console.log((cond ? "OK    " : "FALLA ") + texto); if (!cond) fallos++; };
const api = async (ruta) => {
  const r = await fetch(BASE + ruta, { headers: { Authorization: "Bearer " + TOKEN } });
  return { status: r.status, json: r.ok ? await r.json() : null };
};

function contar(etq) {
  const [W, H] = etq.contenedor;
  const c = etq.cajas;
  const pares = [];
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      const ix = Math.min(c[i].x1, c[j].x1) - Math.max(c[i].x0, c[j].x0);
      const iy = Math.min(c[i].y1, c[j].y1) - Math.max(c[i].y0, c[j].y0);
      if (ix > 0 && iy > 0) pares.push(`${c[i].nombre} × ${c[j].nombre}`);
    }
  }
  const fuera = c.filter((k) => k.x0 < 0 || k.y0 < 0 || k.x1 > W || k.y1 > H).map((k) => `${k.nombre} [${k.x0},${k.y0},${k.x1},${k.y1}]`);
  return { visibles: c.length, solapados: pares.length, pares, fuera: fuera.length, cuales: fuera, W, H };
}

async function pasada(ancho, alto, movil) {
  const nav = await abrir({ ancho, alto, escala: movil ? 3 : 1, movil, webgl: true });
  const etiqueta = `${ancho}×${alto}${movil ? " táctil" : ""}`;
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
    if (!movil) await nav.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
    await espera(2500);
    await nav.pintado();
    const leer = () => nav.evaluar("JSON.parse(JSON.stringify(window.__nevera.escena.etiquetas))");

    // Sin interacción.
    const etq = await leer();
    const n = contar(etq);
    console.log(`\n[${etiqueta}] lienzo ${n.W}×${n.H} px, sin interacción, compartimento activo: ${etq.activo ?? "ninguno"}`);
    for (const k of etq.cajas) console.log(`      ${k.estilo.padEnd(13)} ${k.nombre}  [${k.x0}, ${k.y0}, ${k.x1}, ${k.y1}]`);
    ok(n.solapados === 0, `${etiqueta}: pares de rótulos solapados = ${n.solapados}${n.pares.length ? ` (${n.pares.join("; ")})` : ""} (motor: ${etq.solapes})`);
    ok(n.fuera === 0, `${etiqueta}: rótulos fuera del contenedor = ${n.fuera}${n.cuales.length ? ` (${n.cuales.join("; ")})` : ""}`);
    ok(n.visibles <= 6, `${etiqueta}: rótulos visibles sin interacción = ${n.visibles} (≤ 6); ceden: ${etq.ocultas.length ? etq.ocultas.join(", ") : "ninguno"}`);
    if (DIR) await nav.captura(`${DIR}/etiquetas-${ancho}x${alto}.png`);

    // El encabezado contra la API, en este momento.
    const texto = await nav.evaluar("document.querySelector('.resumen-3d')?.textContent ?? ''");
    const num = (re) => Number((texto.match(re) || [, 0])[1]);
    const cab = { cosas: num(/(\d+) cosas?/), vencidas: num(/(\d+) vencidas?/), en2: num(/(\d+) en ≤ 2 días/), en7: num(/(\d+) en ≤ 7\b/) };
    const [ind, ven, res] = await Promise.all([api("/indicadores"), api("/vencimientos"), api("/resumen")]);
    // /vencimientos trae listas (vencidos, hoy_vencen, proximos): se cuentan.
    const largo = (x) => (Array.isArray(x) ? x.length : x);
    const v = { dias: ven.json.dias, vencidos: largo(ven.json.vencidos), hoy_vencen: largo(ven.json.hoy_vencen), proximos: largo(ven.json.proximos) };
    const i = ind.json;
    ok(cab.cosas === i.elementos_disponibles && cab.vencidas === v.vencidos && cab.vencidas === i.vencidos &&
       cab.en2 + cab.en7 === v.hoy_vencen + v.proximos && cab.en2 + cab.en7 === i.por_vencer_7,
       `${etiqueta}: encabezado «${texto}» = /indicadores (${i.elementos_disponibles} disponibles, ${i.vencidos} vencidos, ${i.por_vencer_7} por vencer en 7) y /vencimientos (${v.vencidos} vencidos, ${v.hoy_vencen} hoy + ${v.proximos} próximos en ${v.dias} días); GET /resumen → ${res.status}`);

    // Tocar un compartimento: se suman los suyos.
    await nav.evaluar("(window.__nevera.escena.encuadrar('despensa'), true)");
    await espera(2500);
    await nav.pintado();
    const etqT = await leer();
    const t = contar(etqT);
    console.log(`[${etiqueta}] con la despensa encuadrada (activo: ${etqT.activo}): ${etqT.cajas.map((k) => `${k.nombre} (${k.estilo})`).join(", ")}`);
    ok(etqT.activo === "despensa" && etqT.cajas.some((k) => k.estilo === "compartimento" && k.nombre === "despensa") && t.solapados === 0 && t.fuera === 0,
       `${etiqueta}: al encuadrar la despensa se suma su rótulo y sus nombres: ${t.visibles} visibles, ${t.solapados} solapados, ${t.fuera} fuera`);
    if (DIR) await nav.captura(`${DIR}/etiquetas-${ancho}x${alto}-despensa.png`);
    return { etiqueta, sinInteraccion: n, despensa: t };
  } finally {
    await nav.cerrar();
  }
}

const r1 = await pasada(1440, 900, false);
const r2 = await pasada(390, 844, true);
console.log("\n" + JSON.stringify({ escritorio: r1.sinInteraccion, movil: r2.sinInteraccion }));
console.log(fallos ? `\n${fallos} FALLAN` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
