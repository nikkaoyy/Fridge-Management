import { useEffect, useState } from "react";
import { api, ErrorApi } from "../api";
import type { Elemento, Miembro } from "../tipos";

interface Props {
  yo: Miembro;
  alSalir: () => void;
}

/** Bloque 1: solo demuestra la puerta (el tablero de verdad llega en el bloque 2). */
export default function Tablero({ yo, alSalir }: Props) {
  const [elementos, setElementos] = useState<Elemento[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Elemento[]>("GET", "/elementos")
      .then(setElementos)
      .catch((e: unknown) => {
        if (!(e instanceof ErrorApi && e.status === 401)) setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  return (
    <main className="tablero">
      <header className="barra">
        <h1>Nevera</h1>
        <span className="quien">{yo.nombre}</span>
        <button type="button" className="boton-texto" onClick={alSalir}>Salir</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="resumen">{elementos === null ? "Cargando…" : `${elementos.length} cosas`}</p>
    </main>
  );
}
