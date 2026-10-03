// @vitest-environment happy-dom
/**
 * TL (TL-D8) — what the stage hands a view about the PAST: fieldd's status
 * ledger (`agent.history`) laid under what the window watched, the runs that
 * ended inside the day named from their fold rows, and the ended lanes
 * narrowed the way the live rows are. A probe view records the props; the
 * timeline itself is puppeteer's and is tested there.
 */
import type {
  AccountUsagePort,
  AgentMonitorProps,
  AgentMonitorView,
  HistoryPort,
} from "@vibecook/puppeteer-views";
import { createInlineSwarmPhysicsDriver } from "@vibecook/puppeteer-views/physics";
import type { AgentRunHistory } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodviewMonitor } from "../src/godview/GodviewMonitor";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import type { MonitorDoor, StatusHistoryPort } from "../src/godview/monitor/remote-door";
import { setSwarmPhysicsDriverFactory } from "../src/godview/views/swarm/swarm-physics-driver";
import { managedSummary } from "./managed-session-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The afternoon is relative to when the suite runs: the ledger keeps a day
// (STATUS_HISTORY_HORIZON_MS) measured from the wall clock, so fixed dates
// expired 24 h after this file was written and the seeded record was trimmed.
const NOW = Date.now();
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();
const CREATED = ago(60);
const ROWS: readonly AgentSessionSummary[] = [
  managedSummary({ runtimeRunId: "run-live", status: "working", createdAt: CREATED }),
  // ended while Godview was closed: the fold still lists it, the stage draws it nowhere live
  managedSummary({ runtimeRunId: "run-gone", status: "idle", alive: false, createdAt: CREATED }),
];

const RECORD: readonly AgentRunHistory[] = [
  {
    runtimeRunId: "run-live",
    recordedFrom: ago(120),
    changes: [
      { status: "unknown", at: ago(120) },
      { status: "blocked", at: ago(110), blocker: { kind: "permission" } },
      { status: "working", at: CREATED, did: "Run pnpm verify" },
    ],
  },
  {
    runtimeRunId: "run-gone",
    recordedFrom: ago(90),
    changes: [{ status: "working", at: ago(90) }],
    exitedAt: ago(70),
  },
];

const nothing: HistoryPort = {
  status: async () => ({ reachable: false, detail: "none", checkedAt: CREATED }),
  facts: async () => [],
  search: async () => ({
    status: { reachable: false, detail: "none", checkedAt: CREATED },
    answered: false,
    hits: [],
    clipped: false,
  }),
};
const noUsage: AccountUsagePort = {
  snapshot: async () => ({ refreshedAt: CREATED, entries: [] }),
  subscribe: () => () => undefined,
};

function door(
  statusHistory?: StatusHistoryPort,
  rows: readonly AgentSessionSummary[] = ROWS,
): MonitorDoor {
  return {
    observeMesh: ({ onOpen }) => {
      onOpen({ devices: [] } as never);
      return () => undefined;
    },
    attach: async () => ({ state: "attached" as const, sessionId: "r", readWrite: true }),
    observe: ({ onFrame }) => {
      onFrame(rows);
      return () => undefined;
    },
    createTerminal: async () => ({ state: "mounted" as const, sessionId: "born-1" }),
    mountLocal: async (sessionId: string) => ({ state: "mounted" as const, sessionId }),
    history: nothing,
    usage: noUsage,
    ...(statusHistory ? { statusHistory } : {}),
  };
}

let seen: AgentMonitorProps | undefined;
const PROBE: AgentMonitorView = {
  id: "probe",
  label: "PROBE",
  parameterGroups: [],
  Component: (props) => {
    seen = props;
    return null;
  },
};

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  seen = undefined;
  setSwarmPhysicsDriverFactory((options) => createInlineSwarmPhysicsDriver(options));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  setSwarmPhysicsDriverFactory(undefined);
  vi.restoreAllMocks();
});

async function mount(monitorDoor: MonitorDoor): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={monitorDoor}>
        <GodviewMonitor
          view={PROBE}
          parameters={{}}
          door={monitorDoor}
          panes={{ sessionIds: [] }}
        />
      </GodviewAgentsProvider>,
    );
  });
  // the ledger's answer lands after the first frame
  await act(async () => {
    await Promise.resolve();
  });
}

const spans = (id: string) =>
  seen?.history?.lanes
    .get(id)
    ?.spans.map((span) => [span.status, new Date(span.fromMs).toISOString()]);

describe("TL — the record a view is handed", () => {
  it("lays fieldd's ledger under what the window watched, asked once the fold is live", async () => {
    const load = vi.fn(async () => RECORD);
    await mount(door({ load }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith();
    // the leading unknown is unrecorded time, never a state
    expect(spans("run-live")).toEqual([
      ["blocked", ago(110)],
      ["working", CREATED],
    ]);
    expect(seen?.history?.lanes.get("run-live")?.spans[1]?.did).toBe("Run pnpm verify");
  });

  it("keeps a run that ended inside the day as an ended lane, named from its fold row", async () => {
    await mount(door({ load: async () => RECORD }));
    expect(seen?.agents.map((agent) => agent.id)).toEqual(["run-live"]);
    expect(seen?.history?.ended.map((agent) => agent.id)).toEqual(["run-gone"]);
    expect(seen?.history?.lanes.get("run-gone")).toMatchObject({
      endedAtMs: Date.parse(ago(70)),
    });
  });

  it("a local run's cost reaches the view (the projection used to drop it)", async () => {
    const live = managedSummary({
      runtimeRunId: "run-live",
      status: "working",
      createdAt: CREATED,
    });
    const now = Date.now();
    const bucket = (agoMs: number, costUsd: number) => ({
      at: new Date(Math.floor((now - agoMs) / 30_000) * 30_000).toISOString(),
      costUsd,
    });
    const priced = {
      ...live,
      monitor: {
        ...live.monitor,
        usage: {
          costUsd: 2.5,
          costCoverage: "partial",
          costHistory: [bucket(60_000, 0.2), bucket(0, 0.3), { at: 7, costUsd: 1 }],
        },
      },
    } as AgentSessionSummary;
    await mount(door(undefined, [priced]));
    const usage = seen?.agents.find((agent) => agent.id === "run-live")?.agent?.usage;
    expect(usage?.total).toBe(2.5);
    expect(usage?.coverage).toBe("partial");
    // the malformed bucket is dropped; the two that stand are in the ledger's steps
    expect(usage?.steps.reduce((sum, step) => sum + step, 0)).toBeCloseTo(0.5);
  });

  it("without the door (or refused), records from where Core says the current state began", async () => {
    await mount(door({ load: async () => Promise.reject(new Error("METHOD_NOT_FOUND")) }));
    expect(spans("run-live")).toEqual([["working", CREATED]]);
    expect(seen?.history?.ended).toEqual([]);
    seen = undefined;
    act(() => root?.unmount());
    await mount(door());
    expect(spans("run-live")).toEqual([["working", CREATED]]);
  });
});
