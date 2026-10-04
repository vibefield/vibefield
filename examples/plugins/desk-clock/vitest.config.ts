import { wgsl } from "@vibefield/plugin-build/wgsl";
import { defineConfig } from "vitest/config";

// The clock's units load its `.wgsl` files exactly as plugin-build inlines them — as their text — so
// what a test composes is what the bundle carries. Node, no GPU: its pixels are the product's (the
// canvas smoke's still) and, at DK-7, the playground's Dawn harness.
export default defineConfig({
  plugins: [wgsl()],
  test: { environment: "node" },
});
