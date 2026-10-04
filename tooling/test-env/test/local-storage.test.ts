/**
 * The Node-26 localStorage shim's witness (DK-7 moved the shim here from field-app's setup and the
 * playground's boot). Each scope below is built the way the shim meets it: Node 26's own property — an
 * accessor that answers undefined and warns when READ — happy-dom's real Storage, and a window beside
 * its global.
 */
import { expect, it } from "vitest";
import { holdLocalStorage } from "../src/local-storage";

/** A scope carrying Node 26's experimental property: an accessor answering undefined, counting its reads. */
function nodeScope(): { scope: Record<string, unknown>; reads: () => number } {
  let reads = 0;
  const scope: Record<string, unknown> = {};
  Object.defineProperty(scope, "localStorage", {
    configurable: true,
    get() {
      reads += 1;
      return undefined;
    },
  });
  return { scope, reads: () => reads };
}

it("puts a working Storage where Node 26's undefined-valued property stands — without ever reading it", () => {
  const { scope, reads } = nodeScope();
  expect(holdLocalStorage(scope)).toBe(true);
  // reading Node's property is what prints its ExperimentalWarning: the shim decides from the descriptor
  expect(reads()).toBe(0);
  const storage = scope.localStorage as Storage;
  storage.setItem("theme", "dark");
  expect(storage.getItem("theme")).toBe("dark");
  expect(storage.length).toBe(1);
  expect(storage.key(0)).toBe("theme");
  storage.removeItem("theme");
  expect(storage.getItem("theme")).toBeNull();
  // a suite may still swap it out for a broken one and put it back (godview's cache rows do)
  expect(Object.getOwnPropertyDescriptor(scope, "localStorage")?.configurable).toBe(true);
});

it("leaves a real Storage alone, and is idempotent", () => {
  const real = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
  const scope: Record<string, unknown> = { localStorage: real };
  expect(holdLocalStorage(scope)).toBe(false);
  expect(scope.localStorage).toBe(real);
  const { scope: node } = nodeScope();
  holdLocalStorage(node);
  const first = node.localStorage;
  expect(holdLocalStorage(node)).toBe(false);
  expect(node.localStorage).toBe(first);
});

it("hands the same Storage to a window beside the global that has none, and never shadows one that has", () => {
  const bare: Record<string, unknown> = {};
  const { scope } = nodeScope();
  scope.window = bare;
  holdLocalStorage(scope);
  expect(bare.localStorage).toBe(scope.localStorage);

  const own = { getItem: () => "kept" } as unknown as Storage;
  const { scope: other } = nodeScope();
  const win: Record<string, unknown> = { localStorage: own };
  other.window = win;
  holdLocalStorage(other);
  expect(win.localStorage).toBe(own);
});
