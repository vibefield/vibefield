import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rendererRoot = join(import.meta.dirname, "src", "renderer-host");
const mainEntry = join(rendererRoot, "index.html");
const designSystemEntry = join(rendererRoot, "design-system.html");

// Renderer build only — main/preload live in @vibefield/electron-shell (build:shell).
//
// Loro wasm decision (B1 spike, mirrors ICE's widgetlab-desktop): alias bare
// "loro-crdt" to its base64 variant — wasm inlined in JS, compiled
// synchronously, zero fetch/import.meta.url — so the prod file:// renderer
// needs no loopback server, no vite-plugin-wasm, no COOP/COEP. Exact-match
// regex so explicit subpath imports never double-append.
export default defineConfig(({ mode }) => ({
  // root = the tiny renderer-host adapter (ESR 3a); the product code lives
  // behind @vibefield/field-app's public entry. Output lands in THIS package's
  // dist so the shell is self-contained (main loads ../renderer from dist/main).
  root: rendererRoot,
  base: "./",
  // The dev runner overrides this one compile-time capability for
  // `dev:onboarding`. Packaged and smoke renderers always get the safe default.
  define: { __VIBEFIELD_FORCE_ONBOARDING__: "false" },
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
  // Dev always optimizes the union of the product and UI Bench graphs. Both
  // surfaces share this cache, so changing launch modes must never leave the
  // product renderer consuming a design-only optimizer result. Fiber is
  // explicit through its linked-workspace owner (Vite's nested-dependency
  // syntax); prebundling it is what keeps its Zustand/CommonJS dependencies
  // behind one Vite-compatible ESM boundary. The explicit include also gives
  // Vite 8 a config-hash change so historical mode-dependent caches are
  // invalidated once instead of requiring a manual cache deletion.
  optimizeDeps: {
    entries: ["index.html", "design-system.html"],
    include: ["@vibefield/field-app > @react-three/fiber"],
  },
  build: {
    // A bench bundle is useful for isolated inspection, but it is development
    // material and therefore lands under the ignored dev root. Production's
    // renderer directory can never be replaced by a design build.
    outDir:
      mode === "design"
        ? join(import.meta.dirname, "..", "..", ".vibefield", "ui-bench", "renderer")
        : join(import.meta.dirname, "dist", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input:
        mode === "design"
          ? {
              "design-system": designSystemEntry,
            }
          : {
              main: mainEntry,
              // test-only entry (ESR-12): built ONLY when the spike is requested —
              // the production renderer output carries no spike code
              ...(process.env["VITE_SPIKE"]
                ? {
                    "spike-loro": join(
                      import.meta.dirname,
                      "src",
                      "renderer-host",
                      "spike-loro.html",
                    ),
                  }
                : {}),
            },
    },
  },
  server: { port: mode === "design" ? 5174 : 5173, strictPort: true },
}));
