// @vitest-environment happy-dom
/**
 * TP-R4a — THE WATCH-ONLY MIRROR (TP-S2).
 *
 * "the mirror cannot take input focus and issues zero geometry claims by
 * construction."
 *
 * Two words in that row do the work. ZERO is a count, so this file counts every
 * call that reaches the runtime and asserts which verbs are not among them. BY
 * CONSTRUCTION means the count must stay zero under a hostile test, not merely
 * under an ordinary render — so the mirror here is focused programmatically,
 * clicked, pointer-pressed and tabbed at, and the assertion is made after all
 * of it.
 *
 * The runtime under the mirror is a double that records EVERY call, and the
 * `TerminalSurface` above it is the real upstream component — which matters,
 * because the hazards this row exists for are upstream's: the focus-sync effect
 * that claims geometry (`TerminalSurface.js:303`), the ungated ResizeObserver
 * that resizes the PTY (`:238-249`), and `readWrite` not being a prop at all
 * (`:40`). A test against a stub of the surface would prove nothing about any
 * of them.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every call the pool's runtime received, in order. The gate reads what is NOT
 * in here. */
let runtimeCalls: { verb: string; args: readonly unknown[] }[] = [];
let sessions: unknown[] = [];

const SESSION = {
  id: "session-a",
  handle: "handle-a",
  executable: "/bin/zsh",
  cols: 80,
  rows: 24,
  exited: false,
  readWrite: true,
  title: null,
  cwd: null,
  bellCount: 0,
  pid: 42,
  createdAtMs: 0,
  exitCode: null,
  exitSignal: null,
  requestedTermination: null,
  exitOutcome: null,
};

// The REAL `TerminalSurface`, `GhostteaProvider` and runtime facade; a FAKE
// runtime underneath. Only the factory is replaced — everything the mirror is
// judged on stays upstream's own code.
vi.mock("@vibecook/ghosttea-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const record =
    (verb: string) =>
    (...args: unknown[]): undefined => {
      runtimeCalls.push({ verb, args });
      return undefined;
    };
  return {
    ...actual,
    waitForGhostteaRendererPorts: () => new Promise(() => undefined),
    createGhostteaTerminalRuntime: () => ({
      connect: () => Promise.resolve(),
      dispose: record("dispose"),
      rendererBackend: "test",
      listSessions: () => {
        runtimeCalls.push({ verb: "listSessions", args: [] });
        return Promise.resolve(sessions);
      },
      sessionMetadata: () => SESSION,
      mount: (...args: unknown[]) => {
        runtimeCalls.push({ verb: "mount", args });
        return { resize: record("mount.resize"), dispose: record("mount.dispose") };
      },
      // Everything below is what a mirror must never reach. Present so that a
      // call would be RECORDED rather than throwing — a test that passes because
      // an undefined method exploded would prove nothing.
      resize: record("resize"),
      claimResizeControl: record("claimResizeControl"),
      setFocused: record("setFocused"),
      setTheme: record("setTheme"),
      setSelection: record("setSelection"),
      sendKey: record("sendKey"),
      sendText: record("sendText"),
      paste: record("paste"),
      sendMouse: record("sendMouse"),
      scroll: record("scroll"),
      scrollTo: record("scrollTo"),
      interrupt: record("interrupt"),
      terminate: record("terminate"),
      unregisterSession: record("unregisterSession"),
      copySelection: async () => "",
      // Allowed.
      setVisible: record("setVisible"),
      setEffects: record("setEffects"),
      setSessionPinned: record("setSessionPinned"),
      scrollbar: () => undefined,
      isMouseTracking: () => false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      startPerformanceMeasurement: () => Promise.resolve(),
      finishPerformanceMeasurement: () => Promise.resolve({ backend: "test" }),
    }),
  };
});

vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

const pool = await import("../src/terminal/pool");
const { TerminalMirrorSurface } = await import("../src/terminal/mirror");
const { MIRROR_REFUSED_VERBS, watchOnlyRuntime } = await import(
  "../src/terminal/mirror/watch-only-runtime"
);

type PoolClient = Parameters<typeof pool.openTerminalPool>[0];
const fieldd = {
  request: () => Promise.resolve({ ticket: { token: "t", controlSocket: "c", frameSocket: "f" } }),
} as unknown as PoolClient;

let root: Root | null = null;
let container: HTMLElement | null = null;

