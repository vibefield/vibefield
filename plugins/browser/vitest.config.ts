import { defineConfig } from "vitest/config";

// The browser plugin's suite mounts real React (DT-3d's card face), so it needs
// a DOM and the JSX transform. This standalone config loads no vite React
// plugin, so esbuild handles the .tsx the same way field-app's own test config
// does — one idiom for renderer-side suites across the workspace.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
