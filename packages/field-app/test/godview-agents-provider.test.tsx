// @vitest-environment happy-dom
/**
 * THE WINDOW'S ONE SUBSCRIPTION (AR-6 §4.1, built at GT-6; MV-3b; MV-3d).
 *
 * The monitor and the deck read one daemon, and two subscriptions on one window
 * would be two boards disagreeing by a tick about it. Since MV-3d the window's
 * ONE subscription is the model board: the chrome the model does not serve (the
 * deck's pane frames, the find sheet, the AR-7 marker) reads the facts that ride
 * this desktop's own rows of it, and the fold's `full` board is never asked
 * while Godview is open. This fixture holds the properties that makes true: ONE
 * ask per window and never `full`, the deck's facts off the board's own rows,
 * the same object until a frame's fact moves, the refusal carried whole, and
 * nothing left open behind an unmounted tree or a closed Godview.
 *
 * The board is fieldd's own backend and projection on scripted sources
 * (`model-board-fixture.ts`): the chrome's facts on its rows are cut by fieldd's
 * code, not by this file. The readers here are probes rather than the real
 * monitor and the real deck: those have their own fixtures
 * (`godview-monitor.test.tsx`, `godview-deck-frames.test.tsx`).
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import {
  GodviewAgentsProvider,
  useDeckAgentFacts,
  useMonitorFeed,
} from "../src/godview/monitor/GodviewAgentsProvider";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import { managedSummary } from "./managed-session-fixture";
import {
  type ScriptedModelBoard,
  type ScriptedModelBoardOptions,
  scriptedModelBoard,
} from "./model-board-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
let board: ScriptedModelBoard | null = null;

interface ProbeDoor extends MonitorDoor {
  observe: ReturnType<typeof vi.fn>;
  observeMesh: ReturnType<typeof vi.fn>;
}

/** A deck's door whose model port is fieldd's scripted board. `observe` (the
 * fold's `full` board) and `observeMesh` are spies the window must never call. */
function boardDoor(options: ScriptedModelBoardOptions = {}): ProbeDoor {
  board?.dispose();
  board = scriptedModelBoard(options);
  return {
    model: board.port,
    observe: vi.fn(() => () => undefined),
    observeMesh: vi.fn(() => () => undefined),
    attach: vi.fn(async () => ({ state: "no-pane" as const })),
    createTerminal: vi.fn(async () => ({ state: "no-pane" as const })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    history: {
      status: async () => ({ reachable: false, detail: "no index", checkedAt: "2026-09-13" }),
      facts: async () => [],
      search: async () => ({
        status: { reachable: false, detail: "no index", checkedAt: "2026-09-13" },
        answered: false,
        hits: [],
        clipped: false,
      }),
    },
    usage: {
      snapshot: async () => ({ refreshedAt: "2026-09-13", entries: [] }),
      subscribe: () => () => undefined,
    },
  } as ProbeDoor;
}

/** What each reader last saw, so they can be compared frame by frame. */
const seen = {
  deck: [] as Array<ReturnType<typeof useDeckAgentFacts>>,
  feed: [] as Array<ReturnType<typeof useMonitorFeed>>,
};

function FeedReader(): ReactElement {
  const feed = useMonitorFeed();
  seen.feed.push(feed);
  return <span data-testid="feed">{feed === null ? "none" : feed.state().state}</span>;
}

function DeckReader(): ReactElement {
  const facts = useDeckAgentFacts();
  seen.deck.push(facts);
  return <span data-testid="deck">{facts.agents.size}</span>;
}

function mount(door: MonitorDoor | null, subscribed = true): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <GodviewAgentsProvider door={door} subscribed={subscribed}>
        <DeckReader />
        <FeedReader />
      </GodviewAgentsProvider>,
    );
  });
}

