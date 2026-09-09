import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const backendTarget = `http://127.0.0.1:${process.env.BG_PORT ?? "14070"}`;

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
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: false,
      },
      // Slide deck runtime served by the backend. Without this, an iframe
      // loaded via Vite (port 5173) would 404 on the <script src="/runtime/
      // deck-stage.js"> tag injected into deck.html.
      "/runtime": {
        target: backendTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
