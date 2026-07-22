import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Renderer build only — main/preload live in @vibefield/electron-shell (build:shell).
//
// Loro wasm decision (B1 spike, mirrors ICE's widgetlab-desktop): alias bare
// "loro-crdt" to its base64 variant — wasm inlined in JS, compiled
// synchronously, zero fetch/import.meta.url — so the prod file:// renderer
// needs no loopback server, no vite-plugin-wasm, no COOP/COEP. Exact-match
// regex so explicit subpath imports never double-append.
export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: [{ find: /^loro-crdt$/, replacement: "loro-crdt/base64" }],
    // one copy each of the stateful libs (ICE marks them external in its dist)
    dedupe: [
      "react",
      "react-dom",
      "three",
      "@react-three/fiber",
      "loro-crdt",
      "@vibecook/strata-ecs",
    ],
  },
  build: {
    outDir: join(import.meta.dirname, "dist", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: join(import.meta.dirname, "renderer", "index.html"),
        // test-only entry (ESR-12): built ONLY when the spike is requested —
        // the production renderer output carries no spike code
        ...(process.env["VITE_SPIKE"]
          ? { "spike-loro": join(import.meta.dirname, "renderer", "spike-loro.html") }
          : {}),
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
