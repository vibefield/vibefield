// @vitest-environment happy-dom
/**
 * TP-R3 — ONE RESIZE PER GESTURE (TP-S2; TP-D18, TPv3 §9.7 / §18.6).
 *
 * "zoom = exactly one PTY resize each way; drag ⇒ ≤1 per throttle tick."
 *
 * The row is about a COUNT, so this file counts, at the seam where a PTY resize
 * is actually committed. That seam is `runtime.resize(sessionId, viewId, cols,
 * rows)`: `TerminalSurface`'s own `ResizeObserver` calls it whenever its derived
 * grid changes (`TerminalSurface.js:238-249`) and `GhostteaTerminalRuntime`
 * turns it into a `resize` notification on the control connection
 * (`runtime.js:1452-1465` → `#sendResize`, `:1525-1538`). Nothing else in the
 * renderer commits one.
 *
 * Two halves, because the claim has two halves:
 *
 *  1. THE REAL SURFACE (`describe("the resize seam")`). The upstream component,
 *     mounted for real against a counting runtime, with a `ResizeObserver` this
 *     file controls. It answers what a box change costs — and pins the finding
 *     that made the mirror a runtime facade rather than a set of props.
 *  2. THE CHOREOGRAPHY (`describe("the gesture")`). `DeckZoomController` driven
 *     end to end with an injected clock, counting LAYOUT COMMITS — the only
 *     thing that changes a pane's box. One per gesture, each way.
 *
 * Together: a gesture performs one layout commit, and one box change costs one
 * `runtime.resize`. happy-dom has no layout engine, so this is the honest way to
 * hold the row in a unit suite.
 *
 * The deck also PUBLISHES the count — `zoom: {phase, commits}` on its
 * `GODVIEW_DECK` marker — so the same number is readable from a live app. Said
 * exactly: the marker carries it and no smoke row asserts on it yet; adding one
 * means teaching `electron-shell/src/testing/smoke.ts`'s `DeckFacts` the field
 * and pressing the chord twice. That is a row for whoever owns the smoke, not a
 * claim this file gets to make.
 */

import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  GhostteaProvider,
  type GhostteaTerminalRuntime,
  TerminalSurface,
  type TerminalTheme,
} from "@vibecook/ghosttea-react";
import { act, createElement, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DeckZoomController,
  type DeckZoomHost,
  type DeckZoomState,
  ZOOM_COMMIT_GRACE_MS,
  ZOOM_DURATION_MS,
  ZOOM_REDUCED_DURATION_MS,
  zoomReturnTransform,
  zoomTransform,
} from "../src/godview/deck-zoom";
import { useDeckZoom } from "../src/godview/ZoomActivePane";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Upstream's own cell metrics (`renderers/types.js:40-44`). The derived grid —
 * and therefore whether a box change is a resize at all — is a function of
 * these, so the test derives its expectations from the same numbers rather than
 * hardcoding a col count that would drift with a font change. */
const CELL_WIDTH = 7.83;
const LINE_HEIGHT = 19;
const ORIGIN = 2;
const colsFor = (width: number): number =>
  Math.max(2, Math.floor((width - ORIGIN * 2) / CELL_WIDTH));
const rowsFor = (height: number): number =>
  Math.max(1, Math.floor((height - ORIGIN * 2) / LINE_HEIGHT));

// ── the controllable ResizeObserver ─────────────────────────────────────────
// happy-dom does not lay anything out, so the observer is this file's: it
// records what the surface observed and lets a test deliver a box change on
// purpose. That is the point rather than a compromise — the row is "how many
// resizes does ONE box change cost", and the only way to ask it is to deliver
// exactly one.

type ObserverEntry = { target: Element; contentRect: { width: number; height: number } };
const observers: { callback: (entries: ObserverEntry[]) => void; targets: Element[] }[] = [];

