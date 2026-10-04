/**
 * DK-5 — this suite's DOM is the repo's SHARED happy-dom environment: test/setup.ts loads
 * `@vibefield/test-env/happy-dom/setup`, so a MutationObserver here survives a garbage
 * collection (DK-3's finding — godview-monitor's no-GPU row went deaf without it). The
 * forced-GC witness runs once, in tooling/test-env; this row holds the WIRING. DK-7: the
 * Node-26 localStorage shim moved there too, and its wiring row is the second.
 */
import { expect, it } from "vitest";

it("observes through the shared shim's held MutationObserver", () => {
  const observer = new MutationObserver(() => undefined);
  const held = Symbol.for("vibefield.test-env.held-mutation-observer");
  expect((Object.getPrototypeOf(observer) as Record<symbol, unknown>)[held]).toBe(true);
});

it("keeps a working localStorage where Node 26's undefined-valued one stood (the shared shim)", () => {
  localStorage.setItem("dk-7.wiring", "held");
  expect(localStorage.getItem("dk-7.wiring")).toBe("held");
  localStorage.removeItem("dk-7.wiring");
  expect(localStorage.getItem("dk-7.wiring")).toBeNull();
});
