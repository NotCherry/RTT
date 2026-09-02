import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";
const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET ?? "ws://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    // Three.js is intentionally kept in one vendor chunk; its minified size is
    // larger than Vite's default warning threshold but remains 136 kB gzipped.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/three/")) {
            return "three-vendor";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiProxyTarget,
      "/ws": {
        target: wsProxyTarget,
        ws: true,
      },
    },
  },
});
