// @vitest-environment happy-dom

// DT-2b-2 — the two faces `ctx.pool.SurfaceView` can wear, rendered.
//
// The door's whole render contract is "the plugin gets the SHIPPING view, or an
// honest reason it cannot" — and that is exactly the pair a reader cannot
// verify from the types. A plugin holding a handle from a window with no live
// surfaces must still be able to lay out its card.

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPluginSurfacePool } from "../src/plugin-host/surface-door";
import type {
  ProductSurfaceFrame,
  SurfaceAcquireOptions,
  SurfaceHandle,
  SurfaceHandleState,
  SurfacePool,
} from "../src/surfaces/pool";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The shipping view wires an IntersectionObserver, a ResizeObserver and rAF.
// happy-dom does not guarantee all three, and their absence would fail this
// test for a reason that has nothing to do with the door.
beforeAll(() => {
  const noopObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  };
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.IntersectionObserver ??= noopObserver;
  scope.ResizeObserver ??= noopObserver;
  scope.requestAnimationFrame ??= (callback: () => void): number =>
    setTimeout(callback, 16) as unknown as number;
  scope.cancelAnimationFrame ??= (handle: number): void => clearTimeout(handle);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function render(node: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

/** A pool whose handles never leave `attaching` — enough for the view to mount. */
function attachingPool(): SurfacePool<ProductSurfaceFrame> {
  const state: SurfaceHandleState<ProductSurfaceFrame> = {
    status: "attaching",
    presentation: null,
    browser: null,
    error: null,
  };
  return {
    disposed: false,
    acquire(key: string, _opts: SurfaceAcquireOptions): SurfaceHandle<ProductSurfaceFrame> {
      return {
        key,
        state,
        status: "attaching",
        presentation: null,
        browser: null,
        error: null,
        onState(listener) {
          listener(state);
          return () => undefined;
        },
        setDemand() {},
        sendInput: () => false,
        navigate: () => false,
        retry() {},
        release() {},
      };
    },
    snapshot() {
      return {
        v: 1,
        disposed: false,
        liveAttachments: 0,
        pendingGraceTimers: 0,
        mints: 0,
        custodyCloses: 0,
        entries: [],
      };
    },
    dispose() {},
  };
}

function poolDoor(surfacePool: SurfacePool<ProductSurfaceFrame> | null) {
  return createPluginSurfacePool({
    pluginId: "vibefield.viewtest",
    client: {
      request: async () => ({}),
      subscribe: async () => ({ snapshot: {}, unsubscribe: () => undefined }),
    },
    own: () => undefined,
    assertOpen: () => undefined,
    resolvePool: () => surfacePool,
  });
}

const DEMAND = { mode: "live", targetFps: 30, priority: 50, interactive: false } as const;

const SOURCE = {
  kind: "browser",
  initialUrl: "https://example.invalid/dashboard",
  profile: { mode: "memory", ref: "fixture" },
  logicalViewport: { width: 800, height: 600 },
} as const;

describe("ctx.pool.SurfaceView", () => {
  it("renders the honest unavailable face on a host with no live surfaces", () => {
    const pool = poolDoor(null);
    const handle = pool.liveSurface({ key: "preview", source: SOURCE, initialDemand: DEMAND });
    const view = render(<pool.SurfaceView handle={handle} />);

    const box = view.querySelector("[data-live-surface-status]");
    expect(box?.getAttribute("data-live-surface-status")).toBe("lost");
    expect(view.textContent).toContain("live surfaces are unavailable on this host");
    // No canvas: there is nothing to paint, and a blank one would be a lie.
    expect(view.querySelector("canvas")).toBeNull();
  });

  it("renders the SHIPPING view for a pool-backed handle", () => {
    const pool = poolDoor(attachingPool());
    const handle = pool.liveSurface({ key: "preview", source: SOURCE, initialDemand: DEMAND });
    const view = render(<pool.SurfaceView handle={handle} />);

    // LiveSurfaceView's own DOM: its status stamp and its one canvas.
    expect(
      view.querySelector("[data-live-surface-status]")?.getAttribute("data-live-surface-status"),
    ).toBe("attaching");
    expect(view.querySelector("canvas")).not.toBeNull();
    expect(view.textContent).toContain("connecting surface");
  });
});
