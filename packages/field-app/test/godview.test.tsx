// @vitest-environment happy-dom
/**
 * The Godview's renderer-side laws (GT-2), at the grain the repo tests chrome:
 * the pure pane rules, and the overlay state that ⌘G, the View menu, and the
 * toolbar button all move. The deck itself is not mounted here — it needs a
 * bridge, a floor, and a GPU, and `pnpm smoke:godview` drives all three.
 */
import type { GodviewState, TerminalBridgeStatus } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodviewToggle } from "../src/godview/GodviewToggle";
import {
  isGodviewOpen,
  requestGodviewToggle,
  resetGodviewOpenForTest,
  useGodviewOpen,
} from "../src/godview/overlay-state";
import { type DeckSession, describePane, sessionsToAdopt } from "../src/godview/pane-faces";
import { type FieldHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { setRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A SessionSummary is wide and only a few fields carry meaning here. */
function session(overrides: Partial<DeckSession> & { id: string }): DeckSession {
  return {
    handle: `handle-${overrides.id}`,
    executable: "/bin/zsh",
    cols: 100,
    rows: 30,
    exited: false,
    readWrite: true,
    title: null,
    cwd: null,
    bellCount: 0,
    pid: 4242,
    createdAtMs: 0,
    exitCode: null,
    exitSignal: null,
    requestedTermination: null,
    exitOutcome: null,
    ownerId: null,
    persistence: "keep-until-exit",
    activity: "idle",
    ...overrides,
  } as DeckSession;
}

describe("describePane", () => {
  it("says nothing about a live pane — the terminal IS the state", () => {
    expect(describePane(session({ id: "a" }))).toBeUndefined();
  });

  it("calls a clean exit an exit, without color: 0 is an ending, not a failure", () => {
    expect(describePane(session({ id: "a", exited: true, exitCode: 0 }))).toEqual({
      label: "exited",
    });
  });

  it("gives a nonzero code the red of §2.5, and states the code", () => {
    expect(describePane(session({ id: "a", exited: true, exitCode: 127 }))).toEqual({
      label: "exited · 127",
      color: "var(--vf-red)",
    });
  });

  it("names the signal when one ended it", () => {
    expect(
      describePane(session({ id: "a", exited: true, exitCode: null, exitSignal: "SIGKILL" })),
    ).toEqual({ label: "ended · SIGKILL", color: "var(--vf-red)" });
  });

  it("admits it does not know how a session ended rather than inventing a code", () => {
    expect(describePane(session({ id: "a", exited: true, exitCode: null }))).toEqual({
      label: "ended",
    });
  });
});

describe("sessionsToAdopt", () => {
  it("adopts a floor session the deck has never shown", () => {
    const floor = [session({ id: "a" }), session({ id: "b" })];
    expect(sessionsToAdopt(floor, new Set(["a"])).map((s) => s.id)).toEqual(["b"]);
  });

  it("never re-adopts a session whose pane was closed — that is what close MEANS", () => {
    // GT-D5: closing a pane detaches, so `b` is still on the floor and still
    // listed. Re-adopting it would undo the user's close on the next open.
    const floor = [session({ id: "a" }), session({ id: "b" })];
    expect(sessionsToAdopt(floor, new Set(["a", "b"]))).toEqual([]);
  });

  it("leaves exited sessions on the floor — the deck is for work in progress", () => {
    const floor = [session({ id: "a", exited: true, exitCode: 0 })];
    expect(sessionsToAdopt(floor, new Set())).toEqual([]);
  });
});

// ---- the overlay state -------------------------------------------------------

let publishState: ((state: GodviewState) => void) | null = null;
let setCalls: (boolean | undefined)[] = [];
let root: Root | null = null;
let host: HTMLElement | null = null;

function installHost(godview: FieldHost["godview"]): void {
  setRendererLogger({
    child: () => ({ error: () => undefined }) as unknown as RendererLogger,
    error: () => undefined,
  } as unknown as RendererLogger);
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    ...(godview !== undefined ? { godview } : {}),
  });
}

beforeEach(() => {
  resetGodviewOpenForTest();
  setCalls = [];
  publishState = null;
  installHost({
    set: (open) => {
      setCalls.push(open);
      return Promise.resolve({ open: open ?? !isGodviewOpen() });
    },
    onState: (handler) => {
      publishState = handler;
      return () => {
        publishState = null;
      };
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function Probe(): React.ReactElement {
  return <GodviewToggle active={useGodviewOpen()} />;
}

function mountProbe(): HTMLButtonElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Probe />));
  const button = host.querySelector("button");
  if (button === null) throw new Error("the toggle did not render");
  return button;
}

describe("the overlay state", () => {
  it("starts closed and follows the host, which owns the value", () => {
    const button = mountProbe();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    act(() => publishState?.({ open: true }));
    expect(isGodviewOpen()).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("asks for a FLIP without sending its own idea of the value", () => {
    // The accelerator is consumed by the menu before this page sees it, so a
    // renderer that sent `open: !mine` could be arguing with a value main had
    // already changed. It sends no value at all.
    mountProbe();
    requestGodviewToggle();
    expect(setCalls).toEqual([undefined]);
  });

  it("does not light the button until the host says so — no optimistic echo", () => {
    const button = mountProbe();
    requestGodviewToggle();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    act(() => publishState?.({ open: true }));
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("stays closed on a host with no Godview — nothing there can open it", () => {
    resetGodviewOpenForTest();
    installHost(undefined);
    const button = mountProbe();
    requestGodviewToggle();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(isGodviewOpen()).toBe(false);
  });
});

describe("the bridge notice", () => {
  // The overlay's own copy of this rule lives in GodviewOverlay; the values it
  // discriminates on are the contract's, so a new state cannot slip past
  // silently.
  it("covers every TerminalBridgeStatus state the contract declares", () => {
    const states: TerminalBridgeStatus["state"][] = ["bridge-up", "bridge-down", "ticket-expired"];
    expect(states).toHaveLength(3);
  });
});

describe("the toggle button", () => {
  it("presses the same door ⌘G presses", () => {
    const button = mountProbe();
    const click = vi.fn();
    button.addEventListener("click", click);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([undefined]);
  });
});
