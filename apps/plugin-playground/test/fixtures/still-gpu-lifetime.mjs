// Run in a child so a native lifetime regression reports its signal without killing the test runner.

import { strict as assert } from "node:assert";
import { registerHooks } from "node:module";
import { setTimeout as delay, setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !specifier.endsWith(".ts") &&
        context.parentURL !== undefined &&
        !context.parentURL.includes("/node_modules/")
      )
        return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const root = fileURLToPath(new URL("../..", import.meta.url));
const { installDom, createHarness } = await import(`${root}/src/boot.ts`);
console.log(JSON.stringify({ phase: "start", pid: process.pid }));
await installDom();
const harness = await createHarness();
try {
  const { stillGpu } = await harness.load(`${root}/src/still.ts`);
  for (let run = 0; run < 12; run++) {
    const gpu = await stillGpu();
    console.log(JSON.stringify({ phase: "created", run }));
    for (let i = 0; i < 4; i++) {
      await delay(10);
      globalThis.gc();
      const buffer = gpu.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      await buffer.mapAsync(GPUMapMode.READ);
      buffer.unmap();
      buffer.destroy();
    }
    const destroyed = gpu.destroy();
    assert.equal(gpu.destroy(), destroyed, "destruction must be idempotent");
    console.log(JSON.stringify({ phase: "destroyed", run }));
    await gpu.device.lost;
    globalThis.gc();
    await destroyed;
    await nextTurn();
    globalThis.gc();
    console.log(JSON.stringify({ phase: "collected", run }));
  }
} finally {
  await harness.close();
}
console.log(JSON.stringify({ phase: "complete" }));
// Exit naturally: retaining the Dawn instance forever would keep this subprocess alive.
