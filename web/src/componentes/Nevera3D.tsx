// La nevera en 3D (PEDIDO-NEVERA-6): la segunda vista del tablero. Se carga aparte (import dinámico): quien usa la
// lista no descarga three. El motor es imperativo y vive fuera de React; aquí solo se le pasan datos y se escuchan
// sus toques.
import { useEffect, useMemo, useRef, useState } from "react";
import { cifras, plural, type Ubicaciones } from "../logica";
import type { Categoria, Elemento } from "../tipos";
import { registrarEscena } from "../escena/capacidad";
import { MotorNevera } from "../escena/motor";

interface Props {
  elementos: Elemento[];
  ubic: Ubicaciones;
  categorias: Categoria[];
  /** Modo ligero automático (de capacidad()) y su motivo. */
  ligeroAuto: boolean;
  motivoAuto: string;
  alFallar: (motivo: string) => void;
}

const CLAVE_LIGERO = "nevera.ligero";

export default function Nevera3D({ elementos, ubic, categorias, ligeroAuto, motivoAuto, alFallar }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const motor = useRef<MotorNevera | null>(null);
  const elegidoAMano = localStorage.getItem(CLAVE_LIGERO);
  const [ligero, setLigero] = useState(elegidoAMano === null ? ligeroAuto : elegidoAMano === "1");
  const fallar = useRef(alFallar);
  fallar.current = alFallar;

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
        alElegir: () => {},
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
                title="Menos resolución y esferas más simples: para teléfonos">
          Ligero
        </button>
      </div>
      <div className="escena" ref={caja} />
      <ul className="leyenda-3d" aria-label="Colores">
        <li className="tono-danger"><i className="marca" aria-hidden="true" />vencido o ≤ 2 días</li>
        <li className="tono-warn"><i className="marca" aria-hidden="true" />≤ 7 días</li>
        <li className="tono-done"><i className="marca" aria-hidden="true" />más de 7</li>
        <li className="ayuda-3d">Arrastra para girar, pellizca o usa la rueda para acercar, toca un compartimento para verlo de cerca.</li>
      </ul>
    </section>
  );
}
