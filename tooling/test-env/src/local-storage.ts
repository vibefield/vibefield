// THE NODE-26 LOCALSTORAGE SHIM (2026-07-18 in field-app's setup; DK-7 shared it here beside the
// MutationObserver shim — the plan's Phase 3 input (6): this package owns every environment shim).
// Node 26 defines an EXPERIMENTAL `localStorage` own property on globalThis that evaluates to
// `undefined` unless the process runs with `--localstorage-file`. Because the key already exists,
// vitest's happy-dom environment never injects happy-dom's real Storage over it (field-app's
// App.tsx reads `localStorage.getItem` at mount and exploded), and the plugin playground's window
// copy skips it too. This puts a real in-memory Storage where that stub stands; browsers are
// unaffected.
//
// It decides from the property's DESCRIPTOR, never by reading it: reading Node's property is what
// prints its ExperimentalWarning, and a tool that warns on every run teaches its users to ignore
// stderr. A data property already holding a Storage (happy-dom's, or this shim's) is left alone.
//
// Loaded by field-app's test setup and by the plugin playground's boot, on the window it installs.

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length(): number {
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

function isStorage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { getItem?: unknown }).getItem === "function"
  );
}

/**
 * Give `scope` a working `localStorage` where Node's experimental stub (or nothing) stands, and the
 * same Storage to its `window` when that is another object without one. Idempotent; returns false
 * where a real Storage already stands, and changes nothing there.
 */
export function holdLocalStorage(scope: object = globalThis): boolean {
  const own = Object.getOwnPropertyDescriptor(scope, "localStorage");
  if (own !== undefined && "value" in own && isStorage(own.value)) return false;
  const storage = memoryStorage();
  Object.defineProperty(scope, "localStorage", { value: storage, configurable: true });
  const win = (scope as { readonly window?: unknown }).window;
  if (
    typeof win === "object" &&
    win !== null &&
    win !== scope &&
    (win as { readonly localStorage?: unknown }).localStorage === undefined
  ) {
    Object.defineProperty(win, "localStorage", { value: storage, configurable: true });
  }
  return true;
}
