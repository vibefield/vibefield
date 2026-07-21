import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Renderer build only — electron/main+preload are esbuild bundles (build:shell).
export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [react()],
  build: {
    outDir: join(import.meta.dirname, "dist", "renderer"),
    emptyOutDir: true,
  },
  server: { port: 5173, strictPort: true },
});
