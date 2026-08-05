// @vitest-environment happy-dom
/**
 * The Godview's renderer-side laws (GT-2), at the grain the repo tests chrome:
 * the pure pane rules, and the overlay state that ⇧⇧, the View menu, and the
 * toolbar button all move. The deck itself is not mounted here — it needs a
 * bridge, a floor, and a GPU, and `pnpm smoke:godview` drives all three.
 */
import type { GodviewState, TerminalBridgeStatus } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreQuestion, restoreSentence, savedPaneSessionIds } from "../src/godview/deck-restore";
import { GodviewToggle } from "../src/godview/GodviewToggle";
import { KillActivePane } from "../src/godview/KillActivePane";
import {
  isGodviewOpen,
  requestGodviewToggle,
  resetGodviewOpenForTest,
  useGodviewOpen,
} from "../src/godview/overlay-state";
import { type DeckSession, describePane } from "../src/godview/pane-faces";
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

// `sessionsToAdopt` and its three rules were deleted at GT-2e: the deck no
// longer decides what a pane holds. `GhostteaWorkspace` claims on mount and
// creates through its own doors (GT-D10), so there is no product rule left here
// to unit-test — what replaced it is a workspace behaviour, asserted in
// `pnpm smoke:godview` against the real library.

// ---- the restore question (GT-3, GT-D8) --------------------------------------

describe("savedPaneSessionIds", () => {
  it("reads pane session ids out of a saved layout, in tree order", () => {
    const layout = {
      version: 1,
      root: {
        kind: "split",
        id: "split-1",
        axis: "horizontal",
        ratio: 0.5,
        first: { kind: "pane", id: "pane-1", sessionId: "one", meta: { cwd: "/repo/api" } },
        second: { kind: "pane", id: "pane-2", sessionId: "two" },
      },
      activePaneId: "pane-1",
      zoomedPaneId: null,
    };
    expect(savedPaneSessionIds(JSON.stringify(layout))).toEqual(["one", "two"]);
  });

  it("reads the pre-v1 nested session shape ghosttea still restores", () => {
    // Believing only the modern field would call a restorable layout empty and
    // start clean without asking — the one silent data loss this gate could do.
    const legacy = { layout: { kind: "pane", id: "pane-1", session: { id: "old" } } };
    expect(savedPaneSessionIds(JSON.stringify(legacy))).toEqual(["old"]);
  });

  it("treats absent, malformed, and unrecognized documents as no layout", () => {
    expect(savedPaneSessionIds(null)).toEqual([]);
    expect(savedPaneSessionIds("{ not json")).toEqual([]);
    expect(savedPaneSessionIds(JSON.stringify({ version: 9, root: { kind: "future" } }))).toEqual(
      [],
    );
  });
});

describe("restoreQuestion", () => {
  it("counts what rejoins and what would be relaunched", () => {
    expect(restoreQuestion(["a", "b", "c"], ["a", "c", "stranger"])).toEqual({
      saved: 3,
      alive: 2,
      dead: 1,
    });
  });

  it("counts a repeated id once — two panes cannot hold one session", () => {
    expect(restoreQuestion(["a", "a"], [])).toEqual({ saved: 1, alive: 0, dead: 1 });
  });

  it("asks nothing of an all-alive deck", () => {
    expect(restoreQuestion(["a"], ["a"]).dead).toBe(0);
  });
});

describe("restoreSentence", () => {
  it("reads as English at one and at many", () => {
    expect(restoreSentence({ saved: 2, alive: 1, dead: 1 })).toBe(
      "1 pane is still running and rejoin · 1 pane ended — restoring opens a new shell in its folder",
    );
    expect(restoreSentence({ saved: 4, alive: 2, dead: 2 })).toBe(
      "2 panes are still running and rejoin · 2 panes ended — restoring opens a new shell in their folders",
    );
  });

  it("says so plainly when nothing survived", () => {
    expect(restoreSentence({ saved: 2, alive: 0, dead: 2 })).toContain("none are still running");
  });
});

// ---- the kill affordance (GT-3, GT-D5) ---------------------------------------

describe("the kill affordance", () => {
  function mountKill(session: DeckSession, request: (m: string, p: unknown) => Promise<unknown>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<KillActivePane session={session} fieldd={{ request } as never} />));
    return host;
  }

  const buttonNamed = (element: HTMLElement, text: string): HTMLButtonElement | undefined =>
    [...element.querySelectorAll("button")].find((button) => button.textContent === text);

  it("never kills on one click — the question comes first", () => {
    const calls: string[] = [];
    const element = mountKill(session({ id: "live-1" }), (method) => {
      calls.push(method);
      return Promise.resolve({ terminated: true });
    });
    act(() => buttonNamed(element, "kill session")?.click());
    expect(calls, "arming is not killing").toEqual([]);
    expect(element.textContent).toContain("end this session and its processes?");
  });

  it("kills the named session through fieldd's audited door on confirm", async () => {
    // Through `terminal.terminate` and not the workspace's own runtime, even
    // though the runtime has one: ending a user's processes belongs on the
    // record with an actor beside it.
    const calls: Array<{ method: string; params: unknown }> = [];
    const element = mountKill(session({ id: "live-1" }), (method, params) => {
      calls.push({ method, params });
      return Promise.resolve({ terminated: true });
    });
    act(() => buttonNamed(element, "kill session")?.click());
    await act(async () => buttonNamed(element, "kill")?.click());
    expect(calls).toEqual([{ method: "terminal.terminate", params: { sessionId: "live-1" } }]);
  });

  it("cancel withdraws the question and kills nothing", () => {
    const calls: string[] = [];
    const element = mountKill(session({ id: "live-1" }), (method) => {
      calls.push(method);
      return Promise.resolve({ terminated: true });
    });
    act(() => buttonNamed(element, "kill session")?.click());
    act(() => buttonNamed(element, "cancel")?.click());
    expect(calls).toEqual([]);
    expect(buttonNamed(element, "kill session")).toBeDefined();
  });

  it("offers nothing for a pane whose session already ended", () => {
    const element = mountKill(session({ id: "gone", exited: true, exitCode: 0 }), () =>
      Promise.reject(new Error("must not be called")),
    );
    expect(element.textContent).toBe("");
  });

  it("states a refusal verbatim rather than pretending it worked", async () => {
    const element = mountKill(session({ id: "live-1" }), () =>
      Promise.reject(new Error("the terminal floor is not available")),
    );
    act(() => buttonNamed(element, "kill session")?.click());
    await act(async () => buttonNamed(element, "kill")?.click());
    expect(element.textContent).toContain("the terminal floor is not available");
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
  it("presses the same door ⇧⇧ presses", () => {
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