class TestResizeObserver {
  readonly #targets: Element[] = [];
  constructor(callback: (entries: ObserverEntry[]) => void) {
    observers.push({ callback, targets: this.#targets });
  }
  observe(target: Element): void {
    this.#targets.push(target);
  }
  disconnect(): void {
    this.#targets.length = 0;
  }
  unobserve(): void {
    // The surface never calls it; present so the shape is a ResizeObserver.
  }
}

/** Deliver one box to every observing surface — one observer callback, exactly
 * as the browser batches it. */
function deliverBox(width: number, height: number): void {
  for (const observer of observers) {
    for (const target of observer.targets) {
      observer.callback([{ target, contentRect: { width, height } }]);
    }
  }
}

// ── the counting runtime ────────────────────────────────────────────────────

interface RuntimeCall {
  verb: string;
  args: readonly unknown[];
}

function countingRuntime(calls: RuntimeCall[]): Record<string, unknown> {
  const record =
    (verb: string) =>
    (...args: unknown[]): undefined => {
      calls.push({ verb, args });
      return undefined;
    };
  return {
    mount: (...args: unknown[]) => {
      calls.push({ verb: "mount", args });
      return {
        // The BACKING-STORE resize, which is not a PTY resize — counted
        // separately so the two can never be confused in an assertion.
        resize: record("mount.resize"),
        dispose: record("mount.dispose"),
      };
    },
    resize: record("resize"),
    claimResizeControl: record("claimResizeControl"),
    releaseResizeControl: record("releaseResizeControl"),
    setViewInputPolicy: record("setViewInputPolicy"),
    setFocused: record("setFocused"),
    setVisible: record("setVisible"),
    setTheme: record("setTheme"),
    setEffects: record("setEffects"),
    setSelection: record("setSelection"),
    sendKey: record("sendKey"),
    sendText: record("sendText"),
    paste: record("paste"),
    sendMouse: record("sendMouse"),
    scroll: record("scroll"),
    scrollTo: record("scrollTo"),
    interrupt: record("interrupt"),
    copySelection: async (...args: unknown[]) => {
      calls.push({ verb: "copySelection", args });
      return "";
    },
    scrollbar: () => undefined,
    isMouseTracking: () => false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

function testSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
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
    pid: 1234,
    createdAtMs: 0,
    exitCode: null,
    exitSignal: null,
    requestedTermination: null,
    exitOutcome: null,
    ...overrides,
  } as SessionSummary;
}

let root: Root | null = null;
let container: HTMLElement | null = null;
let realObserver: unknown;

beforeEach(() => {
  observers.length = 0;
  realObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realObserver;
});

describe("the resize seam — what a box change costs", () => {
  function mountSurface(controlsResize: boolean, calls: RuntimeCall[]): void {
    act(() => {
      root?.render(
        createElement(GhostteaProvider, {
          // The counting double is deliberately NARROWER than the runtime: it
          // answers exactly the members `TerminalSurface` touches, so a call to
          // anything else is a test failure rather than a silent pass.
          runtime: countingRuntime(calls) as unknown as GhostteaTerminalRuntime,
          children: createElement(TerminalSurface, {
            session: testSession(),
            theme: {
              background: [0, 0, 0, 1],
              foreground: [1, 1, 1, 1],
              cursor: [1, 1, 1, 1],
            } as unknown as TerminalTheme,
            active: false,
            controlsResize,
            visible: true,
          }),
        }),
      );
    });
  }

  it("commits exactly one PTY resize for one box change", () => {
    const calls: RuntimeCall[] = [];
    mountSurface(true, calls);
    // The pane's own cell, delivered once — the mount's first measure.
    act(() => deliverBox(400, 300));
    const afterMount = calls.filter((call) => call.verb === "resize").length;

    // THE COMMIT: one box change, from the pane's cell to the whole deck.
    act(() => deliverBox(1200, 800));

    const resizes = calls.filter((call) => call.verb === "resize");
    expect(resizes.length - afterMount).toBe(1);
    expect(resizes[resizes.length - 1]?.args.slice(2)).toEqual([colsFor(1200), rowsFor(800)]);
  });

  it("commits NOTHING while a transform animates — the box never moves", () => {
    const calls: RuntimeCall[] = [];
    mountSurface(true, calls);
    act(() => deliverBox(400, 300));
    const baseline = calls.filter((call) => call.verb === "resize").length;

    // A CSS transform changes no layout box, so the observer is never called at
    // all during the animation. Sixteen frames' worth of nothing:
    act(() => {
      for (let frame = 0; frame < 16; frame += 1) {
        // deliberately no deliverBox — that is the invariant, said as code
      }
    });

    expect(calls.filter((call) => call.verb === "resize").length).toBe(baseline);
  });

  it("does not resize when the box changes below one cell", () => {
    // Why the whole-gesture count is robust: a box change only becomes a PTY
    // resize when the DERIVED grid moves, so sub-cell jitter costs nothing.
    const calls: RuntimeCall[] = [];
    mountSurface(true, calls);
    act(() => deliverBox(400, 300));
    const baseline = calls.filter((call) => call.verb === "resize").length;
    act(() => deliverBox(403, 302));
    expect(colsFor(403)).toBe(colsFor(400));
    expect(calls.filter((call) => call.verb === "resize").length).toBe(baseline);
  });

  it("`controlsResize: false` no longer resizes the PTY — the ResizeObserver path is closed (ghosttea-react 0.11.0)", () => {
    // The hazard the spec's §2 does not name (it names the FOCUS path). In 0.10.1
    // the prop gated only the explicit `claimResizeControl` and the ResizeObserver
    // path was UNGATED, so any mounted surface reflowed the real terminal to its
    // own box — which is why the mirror held a runtime FACADE, not a prop set, and
    // why this test was left as a TRIPWIRE: "if upstream ever fixes it, this test
    // fails and the mirror's first layer can be reconsidered on purpose."
    //
    // G23 ask #6 (ghosttea-react 0.11.0) closed it on BOTH paths: the
    // observer-driven `runtime.resize` is skipped when `controlsResize` is false,
    // and `#sendResize`/`focus-and-resize` refuse for a non-controller. So a
    // read-only mirror now costs the PTY nothing on its own — a box change no
    // longer commits a resize — and the mirror's facade FIRST layer (its resize
    // suppression) is now redundant; retiring it is the noted follow-up.
    const calls: RuntimeCall[] = [];
    mountSurface(false, calls);
    act(() => deliverBox(400, 300));
    const baseline = calls.filter((call) => call.verb === "resize").length;
    act(() => deliverBox(1200, 800));

    // never claims (unchanged), and — the fix — a box change now costs zero resizes.
    expect(calls.filter((call) => call.verb === "claimResizeControl")).toHaveLength(0);
    expect(calls.filter((call) => call.verb === "resize").length).toBe(baseline);
  });

  it("measures the divider drag — resizes per pointer move (TP-R3's drag half)", () => {
    // Upstream throttles a divider drag by NOTHING: `SplitView`'s `onPointerMove`
    // calls `onRatio` on every event and the split relayouts
    // (`workspace/Workspace.js:141-160`). What bounds the resize rate is the
    // CELL GRID, not a timer — a resize is committed only when the derived col
    // count moves, which is once per `CELL_WIDTH` (7.83px) of travel.
    //
    // This measures that bound rather than asserting a budget, because the
    // budget's throttle does not exist yet: TP-R3 asks for "≤1 per throttle
    // tick" and there is no tick to be within. The number is reported in the
    // slice's findings.
    const calls: RuntimeCall[] = [];
    mountSurface(true, calls);
    act(() => deliverBox(400, 300));
    const baseline = calls.filter((call) => call.verb === "resize").length;

    // 60 pointer moves dragging a divider 200px — a fast, ordinary drag.
    const moves = 60;
    const travel = 200;
    act(() => {
      for (let move = 1; move <= moves; move += 1) {
        deliverBox(400 + (travel * move) / moves, 300);
      }
    });
    const resizes = calls.filter((call) => call.verb === "resize").length - baseline;

    // One per cell crossed, never one per pointer move: the grid is the bound.
    expect(resizes).toBe(colsFor(600) - colsFor(400));
    expect(resizes).toBeLessThan(moves);
  });
});

// ── the choreography ────────────────────────────────────────────────────────

/** A zoom host with an injected clock, a fixed layout and no compositor. */
function testZoomHost(options: { reduced?: boolean } = {}): {
  host: DeckZoomHost;
  element: HTMLElement;
  pane: HTMLElement;
  runTimers: () => void;
  runFrames: () => void;
  pending: () => number;
} {
  const element = document.createElement("div");
  const stage = document.createElement("div");
  stage.className = "ghostty-window";
  const pane = document.createElement("div");
  pane.setAttribute("data-pane-id", "pane-1");
  element.append(stage);
  stage.append(pane);
  document.body.append(element);

  const timers = new Map<number, () => void>();
  const frames = new Map<number, () => void>();
  let nextHandle = 1;
  const rects: Record<string, { left: number; top: number; width: number; height: number }> = {
    stage: { left: 0, top: 0, width: 1200, height: 800 },
    pane: { left: 600, top: 0, width: 600, height: 400 },
  };

  return {
    element,
    pane,
    pending: () => timers.size + frames.size,
    runTimers: () => {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, callback] of due) callback();
    },
    runFrames: () => {
      const due = [...frames.entries()];
      frames.clear();
      for (const [, callback] of due) callback();
    },
    host: {
      host: () => element,
      stage: () => stage,
      pane: (paneId) => (paneId === "pane-1" ? pane : null),
      measure: (target) => (target === pane ? rects.pane : rects.stage) as never,
      reducedMotion: () => options.reduced === true,
      raf: (callback) => {
        const handle = nextHandle++;
        frames.set(handle, callback);
        return handle;
      },
      cancelRaf: (handle) => {
        frames.delete(handle);
      },
      timeout: (callback) => {
        const handle = nextHandle++;
        timers.set(handle, callback);
        return handle;
      },
      cancelTimeout: (handle) => {
        timers.delete(handle);
      },
    },
  };
}

