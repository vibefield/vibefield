// @vitest-environment happy-dom
/**
 * PF6 at the COMPOSITION level (GT-3m, re-fed at AR-3).
 *
 * The stage's own fixture proves that unmounting disposes; this proves that
 * CLOSING is what unmounts it. Those are different claims, and only the second
 * one is about the product: the whole PF6 story would be a comment if the
 * overlay kept the stage mounted while hidden the way it deliberately keeps the
 * deck mounted.
 *
 * The deck is stubbed to a component that hands the overlay a fake DOOR and
 * renders nothing — it is the neighbour here, not the subject, and its own
 * mount behaviour has a fixture of its own (godview-deck.test.tsx). The door is
 * what gives the stage something to dispose: the model board's subscription,
 * which must die with the stage. MV-3d — and it is the ONLY one: the fold's
 * `full` board is never asked, open or closed (the chrome reads the facts that
 * ride the model board's own rows), and this fixture's spy on it says so.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";
import { managedSummary } from "./managed-session-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doorFacts = vi.hoisted(() => ({
  /** the fold's `full` board, asked: never, since MV-3d */
  observeCalls: 0,
  observeDisposals: 0,
  /** MV-3b — the model board's opens and closes: the window's one subscription (PF6) */
  modelOpens: 0,
  modelCloses: 0,
  rows: [] as unknown[],
}));

vi.mock("../src/godview/GodviewDeck", async () => {
  const { useEffect } = await import("react");
  const { scriptedModelBoard } = await import("./model-board-fixture");
  type ModelBoardPort = import("../src/godview/monitor/remote-door").ModelBoardPort;
  type FoldRows = import("../src/godview/monitor/facet-types").AgentSessionSummary[];
  const checkedAt = "2026-09-13T00:00:00.000Z";
  const status = { reachable: false, detail: "no index in this fixture", checkedAt };
  // MV-3b — the model board behind the door's model port: fieldd's real backend
  // on the fold rows (`model-board-fixture.ts`), stood up per open and torn down
  // with the close, so the window's one subscription is what the counts read.
  const model: ModelBoardPort = {
    subscribe: async (onFrame, opts) => {
      doorFacts.modelOpens += 1;
      const board = scriptedModelBoard({ rows: doorFacts.rows as FoldRows });
      const subscription = await board.port.subscribe(onFrame, opts);
      return {
        snapshot: subscription.snapshot,
        unsubscribe: () => {
          doorFacts.modelCloses += 1;
          subscription.unsubscribe();
          board.dispose();
        },
      };
    },
    reportShown: async () => ({ reported: true }),
  };
  const door = {
    model,
    attach: async () => ({ state: "no-pane" as const }),
    createTerminal: async () => ({ state: "no-pane" as const }),
    mountLocal: async () => ({ state: "no-pane" as const }),
    // AR-5's two ports. The real deck builds them over its fieldd client
    // (`monitor/doors.ts`); here they answer honestly and reach nothing, which
    // is what a door with no daemon behind it should do.
    history: {
      status: async () => status,
      facts: async () => [],
      search: async () => ({ status, answered: false, hits: [], clipped: false }),
    },
    usage: {
      snapshot: async () => ({ refreshedAt: checkedAt, entries: [] }),
      subscribe: () => () => undefined,
    },
  };
  return {
    GodviewDeck: (props: { onRemoteDoor?: (door: unknown) => void }) => {
      useEffect(() => {
        props.onRemoteDoor?.(door);
        return () => props.onRemoteDoor?.(null);
        // the deck hands the door over once, on mount
      }, []);
      return null;
    },
  };
});

/** The overlay renders its deck branch only when the window's terminal pool is
 * configured (`terminalPoolConfigured`); this fixture has no pool, so the
 * predicate is answered for it — the mocked deck above is what the branch
 * mounts, and the door it hands over is the subject. The prewarm stays the
 * real module's no-op against the answerless client below. */
