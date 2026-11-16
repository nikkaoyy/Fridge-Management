import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErrorApi } from "../api";
import {
  cifras, fecha, normal, ordenSecciones, porUrgencia, porVencer, semaforo, ubicaciones, type Cifras as TCifras,
  type Ubicaciones,
} from "../logica";
import type { Categoria, Elemento, Miembro, Producto, ResumenVencimientos, Ubicacion, Unidad } from "../tipos";
import Alta from "./Alta";
import Cifras from "./Cifras";
import Recetas from "./Recetas";
import Seccion from "./Seccion";
import type { Accion } from "./Tarjeta";

interface Props {
  yo: Miembro;
  alSalir: () => void;
}

interface Datos {
  elementos: Elemento[];
  hoy: string;
  ubic: Ubicaciones;
  unidades: Unidad[];
  categorias: Categoria[];
  productos: Producto[];
}

/** Sonda para verificar desde fuera (Chrome headless) que lo pintado cuadra con la API. */
export interface Sonda {
  listo: boolean;
  hoy: string | null;
  pintados: number; //            tarjetas en el DOM
  elementos: number; //           de GET /elementos
  vencidos: number;
  en7: number; //                 de hoy a 7 días (= indicadores.por_vencer_7)
  por_vencer: number; //          vencidos + ≤ 7 (= GET /elementos?por_vencer=7)
  hoy_vencen: number;
  en2: number;
  riesgo_cop: number | null;
  riesgo_sin_precio: number;
  secciones: Record<string, { total: number; pintados: number; plegada: boolean }>;
  semaforo: Record<string, number>;
  dpr: number;
  ancho: number;
  scroll_horizontal: boolean;
}

declare global {
  interface Window {
    __nevera?: Sonda;
  }
}

