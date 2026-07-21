import { defineConfig } from "vitest/config";

// Renderer unit tests (pure TS today; happy-dom is set now so the coming tray
// DOM/tsx tests need no further wiring). Tests live in test/, not colocated with
// renderer/src, so the include is scoped there.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