vi.mock("../src/terminal/pool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/terminal/pool")>()),
  terminalPoolConfigured: () => true,
}));

/** GT-3p: the overlay itself now reaches fieldd — it schedules the transport
 * prewarm (GT-D14) at idle, above the `everOpened` gate, because warming after
 * the first open would warm nothing. A client that answers nothing is right for
 * this fixture: the subject is the STAGE's lifetime, and the prewarm's own
 * behaviour is asserted in godview-prewarm.test.ts. */
vi.mock("@vibefield/fieldd-client/react", () => ({
  useFielddClient: () => ({ request: () => new Promise(() => undefined) }),
}));

const { GodviewOverlay } = await import("../src/godview/GodviewOverlay");
const { resetActiveViewForTest } = await import("../src/frame/view-state");

let root: Root | null = null;
let container: HTMLElement | null = null;
let publishView: ((state: { view: "canvas" | "godview" }) => void) | null = null;
let openedIntervals: number[] = [];
let clearedIntervals: number[] = [];

beforeEach(() => {
  openedIntervals = [];
  clearedIntervals = [];
  doorFacts.observeCalls = 0;
  doorFacts.observeDisposals = 0;
  doorFacts.modelOpens = 0;
  doorFacts.modelCloses = 0;
  doorFacts.rows = [managedSummary({ runtimeRunId: "run-1", kind: "claude", label: "Claude" })];
  localStorage.clear();
  resetActiveViewForTest();
  setHost({
    platform: "darwin",
    // Present, so the overlay renders its deck branch rather than the
    // no-terminal-bridge face — the monitor must be there either way, but the
    // realistic tree is the one worth asserting on.
    terminal: { connect: () => Promise.resolve({}), onStatus: () => () => undefined },
    // One Frame FR-1: Godview is open exactly while it is the window's view.
    view: {
      set: () => Promise.resolve({ view: "canvas" }),
      onState: (handler: (state: { view: "canvas" | "godview" }) => void) => {
        publishView = handler;
        return () => {
          publishView = null;
        };
      },
    },
  } as unknown as FieldHost);

  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  vi.spyOn(window, "setInterval").mockImplementation(((...args: Parameters<typeof setInterval>) => {
    const id = realSetInterval(...args) as unknown as number;
    openedIntervals.push(id);
    return id;
  }) as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
    if (id !== undefined) clearedIntervals.push(id);
    realClearInterval(id);
  }) as typeof window.clearInterval);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  publishView = null;
  vi.restoreAllMocks();
});

/**
 * Both of these are `await act(async …)` rather than the synchronous form,
 * and the reason is the door: opening the stage asks it for providers and for
 * the mesh, and both answers land in a microtask AFTER a synchronous act has
 * closed. React said so six times per run ("not wrapped in act"), and a warning
 * that is always there is a warning nobody reads — the next real one would have
 * arrived into a page of noise. The async form lets the tree settle first, so
 * every assertion below is made against a stage that has finished arriving.
 */
async function mountOverlay(): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<GodviewOverlay />);
  });
  return container;
}

async function setOpen(open: boolean): Promise<void> {
  await act(async () => {
    publishView?.({ view: open ? "godview" : "canvas" });
  });
}

const stage = (host: HTMLElement): Element | null =>
  host.querySelector(".vf-godview-monitor-stage");

/**
 * Which view the bar is wearing (AR-5).
 *
 * The `<select>` this used to read is gone: the stage's header is the package's
 * instrument bar, and a view is chosen with a mark that reports itself pressed.
 * The claim is unchanged — the choice survives a close — and it is still read
 * off the screen rather than out of storage, which is the point of making it.
 */
