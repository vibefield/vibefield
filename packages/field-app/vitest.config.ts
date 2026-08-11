import { defineConfig } from "vitest/config";

// Renderer unit tests under happy-dom, with the localStorage setup shim (theme.ts
// reads localStorage at init). Tests live in test/, not colocated with src, so
// the include is scoped there. This standalone config doesn't load the renderer
// vite config's React plugin, so esbuild.jsx transforms the .tsx panels the
// panel test imports.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "happy-dom",
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
        inline: ["@vibecook/ghosttea-react"],
      },
    },
  },
});
