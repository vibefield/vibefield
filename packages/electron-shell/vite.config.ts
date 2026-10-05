import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { milleAliases } from "../../scripts/mille-aliases.mjs";
import { readLock, siblingDir } from "../../scripts/siblings.mjs";
import {
  hostSingletons,
  isExpectedSingletonWarning,
  SINGLETON_CHUNK_PREFIX,
  singletonInputs,
} from "./src/vite/host-singletons";
import { renderBlockingEntry } from "./src/vite/render-blocking-entry";

const rendererRoot = join(import.meta.dirname, "src", "renderer-host");
const repoRoot = join(import.meta.dirname, "..", "..");

// AR-0 sibling mode: Vite serves files only under the workspace root by default
// and answers a `link:` package outside it with a 403. The linked sibling
// checkouts (siblings.lock.json, the one reader) join the allow list — and
// ONLY when the lock names them, so registry mode (W-D8) ships this config
// unchanged. Sibling sources then reach the renderer through Vite's own module
// graph (watched, HMR'd), never through the dev runner's watchers.
const siblingEntries = Object.values(readLock(repoRoot)?.siblings ?? {});
const siblingRoots = siblingEntries.map((entry) => siblingDir(repoRoot, entry));
// AR-8c (2026-10-03): a linked package may link further checkouts of its own —
// rosetta's room takes `@vibecook/mille` and `mille-ui` as `link:` rows into a
// mille checkout beside it, the way rosetta's app does — and Vite reaches those
// files by their REAL path, outside every root above. Each such link a lock
// package declares joins the list, resolved from that package's own manifest.
const linkedRoots = siblingEntries.flatMap((entry) =>
  Object.values(entry.packages ?? {}).flatMap((packageDir) => {
    const dir = join(siblingDir(repoRoot, entry), packageDir);
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) return [];
    const { dependencies = {} } = JSON.parse(readFileSync(manifest, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    return Object.values(dependencies)
      .filter((spec) => spec.startsWith("link:"))
      .map((spec) => resolve(dir, spec.slice("link:".length)))
      .filter((target) => existsSync(target))
      .map((target) => realpathSync(target));
  }),
);
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
  define: {
    __VIBEFIELD_FORCE_ONBOARDING__: "false",
    // TP-S0c: the perf lab's renderer bridge is admitted by ONE compile-time
    // boolean. Everywhere else it is the literal `false`, which is what lets
    // rollup drop the dynamic import and the whole module behind it.
    __VIBEFIELD_TERMINAL_PERF_LAB__: String(mode === "terminal-perf-lab"),
  },
  // P8b-3 §11.6: the host singleton chunks + the inline import map that binds
  // a staged plugin's bare specifiers to them. Build injects the chunk-target
  // map; serve injects the SAME map with `/@id/` virtual-module targets, so a
  // dev fieldd's staged approvals resolve too (corrected 2026-08-24 — the
  // plugin's own doc carries the incident). Only `design`/`live-surfaces-lab`
  // go without it: the browser catalog builds no plugin host.
  plugins: [
    tailwindcss(),
    react(),
    ...(mode === "design" || mode === "live-surfaces-lab" ? [] : [hostSingletons()]),
    // DESIGN.md §8 "The switch": the product document's first frame is its
    // entry's synchronous render, never the bare ground ahead of it.
    renderBlockingEntry(),
  ],
  resolve: {
    alias: [...milleAliases(repoRoot), { find: /^loro-crdt$/, replacement: "loro-crdt/base64" }],
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
  // Dev optimizes the union of product, Studio, and browser-catalog graphs. All
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
        : [
            "index.html",
            "studio-product.html",
            "studio.html",
            "design-system.html",
            "logo-studio.html",
          ],
    include: ["@vibefield/field-app > @react-three/fiber"],
    // AR-0 sibling mode, corrected 2026-09-13: the optimizer registry is keyed
    // by the BARE specifier, so the whole graph gets ONE `zod` entry — and
    // `tryOptimizedResolve` returns that flat hit before it ever compares the
    // importer's package directory. This workspace carries zod 3 (contracts,
    // `^3.24.0`); the puppeteer checkout carries its own zod 4 (`^4.4.3`,
    // resolved inside the sibling's node_modules, which is exactly what a
    // `link:` row means). One entry cannot be both, so puppeteer-core's
    // `import { z } from "zod"` was answered with the prebundled zod 3 and its
    // workspace-event schema died on load — a `z.strictObject().refine()`
    // discriminated-union option is still an object in v4 and a ZodEffects in
    // v3, so v3's `type.shape[discriminator]` read `representation` off
    // undefined and every catalog entry rendered blank. Excluding the bare id
    // retires the flat entry; each importer then resolves the copy its own
    // package.json asked for. Dev-only by construction — rollup already
    // resolves per importer, which is why `build:design` never saw this.
    exclude: ["zod"],
  },
  build: {
    // A catalog bundle is useful for isolated inspection, but it is development
    // material and therefore lands under the ignored dev root. Production's
    // renderer directory can never be replaced by a design build.
    outDir:
      mode === "design"
        ? join(import.meta.dirname, "..", "..", ".vibefield", "studio", "catalog-renderer")
        : // TP-S0c: the perf lab builds the SAME product entry with the same
          // plugins; the only differences from production are the
          // `__VIBEFIELD_TERMINAL_PERF_LAB__` define above and this directory.
          // It lands under the ignored dev root so a lab build can never replace
          // the renderer that gets packaged, and everything that could move a
          // measurement — React's build, minification, chunking — is unchanged.
          mode === "terminal-perf-lab"
          ? join(import.meta.dirname, "..", "..", ".vibefield", "terminal-perf-lab", "renderer")
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
              "logo-studio": join(rendererRoot, "logo-studio.html"),
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
  server: {
    port: mode === "design" ? 5174 : 5173,
    strictPort: true,
    ...(siblingRoots.length > 0
      ? { fs: { allow: [searchForWorkspaceRoot(repoRoot), ...siblingRoots, ...linkedRoots] } }
      : {}),
  },
}));
