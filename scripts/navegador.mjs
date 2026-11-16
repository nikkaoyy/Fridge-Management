// Chrome headless por DevTools Protocol, sin dependencias (WebSocket y fetch de Node ≥ 22).
// Lo usan scripts/humo_pantalla.mjs y las capturas de PEDIDO-NEVERA-3. No es parte del servicio.
//
//   const nav = await abrir({ ancho: 390, alto: 844 });
//   await nav.ir("http://127.0.0.1:8451/");
//   await nav.esperar("document.querySelector('#lista li')");
//   await nav.captura("docs/pantalla-3.png");
//   await nav.cerrar();
//
// NEVERA_CHROME cambia el binario. Perfil temporal propio en /tmp, borrado al cerrar.
// Puerto de depuración 0 (lo elige Chrome) y se lee de DevToolsActivePort en el perfil propio: así nunca se conecta
// por error a otro Chrome de la máquina que ya escuche en un puerto fijo.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.NEVERA_CHROME || "/opt/hermes/tools/chromium-1208/chrome-linux64/chrome";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export async function abrir({ ancho = 390, alto = 844, escala = 2 } = {}) {
  // HOME propio: con el de la máquina, crashpad no puede escribir en ~/.config y Chrome muere al arrancar.
  const casa = mkdtempSync(join(tmpdir(), "nevera-chrome-"));
  const perfil = join(casa, "perfil");
  const entorno = { ...process.env, LANG: "es_CO.UTF-8", LANGUAGE: "es_CO:es", HOME: casa, XDG_CONFIG_HOME: join(casa, ".config"), XDG_CACHE_HOME: join(casa, ".cache") };
  const proc = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${perfil}`, "--no-first-run",
    "--no-default-browser-check", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-background-networking", "--disable-sync", "--hide-scrollbars", "--lang=es-CO",
    `--window-size=${ancho},${alto}`, "about:blank",
  ], { stdio: "ignore", env: entorno });

  const activo = join(perfil, "DevToolsActivePort");
  let ws_url = null;
  for (let i = 0; i < 100 && !ws_url; i++) {
    if (existsSync(activo)) {
      const [puerto, ruta] = readFileSync(activo, "utf8").split("\n");
      if (puerto && ruta) {
        // el navegador es el nuestro; su pestaña inicial (about:blank) es la página que se maneja
        const r = await fetch(`http://127.0.0.1:${puerto}/json/list`);
        const pag = (await r.json()).find((t) => t.type === "page");
        if (pag) ws_url = pag.webSocketDebuggerUrl;
      }
    }
    if (!ws_url) await espera(100);
  }
  if (!ws_url) { proc.kill(); rmSync(casa, { recursive: true, force: true }); throw new Error("Chrome no abrió su puerto de depuración"); }

  const ws = new WebSocket(ws_url);
  await new Promise((ok, mal) => { ws.onopen = ok; ws.onerror = mal; });
  let n = 0;
  const pendientes = new Map();
  const consola = [];
  const peticiones = [];   // { metodo, url, conToken } de todo lo que la página pide, en orden
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pendientes.has(d.id)) {
      const { ok, mal } = pendientes.get(d.id);
      pendientes.delete(d.id);
      d.error ? mal(new Error(d.error.message)) : ok(d.result);
    } else if (d.method === "Network.requestWillBeSent") {
      const h = d.params.request.headers || {};
      peticiones.push({ metodo: d.params.request.method, url: d.params.request.url,
                        conToken: Object.keys(h).some((k) => k.toLowerCase() === "authorization") });
    } else if (d.method === "Runtime.exceptionThrown") {
      consola.push("EXCEPCIÓN " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    } else if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) {
      consola.push(d.params.type + " " + d.params.args.map((a) => a.value ?? a.description).join(" "));
    } else if (d.method === "Log.entryAdded" && ["error", "warning"].includes(d.params.entry.level)) {
      consola.push(d.params.entry.level + " " + d.params.entry.text);
    }
  };
  const cmd = (method, params = {}) => new Promise((ok, mal) => {
    const id = ++n;
    pendientes.set(id, { ok, mal });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await cmd("Page.enable");
  await cmd("Runtime.enable");
  await cmd("Log.enable");
  await cmd("Network.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: escala, mobile: true });
  await cmd("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cmd("Emulation.setTimezoneOverride", { timezoneId: "America/Bogota" });

  async function evaluar(expresion) {
    const r = await cmd("Runtime.evaluate", { expression: expresion, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("en la página: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }

  return {
    cmd, evaluar, consola, peticiones,
    async ir(url) {
      await cmd("Page.navigate", { url });
      await this.esperar("document.readyState === 'complete'");
    },
    async esperar(expresion, ms = 8000) {
      const fin = Date.now() + ms;
      for (;;) {
        const v = await evaluar(`(() => { try { return ${expresion}; } catch (_) { return false; } })()`);
        if (v) return v;
        if (Date.now() > fin) throw new Error("no se cumplió a tiempo: " + expresion);
        await espera(50);
      }
    },
    async tocar(selector) {
      // Un toque de verdad (touchStart/touchEnd en el centro del elemento), como el pulgar en el móvil. Además de ser
      // más fiel que .click(), tras un .click() programático Chrome headless puede no repintar el pie fijo.
      const c = await evaluar(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null;
        n.scrollIntoView({ block: "nearest" }); const r = n.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!c) throw new Error("no está para tocar: " + selector);
      await cmd("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x, y: c.y }] });
      await cmd("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    async pintado() {   // dos frames: lo que se ve ya está pintado
      await evaluar("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
    },
    async captura(ruta) {
      await this.pintado();
      const r = await cmd("Page.captureScreenshot", { format: "png" });
      writeFileSync(ruta, Buffer.from(r.data, "base64"));
    },
    async cerrar() {
      try { ws.close(); } catch (_) { /* da igual */ }
      proc.kill();
      await espera(300);
      rmSync(casa, { recursive: true, force: true });
    },
  };
}
