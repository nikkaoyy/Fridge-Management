import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El build sale a web/dist, que es lo que sirve FastAPI (app/pantalla.py) en el 8451. Una sola cosa que arrancar.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0 },
  // Solo para desarrollo (npm run dev): la API va al servicio en 8451.
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: Object.fromEntries(
      ["/miembros", "/ubicaciones", "/unidades", "/categorias", "/productos", "/presentaciones", "/elementos",
       "/vencimientos", "/movimientos", "/importar", "/indicadores", "/salud"].map((r) => [r, "http://127.0.0.1:8451"]),
    ),
  },
});
