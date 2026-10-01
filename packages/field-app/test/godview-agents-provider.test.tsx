// @vitest-environment happy-dom
/**
 * THE FOLD, LIFTED (AR-6 §4.1, built at GT-6).
 *
 * `agent.subscribe` used to be the monitor's private stream. The deck needs the
 * same rows — the pane frame names the agent in a pane and aims its verbs at
 * the run — and two subscriptions on one window would be two boards
 * disagreeing by a tick about one daemon. This fixture holds the properties
 * that makes true: ONE ask per window, both readers on the same frame, the
 * failure carried whole, and nothing left open behind an unmounted tree.
 *
 * The two readers here are probes rather than the real monitor and the real
 * deck: those two have their own fixtures (`godview-monitor.test.tsx` mounts
 * through this provider, `godview-deck-frames.test.tsx` reads the frames' facts
 * out of it), and what is under test in this file is the provider itself.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import {
  foldByTerminal,
  GodviewAgentsProvider,
  useAgentFold,
  useDeckAgentFacts,
} from "../src/godview/monitor/GodviewAgentsProvider";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import { managedSummary } from "./managed-session-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

interface FoldDoor extends MonitorDoor {
  observe: ReturnType<typeof vi.fn>;
  /** Push a frame the way fieldd's subscription would. */
  frame(rows: readonly AgentSessionSummary[]): void;
  fail(reason: string): void;
  disposed(): number;
}

function foldDoor(initial: readonly AgentSessionSummary[] = []): FoldDoor {
  let onFrame: ((rows: readonly AgentSessionSummary[]) => void) | null = null;
  let onError: ((reason: string) => void) | null = null;
  let disposals = 0;
  const observe = vi.fn((handlers: { onFrame: typeof onFrame; onError: typeof onError }) => {
    onFrame = handlers.onFrame;
    onError = handlers.onError;
    handlers.onFrame?.(initial);
    return () => {
      disposals += 1;
      onFrame = null;
      onError = null;
    };
  });
  return {
    observe,
    frame: (rows) => onFrame?.(rows),
    fail: (reason) => onError?.(reason),
    disposed: () => disposals,
    observeMesh: vi.fn(({ onOpen }) => {
      onOpen({ devices: [] });
      return () => undefined;
    }),
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
  } as FoldDoor;
}

/** What each reader last saw, so the two can be compared frame by frame. */
const seen = {
  fold: [] as Array<ReturnType<typeof useAgentFold>>,
  deck: [] as Array<ReturnType<typeof useDeckAgentFacts>>,
};

function FoldReader(): ReactElement {
  const fold = useAgentFold();
  seen.fold.push(fold);
  return <span data-testid="fold">{fold.rows.length}</span>;
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
        <FoldReader />
        <DeckReader />
      </GodviewAgentsProvider>,
    );
  });
}

