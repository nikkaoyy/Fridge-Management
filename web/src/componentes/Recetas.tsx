import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api";
import { cantidad, fecha, normal, plural, semaforo, textoDias } from "../logica";
import { DIAS_RECETA, estado, pasos, propuesta, TEXTO_ESTADO, type EstadoIngrediente, type Linea } from "../recetas";
import type {
  Cocinado, Elemento, Producto, Receta, RecetaDetalle, RecetaSugerida, RecetaVersion, Unidad,
} from "../tipos";

interface Props {
  puede: boolean;
  elementos: Elemento[];
  productos: Producto[];
  unidades: Unidad[];
  hoy: string;
  nombreUbic: (id: number) => string;
  avisar: (texto: string, malo?: boolean) => void;
  /** Después de cocinar: el tablero vuelve a pedir los elementos (lo consumido ya no está). */
  alCocinar: () => Promise<void>;
}

/** Sonda para verificar desde fuera (Chrome headless) que lo pintado cuadra con la API. */
export interface SondaRecetas {
  listo: boolean;
  recetas: number;
  sugeridas: { receta_id: number; nombre: string; dias_mas_urgente: number | null }[];
  pintadas: number;
  estados: Record<EstadoIngrediente, number>;
  vacio: string | null;
  scroll_horizontal: boolean;
}

declare global {
  interface Window {
    __neveraRecetas?: SondaRecetas;
  }
}

type Vista = { modo: "lista" } | { modo: "form"; receta: Receta | null };

