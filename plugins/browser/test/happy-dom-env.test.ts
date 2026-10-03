/**
 * DK-5 — this suite's DOM is the repo's SHARED happy-dom environment (vitest.config.ts
 * loads `@vibefield/test-env/happy-dom/setup`), so a MutationObserver here survives a
 * garbage collection. The forced-GC witness runs once, in tooling/test-env; this row
 * holds the WIRING.
 */
import { expect, it } from "vitest";

it("observes through the shared shim's held MutationObserver", () => {
  const observer = new MutationObserver(() => undefined);
  const held = Symbol.for("vibefield.test-env.held-mutation-observer");
  expect((Object.getPrototypeOf(observer) as Record<symbol, unknown>)[held]).toBe(true);
});