beforeEach(() => {
  seen.fold = [];
  seen.deck = [];
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("the window's one fold", () => {
  it("asks the daemon ONCE however many surfaces read it", () => {
    const door = foldDoor([managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" })]);
    mount(door);
    expect(door.observe).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[data-testid="fold"]')?.textContent).toBe("1");
    expect(container?.querySelector('[data-testid="deck"]')?.textContent).toBe("1");
  });

  it("hands both readers the SAME frame, in the same tick", () => {
    const door = foldDoor();
    mount(door);
    const rows = [
      managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a", kind: "claude" }),
      managedSummary({ runtimeRunId: "run-b", terminalSessionId: "pty-b", kind: "codex" }),
    ];
    act(() => door.frame(rows));
    const fold = seen.fold.at(-1);
    const deck = seen.deck.at(-1);
    expect(fold?.rows).toBe(rows);
    expect([...(fold?.byTerminal.keys() ?? [])]).toEqual(["pty-a", "pty-b"]);
    expect([...(deck?.agents.keys() ?? [])]).toEqual(["pty-a", "pty-b"]);
    expect(deck?.runs.get("pty-a")).toBe("run-a");
  });

  it("holds the deck's facts STILL while the mirror churns, and moves them when a frame's fact does", () => {
    const row = managedSummary({
      runtimeRunId: "run-a",
      terminalSessionId: "pty-a",
      status: "working",
    });
    const door = foldDoor([row]);
    mount(door);
    const first = seen.deck.at(-1);

    // A busier mirror: a new revision, more tokens, a new reply. Nothing a
    // frame draws — so the deck is handed the very same object and React bails
    // out of its subtree rather than re-rendering the panes.
    const busier: AgentSessionSummary = {
      ...row,
      monitor: {
        ...row.monitor,
        schemaVersion: row.monitor?.schemaVersion ?? 3,
        runtimeEpoch: row.monitor?.runtimeEpoch ?? 1,
        runtimeRunId: row.runtimeRunId,
        status: row.monitor?.status ?? "working",
        statusSince: row.monitor?.statusSince ?? row.createdAt,
        blockers: row.monitor?.blockers ?? [],
        alive: row.monitor?.alive ?? true,
        revision: 99,
        usage: { cumulativeTokens: 120_000 },
        lastAssistantMessage: { text: "still going" },
      },
    };
    act(() => door.frame([busier]));
    expect(seen.deck.at(-1)).toBe(first);
    // The fold itself DID move: the monitor draws all of that.
    expect(seen.fold.at(-1)).not.toBe(seen.fold.at(0));

    act(() => door.frame([{ ...row, status: "blocked" }]));
    expect(seen.deck.at(-1)).not.toBe(first);
    expect(seen.deck.at(-1)?.agents.get("pty-a")?.status).toBe("blocked");
  });

  it("carries the daemon's own reason when the subscription fails, and withdraws the rows", () => {
    const door = foldDoor([managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" })]);
    mount(door);
    act(() => door.fail("agent.observe is not in this window's token"));
    const fold = seen.fold.at(-1);
    expect(fold?.state).toBe("unavailable");
    expect(fold?.reason).toBe("agent.observe is not in this window's token");
    expect(fold?.rows).toEqual([]);
    expect(seen.deck.at(-1)?.agents.size).toBe(0);
  });

  it("says nobody was asked when there is no deck yet, and asks nothing while Godview is closed", () => {
    mount(null);
    expect(seen.fold.at(-1)?.state).toBe("no-door");

    act(() => root?.unmount());
    container?.remove();
    const door = foldDoor([managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" })]);
    mount(door, false);
    // PF6: a closed Godview holds no subscription, even with a door in hand.
    expect(door.observe).not.toHaveBeenCalled();
    expect(seen.fold.at(-1)?.state).toBe("no-door");
  });

  it("lets the subscription go with the tree", () => {
    const door = foldDoor();
    mount(door);
    expect(door.disposed()).toBe(0);
    act(() => root?.unmount());
    expect(door.disposed()).toBe(1);
  });
});

describe("the pane join", () => {
  it("takes the floor sessions a pane can actually show, and nothing else", () => {
    const local = managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" });
    const noTerminal = managedSummary({ runtimeRunId: "run-b", terminalSessionId: null });
    const peers: AgentSessionSummary = {
      ...managedSummary({ runtimeRunId: "run-c" }),
      tier: "remote",
      terminal: { hosted: "remote", runtimeSessionId: "peer-pty" },
    };
    const joined = foldByTerminal([local, noTerminal, peers]);
    // A peer's `runtimeSessionId` names a session on ANOTHER floor; the pane in
    // this deck shows a replica with an id of its own (GT-5c).
    expect([...joined.keys()]).toEqual(["pty-a"]);
    expect(joined.get("pty-a")).toBe(local);
  });

  it("prefers the run that has spoken when two rows name one PTY mid-replacement", () => {
    const speaking = managedSummary({ runtimeRunId: "run-new", terminalSessionId: "pty-a" });
    const silent = managedSummary({
      runtimeRunId: "run-old",
      terminalSessionId: "pty-a",
      monitor: false,
    });
    expect(foldByTerminal([speaking, silent]).get("pty-a")).toBe(speaking);
    expect(foldByTerminal([silent, speaking]).get("pty-a")).toBe(speaking);
  });
});