describe("the gesture — one layout commit each way (TP-R3)", () => {
  it("zooms in with exactly one commit, and out with exactly one", () => {
    const rig = testZoomHost();
    const states: DeckZoomState[] = [];
    const zoom = new DeckZoomController(rig.host, (state) => states.push(state));

    zoom.toggle("pane-1");
    expect(zoom.state.phase).toBe("entering");
    // The pane is MARKED but the layout is not applied: the animation runs
    // against the untouched grid, which is what makes it free.
    expect(rig.pane.hasAttribute("data-vf-zoom-pane")).toBe(true);
    expect(rig.element.hasAttribute("data-zoom-layout")).toBe(false);
    expect(zoom.state.commits).toBe(0);

    // The armed frame writes the target transform. Still no layout.
    rig.runFrames();
    expect(rig.element.style.getPropertyValue("--vf-zoom-scale")).not.toBe("1");
    expect(rig.element.hasAttribute("data-zoom-layout")).toBe(false);
    expect(zoom.state.commits).toBe(0);

    // Gesture end: ONE commit.
    rig.runTimers();
    expect(zoom.state.phase).toBe("zoomed");
    expect(zoom.state.commits).toBe(1);
    expect(rig.element.getAttribute("data-zoom-layout")).toBe("pane");
    // The transform is gone in the same write that applied the layout, so the
    // committed state is the true box and not a scaled one.
    expect(rig.element.style.getPropertyValue("--vf-zoom-scale")).toBe("1");

    // And back: one more, never two.
    zoom.toggle("pane-1");
    expect(zoom.state.phase).toBe("leaving");
    // The layout is still applied while it animates out — that is what it is
    // animating FROM.
    expect(rig.element.getAttribute("data-zoom-layout")).toBe("pane");
    expect(zoom.state.commits).toBe(1);
    rig.runFrames();
    rig.runTimers();

    expect(zoom.state.phase).toBe("idle");
    expect(zoom.state.commits).toBe(2);
    expect(rig.element.hasAttribute("data-zoom-layout")).toBe(false);
    expect(rig.pane.hasAttribute("data-vf-zoom-pane")).toBe(false);
    expect(states.at(-1)?.commits).toBe(2);
  });

  it("commits once even when `transitionend` never arrives", () => {
    // DESIGN.md M3 picks CSS transitions because a stalled compositor must not
    // strand the gesture. The deadline owns the commit; the event only hurries
    // it — so a lost event costs a late commit, never a missing one.
    const rig = testZoomHost();
    const zoom = new DeckZoomController(rig.host);
    zoom.toggle("pane-1");
    rig.runFrames();
    rig.runTimers();
    expect(zoom.state.commits).toBe(1);
    expect(zoom.state.phase).toBe("zoomed");
  });

  it("commits once when BOTH endings arrive", () => {
    // The other direction: `transitionend` lands first and the deadline must
    // then be a no-op, or one gesture would cost two commits — two box changes,
    // two PTY resizes, and the row fails.
    const rig = testZoomHost();
    const zoom = new DeckZoomController(rig.host);
    zoom.toggle("pane-1");
    rig.runFrames();
    const event = new Event("transitionend") as TransitionEvent;
    Object.defineProperty(event, "propertyName", { value: "transform" });
    rig.element.dispatchEvent(event);
    expect(zoom.state.commits).toBe(1);
    // Nothing is still scheduled, so nothing can commit again.
    expect(rig.pending()).toBe(0);
    rig.runTimers();
    expect(zoom.state.commits).toBe(1);
  });

  it("ignores a `transitionend` for another property", () => {
    const rig = testZoomHost();
    const zoom = new DeckZoomController(rig.host);
    zoom.toggle("pane-1");
    rig.runFrames();
    const event = new Event("transitionend") as TransitionEvent;
    Object.defineProperty(event, "propertyName", { value: "opacity" });
    rig.element.dispatchEvent(event);
    expect(zoom.state.commits).toBe(0);
    expect(zoom.state.phase).toBe("entering");
  });

  it("a reversal mid-flight still ends at one commit per direction", () => {
    const rig = testZoomHost();
    const zoom = new DeckZoomController(rig.host);
    zoom.toggle("pane-1");
    rig.runFrames();
    // Pressed again before the commit: the gesture reverses rather than
    // stranding the pane, and the abandoned entering never commits. The one
    // commit below is the LEAVE's, and it takes off a layout that was never put
    // on — so the pane's box never moved and the PTY never resized. The counter
    // counts commit operations, not observed resizes, and this is the case
    // where the two differ.
    zoom.toggle("pane-1");
    expect(zoom.state.phase).toBe("leaving");
    rig.runFrames();
    rig.runTimers();
    expect(zoom.state.phase).toBe("idle");
    expect(zoom.state.commits).toBe(1);
  });

  it("honours reduced motion in the duration the commit waits on (M6)", () => {
    const rig = testZoomHost({ reduced: true });
    const zoom = new DeckZoomController(rig.host);
    zoom.toggle("pane-1");
    expect(rig.element.style.getPropertyValue("--vf-zoom-duration")).toBe(
      `${ZOOM_REDUCED_DURATION_MS}ms`,
    );
    const normal = testZoomHost();
    new DeckZoomController(normal.host).toggle("pane-1");
    expect(normal.element.style.getPropertyValue("--vf-zoom-duration")).toBe(
      `${ZOOM_DURATION_MS}ms`,
    );
    expect(ZOOM_COMMIT_GRACE_MS).toBeGreaterThan(0);
  });

  it("reset commits the layout off without animating", () => {
    const rig = testZoomHost();
    const zoom = new DeckZoomController(rig.host);
    zoom.toggle("pane-1");
    rig.runFrames();
    rig.runTimers();
    expect(zoom.state.commits).toBe(1);
    zoom.reset();
    expect(zoom.state.commits).toBe(2);
    expect(rig.element.hasAttribute("data-zoom-layout")).toBe(false);
    // Nothing left scheduled that could commit a third time.
    expect(rig.pending()).toBe(0);
  });
});

