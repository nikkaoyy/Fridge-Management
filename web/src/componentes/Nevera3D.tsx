// La nevera en 3D (PEDIDO-NEVERA-6): la segunda vista del tablero. Se carga aparte (import dinámico): quien usa la
// lista no descarga three. El motor es imperativo y vive fuera de React; aquí solo se le pasan datos y se escuchan
// sus toques.
import { useEffect, useMemo, useRef, useState } from "react";
import { cifras, plural, type Ubicaciones } from "../logica";
import Tarjeta, { type Accion } from "./Tarjeta";
import type { Categoria, Elemento } from "../tipos";
import { registrarEscena } from "../escena/capacidad";
import { MotorNevera } from "../escena/motor";
import { FORMAS, queLleva, type Forma } from "../escena/familias";

/** El dibujo de cada forma para la leyenda (trazo con el color del texto: ningún color propio). */
function Icono({ forma }: { forma: Forma }) {
  const trazo = {
    botella: <path d="M6.6 1.5h2.8v2.2l1.6 2V14.5H5V5.7l1.6-2z" />,
    caja: <rect x="3.5" y="2.5" width="9" height="12" rx="1.6" />,
    bolsa: <path d="M6 2.2l2 1.6 2-1.6-.4 2.6c2.4 1 3.4 3 3.4 5.4 0 3-2 4.3-5 4.3s-5-1.3-5-4.3c0-2.4 1-4.4 3.4-5.4z" />,
    lata: <rect x="3" y="5.5" width="10" height="7.5" rx="1.6" />,
    esfera: <ellipse cx="8" cy="8.8" rx="5.6" ry="5" />,
  }[forma];
  return (
    <svg className="icono-forma" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      {trazo}
    </svg>
  );
}

interface Props {
  elementos: Elemento[];
  ubic: Ubicaciones;
  categorias: Categoria[];
  /** Modo ligero automático (de capacidad()) y su motivo. */
  ligeroAuto: boolean;
  motivoAuto: string;
  alFallar: (motivo: string) => void;
  /** Lo mismo que recibe cada tarjeta de la lista: el panel de una cosa es esa misma tarjeta, con sus acciones. */
  hoy: string;
  puede: boolean;
  nombreUbic: (id: number) => string;
  abierta: { id: number; accion: Accion } | null;
  alAbrir: (id: number, a: Accion | null) => void;
  alEjecutar: (e: Elemento, a: Accion, valor?: string) => Promise<void>;
}

const CLAVE_LIGERO = "nevera.ligero";

