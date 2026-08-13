import { defineConfig } from "vitest/config";

// `include` is narrowed to this package's own `test/` for one specific reason:
// `template/test/manifest.test.ts` is a FILE THE SCAFFOLD SHIPS, not a test of
// the scaffolder. Vitest's default glob would collect it, fail to resolve the
// SDK it imports as a plugin (create-plugin does not depend on the SDK, and
// must not), and report a red that says nothing about this package.
//
// It is still proven, just not from here: the real scaffold runs it. `pnpm test`
// in a scaffolded plugin is the template test's home, and the acceptance run
// executes exactly that.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
