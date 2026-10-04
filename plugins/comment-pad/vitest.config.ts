import { wgsl } from "@vibefield/plugin-build/wgsl";
import { defineConfig } from "vitest/config";

// The pad's units load its `.wgsl` files exactly as plugin-build inlines them — as their text — so
// what a test composes is what the bundle carries. Node, no GPU and no DOM: its states are the SDK's
// kind-conformance harness's (test/kind.test.ts — its WGSL read, never compiled, until ICE publishes a
// host-less desk for a still, ask I30); its pixels are the product's (smoke:canvas's pad row and stills).
export default defineConfig({
  plugins: [wgsl()],
  test: { environment: "node" },
});
