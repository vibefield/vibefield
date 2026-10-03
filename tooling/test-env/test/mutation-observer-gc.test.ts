/**
 * The happy-dom shim's witness, run ONCE for every suite that loads it (DK-3 wrote it
 * in field-app; DK-5 moved it here with the shim). happy-dom 20 holds each observed
 * target's report callback only in a WeakRef, so a collection between `observe()` and
 * the mutation deafened the observer for good — no record, no error. The setup file
 * (`src/happy-dom-setup.ts`, the one every happy-dom suite loads) pins the callback;
 * this row forces the collection that used to land by chance.
 */
import v8 from "node:v8";
import vm from "node:vm";
import { expect, it } from "vitest";
import { holdMutationObserverCallbacks } from "../src/happy-dom";

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

it("leaves a scope with no MutationObserver alone — a node environment", () => {
  const scope: { MutationObserver?: unknown } = {};
  expect(holdMutationObserverCallbacks(scope)).toBe(false);
  expect(scope).toEqual({});
});
