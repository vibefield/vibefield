import { wgsl } from "@vibefield/plugin-build/wgsl";
import { defineConfig } from "vitest/config";

// The clock's units load its `.wgsl` files exactly as plugin-build inlines them — as their text — so
// what a test composes is what the bundle carries. Node, no GPU: its pixels are the product's (the
// canvas smoke's still); its states are the SDK's kind-conformance harness's (test/broken.test.ts — no
// pixels: its WGSL read, never compiled, until ICE publishes a host-less desk for a still, ask I30).
export default defineConfig({
  plugins: [wgsl()],
  test: { environment: "node" },
});
