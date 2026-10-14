import { resolve } from "node:path";
import { wgsl } from "@vibefield/plugin-build/wgsl";
import { defineConfig } from "vitest/config";
import { milleAliases } from "../../scripts/mille-aliases.mjs";

// Renderer unit tests under happy-dom, with the localStorage setup shim (theme.ts
// reads localStorage at init). Tests live in test/, not colocated with src, so
// the include is scoped there. This standalone config doesn't load the renderer
// vite config's React plugin, so esbuild.jsx transforms the .tsx panels the
// panel test imports.
export default defineConfig({
  // DK-6: the example plugin's clock (the host's parity witness, desk-clock-plugin.test.ts) ships its
  // WGSL as `.wgsl` files; the suite loads them as plugin-build inlines them — as their text
  plugins: [wgsl()],
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  // The sibling `link:` rows (puppeteer's views) resolve their own react by
  // Node's rules; dedupe is what makes the tests load ONE React, exactly as
  // the renderer's Vite config does for the bundle (AR-5a).
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      ...milleAliases(resolve(import.meta.dirname, "../..")),
      // The scroll lock under the room's Radix dialog (react-remove-scroll and
      // the four helpers it imports) publishes no `exports`, so vitest's
      // Node-style resolution takes each one's ES5 CommonJS `main` — which Node
      // then loads natively, with a React instance of its own (see `inline` below).
      // Pointed at their `module` builds, they are ESM that Vite inlines and
      // dedupes, as the bundle resolves them.
      {
        find: /^(react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar)$/,
        replacement: "$1/dist/es2015/index.js",
      },
    ],
  },
  test: {
    environment: "happy-dom",
    // Tests that inspect smoke markers opt in exactly as the Electron rig does.
    environmentOptions: { happyDOM: { url: "http://localhost:3000/?godviewMarkers=1" } },
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
    server: {
      deps: {
        // ghosttea-react's workspace entry reaches its bundled keybinding and
        // theme catalogs as plain JSON imports. Externalized, Node's own ESM
        // loader demands an `import ... with { type: "json" }` attribute the
        // published dist does not carry; INLINED, Vite transforms them exactly
        // as it does for the renderer bundle — so the test loads the module the
        // same way production does instead of through a stricter loader.
        //
        // rosetta's room is a registry package since RD-5a (2026-10-14), and its
        // dist imports its own stylesheets (`import "../../styles/….css"`), which
        // Node's loader refuses. Inlined, Vite transforms it as it does for the
        // renderer bundle, and `resolve.dedupe` reaches the Radix dialog it
        // carries — one React, the class the sibling link's own install hit as
        // "Invalid hook call" in History's search (2026-10-04).
        inline: [
          "@vibecook/mille",
          "@vibecook/mille-ui",
          "@vibecook/ghosttea-react",
          "@vibefield/rosetta-room",
        ],
      },
    },
  },
});
