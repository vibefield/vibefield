/**
 * DK-3 — the test environment's MutationObserver survives a garbage collection. happy-dom 20 holds
 * each observed target's report callback only in a WeakRef, so a collection between `observe()`
 * and the mutation deafened the observer for good — no record, no error — and godview-monitor's
 * no-GPU row read the marker's `starting` under the monorepo's whole `pnpm test`, when the heap
 * churned enough for one to land there. test/setup.ts pins the callback; this row forces the
 * collection that used to land by chance.
 */
import v8 from "node:v8";
import vm from "node:vm";
import { expect, it } from "vitest";

v8.setFlagsFromString("--expose-gc");
const collect = vm.runInNewContext("gc") as () => void;

it("delivers a mutation made after a garbage collection", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    seen.push(target.getAttribute("data-state") ?? "");
  });
  observer.observe(target, { attributes: true, attributeFilter: ["data-state"] });
  // The job that built the listener ends, so a WeakRef no longer keeps its target for it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  collect();
  target.setAttribute("data-state", "unavailable");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen).toEqual(["unavailable"]);
  observer.disconnect();
  target.remove();
});