/** No layout engine here, so the surface's observer is inert unless a test
 * drives it. Installed as a no-op so mounting the real component is safe. */
class InertResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

beforeEach(() => {
  runtimeCalls = [];
  sessions = [SESSION];
  pool.disposeTerminalPool();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = InertResizeObserver;
  setHost({
    terminal: {
      connect: () => Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" }),
      onStatus: () => () => undefined,
    },
  } as unknown as FieldHost);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  pool.disposeTerminalPool();
});

/** Open the pool and mount a mirror on `session-a`. */
async function mountMirror(
  props: Partial<Parameters<typeof TerminalMirrorSurface>[0]> = {},
): Promise<void> {
  pool.openTerminalPool(fieldd);
  await act(async () => {
    await settle();
  });
  await act(async () => {
    root?.render(createElement(TerminalMirrorSurface, { sessionId: "session-a", ...props }));
    await settle();
  });
}

const mirror = (): HTMLElement => {
  const element = container?.querySelector<HTMLElement>(".vf-terminal-mirror");
  if (element === null || element === undefined) throw new Error("no mirror mounted");
  return element;
};

const claimVerbs = ["setFocused", "resize", "claimResizeControl"] as const;
const claims = (): typeof runtimeCalls =>
  runtimeCalls.filter((call) => (claimVerbs as readonly string[]).includes(call.verb));

describe("TP-R4a — the mirror cannot take input focus", () => {
  it("mounts the session's surface and reaches the runtime only to WATCH", async () => {
    await mountMirror();
    expect(mirror().getAttribute("data-mirror-state")).toBe("watching");
    // It really did attach: a mirror that never mounted would pass every
    // "zero claims" assertion below by doing nothing at all.
    expect(runtimeCalls.some((call) => call.verb === "mount")).toBe(true);
    expect(claims()).toEqual([]);
  });

  it("is inert — the browser's own answer to 'cannot be focused'", async () => {
    await mountMirror();
    const surface = container?.querySelector(".vf-terminal-mirror-surface");
    expect(surface?.hasAttribute("inert")).toBe(true);
  });

  it("renders its surface as read-only, having no `readWrite` prop to pass", async () => {
    await mountMirror();
    // `TerminalSurface` reads interactivity off the SESSION (`:40`), so the
    // read-only projection is the only way to say it — and this is the
    // assertion that catches the projection being dropped.
    const input = container?.querySelector<HTMLTextAreaElement>(".terminal-input");
    expect(input).not.toBeNull();
    expect(input?.readOnly).toBe(true);
  });

  it("issues zero claims when its input is focused PROGRAMMATICALLY", async () => {
    await mountMirror();
    const input = container?.querySelector<HTMLTextAreaElement>(".terminal-input");
    await act(async () => {
      input?.focus();
      // Fire the event too: `inert` is not implemented by every DOM
      // implementation, and a test that only proved "happy-dom refused to
      // focus" would prove nothing about the layer that matters. So the focus
      // is DELIVERED to the surface by hand and the claim count still holds.
      input?.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
      await settle();
    });
    expect(claims()).toEqual([]);
  });

  it("issues zero claims under pointer press and click", async () => {
    await mountMirror();
    const input = container?.querySelector<HTMLTextAreaElement>(".terminal-input");
    await act(async () => {
      input?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      input?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      input?.dispatchEvent(new Event("click", { bubbles: true }));
      await settle();
    });
    expect(claims()).toEqual([]);
  });

  it("issues zero claims when keys are delivered to it", async () => {
    await mountMirror();
    const input = container?.querySelector<HTMLTextAreaElement>(".terminal-input");
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
    });
    expect(claims()).toEqual([]);
    // And no input reached the session either — a watcher types nothing.
    expect(runtimeCalls.filter((call) => call.verb === "sendKey")).toEqual([]);
    expect(runtimeCalls.filter((call) => call.verb === "sendText")).toEqual([]);
  });

  it("issues zero claims when its box changes", async () => {
    // The hazard `controlsResize: false` does not close (see
    // `terminal-zoom.test.tsx`'s FINDING row): a surface resizes the PTY to its
    // own box through an ungated observer. The facade is what closes it, so
    // this drives a real box change through the real observer path.
    let deliver: ((entries: unknown[]) => void) | null = null;
    let observed: Element | null = null;
    class DrivenResizeObserver {
      constructor(callback: (entries: unknown[]) => void) {
        deliver = callback;
      }
      observe(target: Element): void {
        observed = target;
      }
      disconnect(): void {}
      unobserve(): void {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = DrivenResizeObserver;
    await mountMirror();
    expect(observed).not.toBeNull();
    await act(async () => {
      deliver?.([{ target: observed, contentRect: { width: 1200, height: 800 } }]);
      await settle();
    });
    expect(claims()).toEqual([]);
  });

  it("never repaints the session for everyone else (`setTheme` is session-wide)", async () => {
    await mountMirror();
    // FINDING: `runtime.setTheme` takes a surfaceId for the worker and then
    // notifies the daemon `set-colors` with only a sessionId
    // (`runtime.js:1247-1263`). A mirror with its own theme would repaint the
    // session for every viewer, the authority included.
    expect(runtimeCalls.filter((call) => call.verb === "setTheme")).toEqual([]);
  });
});

