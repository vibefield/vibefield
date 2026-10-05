import { wgsl } from "@vibefield/plugin-build/wgsl";
import { defineConfig } from "vitest/config";

// THE STILLS ON DAWN (DK-11): test/*.dawn.test.ts alone — `plugin-playground --still` drawing the repo's plugins' kinds on
// Node's WebGPU (the `webgpu` package, this CLI's devDependency) and holding each to its plugin's golden. Kept out of
// `test` (vitest.config.ts excludes it): CI's hosts carry no GPU the goldens were blessed on, and a golden is Dawn's bytes
// on the host that blessed it. `pnpm still` runs it.
export default defineConfig({
  // a kind's `.wgsl` loaded as its text, exactly as plugin-build inlines it (the desk clock's parity row imports its src)
  plugins: [wgsl()],
  test: {
    environment: "node",
    include: ["test/**/*.dawn.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
