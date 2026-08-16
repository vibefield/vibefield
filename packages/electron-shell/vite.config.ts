import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import {
  hostSingletons,
  isExpectedSingletonWarning,
  SINGLETON_CHUNK_PREFIX,
  singletonInputs,
} from "./src/vite/host-singletons";

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
  // P8b-3 §11.6: the host singleton chunks + the inline import map that binds
  // a staged plugin's bare specifiers to them. Production renderer only — the
  // plugin never runs for `design`, and its own `apply: "build"` keeps it out
  // of the dev server, where plugins are bundled and a map would bind
  // specifiers to chunks that were never built.
  plugins: [
    tailwindcss(),
    react(),
    ...(mode === "design" || mode === "live-surfaces-lab" ? [] : [hostSingletons()]),
  ],
  resolve: {
    alias: [{ find: /^loro-crdt$/, replacement: "loro-crdt/base64" }],
    // one copy each of the stateful libs (ICE marks them external in its dist).
    // P8b-3 adds drei: it became a HOST singleton the moment §11.6's map
    // promised plugins one, so field-app declares it (the anchor the singleton
    // chunk resolves from) beside widgetlab's own declaration, and this line is
    // what keeps those two declarations one copy.
    dedupe: [
      "react",
      "react-dom",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
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
    entries:
      mode === "live-surfaces-lab"
        ? ["spike-live-surfaces-lab.html"]
        : ["index.html", "design-system.html"],
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
      // MEASURED, and load-bearing (P8b-3). Vite's client default is `false`,
      // which lets rollup drop an entry chunk's exports when nothing in the
      // build imports them — and nothing does: the singleton chunks' consumers
      // are plugin modules resolved through the import map at RUNTIME, which no
      // bundler can see. The first build with the default emitted eleven
      // side-effect-only files (one of them literally zero bytes), so the map
      // pointed at chunks exporting nothing at all. `allow-extension` keeps the
      // signatures; the html entry has no exports, so nothing else moves.
      preserveEntrySignatures: "allow-extension",
      onwarn(warning, defaultHandler) {
        if (isExpectedSingletonWarning(warning)) return;
        defaultHandler(warning);
      },
      input:
        mode === "design"
          ? {
              "design-system": designSystemEntry,
            }
          : mode === "live-surfaces-lab"
            ? {
                "spike-live-surfaces-lab": join(
                  import.meta.dirname,
                  "src",
                  "renderer-host",
                  "spike-live-surfaces-lab.html",
                ),
              }
            : {
                main: mainEntry,
                // §11.6 — one entry per host singleton, so each has an address the
                // import map can name (see src/vite/host-singletons.ts).
                ...singletonInputs(),
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
      output: {
        // The singleton chunks are UNHASHED because the import map naming them
        // is static text whose bytes main hashes for the CSP; everything else
        // keeps vite's default `assets/[name]-[hash].js` verbatim.
        entryFileNames: (chunk) =>
          chunk.name.startsWith(SINGLETON_CHUNK_PREFIX)
            ? "assets/[name].js"
            : "assets/[name]-[hash].js",
      },
    },
  },
  server: { port: mode === "design" ? 5174 : 5173, strictPort: true },
}));
