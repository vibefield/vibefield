// @vitest-environment happy-dom
/**
 * THE MESH HALF, MOUNTED (GT-D17's door; DS-3's board since 2026-09-30).
 *
 * The stage fixture beside this one (`godview-monitor.test.tsx`) proves the
 * local half: the fold's rows appear, select mounts, create spawns. This one
 * holds the OTHER desktops' half beside it — the mesh board, read through a
 * fake door standing in for the deck's fieldd client, because that client
 * needs a daemon and this claim does not: what is under test is the
 * projection, the routing and the device filter, which are ours.
 *
 * What it holds:
 *   1. another desktop's agents become rows, beside the local ones, attributed
 *   2. the claim chip reads the desktop's NAME (DS §11's witness)
 *   3. a frame moves a row; a gap re-subscribes; an asleep desktop's rows stay
 *   4. selecting another desktop's run says what this desktop cannot do yet
 *      (DS-4) and asks the door for nothing; a local row still mounts
 *   5. the device filter: a dropdown that narrows the rows handed to the view
 *   6. no door ⇒ no rows; a board that cannot be read ⇒ local rows still, the
 *      reason on screen; PF6: the board is closed with the stage
 *
 * The rows are read off the LIST view (the swarm paints on WebGPU, which
 * happy-dom does not have); the routing is view-independent.
 */

import {
  type AccountUsagePort,
  type HistoryPort,
  monitorParameterDefaults,
  monitorViewFor,
} from "@vibecook/puppeteer-views";
import type {
  AgentFieldRow,
  AgentMeshFrame,
  AgentMeshOpen,
  DeviceInfo,
} from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { GodviewMonitor } from "../src/godview/GodviewMonitor";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import type { MeshBoardListener, MonitorDoor } from "../src/godview/monitor/remote-door";
import type { MonitorPaneFacts } from "../src/godview/monitor/useMonitorAgents";
import { managedSummary } from "./managed-session-fixture";
import { useInlineSwarmPhysics } from "./swarm-physics-inline";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

useInlineSwarmPhysics();

const ROW_VIEW = "list";

const TOKENS: Record<string, string> = {
  "--tint-l": "0.6",
  "--tint-c": "0.15",
  "--text-faint": "rgba(0, 0, 0, 0.35)",
  "--vf-green": "#30d158",
  "--vf-orange": "#ff9f0a",
  "--vf-card-deep": "#000000",
};

const HERE = "dev-here";
const STUDIO = "dev-studio";
const AT = "2026-09-30T21:00:00.000Z";

/** The two managed rows the fold puts on the stage in every row below. */
const LOCAL_ROWS: readonly AgentSessionSummary[] = [
  managedSummary({ runtimeRunId: "run-a", kind: "claude", label: "Claude", status: "working" }),
  managedSummary({ runtimeRunId: "run-b", kind: "codex", label: "Codex", status: "idle" }),
];

function deskRow(
  runtimeRunId: string,
  overrides: Partial<AgentFieldRow> & Record<string, unknown> = {},
): AgentFieldRow {
  return {
    runtimeRunId,
    revision: 1,
    kind: "agent-a",
    label: "Agent A",
    tier: "managed",
    device: STUDIO,
    status: "working",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    project: { name: "rosetta" },
    ...overrides,
  } as AgentFieldRow;
}

const ROSTER: DeviceInfo[] = [
  { deviceId: HERE, name: "pro", platform: "darwin", self: true, online: true, lastSeenAt: 0 },
  { deviceId: STUDIO, name: "studio", platform: "linux", self: false, online: true, lastSeenAt: 0 },
];

function board(rows: AgentFieldRow[] = [deskRow("run-s1"), deskRow("run-s2")]): AgentMeshOpen {
  return {
    devices: [
      {
        device: HERE,
        state: "live",
        asOf: AT,
        snapshot: { epoch: "here.1", revision: 1, rows: [] },
      },
      {
        device: STUDIO,
        state: "live",
        asOf: AT,
        snapshot: { epoch: "studio.1", revision: 5, rows },
      },
    ],
  };
}

const CHECKED_AT = "2026-09-13T00:00:00.000Z";