describe("the chord — claimed from upstream before its own listener runs", () => {
  /** A stand-in for `GhostteaWorkspace`'s hotkey listener: registered from a
   * PASSIVE effect onto `window` in the CAPTURE phase, which is what it does
   * (`workspace/Workspace.js:631`). If the interception's ordering claim is
   * wrong, this fires and upstream's remounting zoom runs. */
  function FakeWorkspace({ onChord }: { onChord: () => void }): null {
    useEffect(() => {
      const listener = (event: KeyboardEvent): void => {
        if (event.key === "Enter" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
          onChord();
        }
      };
      window.addEventListener("keydown", listener, true);
      return () => window.removeEventListener("keydown", listener, true);
    }, [onChord]);
    return null;
  }

  function Deck({
    onChord,
    onState,
  }: {
    onChord: () => void;
    onState: (s: DeckZoomState) => void;
  }) {
    const hostRef = useRef<HTMLDivElement>(null);
    useDeckZoom(hostRef, "pane-1", onState);
    return createElement(
      "div",
      { ref: hostRef, className: "vf-deck-zoom" },
      createElement("div", { className: "ghostty-window" }, [
        createElement("div", { key: "p", "data-pane-id": "pane-1" }),
      ]),
      createElement(FakeWorkspace, { onChord }),
    );
  }

  it("runs first and stops the workspace's own capture listener", () => {
    let upstreamRan = 0;
    const states: DeckZoomState[] = [];
    act(() => {
      root?.render(
        createElement(Deck, {
          onChord: () => {
            upstreamRan += 1;
          },
          onState: (state) => states.push(state),
        }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, metaKey: true }),
      );
    });

    // Ours ran…
    expect(states.at(-1)?.phase).toBe("entering");
    // …and upstream's did not, so no pane was remounted underneath us.
    expect(upstreamRan).toBe(0);
  });

  it("leaves every other chord alone", () => {
    let upstreamRan = 0;
    const states: DeckZoomState[] = [];
    act(() => {
      root?.render(
        createElement(Deck, {
          onChord: () => {
            upstreamRan += 1;
          },
          onState: (state) => states.push(state),
        }),
      );
    });
    act(() => {
      // Enter without the modifiers, and ⌘Enter without shift: neither is the
      // zoom, and a deck that swallowed them would eat a keystroke a terminal
      // needs.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }));
    });
    expect(states).toEqual([]);
    expect(upstreamRan).toBe(0);
  });
});

