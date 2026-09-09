import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: {
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:14070",
        changeOrigin: false,
      },
      // Slide deck runtime served by the backend. Without this, an iframe
      // loaded via Vite (port 5173) would 404 on the <script src="/runtime/
      // deck-stage.js"> tag injected into deck.html.
      "/runtime": {
        target: "http://127.0.0.1:14070",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
