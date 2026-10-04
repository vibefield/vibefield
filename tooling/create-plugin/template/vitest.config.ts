import { wgsl } from "@vibefield/plugin-build/wgsl";
import { defineConfig } from "vitest/config";

// The kind's units load its `.wgsl` files exactly as plugin-build inlines them — as their text — so
// what a test composes is what the bundle carries. Node, no GPU.
export default defineConfig({
  plugins: [wgsl()],
  test: { environment: "node" },
});
