import { defineConfig } from "vitest/config";

// Renderer unit tests under happy-dom, with the localStorage setup shim (theme.ts
// reads localStorage at init). Tests live in test/, not colocated with
// renderer/src, so the include is scoped there. This standalone config doesn't
// load vite.config's React plugin, so esbuild.jsx transforms the .tsx panels the
// panel test imports.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