/** The board's open lands in a microtask, its frames in the `act` that published them. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function publish(rows: readonly AgentSessionSummary[]): void {
  act(() => board?.publish(rows));
}

beforeEach(() => {
  seen.deck = [];
  seen.feed = [];
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  board?.dispose();
  board = null;
  vi.restoreAllMocks();
});

describe("the window's one subscription", () => {
  it("asks the daemon ONCE — the model board — however many surfaces read it, and never the fold's full board", async () => {
    const door = boardDoor({
      rows: [managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" })],
    });
    mount(door);
    await settle();
    expect(board?.opened()).toBe(1);
    expect(door.observe).not.toHaveBeenCalled();
    expect(door.observeMesh).not.toHaveBeenCalled();
    expect(container?.querySelector('[data-testid="deck"]')?.textContent).toBe("1");
    // the feed's state is its own (the stage subscribes to it, not this provider)
    expect(seen.feed.at(-1)?.state().state).toBe("live");
  });

  it("hands the deck the board's runs, joined to their panes, in the frame they land", async () => {
    mount(boardDoor());
    await settle();
    publish([
      managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a", kind: "claude" }),
      managedSummary({ runtimeRunId: "run-b", terminalSessionId: "pty-b", kind: "codex" }),
    ]);
    const deck = seen.deck.at(-1);
    expect([...(deck?.agents.keys() ?? [])]).toEqual(["pty-a", "pty-b"]);
    expect(deck?.agents.get("pty-a")).toMatchObject({
      providerId: "claude",
      cwd: "/project/vibe-field",
    });
    expect(deck?.runs.get("pty-a")).toBe("run-a");
    // the chrome's runs are the feed's own, the same ones
    expect(
      seen.feed
        .at(-1)
        ?.chrome.runs()
        .map((run) => run.runtimeRunId),
    ).toEqual(["run-a", "run-b"]);
  });

  it("holds the deck's facts STILL while a run's row moves, and moves them when a frame's fact does", async () => {
    const row = managedSummary({
      runtimeRunId: "run-a",
      terminalSessionId: "pty-a",
      status: "working",
    });
    mount(boardDoor({ rows: [row] }));
    await settle();
    const first = seen.deck.at(-1);
    const runsBefore = seen.feed.at(-1)?.chrome.runs();

    // A busier mirror: a new revision, more tokens, a new reply. The run's row
    // DOES move on the board — but nothing a frame draws did, so the deck is
    // handed the very same object and React bails out of its subtree.
    const monitor = row.monitor as NonNullable<AgentSessionSummary["monitor"]>;
    publish([
      {
        ...row,
        monitor: {
          ...monitor,
          revision: 99,
          usage: { cumulativeTokens: 120_000 },
          lastAssistantMessage: { text: "still going" },
        },
      },
    ]);
    expect(seen.feed.at(-1)?.chrome.runs()).not.toBe(runsBefore);
    expect(seen.deck.at(-1)).toBe(first);

    // another desktop's board moving touches nothing of this desktop's runs
    const runsNow = seen.feed.at(-1)?.chrome.runs();
    act(() =>
      board?.peer({ device: "desk-peer", rows: [managedSummary({ runtimeRunId: "run-p" })] }),
    );
    expect(seen.feed.at(-1)?.chrome.runs()).toBe(runsNow);
    expect(seen.deck.at(-1)).toBe(first);

    publish([{ ...row, status: "blocked" }]);
    expect(seen.deck.at(-1)).not.toBe(first);
    expect(seen.deck.at(-1)?.agents.get("pty-a")?.status).toBe("blocked");
  });

  it("carries the daemon's own reason when the board is refused, and the deck has no runs", async () => {
    const refusal = Object.assign(new Error("agent.observe is not in this window's token"), {
      kind: "FORBIDDEN_SCOPE",
      retryable: false,
    });
    mount(
      boardDoor({
        rows: [managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" })],
        refuse: refusal,
      }),
    );
    await settle();
    expect(seen.feed.at(-1)?.state()).toEqual({
      state: "unavailable",
      reason: "agent.observe is not in this window's token",
      retryable: false,
    });
    expect(seen.deck.at(-1)?.agents.size).toBe(0);
    expect(seen.deck.at(-1)?.runs.size).toBe(0);
  });

  it("says nobody was asked when there is no deck yet, and asks nothing while Godview is closed", async () => {
    mount(null);
    await settle();
    expect(seen.feed.at(-1)).toBeNull();
    expect(seen.deck.at(-1)?.agents.size).toBe(0);

    act(() => root?.unmount());
    container?.remove();
    const door = boardDoor({
      rows: [managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" })],
    });
    mount(door, false);
    await settle();
    // PF6: a closed Godview holds no subscription, even with a door in hand
    expect(board?.opened()).toBe(0);
    expect(door.observe).not.toHaveBeenCalled();
    expect(seen.feed.at(-1)).toBeNull();
    expect(seen.deck.at(-1)?.agents.size).toBe(0);
  });

  it("lets the subscription go with the tree", async () => {
    mount(boardDoor());
    await settle();
    expect(board?.closed()).toBe(0);
    act(() => root?.unmount());
    root = null;
    expect(board?.closed()).toBe(1);
  });
});

describe("the window's model board (MV-3b)", () => {
  it("mounts the feed when the door has a model port, its state its own", async () => {
    mount(boardDoor());
    await settle();
    const feed = seen.feed.at(-1);
    expect(feed).not.toBeNull();
    // the feed's STATE is its own (the stage subscribes to it); the context value is the feed
    expect(feed?.state()).toEqual({ state: "live", here: "this-device" });
  });

  it("is null — not an empty board — without a model port", async () => {
    const { model: _none, ...portless } = boardDoor();
    mount(portless as MonitorDoor);
    await settle();
    expect(seen.feed.at(-1)).toBeNull();
    expect(seen.deck.at(-1)?.agents.size).toBe(0);
  });
});
