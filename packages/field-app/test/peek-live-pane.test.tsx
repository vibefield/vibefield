// @vitest-environment happy-dom
/**
 * THE LIVE PEEK WATCHES (P2; DESIGN.md §8 "Search — the Peek"; GV-D8: "the
 * live session's real pane, resting") — TP-R4a's row, restored for the Peek:
 * "the mirror cannot take input focus and issues zero geometry claims by
 * construction".
 *
 * DK-17 retired the canvas's terminal mirror and its 18 rows (`0afeed47`,
 * `test/terminal-mirror.test.tsx`); its five layers came back off the canvas
 * as the Peek's live pane (`frame/peek-pane`), and these are its rows, kept as
 * they were where the surface did not move: ZERO is a count, so every call
 * that reaches the runtime is recorded and the claim-bearing verbs are
 * asserted absent; BY CONSTRUCTION means under a hostile test — focused
 * programmatically, pressed, keyed at and resized — never only an ordinary
 * render. The runtime under the pane is a double that records every call, and
 * the `TerminalSurface` above it is the real upstream component (ghosttea-react
 * 0.12.0 at the pin), because the hazards are upstream's.
 *
 * What moved upstream since the canvas rows (0.10.1 → 0.12.0): the surface's
 * observer resize is gated on `controlsResize`, and `readWrite` / `inputPolicy`
 * are props — so the pane passes both, AND the facade still refuses resize,
 * AND it narrows the new `setViewInputPolicy` to read-only whatever the
 * surface asks: a view starts read-write in the runtime.
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

// The REAL `TerminalSurface` and `GhostteaProvider`; a FAKE runtime underneath.
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
      // What a watcher must never reach — present so a call is RECORDED.
      resize: record("resize"),
      claimResizeControl: record("claimResizeControl"),
      releaseResizeControl: record("releaseResizeControl"),
      setViewInputPolicy: record("setViewInputPolicy"),
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
const { LivePeekPane } = await import("../src/frame/peek-pane/LivePeekPane");
const { MIRROR_REFUSED_VERBS, watchOnlyRuntime } = await import(
  "../src/frame/peek-pane/watch-only"
);
const { FielddProvider } = await import("@vibefield/fieldd-client/react");

type PoolClient = Parameters<typeof pool.openTerminalPool>[0];
const fieldd = {
  status: "ready",
  onStatusChange: () => () => undefined,
  request: () => Promise.resolve({ ticket: { token: "t", controlSocket: "c", frameSocket: "f" } }),
} as unknown as PoolClient;

let root: Root | null = null;
let container: HTMLElement | null = null;

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
  pool.configureTerminalPool({
    transport: "routed",
    defaultShell: "/bin/zsh",
    home: "/Users/test",
  });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = InertResizeObserver;
  setHost({
    logger: { child: () => ({ info: () => undefined, error: () => undefined }) },
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

/** Mount the pane on `session-a`, the pool opened by the pane itself. */
async function mountPane(sessionId = "session-a"): Promise<void> {
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client: fieldd as never },
        createElement(LivePeekPane, { sessionId }),
      ),
    );
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

const pane = (): HTMLElement => {
  const element = container?.querySelector<HTMLElement>(".vf-peek-livepane");
  if (element === null || element === undefined) throw new Error("no pane mounted");
  return element;
};

const claimVerbs = ["setFocused", "resize", "claimResizeControl"] as const;
const claims = (): typeof runtimeCalls =>
  runtimeCalls.filter((call) => (claimVerbs as readonly string[]).includes(call.verb));

