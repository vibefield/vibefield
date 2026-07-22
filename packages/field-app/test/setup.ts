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
