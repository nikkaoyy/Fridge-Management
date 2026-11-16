// La piel en la escena: los colores salen de las variables CSS del <head> (tokens de ARIA copiados de
// /opt/data/pythagoras/web/src/styles/tokens.css, más --danger de la nevera). En PYTHAGORAS eran constantes en
// data/sistema.ts (COLOR); aquí se leen en tiempo de ejecución para que no haya un segundo sitio con los mismos
// valores (y tests/test_pantalla.py prohíbe colores literales en web/src).

const NOMBRES = {
  void: "--void-900",
  panel: "--void-800",
  elevado: "--void-700",
  borde: "--line",
  bordeFuerte: "--line-strong",
  ink: "--ink",
  muted: "--ink-muted",
  faint: "--ink-faint",
  cyan: "--cyan",
  blue: "--blue",
  active: "--active", // NEVERA-7: el violeta de ARIA, para el tono de algunas categorías
  done: "--done",
  warn: "--warn",
  danger: "--danger",
} as const;

export type Token = keyof typeof NOMBRES;
export type Piel = Record<Token, string>;

let cache: Piel | null = null;

/** Los tokens como cadenas CSS (`#rrggbb`), leídos una vez del documento. */
export function piel(): Piel {
  if (cache) return cache;
  const estilo = getComputedStyle(document.documentElement);
  const p = {} as Piel;
  for (const [k, v] of Object.entries(NOMBRES) as [Token, string][]) p[k] = estilo.getPropertyValue(v).trim();
  cache = p;
  return p;
}