function unreachableHistory(): HistoryPort {
  const status = { reachable: false, detail: "no index in this fixture", checkedAt: CHECKED_AT };
  return {
    status: async () => status,
    facts: async () => [],
    search: async () => ({ status, answered: false, hits: [], clipped: false }),
  };
}

function emptyUsage(): AccountUsagePort {
  return {
    snapshot: async () => ({ refreshedAt: CHECKED_AT, entries: [] }),
    subscribe: () => () => undefined,
  };
}

interface FakeDoor extends MonitorDoor {
  attach: ReturnType<typeof vi.fn>;
  mountLocal: ReturnType<typeof vi.fn>;
  createTerminal: ReturnType<typeof vi.fn>;
  /** push a per-device frame to the newest board listener */
  push(frame: AgentMeshFrame): void;
  /** how many boards were opened, and closed */
  opened(): number;
  closed(): number;
}

function fakeDoor(open: AgentMeshOpen | Error = board(), rows = LOCAL_ROWS): FakeDoor {
  let listener: MeshBoardListener | null = null;
  let opened = 0;
  let closed = 0;
  return {
    observeMesh: (next) => {
      opened += 1;
      listener = next;
      if (open instanceof Error) next.onError(open.message);
      else next.onOpen(open);
      return () => {
        closed += 1;
        if (listener === next) listener = null;
      };
    },
    devices: {
      subscribe: (deliver) => {
        deliver(ROSTER);
        return () => undefined;
      },
    },
    attach: vi.fn(async () => ({ state: "no-pane" as const })),
    observe: vi.fn(({ onFrame }) => {
      onFrame(rows);
      return () => undefined;
    }),
    createTerminal: vi.fn(async () => ({ state: "no-pane" as const })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    history: unreachableHistory(),
    usage: emptyUsage(),
    push: (frame) => listener?.onFrame(frame),
    opened: () => opened,
    closed: () => closed,
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;
let markers: GodviewMonitorFacts[] = [];

beforeEach(() => {
  markers = [];
  localStorage.clear();
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("GODVIEW_MONITOR ")) {
      markers.push(JSON.parse(line.slice("GODVIEW_MONITOR ".length)) as GodviewMonitorFacts);
    }
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  vi.restoreAllMocks();
});

async function mountMonitor(
  door: MonitorDoor | null,
  panes: MonitorPaneFacts = { sessionIds: [] },
): Promise<HTMLElement> {
  const view = monitorViewFor(ROW_VIEW);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <GodviewMonitor
          view={view}
          parameters={monitorParameterDefaults(view.parameterGroups)}
          door={door}
          panes={panes}
        />
      </GodviewAgentsProvider>,
    );
  });
  return container;
}

const latest = (): GodviewMonitorFacts => markers[markers.length - 1] as GodviewMonitorFacts;
const rows = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row"),
];
const remoteRows = (host: HTMLElement): HTMLButtonElement[] =>
  rows(host).filter((row) => row.classList.contains("is-remote"));
const localRows = (host: HTMLElement): HTMLButtonElement[] =>
  rows(host).filter((row) => !row.classList.contains("is-remote"));
const ackText = (host: HTMLElement): string =>
  host.querySelector(".vf-monitor-ack")?.textContent ?? "";

