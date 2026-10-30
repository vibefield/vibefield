import { wgsl } from "@vibefield/plugin-build/wgsl";
import { defineConfig } from "vitest/config";

// The phone's units load its `.wgsl` files exactly as plugin-build inlines them — as their text — so what a test composes is
// what the bundle carries. Node, no GPU and no DOM: its law is pure, its fixture feed is arithmetic, its states are the SDK's
// kind-conformance harness's (its WGSL read, never compiled); its pixels are Dawn's (`pnpm still` — the playground's `--still`
// over this plugin, held to test/still.golden.json once the first gated run blesses it).
export default defineConfig({
  plugins: [wgsl()],
  test: { environment: "node" },
});