describe("the transform (DESIGN.md M2 — the subject stays where the eye left it)", () => {
  it("carries the pane's centre onto the host's centre, covering it", () => {
    const pane = { left: 600, top: 0, width: 600, height: 400 };
    const host = { left: 0, top: 0, width: 1200, height: 800 };
    const transform = zoomTransform(pane, host);
    expect(transform.scale).toBe(2);
    // pane centre (900, 200) → host centre (600, 400)
    expect(transform.x + transform.scale * 900).toBeCloseTo(600);
    expect(transform.y + transform.scale * 200).toBeCloseTo(400);
  });

  it("covers rather than fits, so no glyph is stretched", () => {
    const transform = zoomTransform(
      { left: 0, top: 0, width: 600, height: 100 },
      { left: 0, top: 0, width: 1200, height: 800 },
    );
    // max(2, 8) — a single scalar, and the overflow is clipped by the deck.
    expect(transform.scale).toBe(8);
  });

  it("returns the identity for a pane with no area", () => {
    expect(
      zoomTransform(
        { left: 0, top: 0, width: 0, height: 0 },
        { left: 0, top: 0, width: 10, height: 10 },
      ),
    ).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it("maps the host box back onto the saved home rect on the way out", () => {
    const home = { left: 600, top: 0, width: 600, height: 400 };
    const host = { left: 0, top: 0, width: 1200, height: 800 };
    const transform = zoomReturnTransform(home, host);
    expect(transform.scale).toBe(0.5);
    expect(transform.x).toBe(600);
    expect(transform.y).toBe(0);
  });
});