export default function Tablero({ yo, alSalir }: Props) {
  const puede = yo.rol !== "lector";
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorCarga, setErrorCarga] = useState("");
  const [q, setQ] = useState("");
  const [soloPorVencer, setSoloPorVencer] = useState(false);
  const [plegadas, setPlegadas] = useState<Set<number>>(new Set());
  const [vista, setVista] = useState<"tablero" | "alta">("tablero");
  const [pestana, setPestana] = useState<"nevera" | "recetas">("nevera"); // PEDIDO-NEVERA-5: se añade, no se rehace
  const [ubicAlta, setUbicAlta] = useState<number | null>(null);
  const [abierta, setAbierta] = useState<{ id: number; accion: Accion } | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; malo: boolean } | null>(null);
  const [salirArmado, setSalirArmado] = useState(false);
  const temporizador = useRef<number | undefined>(undefined);

  const avisar = useCallback((texto: string, malo = false) => {
    setAviso({ texto, malo });
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setAviso(null), malo ? 6000 : 3500);
  }, []);

  const cargarTodo = useCallback(async () => {
    try {
      const [ubic, unidades, categorias, productos, elementos, venc] = await Promise.all([
        api<Ubicacion[]>("GET", "/ubicaciones"),
        api<Unidad[]>("GET", "/unidades"),
        api<Categoria[]>("GET", "/categorias"),
        puede ? api<Producto[]>("GET", "/productos") : Promise.resolve([] as Producto[]),
        api<Elemento[]>("GET", "/elementos"),
        api<ResumenVencimientos>("GET", "/vencimientos?dias=7"),
      ]);
      setDatos({ elementos, hoy: venc.hoy, ubic: ubicaciones(ubic), unidades, categorias, productos });
      setErrorCarga("");
    } catch (e) {
      if (!(e instanceof ErrorApi && e.status === 401)) setErrorCarga(e instanceof Error ? e.message : String(e));
    }
  }, [puede]);

  const refrescar = useCallback(async () => {
    try {
      const [elementos, venc] = await Promise.all([
        api<Elemento[]>("GET", "/elementos"),
        api<ResumenVencimientos>("GET", "/vencimientos?dias=7"),
      ]);
      setDatos((d) => (d ? { ...d, elementos, hoy: venc.hoy } : d));
    } catch (e) {
      if (!(e instanceof ErrorApi && e.status === 401)) avisar("No se pudo cargar: " + (e as Error).message, true);
    }
  }, [avisar]);

  useEffect(() => {
    void cargarTodo();
    return () => {
      window.clearTimeout(temporizador.current);
      delete window.__nevera; // al salir o al revocar, ni las cifras quedan a la vista
      delete window.__neveraAlta;
    };
  }, [cargarTodo]);

  useEffect(() => {
    const alVolverVisible = () => {
      if (document.visibilityState === "visible" && vista === "tablero" && !abierta) void refrescar();
    };
    document.addEventListener("visibilitychange", alVolverVisible);
    return () => document.removeEventListener("visibilitychange", alVolverVisible);
  }, [vista, abierta, refrescar]);

  useEffect(() => {
    if (!salirArmado) return;
    const t = window.setTimeout(() => setSalirArmado(false), 3000);
    return () => window.clearTimeout(t);
  }, [salirArmado]);

  const c: TCifras | null = useMemo(() => (datos ? cifras(datos.elementos) : null), [datos]);

  const secciones = useMemo(() => {
    if (!datos) return [];
    const nq = normal(q);
    return ordenSecciones(datos.ubic.raices).map((u) => {
      const todos = datos.elementos.filter((e) => datos.ubic.raizDe.get(e.ubicacion_id) === u.id);
      const visibles = todos
        .filter((e) => !soloPorVencer || porVencer(e))
        .filter((e) => !nq || normal(e.producto).includes(nq) || normal(e.etiqueta).includes(nq) || normal(e.nota).includes(nq))
        .sort(porUrgencia);
      const motivo: "vacia" | "busqueda" | "por-vencer" = todos.length === 0 ? "vacia" : nq ? "busqueda" : "por-vencer";
      return { u, total: todos.length, visibles, motivo };
    });
  }, [datos, q, soloPorVencer]);

  // la sonda, después de pintar
  useEffect(() => {
    const cuenta: Record<string, number> = {};
    for (const n of document.querySelectorAll<HTMLElement>("[data-elemento]")) {
      const s = n.dataset.semaforo ?? "?";
      cuenta[s] = (cuenta[s] ?? 0) + 1;
    }
    window.__nevera = {
      listo: !!datos && vista === "tablero" && pestana === "nevera",
      hoy: datos?.hoy ?? null,
      pintados: document.querySelectorAll("[data-elemento]").length,
      elementos: datos?.elementos.length ?? 0,
      vencidos: c?.vencidos ?? 0,
      en7: c?.en7 ?? 0,
      por_vencer: c?.riesgo.cosas ?? 0,
      hoy_vencen: c?.hoy ?? 0,
      en2: c?.en2 ?? 0,
      riesgo_cop: c?.riesgo.cop ?? null,
      riesgo_sin_precio: c?.riesgo.sinPrecio ?? 0,
      secciones: Object.fromEntries(secciones.map((s) => [s.u.nombre, {
        total: s.total, pintados: document.querySelectorAll(`[data-seccion="${s.u.nombre}"] [data-elemento]`).length,
        plegada: plegadas.has(s.u.id),
      }])),
      semaforo: cuenta,
      dpr: window.devicePixelRatio,
      ancho: window.innerWidth,
      scroll_horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  async function ejecutar(e: Elemento, accion: Accion, valor?: string) {
    if (!datos) return;
    if (accion === "abri") {
      await api<Elemento>("PATCH", `/elementos/${e.id}`, { abierto_en: datos.hoy });
      avisar(`${e.producto}: abierto hoy.`);
    } else if (accion === "acabo") {
      await api("POST", "/movimientos", { elemento_id: e.id, tipo: "consumo" });
      avisar(`${e.producto}: se acabó.`);
    } else if (accion === "botar") {
      const motivo = semaforo(e.dias_para_vencer) === "vencido" ? "vencido" : null;
      await api("POST", "/movimientos", { elemento_id: e.id, tipo: "merma", motivo });
      avisar(`${e.producto}: botado (merma).`);
    } else {
      const r = await api<Elemento>("PATCH", `/elementos/${e.id}`, { vencimiento: valor });
      avisar(`${e.producto}: vence ${fecha(r.vencimiento, datos.hoy)}.`);
    }
    setAbierta(null);
    await refrescar();
  }

  function plegar(id: number) {
    setPlegadas((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function irAlta(ubicacionId: number | null) {
    if (!puede) return;
    setAbierta(null);
    setUbicAlta(ubicacionId);
    setVista("alta");
    window.scrollTo(0, 0);
  }

  const barra = (
    <header className="barra">
      <div className="marca-app">
        <span className="sobretitulo">ARIA · casa</span>
        <h1>Nevera</h1>
      </div>
      <span className="quien" id="quien">{yo.nombre}{puede ? "" : " · solo lectura"}</span>
      <button type="button" id="salir" className="boton-texto" onClick={() => (salirArmado ? alSalir() : setSalirArmado(true))}>
        {salirArmado ? "¿Seguro? Otra vez" : "Salir"}
      </button>
    </header>
  );

  const pestanas = (
    <nav className="pestanas" aria-label="Secciones">
      {(["nevera", "recetas"] as const).map((k) => (
        <button key={k} type="button" id={`pestana-${k}`} className="pestana" aria-current={pestana === k ? "page" : undefined}
                onClick={() => { setPestana(k); setAbierta(null); window.scrollTo(0, 0); }}>
          {k === "nevera" ? "Nevera" : "Recetas"}
        </button>
      ))}
    </nav>
  );

  if (!datos || !c) {
    return (
      <main className="tablero">
        {barra}
        {errorCarga ? (
          <div className="panel vacio-total">
            <p className="error" role="alert">No se pudo cargar: {errorCarga}</p>
            <button type="button" className="boton-secundario" onClick={() => void cargarTodo()}>Reintentar</button>
          </div>
        ) : (
          <p className="cargando">Cargando…</p>
        )}
      </main>
    );
  }

  if (vista === "alta" && puede) {
    return (
      <Alta
        productos={datos.productos}
        categorias={datos.categorias}
        unidades={datos.unidades}
        ubic={datos.ubic}
        hoy={datos.hoy}
        ubicacionInicial={ubicAlta ?? datos.ubic.raices.find((u) => u.nombre === "nevera")?.id ?? null}
        alGuardar={async (nuevo) => {
          if (nuevo) await cargarTodo();
          else await refrescar();
        }}
        alVolver={() => setVista("tablero")}
      />
    );
  }

  const nombreUbic = (id: number) => datos.ubic.porId.get(id)?.nombre ?? `ubicación ${id}`;
  const nadaEnCasa = datos.elementos.length === 0;
  const avisoFlotante = aviso && (
    <div id="aviso" className={`aviso${aviso.malo ? " malo" : ""}`} role="status" aria-live="polite">{aviso.texto}</div>
  );

  if (pestana === "recetas") {
    return (
      <main className="tablero">
        {barra}
        {pestanas}
        <Recetas
          puede={puede}
          elementos={datos.elementos}
          productos={datos.productos}
          unidades={datos.unidades}
          hoy={datos.hoy}
          nombreUbic={nombreUbic}
          avisar={avisar}
          alCocinar={refrescar}
        />
        {avisoFlotante}
      </main>
    );
  }

  return (
    <main className="tablero">
      {barra}
      {pestanas}
      <Cifras c={c} />

      <div className="herramientas">
        <input id="buscar" type="search" placeholder="Buscar por nombre" aria-label="Buscar por nombre" value={q}
               onChange={(e) => { setQ(e.target.value); setAbierta(null); }} autoComplete="off" enterKeyHint="search" />
        <button type="button" id="por-vencer" className="chip" aria-pressed={soloPorVencer}
                onClick={() => { setSoloPorVencer((v) => !v); setAbierta(null); }}>
          Por vencer <span className="mono">{c.riesgo.cosas}</span>
        </button>
        {puede && (
          <button type="button" id="ir-alta-barra" className="boton-agregar" onClick={() => irAlta(null)}>+ Agregar</button>
        )}
      </div>
      <p className="hoy-es">
        Hoy es {fecha(datos.hoy, null)} en Bogotá
        {soloPorVencer && " · solo lo vencido y lo que vence en ≤ 7 días"}
      </p>

      {nadaEnCasa && (
        <div className="panel vacio-total">
          <p>{puede ? "La nevera está vacía: agrega lo primero." : "La nevera está vacía."}</p>
          {puede && <button type="button" className="boton-principal" onClick={() => irAlta(null)}>Agregar</button>}
        </div>
      )}

      <div className="secciones">
        {secciones.map((s) => (
          <Seccion
            key={s.u.id}
            u={s.u}
            total={s.total}
            visibles={s.visibles}
            motivoVacio={s.motivo}
            plegada={plegadas.has(s.u.id)}
            alPlegar={() => plegar(s.u.id)}
            nombreUbic={nombreUbic}
            hoy={datos.hoy}
            puede={puede}
            abierta={abierta}
            alAbrir={(id, a) => setAbierta(a ? { id, accion: a } : null)}
            alEjecutar={ejecutar}
            alAgregar={irAlta}
          />
        ))}
      </div>

      {puede && (
        <button type="button" id="ir-alta" className="agregar-flotante" onClick={() => irAlta(null)}>
          + Agregar
        </button>
      )}
      {avisoFlotante}
    </main>
  );
}
