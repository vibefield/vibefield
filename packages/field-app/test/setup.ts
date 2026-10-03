import { loadDevBundledPlugins } from "../src/field-engine";

/**
 * Test-env shim (2026-07-18): Node 26 defines an EXPERIMENTAL `localStorage`
 * own property on globalThis that evaluates to `undefined` unless the process
 * runs with `--localstorage-file`. Because the key already exists, vitest's
 * happy-dom environment never injects happy-dom's real Storage over it — and
 * App.tsx's dark-mode init (`localStorage.getItem`) explodes at mount.
 * Replace the stub with a real in-memory Storage; browsers are unaffected.
 * Same shim rides in packages/devtools/test/setup.ts — keep the two in step.
 */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

if (typeof globalThis.localStorage === "undefined") {
  const storage = makeStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  const win = (globalThis as { window?: object }).window;
  if (win !== undefined && (win as { localStorage?: Storage }).localStorage === undefined) {
    Object.defineProperty(win, "localStorage", { value: storage, configurable: true });
  }
}

/**
 * Test-env shim (DK-3, 2026-10-03): happy-dom 20's MutationObserverListener holds
 * each observed target's report callback ONLY in a WeakRef (`callback: new
 * WeakRef((record) => this.report(record))` — nothing else references the arrow),
 * so a garbage collection between `observe()` and a mutation deafens the observer
 * for good: no record, no error. Under the monorepo's whole `pnpm test` the heap
 * churns enough for one to land there — godview-monitor's no-GPU row read the
 * marker's `starting` forever, four whole runs in six, never alone. A browser
 * keeps a connected observer's registrations alive; so does this: `observe()`
 * builds its listener while `WeakRef` holds strongly, and nothing else changes.
 * test/mutation-observer-gc.test.ts forces the collection. (The `node`
 * environment's files have no MutationObserver, and keep none.)
 */
class StrongRef<T extends object> {
  readonly #target: T;
  constructor(target: T) {
    this.#target = target;
  }
  deref(): T {
    return this.#target;
  }
}

if (typeof globalThis.MutationObserver === "function") {
  class HeldMutationObserver extends globalThis.MutationObserver {
    override observe(target: Node, options?: MutationObserverInit): void {
      const weakRef = globalThis.WeakRef;
      globalThis.WeakRef = StrongRef as unknown as WeakRefConstructor;
      try {
        super.observe(target, options);
      } finally {
        globalThis.WeakRef = weakRef;
      }
    }
  }
  globalThis.MutationObserver = HeldMutationObserver;
  const windowObject = (globalThis as { window?: { MutationObserver: unknown } }).window;
  if (windowObject !== undefined) windowObject.MutationObserver = HeldMutationObserver;
}

/**
 * P8b-3: load the dev-bundled plugin set once, for the whole file.
 *
 * The four built-in plugins stopped being static imports of `field-engine` —
 * production stages them from their own artifacts, and the bundled list is now a
 * DEV fallback behind a dynamic import (P8-D2). The headless suites have no
 * daemon to approve modules and no boot phase to await one, so this awaits the
 * fallback here, where a setup file may use top-level await; `buildRegistry()`
 * with no argument then finds it already loaded and stays synchronous, which is
 * what lets those suites go on calling it from ordinary sync helpers.
 */
await loadDevBundledPlugins();
