import { useEffect, useRef, useState, type FormEvent } from "react";

interface Props {
  error: string;
  ocupado: boolean;
  puedeReintentar: boolean;
  alEntrar: (token: string) => void;
  alReintentar: () => void;
}

/** Sin token válido solo existe esto: un campo y un botón. Ningún dato de la casa. */
export default function Entrar({ error, ocupado, puedeReintentar, alEntrar, alReintentar }: Props) {
  const [token, setToken] = useState("");
  const [falta, setFalta] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campo.current?.focus();
  }, []);

  function enviar(ev: FormEvent) {
    ev.preventDefault();
    const t = token.trim();
    if (!t) {
      setFalta(true);
      return;
    }
    setFalta(false);
    alEntrar(t);
    setToken("");
  }

  const mensaje = falta ? "Escribe el token." : error;
  return (
    <main className="entrar">
      <form id="f-token" className="panel entrar-panel" onSubmit={enviar} autoComplete="off" noValidate>
        <p className="sobretitulo">Nevera · ARIA</p>
        <h1>Entrar</h1>
        <p className="ayuda">Pega tu token de miembro. Se guarda solo en este dispositivo.</p>
        <label htmlFor="token">Token</label>
        <input
          id="token"
          ref={campo}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          required
        />
        <button type="submit" className="boton-principal" disabled={ocupado}>
          {ocupado ? "Comprobando…" : "Entrar"}
        </button>
        {mensaje && (
          <p id="token-error" className="error" role="alert">
            {mensaje}
          </p>
        )}
        {puedeReintentar && (
          <button id="reintentar" type="button" className="boton-secundario" onClick={alReintentar}>
            Reintentar con el token guardado
          </button>
        )}
      </form>
    </main>
  );
}
