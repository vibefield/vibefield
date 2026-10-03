import { defineConfig } from "vitest/config";

// The browser plugin's suite is a renderer-side suite (the Artifacts panel is
// React), so it runs under a DOM and the JSX transform. This standalone config
// loads no vite React plugin, so esbuild handles .tsx the same way field-app's
// own test config does — one idiom for renderer-side suites across the
// workspace — and it loads the repo's shared happy-dom shim (tooling/test-env).
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["@vibefield/test-env/happy-dom/setup"],
  },
});
