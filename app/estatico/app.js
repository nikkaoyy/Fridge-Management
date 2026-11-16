/* Nevera — la pantalla (PEDIDO-NEVERA-3). JavaScript a mano, sin build ni dependencias.
 *
 * Reglas:
 * - Nada de datos hasta validar el token con GET /miembros/yo. Si un 401 llega después (token revocado), se olvida
 *   el token y se borra de la pantalla todo lo pintado.
 * - El token vive solo en localStorage de este dispositivo y solo viaja en la cabecera Authorization.
 * - Todo texto que viene de la API entra con textContent (nunca innerHTML).
 * - Un lector no ve botones que no puede usar: ni acciones por elemento ni «Agregar».
 * - Solo endpoints del contrato (api/openapi.yaml), en el mismo origen:
 *     GET  /miembros/yo, /ubicaciones, /unidades, /categorias, /productos, /elementos, /vencimientos
 *     PATCH /elementos/{id}  (abierto_en = hoy; vencimiento)
 *     POST /movimientos      (consumo o merma sin cantidad: sale el saldo entero, D4)
 *     POST /importar         (alta rápida: una fila de CSV crea producto, presentación y elemento, todo o nada)
 */
"use strict";
(() => {
  const CLAVE = "nevera.token";
  const ROJO = 2, AMBAR = 7;            // semáforo: rojo ≤ 2 días, ámbar ≤ 7, verde el resto
  const UBIC_POR_DEFECTO = "nevera";    // la misma que usa el importador

  const $ = (s) => document.querySelector(s);
  const st = {
    token: null, yo: null, puede: false, hoy: null,
    elementos: [], ubic: new Map(), raiz: new Map(), raices: [], unidades: [], productos: [], categorias: [],
    filtro: "todo", destino: null, q: "", abierto: null, vista: "lista",
  };

  // ------------------------------------------------------------------ utilidades

  function el(tag, attrs, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "texto") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const h of hijos) if (h !== null && h !== undefined && h !== false) n.append(h);
    return n;
  }

  const normal = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const num = (x) => Number(x).toLocaleString("es-CO", { maximumFractionDigits: 2 });
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  function fecha(iso) {
    if (!iso) return "";
    const [a, m, d] = iso.split("-").map(Number);
    const anio = st.hoy && Number(st.hoy.slice(0, 4)) !== a ? " " + a : "";
    return `${d} ${MESES[m - 1]}${anio}`;
  }

  function cantidad(valor, unidad) {
    if (unidad === "g" && valor >= 1000) return num(valor / 1000) + " kg";
    if (unidad === "ml" && valor >= 1000) return num(valor / 1000) + " l";
    return num(valor) + " " + unidad;
  }

  function semaforo(dias) {
    if (dias === null || dias === undefined) return "gris";
    if (dias <= ROJO) return "rojo";
    if (dias <= AMBAR) return "ambar";
    return "verde";
  }

  function textoDias(d) {
    if (d === null || d === undefined) return "sin fecha";
    if (d < 0) return "vencido";
    if (d === 0) return "hoy";
    if (d === 1) return "1 día";
    return d + " días";
  }

  function detalleDias(e) {
    const d = e.dias_para_vencer;
    if (d === null || d === undefined) return "sin vencimiento";
    if (d < -1) return `venció hace ${-d} días (${fecha(e.vencimiento)})`;
    if (d === -1) return `venció ayer (${fecha(e.vencimiento)})`;
    if (d === 0) return "vence hoy";
    if (d === 1) return "vence mañana";
    return "vence " + fecha(e.vencimiento);
  }

  let temporizador = null;
  function aviso(texto, malo) {
    const a = $("#aviso");
    a.textContent = texto;
    a.classList.toggle("malo", !!malo);
    a.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { a.hidden = true; }, malo ? 6000 : 3500);
  }

  // ------------------------------------------------------------------ API

  class ErrorApi extends Error {
    constructor(status, codigo, mensaje) { super(mensaje); this.status = status; this.codigo = codigo; }
  }

  async function api(metodo, ruta, cuerpo, tipo) {
    if (!st.token) throw new ErrorApi(401, "no_autenticado", "sin token");
    const h = { Authorization: "Bearer " + st.token, Accept: "application/json" };
    let body;
    if (cuerpo !== undefined) {
      h["Content-Type"] = tipo || "application/json";
      body = tipo ? cuerpo : JSON.stringify(cuerpo);
    }
    let r;
    try {
      r = await fetch(ruta, { method: metodo, headers: h, body, cache: "no-store", credentials: "omit" });
    } catch (_) {
      throw new ErrorApi(0, "red", "No se pudo hablar con el servidor. ¿Estás en la red de la casa?");
    }
    const datos = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) {
      const e = (datos && datos.error) || {};
      if (r.status === 401 && st.yo) olvidar("El token dejó de valer en el servidor. Escribe uno válido.");
      throw new ErrorApi(r.status, e.codigo || "error", e.mensaje || "error " + r.status);
    }
    return datos;
  }

  // ------------------------------------------------------------------ token

  function mostrar(vista) {
    if (st.vista !== vista) $("#aviso").hidden = true;
    st.vista = vista;
    $("#cargando").hidden = true;
    $("#v-token").hidden = vista !== "token";
    $("#v-lista").hidden = vista !== "lista";
    $("#v-alta").hidden = vista !== "alta";
    $("#pie").hidden = vista === "token";
    $("#quien").hidden = vista === "token";
    for (const [id, v] of [["#ir-lista", "lista"], ["#ir-alta", "alta"]]) {
      if (vista === v) $(id).setAttribute("aria-current", "page"); else $(id).removeAttribute("aria-current");
    }
  }

  function errorToken(texto, reintentar) {
    const p = $("#token-error");
    p.textContent = texto || "";
    p.hidden = !texto;
    $("#reintentar").hidden = !reintentar;
  }

  function borrarPantalla() {
    // Todo lo pintado con datos sale del DOM, no solo se oculta.
    for (const s of ["#lista", "#filtros", "#a-donde", "#dl-productos", "#dl-categorias", "#a-unidad"]) {
      $(s).replaceChildren();
    }
    for (const s of ["#resumen", "#vacio", "#quien-nombre", "#a-msg", "#a-nombre-ayuda", "#aviso"]) {
      $(s).textContent = "";
    }
    $("#aviso").hidden = true;
    $("#f-alta").reset();
    $("#buscar").value = "";
    Object.assign(st, { yo: null, puede: false, hoy: null, elementos: [], ubic: new Map(), raiz: new Map(),
                        raices: [], unidades: [], productos: [], categorias: [], q: "", abierto: null });
  }

  function olvidar(motivo) {
    localStorage.removeItem(CLAVE);
    st.token = null;
    borrarPantalla();
    document.body.classList.remove("lector");
    mostrar("token");
    errorToken(motivo, false);
    $("#token").value = "";
    $("#token").focus();
  }

  async function validar(token) {
    st.token = token;
    try {
      return await api("GET", "/miembros/yo");
    } catch (e) {
      st.token = null;
      throw e;
    }
  }

  function mensajeDeFallo(e) {
    if (e.status === 401) return "Ese token no vale: el servidor lo rechazó. Pídele uno válido al admin.";
    if (e.status === 0) return e.message;
    return `No se pudo validar el token (${e.status}): ${e.message}`;
  }

  async function alEntrar(ev) {
    ev.preventDefault();
    const token = $("#token").value.trim();
    if (!token) { errorToken("Escribe el token.", false); return; }
    const boton = $("#f-token button[type=submit]");
    boton.disabled = true;
    errorToken("", false);
    try {
      const yo = await validar(token);
      localStorage.setItem(CLAVE, token);
      $("#token").value = "";
      await entrar(yo, token);
    } catch (e) {
      if (st.yo) { borrarPantalla(); mostrar("token"); }   // validó, pero falló la carga: nada a medio pintar
      errorToken(mensajeDeFallo(e), false);
    } finally {
      boton.disabled = false;
    }
  }

  async function conGuardado() {
    const token = localStorage.getItem(CLAVE);
    if (!token) { mostrar("token"); errorToken("", false); $("#token").focus(); return; }
    try {
      const yo = await validar(token);
      await entrar(yo, token);
    } catch (e) {
      if (e.status === 401) {
        localStorage.removeItem(CLAVE);
        mostrar("token");
        errorToken("El token guardado en este dispositivo ya no vale. Escribe uno válido.", false);
      } else {
        borrarPantalla();
        mostrar("token");   // el token se queda guardado: el fallo fue de red o del servidor, no del token
        errorToken(mensajeDeFallo(e), true);
      }
    }
  }

  async function entrar(yo, token) {
    st.token = token;
    st.yo = yo;
    st.puede = yo.rol !== "lector";
    document.body.classList.toggle("lector", !st.puede);
    $("#quien-nombre").textContent = yo.nombre + (st.puede ? "" : " · solo lectura");
    $("#ir-alta").hidden = !st.puede;
    const [ubic, unidades, categorias, productos] = await Promise.all([
      api("GET", "/ubicaciones"), api("GET", "/unidades"), api("GET", "/categorias"), api("GET", "/productos"),
    ]);
    prepararUbicaciones(ubic);
    st.unidades = unidades;
    st.categorias = categorias;
    st.productos = productos;
    pintarFiltros();
    if (st.puede) prepararAlta();
    mostrar("lista");
    $("#resumen").textContent = "Cargando…";
    await refrescar();
  }

  // ------------------------------------------------------------------ datos

  function prepararUbicaciones(lista) {
    st.ubic = new Map(lista.map((u) => [u.id, u]));
    st.raiz = new Map();
    for (const u of lista) {
      let r = u, vueltas = 0;
      while (r.padre_id !== null && st.ubic.has(r.padre_id) && vueltas++ < 20) r = st.ubic.get(r.padre_id);
      st.raiz.set(u.id, r.id);
    }
    st.raices = lista.filter((u) => u.padre_id === null);
    const def = st.raices.find((u) => u.nombre === UBIC_POR_DEFECTO) || st.raices[0];
    st.destino = def ? def.id : null;
  }

  async function refrescar() {
    if (!st.yo) return;
    try {
      const [elementos, venc] = await Promise.all([api("GET", "/elementos"), api("GET", "/vencimientos?dias=1")]);
      if (!st.yo) return;
      st.elementos = elementos;
      st.hoy = venc.hoy;
      pintar();
    } catch (e) {
      if (e.status !== 401) aviso("No se pudo cargar la lista: " + e.message, true);
    }
  }

  // ------------------------------------------------------------------ lista

  function pintarFiltros() {
    const caja = $("#filtros");
    const cuenta = new Map();
    for (const e of st.elementos) {
      const r = st.raiz.get(e.ubicacion_id);
      cuenta.set(r, (cuenta.get(r) || 0) + 1);
    }
    const chip = (clave, texto, n) => el("button", {
      type: "button", class: "chip", "aria-pressed": String(st.filtro === clave),
      onclick: () => { st.filtro = clave; if (clave !== "todo") st.destino = clave; st.abierto = null; pintar(); },
    }, texto, st.elementos.length ? el("span", { class: "n", texto: String(n) }) : null);
    caja.replaceChildren(
      chip("todo", "Todo", st.elementos.length),
      ...st.raices.map((u) => chip(u.id, u.nombre, cuenta.get(u.id) || 0)),
    );
  }

  function visibles() {
    const q = normal(st.q);
    return st.elementos
      .filter((e) => st.filtro === "todo" || st.raiz.get(e.ubicacion_id) === st.filtro)
      .filter((e) => !q || normal(e.producto).includes(q) || normal(e.etiqueta).includes(q))
      .sort((a, b) => {
        const da = a.dias_para_vencer, db = b.dias_para_vencer;
        if ((da === null) !== (db === null)) return da === null ? 1 : -1;   // sin fecha al final
        if (da !== db) return da - db;                                       // vencidos (negativos) arriba
        return a.producto.localeCompare(b.producto, "es") || a.id - b.id;
      });
  }

  function pintar() {
    pintarFiltros();
    const lista = visibles();
    const vencidos = st.elementos.filter((e) => e.dias_para_vencer !== null && e.dias_para_vencer < 0).length;
    const rojos = st.elementos.filter((e) => semaforo(e.dias_para_vencer) === "rojo").length - vencidos;
    const ambar = st.elementos.filter((e) => semaforo(e.dias_para_vencer) === "ambar").length;
    const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
    $("#resumen").textContent = `${pl(st.elementos.length, "cosa", "cosas")} · ${pl(vencidos, "vencida", "vencidas")}` +
                                ` · ${rojos} en ≤ 2 días · ${ambar} en ≤ 7 días`;
    $("#lista").replaceChildren(...lista.map(item));
    const vacio = $("#vacio");
    vacio.hidden = lista.length > 0;
    vacio.textContent = st.elementos.length === 0 ? "No hay nada registrado todavía."
      : "Nada coincide con el filtro o la búsqueda.";
  }

  function item(e) {
    const sem = semaforo(e.dias_para_vencer);
    const vencido = e.dias_para_vencer !== null && e.dias_para_vencer < 0;
    const ubic = st.ubic.get(e.ubicacion_id);
    const partes = [cantidad(e.saldo, e.unidad_base)];
    if (e.saldo < e.cantidad_inicial) partes[0] += " de " + cantidad(e.cantidad_inicial, e.unidad_base);
    partes.push(ubic ? ubic.nombre : "ubicación " + e.ubicacion_id);
    partes.push(detalleDias(e));
    if (e.abierto_en) partes.push("abierto " + fecha(e.abierto_en));

    const li = el("li", { class: `item sem-${sem}${vencido ? " vencido" : ""}`, "data-id": String(e.id) },
      el("div", { class: "fila1" },
        el("span", { class: "nombre" }, e.producto,
          e.presentacion && e.presentacion !== "a granel" ? el("small", { texto: " · " + e.presentacion }) : null,
          e.etiqueta ? el("small", { texto: " · " + e.etiqueta }) : null),
        el("span", { class: "dias", texto: textoDias(e.dias_para_vencer), title: e.vencimiento || "" })),
      el("div", { class: "fila2", texto: partes.join(" · ") }));

    if (st.puede) {
      if (st.abierto && st.abierto.id === e.id) li.append(confirmacion(e, st.abierto.accion));
      else li.append(acciones(e));
    }
    return li;
  }

  function acciones(e) {
    const b = (accion, texto) => el("button", {
      type: "button", class: "accion", "data-accion": accion,
      onclick: () => { st.abierto = { id: e.id, accion }; pintar(); enfocarConfirmacion(e.id); },
    }, texto);
    return el("div", { class: "acciones" },
      e.abierto_en ? el("span", { class: "accion apagada", texto: "Abierto" }) : b("abri", "Abrí"),
      b("acabo", "Se acabó"), b("botar", "Botar"), b("fecha", "Fecha"));
  }

  function enfocarConfirmacion(id) {
    const n = document.querySelector(`li[data-id="${id}"] .confirma [data-foco]`);
    if (n) n.focus();
  }

  function cerrar() { st.abierto = null; pintar(); }

  function confirmacion(e, accion) {
    const queda = cantidad(e.saldo, e.unidad_base);
    const nombre = `«${e.producto}»`;
    const msg = el("p", { class: "error", role: "alert", hidden: true });
    let fechaInput = null;
    const textos = {
      abri: [`¿Abriste ${nombre} hoy (${fecha(st.hoy)})?`, "Sí, lo abrí"],
      acabo: [`¿Se acabó ${nombre}? Sale lo que queda (${queda}).`, "Sí, se acabó"],
      botar: [`¿Botar ${nombre}? Queda como merma (${queda}).`, "Sí, botar"],
      fecha: [`Nuevo vencimiento de ${nombre}:`, "Guardar"],
    };
    const [pregunta, si] = textos[accion];
    const ok = el("button", { type: "submit", class: "si", "data-foco": accion === "fecha" ? null : true }, si);
    const no = el("button", { type: "button", class: "no", onclick: cerrar }, "No");
    if (accion === "fecha") {
      fechaInput = el("input", { type: "date", value: e.vencimiento || "", "aria-label": "Nuevo vencimiento",
                                 "data-foco": true, required: true });
    }
    const form = el("form", { class: "confirma", "data-accion": accion },
      el("p", { class: "pregunta", texto: pregunta }), fechaInput,
      el("div", { class: "botones" }, ok, no), msg);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (accion === "fecha" && !fechaInput.value) {
        msg.textContent = "Elige una fecha."; msg.hidden = false; return;
      }
      ok.disabled = no.disabled = true;
      try {
        await ejecutar(e, accion, fechaInput && fechaInput.value);
        st.abierto = null;
        await refrescar();
      } catch (err) {
        if (err.status === 401) return;
        msg.textContent = err.message; msg.hidden = false;
        ok.disabled = no.disabled = false;
      }
    });
    form.addEventListener("keydown", (ev) => { if (ev.key === "Escape") cerrar(); });
    return form;
  }

  async function ejecutar(e, accion, valor) {
    if (accion === "abri") {
      await api("PATCH", `/elementos/${e.id}`, { abierto_en: st.hoy });
      aviso(`${e.producto}: abierto hoy.`);
    } else if (accion === "acabo") {
      await api("POST", "/movimientos", { elemento_id: e.id, tipo: "consumo" });
      aviso(`${e.producto}: se acabó.`);
    } else if (accion === "botar") {
      await api("POST", "/movimientos", { elemento_id: e.id, tipo: "merma" });
      aviso(`${e.producto}: botado (merma).`);
    } else if (accion === "fecha") {
      const r = await api("PATCH", `/elementos/${e.id}`, { vencimiento: valor });
      aviso(`${e.producto}: vence ${fecha(r.vencimiento)}.`);
    }
  }

  // ------------------------------------------------------------------ alta rápida

  function prepararAlta() {
    $("#dl-productos").replaceChildren(...st.productos.map((p) => el("option", { value: p.nombre })));
    $("#dl-categorias").replaceChildren(...st.categorias.map((c) => el("option", { value: c.nombre })));
    const sel = $("#a-unidad");
    const previa = sel.value || "u";
    sel.replaceChildren(...st.unidades.map((u) => el("option", { value: u.codigo, texto: u.codigo, title: u.nombre })));
    sel.value = st.unidades.some((u) => u.codigo === previa) ? previa : (st.unidades[0] || {}).codigo;
    pintarDestino();
  }

  function pintarDestino() {
    const caja = $("#a-donde");
    caja.replaceChildren(...st.raices.map((u) => el("button", {
      type: "button", class: "chip", role: "radio", "aria-checked": String(st.destino === u.id),
      onclick: () => { st.destino = u.id; pintarDestino(); },
    }, u.nombre)));
    const d = st.ubic.get(st.destino);
    $("#a-guardar").textContent = d ? "Guardar en " + d.nombre : "Guardar";
  }

  function productoExistente(nombre) {
    const n = normal(nombre);
    return n ? st.productos.find((p) => normal(p.nombre) === n) || null : null;
  }

  function alEscribirNombre() {
    const p = productoExistente($("#a-nombre").value);
    const ayuda = $("#a-nombre-ayuda");
    if (p) {
      ayuda.textContent = `Ya existe (${p.categoria}): se suma una unidad nueva.`;
      $("#a-categoria").value = p.categoria;
      const actual = st.unidades.find((u) => u.codigo === $("#a-unidad").value);
      const base = st.unidades.find((u) => u.codigo === p.unidad_base);
      if (base && (!actual || actual.magnitud !== base.magnitud)) $("#a-unidad").value = base.codigo;
    } else {
      ayuda.textContent = $("#a-nombre").value.trim() ? "Producto nuevo: elige su categoría." : "";
    }
  }

  function csv(valores) {
    return valores.map((v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"').join(",");
  }

  function msgAlta(texto, malo) {
    const m = $("#a-msg");
    m.textContent = texto;
    m.classList.toggle("error", !!malo);
    m.hidden = !texto;
  }

  async function alAgregar(ev) {
    ev.preventDefault();
    const existente = productoExistente($("#a-nombre").value);
    const nombre = existente ? existente.nombre : $("#a-nombre").value.trim().replace(/\s+/g, " ");
    const categoria = $("#a-categoria").value.trim();
    const cant = $("#a-cantidad").value.trim().replace(",", ".");
    const unidad = $("#a-unidad").value;
    const vence = $("#a-vence").value;
    const destino = st.ubic.get(st.destino);
    if (!nombre) { msgAlta("Falta el nombre.", true); $("#a-nombre").focus(); return; }
    if (!existente && !categoria) { msgAlta("Producto nuevo: falta la categoría.", true); $("#a-categoria").focus(); return; }
    if (!/^\d+(\.\d+)?$/.test(cant) || Number(cant) <= 0) {
      msgAlta("La cantidad tiene que ser un número mayor que 0.", true); $("#a-cantidad").focus(); return;
    }
    if (!destino) { msgAlta("Elige dónde se guarda.", true); return; }
    const boton = $("#a-guardar");
    boton.disabled = true;
    msgAlta("", false);
    const cuerpo = csv(["nombre", "categoria", "unidad", "cantidad", "fecha_compra", "fecha_vencimiento",
                        "precio_unitario", "ubicacion"]) + "\n" +
                   csv([nombre, categoria, unidad, cant, st.hoy, vence, "", destino.nombre]) + "\n";
    try {
      const r = await api("POST", "/importar", cuerpo, "text/csv; charset=utf-8");
      const nuevo = r.productos_nuevos.length > 0;
      msgAlta(`Agregado: ${nombre} · ${num(cant)} ${unidad} · ${vence ? "vence " + fecha(vence) : "sin fecha"} · ` +
              `${destino.nombre}${nuevo ? " (producto nuevo)" : ""}.`, false);
      if (nuevo) {
        const [productos, categorias] = await Promise.all([api("GET", "/productos"), api("GET", "/categorias")]);
        st.productos = productos; st.categorias = categorias;
        prepararAlta();
      }
      for (const id of ["#a-nombre", "#a-categoria", "#a-vence"]) $(id).value = "";
      $("#a-cantidad").value = "1";
      $("#a-nombre-ayuda").textContent = "";
      $("#a-nombre").focus();
      refrescar();
    } catch (e) {
      if (e.status !== 401) msgAlta("No se guardó: " + e.message, true);
    } finally {
      boton.disabled = false;
    }
  }

  // ------------------------------------------------------------------ arranque

  let salirArmado = null;
  function alSalir() {
    const b = $("#salir");
    if (!salirArmado) {
      b.textContent = "¿Seguro? Toca otra vez";
      salirArmado = setTimeout(() => { salirArmado = null; b.textContent = "Salir"; }, 3000);
      return;
    }
    clearTimeout(salirArmado);
    salirArmado = null;
    b.textContent = "Salir";
    olvidar("Token olvidado en este dispositivo.");
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#f-token").addEventListener("submit", alEntrar);
    $("#reintentar").addEventListener("click", () => { errorToken("", false); conGuardado(); });
    $("#salir").addEventListener("click", alSalir);
    $("#buscar").addEventListener("input", (ev) => { st.q = ev.target.value; st.abierto = null; pintar(); });
    $("#ir-lista").addEventListener("click", () => { mostrar("lista"); refrescar(); });
    $("#ir-alta").addEventListener("click", () => {
      if (!st.puede) return;
      pintarDestino(); mostrar("alta"); $("#a-nombre").focus();
    });
    $("#f-alta").addEventListener("submit", alAgregar);
    $("#a-nombre").addEventListener("input", alEscribirNombre);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && st.yo && st.vista === "lista" && !st.abierto) refrescar();
    });
    conGuardado();
  });
})();
