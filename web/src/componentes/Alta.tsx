import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ErrorApi } from "../api";
import { fecha, normal, num, type Ubicaciones } from "../logica";
import type { Categoria, Elemento, Presentacion, Producto, ResumenImportacion, Unidad } from "../tipos";

const FOTO_MAXIMA = 8 * 1024 * 1024; // lo mismo que acepta POST /elementos (D5)
const BASE_DE: Record<Unidad["magnitud"], Producto["unidad_base"]> = { masa: "g", volumen: "ml", conteo: "u" };

interface Props {
  productos: Producto[];
  categorias: Categoria[];
  unidades: Unidad[];
  ubic: Ubicaciones;
  hoy: string | null;
  ubicacionInicial: number | null;
  alGuardar: (productoNuevo: boolean) => Promise<void>;
  alVolver: () => void;
}

export interface UltimaAlta {
  camino: "elementos" | "importar" | "producto+elementos";
  ms_servidor: number;
  con_foto: boolean;
}

declare global {
  interface Window {
    __neveraAlta?: UltimaAlta;
  }
}

function csv(valores: (string | number | null | undefined)[]): string {
  return valores.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",");
}

function leerComoDataUrl(f: File): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(new Error("no se pudo leer la foto"));
    r.readAsDataURL(f);
  });
}

/**
 * Alta rápida: cinco campos (nombre, categoría, cantidad + unidad, ubicación, vencimiento) y foto opcional (D5).
 * Foco automático en «Nombre»; «siguiente» (Enter) salta de campo en campo y el último guarda.
 *
 * Caminos, todos del contrato:
 * - producto que ya existe → POST /elementos con su presentación «a granel» (lleva la foto si la hay);
 * - producto nuevo sin foto → POST /importar con una fila (crea categoría, producto, presentación y elemento en UNA
 *   transacción, como en NEVERA-3);
 * - producto nuevo con foto → POST /categorias (si hace falta), /productos, /presentaciones y /elementos con la foto:
 *   el importador no lleva fotos. Si falla el último paso queda el producto sin elemento; al reintentar se reutiliza.
 */
