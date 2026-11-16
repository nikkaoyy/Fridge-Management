// Cliente de la API (mismo origen). Reglas, las mismas de NEVERA-3:
// - El token vive solo en localStorage de este dispositivo y solo viaja en la cabecera Authorization.
// - Nada de datos hasta validar el token con GET /miembros/yo (lo hace App.tsx).
// - Solo endpoints del contrato. Cada llamada se escribe `api("MÉTODO", "/ruta", …)` con la ruta literal:
//   tests/test_pantalla.py las busca en web/src y comprueba que todas estén en api/openapi.yaml y no sean de fase 2.

export const CLAVE_TOKEN = "nevera.token"; // la misma de NEVERA-3: el móvil que ya entró sigue dentro

export class ErrorApi extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

let token: string | null = null;
let alRechazo: (() => void) | null = null;

export function fijarToken(t: string | null): void {
  token = t;
}

/** Se llama cuando el servidor responde 401 con un token que antes valía (revocado): App olvida y borra todo. */
export function alRechazar(f: (() => void) | null): void {
  alRechazo = f;
}

export async function api<T>(metodo: string, ruta: string, cuerpo?: unknown, tipo?: string): Promise<T> {
  if (!token) throw new ErrorApi(401, "no_autenticado", "sin token");
  const h: Record<string, string> = { Authorization: "Bearer " + token, Accept: "application/json" };
  let body: string | undefined;
  if (cuerpo !== undefined) {
    h["Content-Type"] = tipo ?? "application/json";
    body = tipo ? String(cuerpo) : JSON.stringify(cuerpo);
  }
  let r: Response;
  try {
    r = await fetch(ruta, { method: metodo, headers: h, body, cache: "no-store", credentials: "omit" });
  } catch {
    throw new ErrorApi(0, "red", "No se pudo hablar con el servidor. ¿Estás en la red de la casa?");
  }
  const datos = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    const e = (datos && (datos as { error?: { codigo?: string; mensaje?: string } }).error) || {};
    if (r.status === 401 && alRechazo) alRechazo();
    throw new ErrorApi(r.status, e.codigo || "error", e.mensaje || "error " + r.status);
  }
  return datos as T;
}
