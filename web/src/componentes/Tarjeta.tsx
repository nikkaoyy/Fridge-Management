import { useEffect, useRef, useState, type FormEvent } from "react";
import { cantidad, fecha, semaforo, textoDias } from "../logica";
import type { Elemento } from "../tipos";

export type Accion = "abri" | "acabo" | "botar" | "fecha";

interface Props {
  e: Elemento;
  ubicacion: string;
  hoy: string | null;
  puede: boolean;
  abierta: Accion | null;
  alAbrir: (a: Accion | null) => void;
  alEjecutar: (e: Elemento, a: Accion, valor?: string) => Promise<void>;
}

const BOTONES: [Accion, string][] = [["abri", "Abrí"], ["acabo", "Se acabó"], ["botar", "Botar"], ["fecha", "Fecha"]];

export default function Tarjeta({ e, ubicacion, hoy, puede, abierta, alAbrir, alEjecutar }: Props) {
  const sem = semaforo(e.dias_para_vencer);
  const parcial = e.saldo < e.cantidad_inicial;
  return (
    <li className={`tarjeta sem-${sem}`} data-elemento={e.id} data-semaforo={sem}>
      <div className="tarjeta-fila">
        <h3 className="tarjeta-nombre">
          {sem === "vencido" && <span className="marca-vencido">Vencido</span>}
          {e.producto}
          {e.presentacion && e.presentacion !== "a granel" && <small> · {e.presentacion}</small>}
          {e.etiqueta && <small> · {e.etiqueta}</small>}
        </h3>
        <span className="dias" title={e.vencimiento ?? "sin vencimiento"}>
          <i className="marca" aria-hidden="true" />
          {textoDias(e.dias_para_vencer)}
        </span>
      </div>
      <dl className="tarjeta-datos">
        <div>
          <dt>Cantidad</dt>
          <dd className="mono">
            {cantidad(e.saldo, e.unidad_base)}
            {parcial && <span className="tenue"> de {cantidad(e.cantidad_inicial, e.unidad_base)}</span>}
          </dd>
        </div>
        <div>
          <dt>Dónde</dt>
          <dd>{ubicacion}</dd>
        </div>
        <div>
          <dt>Vence</dt>
          <dd className="mono">{e.vencimiento ? fecha(e.vencimiento, hoy) : "—"}</dd>
        </div>
      </dl>
      {e.abierto_en && <p className="tarjeta-extra">Abierto el {fecha(e.abierto_en, hoy)}</p>}
      {e.nota && <p className="tarjeta-nota">{e.nota}</p>}
      {puede &&
        (abierta ? (
          <Confirmacion e={e} accion={abierta} hoy={hoy} alCerrar={() => alAbrir(null)} alEjecutar={alEjecutar} />
        ) : (
          <div className="acciones">
            {BOTONES.map(([a, texto]) =>
              a === "abri" && e.abierto_en ? (
                <span key={a} className="accion apagada">Abierto</span>
              ) : (
                <button key={a} type="button" className="accion" data-accion={a} onClick={() => alAbrir(a)}>
                  {texto}
                </button>
              ),
            )}
          </div>
        ))}
    </li>
  );
}

interface PropsConf {
  e: Elemento;
  accion: Accion;
  hoy: string | null;
  alCerrar: () => void;
  alEjecutar: (e: Elemento, a: Accion, valor?: string) => Promise<void>;
}

/** Cada acción pide un «Sí» en la misma tarjeta; «No» (o Escape) la cierra sin tocar nada. */
function Confirmacion({ e, accion, hoy, alCerrar, alEjecutar }: PropsConf) {
  const [valor, setValor] = useState(e.vencimiento ?? "");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const foco = useRef<HTMLInputElement & HTMLButtonElement>(null);
  useEffect(() => foco.current?.focus(), []);

  const queda = cantidad(e.saldo, e.unidad_base);
  const textos: Record<Accion, [string, string]> = {
    abri: [`¿Abriste «${e.producto}» hoy (${fecha(hoy)})?`, "Sí, lo abrí"],
    acabo: [`¿Se acabó «${e.producto}»? Sale lo que queda (${queda}).`, "Sí, se acabó"],
    botar: [`¿Botar «${e.producto}»? Queda como merma (${queda}).`, "Sí, botar"],
    fecha: [`Nuevo vencimiento de «${e.producto}»:`, "Guardar"],
  };
  const [pregunta, si] = textos[accion];

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (accion === "fecha" && !valor) {
      setError("Elige una fecha.");
      return;
    }
    setOcupado(true);
    setError("");
    try {
      await alEjecutar(e, accion, valor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOcupado(false);
    }
  }

  return (
    <form className="confirma" data-accion={accion} onSubmit={enviar}
          onKeyDown={(ev) => ev.key === "Escape" && alCerrar()}>
      <p className="pregunta">{pregunta}</p>
      {accion === "fecha" && (
        <input ref={foco} type="date" value={valor} onChange={(ev) => setValor(ev.target.value)}
               aria-label="Nuevo vencimiento" required />
      )}
      <div className="botones">
        <button ref={accion === "fecha" ? undefined : foco} type="submit" className="si" disabled={ocupado}>{si}</button>
        <button type="button" className="no" onClick={alCerrar} disabled={ocupado}>No</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
