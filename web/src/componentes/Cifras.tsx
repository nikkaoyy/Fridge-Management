import { type Cifras as TCifras, pesos, plural } from "../logica";

interface Props {
  c: TCifras;
}

interface Tile {
  id: string;
  etiqueta: string;
  valor: string;
  nota: string;
  tono: "danger" | "warn" | "done" | "neutro";
}

/**
 * La cabecera de cifras, en grande y primero. El número va en tinta (--ink, JetBrains Mono); el color del semáforo
 * es la marca de al lado, nunca el único portador: cada tile dice con palabras qué cuenta.
 */
export default function Cifras({ c }: Props) {
  const r = c.riesgo;
  const riesgo =
    r.cosas === 0
      ? { valor: pesos(0), nota: "nada vence en ≤ 7 días" }
      : r.cop === null
        ? { valor: "sin precio", nota: `${plural(r.cosas, "cosa", "cosas")} en riesgo, ninguna con precio` }
        : {
            valor: pesos(r.cop),
            nota:
              `${plural(r.cosas, "cosa vencida o", "cosas vencidas o")} en ≤ 7 días` +
              (r.sinPrecio ? ` · ${r.sinPrecio} sin precio (no suman)` : ""),
          };
  const tiles: Tile[] = [
    { id: "hoy", etiqueta: "Vencen hoy", valor: String(c.hoy), nota: "con fecha de hoy", tono: c.hoy ? "danger" : "neutro" },
    { id: "en2", etiqueta: "En ≤ 2 días", valor: String(c.en2), nota: "hoy, mañana o pasado", tono: c.en2 ? "danger" : "neutro" },
    { id: "en7", etiqueta: "En ≤ 7 días", valor: String(c.en7), nota: "de hoy a 7 días", tono: c.en7 ? "warn" : "neutro" },
    { id: "vencidos", etiqueta: "Vencidas", valor: String(c.vencidos), nota: c.vencidos ? "revisar o botar" : "ninguna", tono: c.vencidos ? "danger" : "done" },
  ];
  return (
    <section className="cifras" aria-label="Cifras">
      <div className="cifra cifra-heroe" data-cifra="total">
        <span className="cifra-etiqueta">Cosas en casa</span>
        <span className="cifra-valor mono">{c.total}</span>
        <span className="cifra-nota">disponibles ahora</span>
      </div>
      {tiles.map((t) => (
        <div key={t.id} className={`cifra tono-${t.tono}`} data-cifra={t.id}>
          <span className="cifra-etiqueta">
            <i className="marca" aria-hidden="true" />
            {t.etiqueta}
          </span>
          <span className="cifra-valor mono">{t.valor}</span>
          <span className="cifra-nota">{t.nota}</span>
        </div>
      ))}
      <div className={`cifra cifra-ancha tono-${r.cosas ? "warn" : "neutro"}`} data-cifra="riesgo">
        <span className="cifra-etiqueta">
          <i className="marca" aria-hidden="true" />
          Valor en riesgo
        </span>
        <span className={`cifra-valor mono${r.cop === null && r.cosas ? " sin-dato" : ""}`}>{riesgo.valor}</span>
        <span className="cifra-nota">{riesgo.nota}</span>
      </div>
    </section>
  );
}
