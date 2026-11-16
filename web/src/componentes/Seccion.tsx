import { fraseVacia, semaforo } from "../logica";
import type { Elemento, Ubicacion } from "../tipos";
import Tarjeta, { type Accion } from "./Tarjeta";

interface Props {
  u: Ubicacion;
  total: number; //           cosas en esta ubicación (con sus sububicaciones), sin filtro
  visibles: Elemento[]; //    ya filtrados y ordenados por urgencia
  motivoVacio: "vacia" | "busqueda" | "por-vencer";
  plegada: boolean;
  alPlegar: () => void;
  nombreUbic: (id: number) => string;
  hoy: string | null;
  puede: boolean;
  abierta: { id: number; accion: Accion } | null;
  alAbrir: (id: number, a: Accion | null) => void;
  alEjecutar: (e: Elemento, a: Accion, valor?: string) => Promise<void>;
  alAgregar: (ubicacionId: number) => void;
}

export default function Seccion(p: Props) {
  const urgentes = p.visibles.filter((e) => ["vencido", "urgente"].includes(semaforo(e.dias_para_vencer))).length;
  const filtrado = p.visibles.length !== p.total;
  const idCuerpo = `seccion-${p.u.id}`;
  return (
    <section className={`seccion${p.plegada ? " plegada" : ""}`} data-seccion={p.u.nombre} aria-labelledby={`${idCuerpo}-t`}>
      <h2 className="seccion-titulo" id={`${idCuerpo}-t`}>
        <button type="button" aria-expanded={!p.plegada} aria-controls={idCuerpo} onClick={p.alPlegar}>
          <span className="seccion-nombre">{p.u.nombre}</span>
          <span className="seccion-cuenta mono" data-cuenta={p.visibles.length}>
            {filtrado ? `${p.visibles.length} de ${p.total}` : p.total}
          </span>
          {urgentes > 0 && <span className="seccion-urgentes">{urgentes} urgente{urgentes === 1 ? "" : "s"}</span>}
          <span className="chevron" aria-hidden="true" />
        </button>
      </h2>
      {!p.plegada && (
        <div id={idCuerpo} className="seccion-cuerpo">
          {p.visibles.length === 0 ? (
            <div className="vacio">
              <p>{fraseVacia(p.u.nombre, p.motivoVacio, p.puede)}</p>
              {p.motivoVacio === "vacia" && p.puede && (
                <button type="button" className="boton-secundario" onClick={() => p.alAgregar(p.u.id)}>
                  Agregar a {p.u.nombre}
                </button>
              )}
            </div>
          ) : (
            <ul className="tarjetas">
              {p.visibles.map((e) => (
                <Tarjeta
                  key={e.id}
                  e={e}
                  ubicacion={p.nombreUbic(e.ubicacion_id)}
                  hoy={p.hoy}
                  puede={p.puede}
                  abierta={p.abierta && p.abierta.id === e.id ? p.abierta.accion : null}
                  alAbrir={(a) => p.alAbrir(e.id, a)}
                  alEjecutar={p.alEjecutar}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