describe("the facade itself (`watchOnlyRuntime`)", () => {
  it("refuses every claim-bearing verb and names what it refused", () => {
    const calls: string[] = [];
    const record = (verb: string) => () => {
      calls.push(verb);
    };
    const underlying = Object.fromEntries(
      MIRROR_REFUSED_VERBS.map((verb) => [verb, record(verb)]),
    ) as unknown as Parameters<typeof watchOnlyRuntime>[0];
    const guarded = watchOnlyRuntime(underlying);
    for (const verb of MIRROR_REFUSED_VERBS) {
      (guarded.runtime as unknown as Record<string, () => void>)[verb]?.();
    }
    expect(calls).toEqual([]);
    expect(guarded.refusals().count).toBe(MIRROR_REFUSED_VERBS.length);
    expect(guarded.refusals().verbs).toEqual([...MIRROR_REFUSED_VERBS]);
  });

  it("refuses a verb it has never heard of — an allow-list, not a deny-list", () => {
    const guarded = watchOnlyRuntime({
      somethingNewUpstreamAdded: () => "reached",
    } as unknown as Parameters<typeof watchOnlyRuntime>[0]);
    const result = (
      guarded.runtime as unknown as Record<string, () => unknown>
    ).somethingNewUpstreamAdded?.();
    expect(result).toBeUndefined();
    expect(guarded.refusals().verbs).toEqual(["somethingNewUpstreamAdded"]);
  });

  it("forwards the watching verbs with the RUNTIME as `this`", () => {
    // The runtime keeps its state in `#private` fields; a method invoked with
    // the facade as its receiver throws on the first field access. This is the
    // regression guard for that — it is not hypothetical, it is what a naive
    // proxy does.
    class Runtime {
      #handles: string[] = [];
      setVisible(handle: string): void {
        this.#handles.push(handle);
      }
      seen(): string[] {
        return this.#handles;
      }
    }
    const runtime = new Runtime();
    const guarded = watchOnlyRuntime(runtime as unknown as Parameters<typeof watchOnlyRuntime>[0]);
    expect(() =>
      (guarded.runtime as unknown as { setVisible: (h: string) => void }).setVisible("handle-a"),
    ).not.toThrow();
    expect(runtime.seen()).toEqual(["handle-a"]);
    expect(guarded.refusals().count).toBe(0);
  });

  it("refuses an ASYNC verb in the shape its caller chains on", async () => {
    // A refusal must be a no-op, not a fault. `TerminalSurface` does
    // `.copySelection(…).catch(…)` (`:519`), so a refusal returning `undefined`
    // would throw a TypeError inside someone else's event handler — which is
    // exactly what this suite's pointer test surfaced before the fix.
    const guarded = watchOnlyRuntime({
      copySelection: () => Promise.resolve("secret"),
    } as unknown as Parameters<typeof watchOnlyRuntime>[0]);
    const result = (
      guarded.runtime as unknown as { copySelection: () => Promise<string> }
    ).copySelection();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe("");
    expect(guarded.refusals().verbs).toEqual(["copySelection"]);
  });

  it("returns a STABLE function per verb, so listener cleanup still matches", () => {
    const guarded = watchOnlyRuntime({
      addEventListener: () => undefined,
    } as unknown as Parameters<typeof watchOnlyRuntime>[0]);
    const first = (guarded.runtime as unknown as Record<string, unknown>).addEventListener;
    const second = (guarded.runtime as unknown as Record<string, unknown>).addEventListener;
    expect(first).toBe(second);
  });
});