describe("another desktop's agents as monitor citizens (DS-3)", () => {
  it("puts them on the stage beside the local ones", async () => {
    const view = await mountMonitor(fakeDoor());
    expect(rows(view)).toHaveLength(LOCAL_ROWS.length + 2);
    expect(remoteRows(view)).toHaveLength(2);
    expect(latest().localAgents).toBe(LOCAL_ROWS.length);
    expect(latest().remoteSessions).toBe(2);
    expect(latest().remoteHosts).toBe(1);
    expect(latest().remoteState).toBe("serving");
  });

  it("keeps each row attributed to the desktop it lives on", async () => {
    const view = await mountMonitor(fakeDoor());
    const [first] = remoteRows(view);
    // the views name the desktop first for a screen reader…
    expect(first?.getAttribute("aria-label")).toMatch(/^on studio, rosetta/);
    // …and the detail line leads with it until the views draw its mark (pu-device)
    expect(first?.querySelector(".vf-monitor-list-detail")?.textContent).toBe("studio · working");
    for (const local of localRows(view)) {
      expect(local.getAttribute("aria-label")).not.toContain("studio");
    }
  });

  it("the claim chip reads the desktop's NAME — never 'mesh unavailable'", async () => {
    const view = await mountMonitor(fakeDoor());
    expect(view.querySelector(".vf-monitor-local-chip")?.textContent).toBe("2 managed agents");
    expect(view.querySelector(".vf-monitor-remote-chip")?.textContent).toBe("2 agents on studio");
    expect(view.querySelector(".vf-monitor-remote-chip .vf-os-mark")?.getAttribute("data-os")).toBe(
      "linux",
    );
    expect(view.querySelector(".vf-monitor-remote-unavailable-chip")).toBeNull();
  });

  it("a desktop alone: only the local claim, and no device chip (one desktop is no choice)", async () => {
    const view = await mountMonitor(
      fakeDoor({ devices: [{ device: HERE, state: "live", asOf: AT }] }),
    );
    expect(view.querySelector(".vf-monitor-local-chip")?.textContent).toBe("2 managed agents");
    expect(view.querySelector(".vf-monitor-remote-chip")).toBeNull();
    expect(view.querySelector(".vf-device-filter")).toBeNull();
    expect(latest().remoteState).toBe("serving");
  });

  it("a frame moves its row: the owner's delta, applied on its chain", async () => {
    const door = fakeDoor();
    const view = await mountMonitor(door);
    await act(async () => {
      door.push({
        device: STUDIO,
        delta: {
          epoch: "studio.1",
          since: 5,
          revision: 6,
          upserts: [
            deskRow("run-s1", {
              status: "blocked",
              blockers: [{ id: "q", kind: "question", since: AT, question: "Keep it greyed?" }],
            }),
          ],
          removed: ["run-s2"],
        },
      });
    });
    expect(remoteRows(view)).toHaveLength(1);
    expect(remoteRows(view)[0]?.classList.contains("is-blocked")).toBe(true);
    expect(remoteRows(view)[0]?.querySelector(".vf-monitor-list-detail")?.textContent).toBe(
      "studio · Keep it greyed?",
    );
  });

  it("a gap in the owner's chain re-subscribes, and the fresh board replaces the copy", async () => {
    const door = fakeDoor();
    await mountMonitor(door);
    expect(door.opened()).toBe(1);
    await act(async () => {
      door.push({
        device: STUDIO,
        delta: { epoch: "studio.1", since: 9, revision: 10, upserts: [], removed: [] },
      });
    });
    expect(door.closed()).toBe(1);
    expect(door.opened()).toBe(2);
  });

  it("an asleep desktop keeps its rows, greyed — asleep is a state, not an absence", async () => {
    const door = fakeDoor();
    const view = await mountMonitor(door);
    await act(async () => {
      door.push({ device: STUDIO, state: "asleep", asOf: "2026-09-30T21:10:00.000Z" });
    });
    expect(remoteRows(view)).toHaveLength(2);
    expect(remoteRows(view).every((row) => row.classList.contains("is-stale"))).toBe(true);
  });
});

describe("select routes by source", () => {
  it("another desktop's run says what this desktop cannot do yet, and asks the door nothing", async () => {
    const door = fakeDoor();
    const view = await mountMonitor(door);
    await act(async () => remoteRows(view)[0]?.click());
    expect(door.attach).not.toHaveBeenCalled();
    expect(door.mountLocal).not.toHaveBeenCalled();
    expect(ackText(view)).toBe(
      "rosetta runs on studio — its terminal cannot be opened from here yet",
    );
  });

  it("a LOCAL row asks the door to MOUNT its PTY — never to attach (the split-routing test)", async () => {
    const door = fakeDoor();
    const view = await mountMonitor(door);
    await act(async () => localRows(view)[0]?.click());
    expect(door.attach).not.toHaveBeenCalled();
    expect(door.mountLocal).toHaveBeenCalledTimes(1);
    expect(["run-a-pty", "run-b-pty"]).toContain(door.mountLocal.mock.calls[0]?.[0]);
    expect(ackText(view)).toContain("mounted in the active pane");
  });
});

