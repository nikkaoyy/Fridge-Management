import { useCallback, useEffect, useState } from "react";
import { api, alRechazar, CLAVE_TOKEN, ErrorApi, fijarToken } from "./api";
import Entrar from "./componentes/Entrar";
import Tablero from "./componentes/Tablero";
import type { Miembro } from "./tipos";

type Estado =
  | { fase: "comprobando" }
  | { fase: "token"; error: string; reintentar: boolean; ocupado: boolean }
  | { fase: "dentro"; yo: Miembro; sesion: number };

function mensajeDeFallo(e: unknown): string {
  if (e instanceof ErrorApi) {
    if (e.status === 401) return "Ese token no vale: el servidor lo rechazó. Pídele uno válido al admin.";
    if (e.status === 0) return e.message;
    return `No se pudo validar el token (${e.status}): ${e.message}`;
  }
  return "No se pudo validar el token.";
}

/**
 * La puerta: nada se pide a la API (ni se pinta un dato) hasta que GET /miembros/yo acepta el token. Si después el
 * servidor lo rechaza (revocado), se olvida en el dispositivo y el tablero se desmonta entero: sus datos salen del DOM.
 */
export default function App() {
  const [estado, setEstado] = useState<Estado>({ fase: "comprobando" });

  const olvidar = useCallback((motivo: string) => {
    localStorage.removeItem(CLAVE_TOKEN);
    fijarToken(null);
    alRechazar(null);
    setEstado({ fase: "token", error: motivo, reintentar: false, ocupado: false });
  }, []);

  const validar = useCallback(
    async (token: string, guardado: boolean) => {
      fijarToken(token);
      try {
        const yo = await api<Miembro>("GET", "/miembros/yo");
        localStorage.setItem(CLAVE_TOKEN, token);
        alRechazar(() => olvidar("El token dejó de valer en el servidor. Escribe uno válido."));
        setEstado({ fase: "dentro", yo, sesion: Date.now() });
      } catch (e) {
        fijarToken(null);
        const es401 = e instanceof ErrorApi && e.status === 401;
        if (guardado && es401) {
          localStorage.removeItem(CLAVE_TOKEN);
          setEstado({ fase: "token", error: "El token guardado en este dispositivo ya no vale. Escribe uno válido.",
                      reintentar: false, ocupado: false });
        } else {
          // un fallo de red o del servidor no es culpa del token: si estaba guardado, se queda para reintentar
          setEstado({ fase: "token", error: mensajeDeFallo(e), reintentar: guardado && !es401, ocupado: false });
        }
      }
    },
    [olvidar],
  );

  const conGuardado = useCallback(() => {
    const t = localStorage.getItem(CLAVE_TOKEN);
    if (!t) {
      setEstado({ fase: "token", error: "", reintentar: false, ocupado: false });
      return;
    }
    setEstado({ fase: "comprobando" });
    void validar(t, true);
  }, [validar]);

  useEffect(() => {
    conGuardado();
  }, [conGuardado]);

  if (estado.fase === "comprobando") return <p className="cargando">Cargando…</p>;
  if (estado.fase === "token") {
    return (
      <Entrar
        error={estado.error}
        ocupado={estado.ocupado}
        puedeReintentar={estado.reintentar}
        alEntrar={(t) => {
          setEstado({ ...estado, error: "", ocupado: true });
          void validar(t, false);
        }}
        alReintentar={conGuardado}
      />
    );
  }
  return (
    <Tablero key={estado.sesion} yo={estado.yo} alSalir={() => olvidar("Token olvidado en este dispositivo.")} />
  );
}