describe("cull-driven demand (TP-L-E′), released atomically", () => {
  it("declares `live` while visible and `none` while culled", async () => {
    await mountMirror({ culled: false });
    expect(pool.terminalSessionDemand("session-a")).toBe("live");
    expect(mirror().getAttribute("data-mirror-state")).toBe("watching");
    // The RENDER half is real today: `setVisible` reaches the worker.
    expect(runtimeCalls.some((call) => call.verb === "setVisible")).toBe(true);

    await act(async () => {
      root?.render(createElement(TerminalMirrorSurface, { sessionId: "session-a", culled: true }));
      await settle();
    });
    expect(pool.terminalSessionDemand("session-a")).toBe("none");
    expect(mirror().getAttribute("data-mirror-state")).toBe("culled");
    // The view is still BOUND — declared `none` is not the same as released,
    // and the ledger counts them separately on purpose.
    expect(pool.terminalPoolViewCount()).toBe(1);
  });

  it("releases the view on unmount — the fold drops to none", async () => {
    await mountMirror({ culled: false });
    expect(pool.terminalPoolLiveSessions()).toEqual(["session-a"]);
    expect(pool.terminalPoolViewCount()).toBe(1);

    await act(async () => {
      root?.render(null);
      await settle();
    });

    // TP-L-E′: "unmount does not silence the source directly; it atomically
    // RELEASES that view's declared demand." Both halves: nothing is left
    // bound, and the session's fold is gone rather than merely `none`.
    expect(pool.terminalPoolViewCount()).toBe(0);
    expect(pool.terminalPoolLiveSessions()).toEqual([]);
    expect(pool.terminalSessionDemand("session-a")).toBe("none");
    expect(pool.terminalPoolDemand()).toEqual([]);
  });

  it("a mirror is the LAST live view or it is not — the fold is over views", async () => {
    // The deck's pane and a mirror both watching one session: culling the
    // mirror must NOT drop the session, because the pane still wants it. This
    // is the fold doing its job, and the reason demand is a ledger rather than
    // a boolean per widget.
    const deckView = pool.bindTerminalSessionView("session-a", { mode: "live" });
    await mountMirror({ culled: true });
    expect(pool.terminalSessionDemand("session-a")).toBe("live");
    await act(async () => {
      root?.render(null);
      await settle();
    });
    expect(pool.terminalSessionDemand("session-a")).toBe("live");
    deckView.release();
    expect(pool.terminalSessionDemand("session-a")).toBe("none");
  });

  it("declares nothing for a session the floor does not have", async () => {
    sessions = [];
    await mountMirror();
    expect(mirror().getAttribute("data-mirror-state")).toBe("unavailable");
    // An honest face, and no demand for a session that is not there.
    expect(pool.terminalPoolViewCount()).toBe(0);
    expect(container?.textContent).toContain("session unavailable");
  });
});

describe("camera zoom — re-raster at gesture end (§10)", () => {
  it("does not re-raster while a gesture is in flight, and once when it settles", async () => {
    await mountMirror({ cameraScale: 1, cameraSettled: true });
    expect(mirror().getAttribute("data-rerasters")).toBe("0");

    // Mid-gesture: three scale changes, none settled.
    for (const scale of [1.4, 1.9, 2.4]) {
      await act(async () => {
        root?.render(
          createElement(TerminalMirrorSurface, {
            sessionId: "session-a",
            cameraScale: scale,
            cameraSettled: false,
          }),
        );
        await settle();
      });
    }
    expect(mirror().getAttribute("data-camera")).toBe("moving");
    expect(mirror().getAttribute("data-rerasters")).toBe("0");
    // The scale rides a custom property — a transform, not a box.
    expect(mirror().style.getPropertyValue("--vf-mirror-scale")).toBe("2.4");

    // Gesture end: exactly one.
    await act(async () => {
      root?.render(
        createElement(TerminalMirrorSurface, {
          sessionId: "session-a",
          cameraScale: 2.4,
          cameraSettled: true,
        }),
      );
      await settle();
    });
    expect(mirror().getAttribute("data-camera")).toBe("settled");
    expect(mirror().getAttribute("data-rerasters")).toBe("1");
    // Settled means the transform is spent: the box carries the scale now.
    expect(mirror().style.getPropertyValue("--vf-mirror-scale")).toBe("1");
    // And a camera never costs a PTY resize — a mirror holds no geometry.
    expect(claims()).toEqual([]);
  });
});