export default function Nevera3D(p: Props) {
  const { elementos, ubic, categorias, ligeroAuto, motivoAuto, alFallar } = p;
  const caja = useRef<HTMLDivElement>(null);
  const motor = useRef<MotorNevera | null>(null);
  const elegidoAMano = localStorage.getItem(CLAVE_LIGERO);
  const [ligero, setLigero] = useState(elegidoAMano === null ? ligeroAuto : elegidoAMano === "1");
  const fallar = useRef(alFallar);
  fallar.current = alFallar;
  const [sel, setSel] = useState<number | null>(null);
  const alAbrir = useRef(p.alAbrir);
  alAbrir.current = p.alAbrir;
  const elegida = sel === null ? undefined : elementos.find((e) => e.id === sel);

  const catMap = useMemo(() => new Map(categorias.map((c) => [c.id, c.nombre])), [categorias]);
  const c = useMemo(() => cifras(elementos), [elementos]);

  // El motor se crea una vez por montaje; si WebGL falla al crearlo, la app vuelve a la lista.
  useEffect(() => {
    if (!caja.current) return;
    let m: MotorNevera;
    try {
      const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      m = new MotorNevera(caja.current, {
        ligero,
        motivoLigero: elegidoAMano === null ? motivoAuto : "elegido a mano",
        reducido,
        alElegir: (id) => {
          setSel(id);
          if (id !== null) alAbrir.current(id, null);
        },
        alFallar: (motivo) => fallar.current(motivo),
      });
    } catch (e) {
      fallar.current(e instanceof Error ? e.message : String(e));
      return;
    }
    motor.current = m;
    registrarEscena(m.estadisticas as unknown as { rendimiento: unknown });
    return () => {
      registrarEscena(null);
      motor.current = null;
      m.destruir();
    };
    // ligero y el motivo inicial solo cuentan al crear (el antialias se decide ahí); después va por setLigero.
  }, []);

  useEffect(() => {
    motor.current?.actualizar({ elementos, ubic, categorias: catMap });
  }, [elementos, ubic, catMap]);

  // Lo que se acabó o se botó ya no está: su panel se cierra solo. El aro de la escena sigue a la selección.
  useEffect(() => {
    if (sel !== null && !elegida) setSel(null);
    motor.current?.seleccionar(elegida ? elegida.id : null);
  }, [sel, elegida]);

  useEffect(() => {
    if (sel === null) return;
    const alTeclear = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !p.abierta) {
        setSel(null);
        motor.current?.plegar();
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [sel, p.abierta]);

  function cambiarLigero() {
    const l = !ligero;
    setLigero(l);
    localStorage.setItem(CLAVE_LIGERO, l ? "1" : "0");
    motor.current?.setLigero(l, "elegido a mano");
  }

  return (
    <section className="vista-3d" aria-label="La nevera en 3D">
      <div className="barra-3d">
        <p className="resumen-3d">
          {plural(c.total, "cosa", "cosas")}
          {c.vencidos > 0 && <span className="t-danger"> · {c.vencidos} vencida{c.vencidos === 1 ? "" : "s"}</span>}
          {c.en2 > 0 && <span className="t-danger"> · {c.en2} en ≤ 2 días</span>}
          {c.en7 - c.en2 > 0 && <span className="t-warn"> · {c.en7 - c.en2} en ≤ 7</span>}
        </p>
        <button type="button" id="encuadre" className="chip" onClick={() => motor.current?.encuadrar()}>
          Encuadre
        </button>
        <button type="button" id="modo-ligero" className="chip" aria-pressed={ligero} onClick={cambiarLigero}
                title="Menos resolución y cuerpos más simples: para teléfonos">
          Ligero
        </button>
      </div>
      <div className="escena-marco">
        <div className="escena" ref={caja} />
        {elegida && (
          <aside className="panel-3d" aria-label={`${elegida.producto}: acciones`}>
            <button type="button" id="cerrar-panel" className="boton-texto cerrar-panel" onClick={() => setSel(null)}>
              Cerrar
            </button>
            <ul className="tarjetas">
              <Tarjeta
                e={elegida}
                ubicacion={p.nombreUbic(elegida.ubicacion_id)}
                hoy={p.hoy}
                puede={p.puede}
                abierta={p.abierta && p.abierta.id === elegida.id ? p.abierta.accion : null}
                alAbrir={(a) => p.alAbrir(elegida.id, a)}
                alEjecutar={p.alEjecutar}
              />
            </ul>
          </aside>
        )}
      </div>
      {/* NEVERA-7: la leyenda en una línea, debajo de la escena: las cinco formas y qué dice cada color. */}
      <ul className="leyenda-3d" aria-label="Leyenda">
        {FORMAS.map((f) => (
          <li key={f} title={`${f}: ${queLleva(f)}`} aria-label={f}>
            <Icono forma={f} />
            <span className="largo">{f}</span>
          </li>
        ))}
        <li className="leyenda-sep"><span className="largo">cuerpo: su categoría · </span>aro:</li>
        <li className="tono-danger"><i className="aro late" aria-hidden="true" />≤ 2<span className="largo"> días</span></li>
        <li className="tono-warn"><i className="aro" aria-hidden="true" />≤ 7</li>
        <li className="tono-done"><i className="aro" aria-hidden="true" />más</li>
        <li><b className="pastilla-leyenda">×3</b><span className="largo">montón</span></li>
      </ul>
      <p className="ayuda-3d">
        El color del cuerpo es su categoría y el aro, lo que le queda (late si vence en 2 días o menos). Arrastra para
        girar, pellizca o usa la rueda para acercar. Toca una balda para verla de cerca, un montón para desplegarlo y
        una cosa para sus acciones.
      </p>
    </section>
  );
}
