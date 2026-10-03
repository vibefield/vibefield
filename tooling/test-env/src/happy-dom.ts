// THE SHARED HAPPY-DOM SHIM (DK-3 found it, DK-5 shared it). happy-dom 20's
// `MutationObserverListener` holds each observed target's report callback ONLY in a
// WeakRef (`callback: new WeakRef((record) => this.report(record))` — nothing else
// references that arrow), so a garbage collection between `observe()` and a mutation
// deafens the observer for good: no record, no error. Under the monorepo's whole
// `pnpm test` the heap churns enough for one to land there — godview-monitor's no-GPU
// row read its marker's `starting` forever, four whole runs in six, never alone. A
// browser keeps a connected observer's registrations alive; so does this: `observe()`
// builds its listener while `WeakRef` holds strongly, and nothing else changes.
//
// Every happy-dom environment in the repo loads it — field-app's and the browser
// plugin's suites through `@vibefield/test-env/happy-dom/setup`, the plugin
// playground on the window it installs — and `test/mutation-observer-gc.test.ts`
// here forces the collection that used to land by chance, once for all of them.
// Retire it when happy-dom holds the callback strongly.

const HELD = Symbol.for("vibefield.test-env.held-mutation-observer");

/** What `WeakRef` is, for the length of one `observe()`: a reference that holds. */
class StrongRef<T extends object> {
  readonly #target: T;
  constructor(target: T) {
    this.#target = target;
  }
  deref(): T {
    return this.#target;
  }
}

/**
 * Make `scope`'s MutationObserver keep its report callbacks through a garbage
 * collection: its prototype's `observe` builds the listener while `WeakRef` holds
 * strongly. Idempotent. Returns false where the scope has no MutationObserver (a
 * `node` environment), and changes nothing there.
 */
export function holdMutationObserverCallbacks(
  scope: { readonly MutationObserver?: unknown } = globalThis,
): boolean {
  const Observer = scope.MutationObserver;
  if (typeof Observer !== "function") return false;
  const proto = Observer.prototype as MutationObserver & { [HELD]?: true };
  if (proto[HELD] === true) return true;
  const observe = proto.observe;
  proto.observe = function observeHeld(
    this: MutationObserver,
    target: Node,
    options?: MutationObserverInit,
  ): void {
    const weakRef = globalThis.WeakRef;
    globalThis.WeakRef = StrongRef as unknown as WeakRefConstructor;
    try {
      observe.call(this, target, options);
    } finally {
      globalThis.WeakRef = weakRef;
    }
  };
  Object.defineProperty(proto, HELD, { value: true });
  return true;
}