describe("the live peek cannot take input focus, nor claim the terminal's size", () => {
  it("opens the window's pool itself, mounts the session's surface and reaches the runtime only to WATCH", async () => {
    await mountPane();
    expect(pool.terminalPoolSnapshot().claimed).toBe(true);
    expect(pane().getAttribute("data-live-peek")).toBe("watching");
    // It really did attach: a pane that never mounted would pass every "zero
    // claims" assertion below by doing nothing at all.
    expect(runtimeCalls.some((call) => call.verb === "mount")).toBe(true);
    expect(claims()).toEqual([]);
  });

  it("is inert, and its view is read-only in the runtime whatever the surface asks", async () => {
    await mountPane();
    expect(container?.querySelector(".vf-peek-livepane-surface")?.hasAttribute("inert")).toBe(true);
    const input = container?.querySelector<HTMLTextAreaElement>(".terminal-input");
    expect(input).not.toBeNull();
    expect(input?.readOnly).toBe(true);
    const policies = runtimeCalls.filter((call) => call.verb === "setViewInputPolicy");
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.every((call) => call.args[1] === false)).toBe(true);
  });

  it("issues zero claims when its input is focused programmatically, pressed, or keyed at", async () => {
    await mountPane();
    const input = container?.querySelector<HTMLTextAreaElement>(".terminal-input");
    await act(async () => {
      input?.focus();
      // delivered by hand too: a test that only proved "happy-dom refused to
      // focus" would prove nothing about the layers that matter
      input?.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
      input?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      input?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      input?.dispatchEvent(new Event("click", { bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      // ghosttea 0.13.3 (#79, #81): text the platform inserts with no keydown (the
      // Character Viewer, a soft keyboard, dictation, an IME commit outside a
      // composition) has its own path to the terminal now, and the exact Ctrl+C is the
      // interrupt. A watcher's view takes neither.
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }),
      );
      input?.dispatchEvent(
        new InputEvent("beforeinput", { inputType: "insertText", data: "x", bubbles: true }),
      );
      input?.dispatchEvent(
        new InputEvent("input", { inputType: "insertText", data: "x", bubbles: true }),
      );
      input?.dispatchEvent(new CompositionEvent("compositionend", { data: "é", bubbles: true }));
      await settle();
    });
    expect(claims()).toEqual([]);
    for (const verb of ["sendKey", "sendText", "paste", "sendMouse", "interrupt"]) {
      expect(runtimeCalls.filter((call) => call.verb === verb)).toEqual([]);
    }
  });

  it("issues zero claims when its box changes — the pane keeps the PTY's size, the peek draws what fits", async () => {
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
    await mountPane();
    expect(observed).not.toBeNull();
    await act(async () => {
      deliver?.([{ target: observed, contentRect: { width: 1200, height: 800 } }]);
      await settle();
    });
    expect(claims()).toEqual([]);
  });

  it("never repaints the session for everyone else (`setTheme` is session-wide)", async () => {
    await mountPane();
    expect(runtimeCalls.filter((call) => call.verb === "setTheme")).toEqual([]);
  });

  it("declares live demand while it shows, releases it when it goes, and asks nothing for a session the floor does not have", async () => {
    await mountPane();
    expect(pool.terminalSessionDemand("session-a")).toBe("live");
    await act(async () => {
      root?.render(null);
      await settle();
    });
    expect(pool.terminalPoolViewCount()).toBe(0);
    expect(pool.terminalSessionDemand("session-a")).toBe("none");
    sessions = [];
    await mountPane("session-gone");
    expect(pane().getAttribute("data-live-peek")).toBe("unavailable");
    expect(pool.terminalPoolViewCount()).toBe(0);
    expect(container?.textContent).toContain(
      "Its terminal is not on this desktop's floor any more.",
    );
  });
});

describe("the facade itself (`watch-only.ts`)", () => {
  it("refuses every claim-bearing verb and names what it refused", () => {
    const calls: string[] = [];
    const underlying = Object.fromEntries(
      MIRROR_REFUSED_VERBS.map((verb) => [verb, () => calls.push(verb)]),
    ) as unknown as Parameters<typeof watchOnlyRuntime>[0];
    const guarded = watchOnlyRuntime(underlying);
    for (const verb of MIRROR_REFUSED_VERBS) {
      (guarded.runtime as unknown as Record<string, () => void>)[verb]?.();
    }
    expect(calls).toEqual([]);
    expect(guarded.refusals().verbs).toEqual([...MIRROR_REFUSED_VERBS]);
  });

  it("refuses a verb it has never heard of — an allow-list, not a deny-list", () => {
    const guarded = watchOnlyRuntime({
      somethingNewUpstreamAdded: () => "reached",
    } as unknown as Parameters<typeof watchOnlyRuntime>[0]);
    expect(
      (guarded.runtime as unknown as Record<string, () => unknown>).somethingNewUpstreamAdded?.(),
    ).toBeUndefined();
    expect(guarded.refusals().verbs).toEqual(["somethingNewUpstreamAdded"]);
  });

  it("narrows a view's input policy to read-only, whatever is asked", () => {
    const asked: unknown[][] = [];
    const guarded = watchOnlyRuntime({
      setViewInputPolicy: (...args: unknown[]) => asked.push(args),
    } as unknown as Parameters<typeof watchOnlyRuntime>[0]);
    (
      guarded.runtime as unknown as { setViewInputPolicy: (v: string, rw: boolean) => void }
    ).setViewInputPolicy("view-1", true);
    expect(asked).toEqual([["view-1", false]]);
    expect(guarded.refusals().count).toBe(0);
  });

  it("forwards the watching verbs with the RUNTIME as `this`", () => {
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
    (guarded.runtime as unknown as { setVisible: (h: string) => void }).setVisible("handle-a");
    expect(runtime.seen()).toEqual(["handle-a"]);
    expect(guarded.refusals().count).toBe(0);
  });

  it("refuses an ASYNC verb in the shape its caller chains on", async () => {
    const guarded = watchOnlyRuntime({
      copySelection: () => Promise.resolve("secret"),
    } as unknown as Parameters<typeof watchOnlyRuntime>[0]);
    const result = (
      guarded.runtime as unknown as { copySelection: () => Promise<string> }
    ).copySelection();
    await expect(result).resolves.toBe("");
    expect(guarded.refusals().verbs).toEqual(["copySelection"]);
  });

  it("returns a STABLE function per verb, so listener cleanup still matches", () => {
    const guarded = watchOnlyRuntime({
      addEventListener: () => undefined,
    } as unknown as Parameters<typeof watchOnlyRuntime>[0]);
    const read = (): unknown =>
      (guarded.runtime as unknown as Record<string, unknown>).addEventListener;
    expect(read()).toBe(read());
  });
});