const viewMark = (host: HTMLElement, label: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(
    `[role="group"][aria-label="Monitor view"] button[aria-label="${label} view"]`,
  );
const pressedView = (host: HTMLElement): string | undefined =>
  [
    ...host.querySelectorAll<HTMLButtonElement>(
      '[role="group"][aria-label="Monitor view"] button[aria-pressed="true"]',
    ),
  ][0]?.getAttribute("aria-label") ?? undefined;

describe("the monitor's lifetime inside the overlay (PF6)", () => {
  it("does not exist until the Godview has been opened once", async () => {
    const host = await mountOverlay();
    // The overlay itself is not in the tree before a first open, so nothing
    // below it can be either — a user who never presses ⇧⇧ runs no monitor.
    expect(host.querySelector(".vf-godview")).toBeNull();
    expect(openedIntervals, "a closed Godview started a timer").toHaveLength(0);
    expect(doorFacts.observeCalls, "a closed Godview subscribed to the fold").toBe(0);
    expect(doorFacts.modelOpens, "a closed Godview opened the model board").toBe(0);
  });

  it("mounts the stage on open and REMOVES it on close, clearing its timers and its subscription", async () => {
    const host = await mountOverlay();

    await setOpen(true);
    expect(stage(host), "the stage never mounted").not.toBeNull();
    // the board reached the chrome: one managed agent, said in words
    expect(host.querySelector(".vf-monitor-local-chip")?.textContent).toBe("1 managed agent");
    // MV-3d: the fold's `full` board is not asked while Godview is open
    expect(doorFacts.observeCalls, "the window asked the fold's full board").toBe(0);
    // MV-3b: the window's one model subscription opened with the stage (the
    // clocks the seam used to run here — the mesh poll, the 10 s now — are the
    // backend's now, so there is no interval to count; whatever the stage
    // still opens must close with it)
    expect(doorFacts.modelOpens, "the model board never opened").toBe(1);
    const started = [...openedIntervals];

    await setOpen(false);

    // THE PF6 CLAIM, at the level it actually matters. The overlay stays in the
    // tree — the deck below is expensive to build and instant to reveal, so it
    // is kept and silenced — but the monitor is GONE, not hidden: every
    // interval it opened went with it, and so did its one subscription.
    expect(host.querySelector(".vf-godview"), "the overlay unmounted too").not.toBeNull();
    expect(stage(host), "the stage survived the close").toBeNull();
    for (const id of started) {
      expect(clearedIntervals, `interval ${id} outlived the close`).toContain(id);
    }
    expect(doorFacts.modelCloses, "the model subscription outlived the close").toBe(1);
    expect(doorFacts.observeCalls, "a closed Godview asked the fold's full board").toBe(0);
  });

  it("comes back on reopen, from the fold's current frame", async () => {
    // A reopened stage subscribes afresh and gets the daemon's current frame —
    // state transfer, never edges — so nothing is replayed and nothing is
    // remembered across the close. That is why the stage may be unmounted
    // strictly while the deck, whose layout is NOT reproducible from a frame,
    // gets the other treatment.
    const host = await mountOverlay();
    await setOpen(true);
    await setOpen(false);
    await setOpen(true);
    expect(stage(host)).not.toBeNull();
    expect(doorFacts.observeCalls).toBe(0);
    expect(doorFacts.modelOpens).toBe(2);
    expect(host.querySelector(".vf-monitor-local-chip")?.textContent).toBe("1 managed agent");
  });

  it("keeps the chosen view across a close, because the choice lives above the stage", async () => {
    const host = await mountOverlay();
    await setOpen(true);
    expect(pressedView(host)).toBe("SWARM view");

    await act(async () => viewMark(host, "LIST")?.click());
    expect(host.querySelector(".vf-monitor-list")).not.toBeNull();

    await setOpen(false);
    await setOpen(true);

    // The reason `useMonitorTuning` lives in the overlay and not in the stage:
    // state inside a component that unmounts on every close is state that
    // resets on every close.
    expect(pressedView(host)).toBe("LIST view");
    expect(host.querySelector(".vf-monitor-list")).not.toBeNull();
  });
});