describe("the device filter — one dropdown, before the profile tabs", () => {
  it("offers every desktop as its mark and its name, here first, all by default", async () => {
    const view = await mountMonitor(fakeDoor());
    const chip = view.querySelector<HTMLButtonElement>(".vf-device-filter-chip");
    expect(chip?.textContent).toBe("All desktops");
    expect(chip?.getAttribute("aria-haspopup")).toBe("listbox");
    await act(async () => chip?.click());
    const options = [...view.querySelectorAll<HTMLButtonElement>(".vf-device-filter-row")];
    expect(options.map((option) => option.getAttribute("data-device"))).toEqual(["", HERE, STUDIO]);
    expect(options[1]?.textContent).toContain("here");
    expect(options[2]?.querySelector(".vf-os-mark")?.getAttribute("data-os")).toBe("linux");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("narrows the rows handed to the view, and widens back to all", async () => {
    const view = await mountMonitor(fakeDoor());
    const chip = (): HTMLButtonElement | null =>
      view.querySelector<HTMLButtonElement>(".vf-device-filter-chip");
    await act(async () => chip()?.click());
    await act(async () =>
      view
        .querySelector<HTMLButtonElement>(`.vf-device-filter-row[data-device="${STUDIO}"]`)
        ?.click(),
    );
    expect(rows(view)).toHaveLength(2);
    expect(remoteRows(view)).toHaveLength(2);
    expect(chip()?.textContent).toBe("studio");
    expect(view.querySelector(".vf-device-filter-menu")).toBeNull();
    expect(latest().shownAgents).toBe(2);

    await act(async () => chip()?.click());
    await act(async () =>
      view
        .querySelector<HTMLButtonElement>(`.vf-device-filter-row[data-device="${HERE}"]`)
        ?.click(),
    );
    expect(rows(view)).toHaveLength(LOCAL_ROWS.length);
    expect(remoteRows(view)).toHaveLength(0);

    await act(async () => chip()?.click());
    await act(async () =>
      view.querySelector<HTMLButtonElement>('.vf-device-filter-row[data-device=""]')?.click(),
    );
    expect(rows(view)).toHaveLength(LOCAL_ROWS.length + 2);
  });

  it("closes on Escape and hands the focus back to the chip", async () => {
    const view = await mountMonitor(fakeDoor());
    const chip = view.querySelector<HTMLButtonElement>(".vf-device-filter-chip");
    await act(async () => chip?.click());
    const menu = view.querySelector<HTMLElement>(".vf-device-filter-menu");
    expect(document.activeElement?.getAttribute("data-device")).toBe("");
    await act(async () => {
      menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement?.getAttribute("data-device")).toBe(HERE);
    await act(async () => {
      menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(view.querySelector(".vf-device-filter-menu")).toBeNull();
    expect(document.activeElement).toBe(chip);
  });
});

describe("the board without a floor", () => {
  it("with NO door: no rows at all, and both states say nobody was asked", async () => {
    const view = await mountMonitor(null);
    expect(rows(view)).toHaveLength(0);
    expect(latest().remoteState).toBe("no-door");
    expect(latest().localState).toBe("no-door");
  });

  it("a board that cannot be read: the local rows stand, no invented desktops, the reason ON SCREEN", async () => {
    const view = await mountMonitor(fakeDoor(new Error("FORBIDDEN_SCOPE: requires agent.observe")));
    expect(remoteRows(view)).toHaveLength(0);
    expect(localRows(view)).toHaveLength(LOCAL_ROWS.length);
    expect(latest().remoteState).toBe("unavailable");
    expect(view.querySelector(".vf-monitor-remote-unavailable-chip")?.textContent).toBe(
      "mesh unavailable · FORBIDDEN_SCOPE: requires agent.observe",
    );
  });

  it("PF6: the board is closed with the stage", async () => {
    const door = fakeDoor();
    await mountMonitor(door);
    expect(door.opened()).toBe(1);
    act(() => root?.unmount());
    root = null;
    expect(door.closed()).toBe(1);
  });
});