export default function Alta({ productos, categorias, unidades, ubic, hoy, ubicacionInicial, alGuardar, alVolver }: Props) {
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [cant, setCant] = useState("1");
  const [unidad, setUnidad] = useState(unidades.some((u) => u.codigo === "u") ? "u" : (unidades[0]?.codigo ?? ""));
  const [ubicacion, setUbicacion] = useState<number | null>(ubicacionInicial ?? ubic.raices[0]?.id ?? null);
  const [vence, setVence] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ texto: string; malo: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const rNombre = useRef<HTMLInputElement>(null);
  const rCategoria = useRef<HTMLInputElement>(null);
  const rCant = useRef<HTMLInputElement>(null);
  const rUnidad = useRef<HTMLSelectElement>(null);
  const rUbic = useRef<HTMLSelectElement>(null);
  const rVence = useRef<HTMLInputElement>(null);
  const rFoto = useRef<HTMLInputElement>(null);
  const orden = [rNombre, rCategoria, rCant, rUnidad, rUbic, rVence];

  useEffect(() => rNombre.current?.focus(), []);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);

  const existente = (() => {
    const n = normal(nombre);
    return n ? (productos.find((p) => normal(p.nombre) === n) ?? null) : null;
  })();

  function alEscribirNombre(v: string) {
    setNombre(v);
    const p = productos.find((x) => normal(x.nombre) === normal(v));
    if (p) {
      if (p.categoria) setCategoria(p.categoria);
      const actual = unidades.find((u) => u.codigo === unidad);
      const base = unidades.find((u) => u.codigo === p.unidad_base);
      if (base && (!actual || actual.magnitud !== base.magnitud)) setUnidad(base.codigo);
    }
  }

  /** «Siguiente»: Enter en un campo pasa al próximo; en el último, envía. */
  function siguiente(i: number) {
    return (ev: KeyboardEvent) => {
      if (ev.key !== "Enter" || i === orden.length - 1) return;
      ev.preventDefault();
      orden[i + 1].current?.focus();
    };
  }

  function elegirFoto(f: File | null) {
    if (f && f.size > FOTO_MAXIMA) {
      setMsg({ texto: `La foto pesa ${num(f.size / 1048576)} MB; el máximo es 8 MB.`, malo: true });
      return;
    }
    if (vista) URL.revokeObjectURL(vista);
    setFoto(f);
    setVista(f ? URL.createObjectURL(f) : null);
    if (rFoto.current) rFoto.current.value = "";
  }

  async function presentacionGranel(productoId: number): Promise<number> {
    const lista = await api<Presentacion[]>("GET", `/presentaciones?producto_id=${productoId}`);
    const activas = lista.filter((p) => p.activo);
    const granel = activas.find((p) => p.nombre === "a granel")
      ?? activas.find((p) => p.contenido === null && p.parte_id === null);
    if (granel) return granel.id;
    const nueva = await api<Presentacion>("POST", "/presentaciones", { producto_id: productoId, nombre: "a granel" });
    return nueva.id;
  }

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    const nom = existente ? existente.nombre : nombre.trim().replace(/\s+/g, " ");
    const cat = categoria.trim();
    const c = cant.trim().replace(",", ".");
    const destino = ubicacion !== null ? ubic.porId.get(ubicacion) : undefined;
    const falla = (texto: string, r: { current: HTMLElement | null }) => {
      setMsg({ texto, malo: true });
      r.current?.focus();
    };
    if (!nom) return falla("Falta el nombre.", rNombre);
    if (!existente && !cat) return falla("Producto nuevo: falta la categoría.", rCategoria);
    if (!/^\d+(\.\d+)?$/.test(c) || Number(c) <= 0) return falla("La cantidad tiene que ser un número mayor que 0.", rCant);
    if (!destino) return falla("Elige dónde se guarda.", rUbic);

    setOcupado(true);
    setMsg(null);
    const t0 = performance.now();
    let camino: UltimaAlta["camino"];
    let nuevo = false;
    try {
      const fotoB64 = foto ? await leerComoDataUrl(foto) : undefined;
      const cuerpo = (presentacion_id: number) => ({
        presentacion_id, ubicacion_id: destino.id, cantidad: Number(c), unidad,
        ...(vence ? { vencimiento: vence } : {}), ...(fotoB64 ? { foto: fotoB64 } : {}),
      });
      if (existente) {
        camino = "elementos";
        await api<Elemento[]>("POST", "/elementos", cuerpo(await presentacionGranel(existente.id)));
      } else if (!fotoB64) {
        camino = "importar";
        const fila = csv(["nombre", "categoria", "unidad", "cantidad", "fecha_compra", "fecha_vencimiento",
                          "precio_unitario", "ubicacion"]) + "\n" +
                     csv([nom, cat, unidad, c, hoy, vence, "", destino.nombre]) + "\n";
        const r = await api<ResumenImportacion>("POST", "/importar", fila, "text/csv; charset=utf-8");
        nuevo = r.productos_nuevos.length > 0;
      } else {
        camino = "producto+elementos";
        const mag = unidades.find((u) => u.codigo === unidad)?.magnitud ?? "conteo";
        const catId = categorias.find((x) => normal(x.nombre) === normal(cat))?.id
          ?? (await api<Categoria>("POST", "/categorias", { nombre: cat })).id;
        const prod = await api<Producto>("POST", "/productos", { nombre: nom, categoria_id: catId, unidad_base: BASE_DE[mag] });
        nuevo = true;
        const pres = await api<Presentacion>("POST", "/presentaciones", { producto_id: prod.id, nombre: "a granel" });
        await api<Elemento[]>("POST", "/elementos", cuerpo(pres.id));
      }
      window.__neveraAlta = { camino, ms_servidor: Math.round(performance.now() - t0), con_foto: !!fotoB64 };
      setMsg({
        texto: `Agregado: ${nom} · ${num(Number(c))} ${unidad} · ${vence ? "vence " + fecha(vence, hoy) : "sin fecha"} · ` +
               `${destino.nombre}${nuevo ? " (producto nuevo)" : ""}${fotoB64 ? " · con foto" : ""}.`,
        malo: false,
      });
      setNombre("");
      setCategoria("");
      setCant("1");
      setVence("");
      elegirFoto(null);
      rNombre.current?.focus();
      await alGuardar(nuevo);
    } catch (e) {
      if (!(e instanceof ErrorApi && e.status === 401)) {
        const extra = nuevo ? " El producto quedó creado: al reintentar se reutiliza." : "";
        setMsg({ texto: "No se guardó: " + (e instanceof Error ? e.message : String(e)) + extra, malo: true });
        if (nuevo) await alGuardar(true).catch(() => undefined); // recarga el catálogo: el reintento lo encuentra
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="tablero alta">
      <header className="barra">
        <button type="button" className="boton-texto volver" onClick={alVolver}>← Tablero</button>
        <h1>Agregar</h1>
      </header>
      <form id="f-alta" className="panel alta-panel" onSubmit={enviar} autoComplete="off" noValidate>
        <label htmlFor="a-nombre">Nombre</label>
        <input id="a-nombre" ref={rNombre} list="dl-productos" value={nombre} onChange={(e) => alEscribirNombre(e.target.value)}
               onKeyDown={siguiente(0)} autoCapitalize="sentences" enterKeyHint="next" required />
        <p className="ayuda" id="a-nombre-ayuda">
          {existente ? `Ya existe (${existente.categoria ?? "sin categoría"}): se suma una unidad nueva.`
            : nombre.trim() ? "Producto nuevo: elige su categoría." : " "}
        </p>

        <label htmlFor="a-categoria">Categoría</label>
        <input id="a-categoria" ref={rCategoria} list="dl-categorias" value={categoria}
               onChange={(e) => setCategoria(e.target.value)} onKeyDown={siguiente(1)} autoCapitalize="none" enterKeyHint="next" />

        <div className="par">
          <div>
            <label htmlFor="a-cantidad">Cantidad</label>
            <input id="a-cantidad" ref={rCant} inputMode="decimal" value={cant} onChange={(e) => setCant(e.target.value)}
                   onKeyDown={siguiente(2)} onFocus={(e) => e.target.select()} enterKeyHint="next" required />
          </div>
          <div>
            <label htmlFor="a-unidad">Unidad</label>
            <select id="a-unidad" ref={rUnidad} value={unidad} onChange={(e) => setUnidad(e.target.value)} onKeyDown={siguiente(3)}>
              {unidades.map((u) => <option key={u.codigo} value={u.codigo} title={u.nombre}>{u.codigo}</option>)}
            </select>
          </div>
        </div>

        <label htmlFor="a-ubicacion">Ubicación</label>
        <select id="a-ubicacion" ref={rUbic} value={ubicacion ?? ""} onChange={(e) => setUbicacion(Number(e.target.value))}
                onKeyDown={siguiente(4)}>
          {[...ubic.porId.values()].map((u) => (
            <option key={u.id} value={u.id}>{u.padre_id === null ? u.nombre : `— ${u.nombre}`}</option>
          ))}
        </select>

        <label htmlFor="a-vence">Vence</label>
        <input id="a-vence" ref={rVence} type="date" value={vence} onChange={(e) => setVence(e.target.value)} enterKeyHint="done" />

        <div className="foto">
          <input ref={rFoto} id="a-foto" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*"
                 capture="environment" hidden onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)} />
          {vista ? (
            <>
              <img src={vista} alt="Foto elegida" className="foto-vista" />
              <button type="button" className="boton-texto" onClick={() => elegirFoto(null)}>Quitar foto</button>
            </>
          ) : (
            <button type="button" className="boton-secundario" id="a-foto-boton" onClick={() => rFoto.current?.click()}>
              Foto (opcional)
            </button>
          )}
        </div>

        <button id="a-guardar" type="submit" className="boton-principal" disabled={ocupado}>
          {ocupado ? "Guardando…" : `Guardar en ${ubicacion !== null ? (ubic.porId.get(ubicacion)?.nombre ?? "") : ""}`}
        </button>
        {msg && <p id="a-msg" className={msg.malo ? "error" : "mensaje"} role={msg.malo ? "alert" : "status"}>{msg.texto}</p>}
      </form>
      <datalist id="dl-productos">{productos.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>
      <datalist id="dl-categorias">{categorias.map((c) => <option key={c.id} value={c.nombre} />)}</datalist>
    </main>
  );
}