export default function Recetas(p: Props) {
  const [recetas, setRecetas] = useState<Receta[] | null>(null);
  const [sugeridas, setSugeridas] = useState<RecetaSugerida[] | null>(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState<Vista>({ modo: "lista" });
  const [cocinando, setCocinando] = useState<number | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        api<Receta[]>("GET", "/recetas"),
        api<RecetaSugerida[]>("GET", `/recetas/sugeridas?dias=${DIAS_RECETA}`),
      ]);
      setRecetas(r);
      setSugeridas(s);
      setError("");
    } catch (e) {
      if (!(e instanceof ErrorApi && e.status === 401)) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void cargar();
    return () => {
      delete window.__neveraRecetas;
    };
  }, [cargar]);

  const vacio = recetas && recetas.length === 0
    ? (p.puede ? "Todavía no hay recetas: crea la primera con lo que sueles cocinar." : "Todavía no hay recetas.")
    : null;

  useEffect(() => {
    const estados: Record<EstadoIngrediente, number> = { vence: 0, tengo: 0, falta: 0 };
    for (const n of document.querySelectorAll<HTMLElement>("[data-sugerida] [data-estado]")) {
      const k = n.dataset.estado as EstadoIngrediente;
      if (k in estados) estados[k] += 1;
    }
    window.__neveraRecetas = {
      listo: recetas !== null && sugeridas !== null && vista.modo === "lista",
      recetas: recetas?.length ?? 0,
      sugeridas: (sugeridas ?? []).map((s) => ({ receta_id: s.receta_id, nombre: s.nombre, dias_mas_urgente: s.dias_mas_urgente })),
      pintadas: document.querySelectorAll("[data-sugerida]").length,
      estados,
      vacio: document.querySelector("[data-vacio-recetas]")?.textContent ?? null,
      scroll_horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  if (vista.modo === "form" && p.puede) {
    return (
      <FormReceta
        receta={vista.receta}
        productos={p.productos}
        unidades={p.unidades}
        alVolver={() => setVista({ modo: "lista" })}
        alGuardar={async (texto) => {
          p.avisar(texto);
          setVista({ modo: "lista" });
          await cargar();
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  if (error) {
    return (
      <div className="panel vacio-total">
        <p className="error" role="alert">No se pudieron cargar las recetas: {error}</p>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Reintentar</button>
      </div>
    );
  }
  if (!recetas || !sugeridas) return <p className="cargando">Cargando recetas…</p>;

  const nueva = p.puede && (
    <button type="button" id="nueva-receta" className="boton-agregar visible" onClick={() => setVista({ modo: "form", receta: null })}>
      + Nueva receta
    </button>
  );

  return (
    <div className="recetas">
      <section className="seccion" data-seccion-recetas="sugeridas" aria-labelledby="hoy-cocino-t">
        <div className="seccion-cabeza">
          <h2 id="hoy-cocino-t">Qué puedes cocinar hoy</h2>
          <span className="ayuda-linea">primero lo que lleva algo que se vence antes</span>
        </div>
        <div className="seccion-cuerpo">
          {vacio ? (
            <div className="vacio">
              <p>Cuando haya recetas, aquí salen primero las que usan lo que se vence antes.</p>
            </div>
          ) : sugeridas.length === 0 ? (
            <div className="vacio">
              <p>Ninguna receta tiene hoy un ingrediente en casa (que no esté vencido).</p>
            </div>
          ) : (
            <ul className="tarjetas">
              {sugeridas.map((s) => (
                <TarjetaSugerida
                  key={s.receta_id}
                  s={s}
                  puede={p.puede}
                  cocinando={cocinando === s.receta_id}
                  elementos={p.elementos}
                  hoy={p.hoy}
                  nombreUbic={p.nombreUbic}
                  alAbrir={() => setCocinando(s.receta_id)}
                  alCerrar={() => setCocinando(null)}
                  alHecho={async (r) => {
                    setCocinando(null);
                    p.avisar(`Cocinaste «${s.nombre}»: ${plural(r.movimientos.length, "cosa descontada", "cosas descontadas")}.`);
                    await Promise.all([p.alCocinar(), cargar()]);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="seccion" data-seccion-recetas="todas" aria-labelledby="todas-t">
        <div className="seccion-cabeza">
          <h2 id="todas-t">Recetas</h2>
          <span className="seccion-cuenta mono">{recetas.length}</span>
          {nueva}
        </div>
        <div className="seccion-cuerpo">
          {recetas.length === 0 ? (
            <div className="vacio">
              <p data-vacio-recetas>{vacio}</p>
              {p.puede && (
                <button type="button" className="boton-secundario" onClick={() => setVista({ modo: "form", receta: null })}>
                  Crear la primera receta
                </button>
              )}
            </div>
          ) : (
            <ul className="tarjetas">
              {recetas.map((r) => (
                <FichaReceta
                  key={r.id}
                  r={r}
                  hoy={p.hoy}
                  puede={p.puede}
                  abierta={abierta === r.id}
                  alAbrir={() => setAbierta(abierta === r.id ? null : r.id)}
                  alEditar={() => setVista({ modo: "form", receta: r })}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ qué puedes cocinar hoy

interface PropsSugerida {
  s: RecetaSugerida;
  puede: boolean;
  cocinando: boolean;
  elementos: Elemento[];
  hoy: string;
  nombreUbic: (id: number) => string;
  alAbrir: () => void;
  alCerrar: () => void;
  alHecho: (r: Cocinado) => Promise<void>;
}

function TarjetaSugerida({ s, puede, cocinando, elementos, hoy, nombreUbic, alAbrir, alCerrar, alHecho }: PropsSugerida) {
  const sem = semaforo(s.dias_mas_urgente);
  const urgente = s.cubre[0];
  const filas = [...s.cubre.map((i) => ({ i, est: estado(i, false) })), ...s.faltan.map((i) => ({ i, est: estado(i, true) }))];
  return (
    <li className={`tarjeta sugerida sem-${sem}`} data-sugerida={s.receta_id}>
      <div className="tarjeta-fila">
        <h3 className="tarjeta-nombre">
          {s.nombre}
          {s.porciones ? <small> · {plural(s.porciones, "comensal", "comensales")}</small> : null}
        </h3>
        <span className="dias" title="lo que se vence antes de lo que lleva">
          <i className="marca" aria-hidden="true" />
          {s.dias_mas_urgente === null ? "sin fecha" : textoDias(s.dias_mas_urgente)}
        </span>
      </div>
      <p className="tarjeta-extra">
        {s.dias_mas_urgente !== null && urgente ? `Lo más urgente: ${urgente.producto} (${textoDias(s.dias_mas_urgente)}). ` : ""}
        Tienes {s.disponibles} de {plural(s.ingredientes, "ingrediente", "ingredientes")}
        {s.por_vencer ? ` · ${s.por_vencer} se ${s.por_vencer === 1 ? "vence" : "vencen"} en ≤ ${DIAS_RECETA} días` : ""}
      </p>
      <ul className="ingredientes">
        {filas.map(({ i, est }) => (
          <li key={i.producto_id} className={`ing est-${est}`} data-estado={est} data-producto={i.producto_id}>
            <i className="marca" aria-hidden="true" />
            <span className="ing-nombre">
              {i.producto}
              {i.opcional && <small> · opcional</small>}
            </span>
            <span className="ing-cant mono">{cantidad(i.cantidad, i.unidad)}</span>
            <span className="ing-estado">
              {TEXTO_ESTADO[est]}
              {est === "vence" && i.dias_para_vencer !== null ? ` · ${textoDias(i.dias_para_vencer)}` : ""}
              {est !== "falta" && !i.alcanza ? ` · hay ${cantidad(i.saldo, i.unidad)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {puede &&
        (cocinando ? (
          <Cocinar s={s} elementos={elementos} hoy={hoy} nombreUbic={nombreUbic} alCerrar={alCerrar} alHecho={alHecho} />
        ) : (
          <div className="acciones una">
            <button type="button" className="accion" data-accion="cocinar" onClick={alAbrir}>Cocinar</button>
          </div>
        ))}
    </li>
  );
}

interface PropsCocinar {
  s: RecetaSugerida;
  elementos: Elemento[];
  hoy: string;
  nombreUbic: (id: number) => string;
  alCerrar: () => void;
  alHecho: (r: Cocinado) => Promise<void>;
}

/**
 * La confirmación: lo que se propone descontar (lo que se vence antes primero) y el usuario marca y corrige. Solo
 * con «Sí» se llama a POST /recetas/{id}/cocinar; si no alcanza, el servidor dice qué falta y no descuenta nada.
 */
function Cocinar({ s, elementos, hoy, nombreUbic, alCerrar, alHecho }: PropsCocinar) {
  const [lineas, setLineas] = useState<Linea[]>(() => propuesta(s, elementos));
  const [textos, setTextos] = useState<Record<string, string>>(() =>
    Object.fromEntries(propuesta(s, elementos).map((l) => [l.clave, String(l.cantidad)])));
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cambiar = (clave: string, cambio: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    const usar = lineas.filter((l) => l.usar);
    if (usar.length === 0) {
      setError("Marca al menos una cosa que hayas usado.");
      return;
    }
    const consumos: { elemento_id: number; cantidad: number }[] = [];
    for (const l of usar) {
      const n = Number((textos[l.clave] ?? "").replace(",", "."));
      if (!(n > 0)) {
        setError(`La cantidad de ${l.producto} tiene que ser mayor que 0.`);
        return;
      }
      consumos.push({ elemento_id: l.elemento.id, cantidad: n });
    }
    setOcupado(true);
    setError("");
    try {
      const r = await api<Cocinado>("POST", `/recetas/${s.receta_id}/cocinar`, { consumos });
      await alHecho(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  return (
    <form className="confirma cocinar" data-accion="cocinar" onSubmit={enviar}
          onKeyDown={(ev) => ev.key === "Escape" && alCerrar()}>
      <p className="pregunta">¿Cocinaste «{s.nombre}»? Esto es lo que se descuenta; cambia lo que no usaste.</p>
      {lineas.length === 0 ? (
        <p className="ayuda">No hay nada en casa para descontar.</p>
      ) : (
        <ul className="lineas">
          {lineas.map((l) => (
            <li key={l.clave} className="linea" data-linea={l.elemento.id}>
              <label className="linea-usar">
                <input type="checkbox" checked={l.usar} onChange={(ev) => cambiar(l.clave, { usar: ev.target.checked })} />
                <span>
                  <strong>{l.producto}</strong>
                  {l.opcional && <small> · opcional</small>}
                  <small className="tenue">
                    {nombreUbic(l.elemento.ubicacion_id)} · {l.elemento.vencimiento ? `vence ${fecha(l.elemento.vencimiento, hoy)}` : "sin fecha"}
                    {" "}· hay {cantidad(l.elemento.saldo, l.elemento.unidad_base)}
                  </small>
                </span>
              </label>
              <span className="linea-cant">
                <input type="text" inputMode="decimal" aria-label={`Cantidad de ${l.producto} en ${l.elemento.unidad_base}`}
                       value={textos[l.clave] ?? ""} disabled={!l.usar}
                       onChange={(ev) => setTextos((t) => ({ ...t, [l.clave]: ev.target.value }))} />
                <span className="mono">{l.elemento.unidad_base}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {s.faltan.length > 0 && (
        <p className="ayuda">Me falta: {s.faltan.map((i) => i.producto).join(", ")}. Eso no se descuenta.</p>
      )}
      <div className="botones">
        <button type="submit" className="si" disabled={ocupado || lineas.length === 0}>Sí, descontar</button>
        <button type="button" className="no" onClick={alCerrar} disabled={ocupado}>No</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

// ------------------------------------------------------------------ la lista

interface PropsFicha {
  r: Receta;
  hoy: string;
  puede: boolean;
  abierta: boolean;
  alAbrir: () => void;
  alEditar: () => void;
}

function FichaReceta({ r, hoy, puede, abierta, alAbrir, alEditar }: PropsFicha) {
  const v = r.version_vigente;
  const [detalle, setDetalle] = useState<RecetaDetalle | null>(null);
  useEffect(() => {
    if (!abierta || detalle) return;
    api<RecetaDetalle>("GET", `/recetas/${r.id}`).then(setDetalle).catch(() => setDetalle(null));
  }, [abierta, detalle, r.id]);
  const lista = pasos(v.instrucciones);
  return (
    <li className="tarjeta ficha" data-receta={r.id}>
      <div className="tarjeta-fila">
        <h3 className="tarjeta-nombre">
          {r.nombre}
          <small> · {plural(v.porciones, "comensal", "comensales")}</small>
        </h3>
        <span className="version mono" title={`creada el ${fecha(v.creado_en.slice(0, 10), hoy)}`}>v{v.numero}</span>
      </div>
      <p className="tarjeta-extra">
        {v.ingredientes.map((i) => i.producto).join(", ")}
      </p>
      {abierta && (
        <div className="ficha-detalle">
          <h4>Ingredientes</h4>
          <ul className="ingredientes">
            {v.ingredientes.map((i) => (
              <li key={i.producto_id} className="ing">
                <span className="ing-nombre">{i.producto}{i.opcional && <small> · opcional</small>}</span>
                <span className="ing-cant mono">{cantidad(i.cantidad, i.unidad)}</span>
              </li>
            ))}
          </ul>
          <h4>Pasos</h4>
          {lista.length ? <ol className="pasos">{lista.map((t, k) => <li key={k}>{t}</li>)}</ol> : <p className="ayuda">Sin pasos escritos.</p>}
          {detalle && detalle.versiones.length > 1 && (
            <p className="ayuda" data-historial>
              Historial: {detalle.versiones.map((x) => `v${x.numero} (${fecha(x.creado_en.slice(0, 10), hoy)}, ${plural(x.ingredientes.length, "ingrediente", "ingredientes")})`).join(" · ")}
            </p>
          )}
        </div>
      )}
      <div className={`acciones ${puede ? "dos" : "una"}`}>
        <button type="button" className="accion" data-accion="ver" aria-expanded={abierta} onClick={alAbrir}>
          {abierta ? "Cerrar" : "Ver"}
        </button>
        {puede && <button type="button" className="accion" data-accion="editar" onClick={alEditar}>Editar</button>}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ crear y editar

interface LineaForm {
  clave: number;
  producto_id: number | null;
  cantidad: string;
  unidad: string;
  opcional: boolean;
}

interface PropsForm {
  receta: Receta | null;
  productos: Producto[];
  unidades: Unidad[];
  alVolver: () => void;
  alGuardar: (texto: string) => Promise<void>;
}

let siguienteClave = 1;
const lineaVacia = (): LineaForm => ({ clave: siguienteClave++, producto_id: null, cantidad: "", unidad: "", opcional: false });

/**
 * Nombre, comensales, pasos y líneas de ingrediente (producto, cantidad, unidad). Las unidades que se ofrecen son las
 * del catálogo de la magnitud del producto: «2 cucharadas» no se puede escribir (el servidor diría 400). Editar crea
 * la versión N+1 y lo avisa; el nombre es de la receta, no de la versión, y no cambia.
 */
function FormReceta({ receta, productos, unidades, alVolver, alGuardar }: PropsForm) {
  const v = receta?.version_vigente;
  const [nombre, setNombre] = useState(receta?.nombre ?? "");
  const [porciones, setPorciones] = useState(String(v?.porciones ?? 2));
  const [texto, setTexto] = useState(v?.instrucciones ?? "");
  const [lineas, setLineas] = useState<LineaForm[]>(() =>
    v ? v.ingredientes.map((i) => ({ clave: siguienteClave++, producto_id: i.producto_id, cantidad: String(i.cantidad),
                                     unidad: i.unidad, opcional: !!i.opcional }))
      : [lineaVacia()]);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const activos = useMemo(
    () => productos.filter((x) => x.activo).sort((a, b) => normal(a.nombre).localeCompare(normal(b.nombre), "es")),
    [productos]);
  const porId = useMemo(() => new Map(productos.map((x) => [x.id, x])), [productos]);
  const magnitudDe = (pid: number | null) => {
    const pr = pid === null ? undefined : porId.get(pid);
    return pr ? unidades.find((u) => u.codigo === pr.unidad_base)?.magnitud : undefined;
  };

  const cambiar = (clave: number, cambio: Partial<LineaForm>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    if (!receta && !nombre.trim()) return setError("Ponle nombre a la receta.");
    const n = Number(porciones);
    if (!Number.isInteger(n) || n < 1) return setError("Comensales: un número entero, 1 o más.");
    const usadas = lineas.filter((l) => l.producto_id !== null || l.cantidad.trim());
    if (usadas.length === 0) return setError("Agrega al menos un ingrediente.");
    const ingredientes = [];
    for (const [k, l] of usadas.entries()) {
      if (l.producto_id === null) return setError(`Ingrediente ${k + 1}: elige el producto.`);
      const c = Number(l.cantidad.replace(",", "."));
      if (!(c > 0)) return setError(`Ingrediente ${k + 1}: la cantidad tiene que ser mayor que 0.`);
      if (!l.unidad) return setError(`Ingrediente ${k + 1}: elige la unidad.`);
      ingredientes.push({ producto_id: l.producto_id, cantidad: c, unidad: l.unidad, opcional: l.opcional });
    }
    const version = { porciones: n, instrucciones: texto.trim() || null, ingredientes };
    setOcupado(true);
    try {
      if (receta) {
        const r = await api<RecetaVersion>("POST", `/recetas/${receta.id}/versiones`, version);
        await alGuardar(`«${receta.nombre}»: guardada la versión ${r.numero}; la ${r.numero - 1} queda como estaba.`);
      } else {
        const r = await api<Receta>("POST", "/recetas", { nombre: nombre.trim(), version });
        await alGuardar(`Receta «${r.nombre}» creada.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  return (
    <form className="panel form-receta" onSubmit={enviar} noValidate>
      <div className="barra">
        <button type="button" className="boton-texto volver" onClick={alVolver}>← Recetas</button>
        <h2>{receta ? "Editar receta" : "Nueva receta"}</h2>
      </div>
      {receta && v && (
        <p className="aviso-version" role="note" data-aviso-version>
          «{receta.nombre}» va en la versión {v.numero}. Guardar crea la <strong>versión {v.numero + 1}</strong>; la {v.numero}
          {v.numero > 1 ? " y las anteriores quedan" : " queda"} como estaba.
        </p>
      )}
      <label htmlFor="receta-nombre">Nombre</label>
      <input id="receta-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!!receta}
             autoComplete="off" enterKeyHint="next" autoFocus={!receta} />
      {receta && <p className="ayuda">El nombre es de la receta y no cambia entre versiones.</p>}
      <label htmlFor="receta-porciones">Comensales</label>
      <input id="receta-porciones" type="number" inputMode="numeric" min={1} step={1} value={porciones}
             onChange={(e) => setPorciones(e.target.value)} />

      <fieldset className="lineas-receta">
        <legend>Ingredientes</legend>
        {lineas.map((l, k) => {
          const mag = magnitudDe(l.producto_id);
          const opciones = mag ? unidades.filter((u) => u.magnitud === mag) : [];
          return (
            <div key={l.clave} className="linea-receta" data-linea-receta={k + 1}>
              <select aria-label={`Producto del ingrediente ${k + 1}`} value={l.producto_id ?? ""}
                      onChange={(e) => {
                        const pid = e.target.value ? Number(e.target.value) : null;
                        cambiar(l.clave, { producto_id: pid, unidad: pid ? (porId.get(pid)?.unidad_base ?? "") : "" });
                      }}>
                <option value="">Producto…</option>
                {activos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
              <input aria-label={`Cantidad del ingrediente ${k + 1}`} type="text" inputMode="decimal" placeholder="Cantidad"
                     value={l.cantidad} onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })} />
              <select aria-label={`Unidad del ingrediente ${k + 1}`} value={l.unidad} disabled={!mag}
                      onChange={(e) => cambiar(l.clave, { unidad: e.target.value })}>
                {!mag && <option value="">Unidad</option>}
                {opciones.map((u) => <option key={u.codigo} value={u.codigo}>{u.codigo}</option>)}
              </select>
              <label className="linea-opcional">
                <input type="checkbox" checked={l.opcional} onChange={(e) => cambiar(l.clave, { opcional: e.target.checked })} />
                opcional
              </label>
              <button type="button" className="boton-texto quitar" aria-label={`Quitar ingrediente ${k + 1}`}
                      onClick={() => setLineas((ls) => (ls.length > 1 ? ls.filter((x) => x.clave !== l.clave) : [lineaVacia()]))}>
                Quitar
              </button>
            </div>
          );
        })}
        <button type="button" id="mas-ingrediente" className="boton-secundario" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
          + Ingrediente
        </button>
        <p className="ayuda">Las cantidades se guardan en la unidad base del producto (1 kg queda como 1000 g).</p>
      </fieldset>

      <label htmlFor="receta-pasos">Pasos <span className="tenue">(uno por línea)</span></label>
      <textarea id="receta-pasos" rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} />

      <button type="submit" id="guardar-receta" className="boton-principal" disabled={ocupado}>
        {receta && v ? `Guardar como versión ${v.numero + 1}` : "Crear receta"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
