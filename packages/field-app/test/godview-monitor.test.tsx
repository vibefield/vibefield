// @vitest-environment happy-dom
/**
 * The monitor stage, MOUNTED (GT-3m, re-fed at AR-3).
 *
 * The deck fixture beside this one stubs the bridge, the floor and the GPU
 * because the deck cannot have them here. This one stubs exactly ONE thing —
 * the door — and that is the point of GT-D13: a view is a pure function of its
 * props and the source behind the seam is the deck's door, so the real
 * registry, the real projection, the real classifier and the real matter
 * engine all run against rows shaped exactly as fieldd's fold sends them.
 *
 * What it holds:
 *   1. the stage mounts on the registry's default view with the fold's rows
 *      and the deck's unclaimed pane on it
 *   2. THE CLAIM — the local chip counts managed agents, in the DOM and in the
 *      marker, and nothing on the stage says "mock" any more
 *   3. PF6 — closing disposes: every interval cleared, every engine cleared
 *   4. select MOUNTS through the door; create SPAWNS through the door
 *   5. with no door there are no rows and no invented ones
 */

import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import Matter from "matter-js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { GodviewMonitor } from "../src/godview/GodviewMonitor";
import type { AgentProviderSummary, AgentSessionSummary } from "../src/godview/monitor/facet-types";
import { monitorParameterDefaults } from "../src/godview/monitor/parameters";
import { DEFAULT_MONITOR_VIEW_ID, monitorViewFor } from "../src/godview/monitor/registry";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import type { MonitorPaneFacts } from "../src/godview/monitor/useMonitorAgents";
import { managedSummary } from "./managed-session-fixture";
import { useInlineSwarmPhysics } from "./swarm-physics-inline";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// GT-3c: happy-dom has no `Worker`, so the swarm is told to simulate in-thread.
// It is the same engine either way, which is what keeps the disposal assertion
// below meaningful — `Matter.Engine.clear` is still a real call on a real world.
useInlineSwarmPhysics();

/** DESIGN.md §2.6 and §2.5, stamped onto the document — because the palette is
 * supposed to READ them, and a test with no tokens would prove only that the
 * fallbacks work. */
const TOKENS: Record<string, string> = {
  "--vf-accent-1": "#6366f1",
  "--vf-accent-2": "#ec4899",
  "--vf-accent-3": "#22c55e",
  "--vf-accent-4": "#f59e0b",
  "--vf-accent-5": "#06b6d4",
  "--vf-accent-6": "#8b5cf6",
  "--vf-accent-7": "#ef4444",
  "--vf-accent-8": "#3b82f6",
  "--vf-green": "#30d158",
  "--vf-orange": "#ff9f0a",
  "--vf-card-deep": "#000000",
};

/** Three managed rows, as the fold sends them, and one pane no agent claims. */
const ROWS: readonly AgentSessionSummary[] = [
  managedSummary({
    runtimeRunId: "run-claude",
    kind: "claude",
    label: "Claude",
    status: "working",
    cwd: "/project/vibe-field",
    createdAt: "2026-09-12T10:00:00.000Z",
  }),
  managedSummary({
    runtimeRunId: "run-codex",
    kind: "codex",
    label: "Codex",
    status: "blocked",
    blocker: { kind: "permission", tool: "Bash" },
    cwd: "/project/voyager",
    createdAt: "2026-09-12T10:00:01.000Z",
  }),
  managedSummary({
    runtimeRunId: "run-grok",
    kind: "grok",
    label: "Grok",
    status: "idle",
    cwd: "/project/jabali",
    createdAt: "2026-09-12T10:00:02.000Z",
  }),
];
const PROVIDERS: readonly AgentProviderSummary[] = [
  { id: "claude", label: "Claude", available: true, resumable: true, personas: [] },
  { id: "pi", label: "Pi", available: false, resumable: true, personas: [] },
];
const pane = (id: string, cwd = "/project/scratch"): SessionSummary =>
  ({ id, exited: false, createdAtMs: 5, cwd, title: "zsh" }) as SessionSummary;
/** The deck's panes: the codex agent's PTY, and one unclaimed shell. */
const PANES: MonitorPaneFacts = {
  sessionIds: ["run-codex-pty", "pane-1"],
  activeSessionId: "pane-1",
  sessions: [pane("run-codex-pty", "/project/voyager"), pane("pane-1")],
};

interface FakeDoor extends MonitorDoor {
  mountLocal: ReturnType<typeof vi.fn>;
  spawn: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
}

function fakeDoor(rows: readonly AgentSessionSummary[] = ROWS): FakeDoor {
  return {
    listHosts: vi.fn(async () => []),
    attach: vi.fn(async () => ({ state: "attached" as const, sessionId: "r", readWrite: true })),
    observe: vi.fn(({ onFrame }) => {
      onFrame(rows);
      return () => undefined;
    }),
    providers: vi.fn(async () => PROVIDERS),
    spawn: vi.fn(async () => ({
      state: "spawned" as const,
      sessionId: "born-1",
      runtimeRunId: "run-born",
      label: "Claude",
    })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;
let markers: GodviewMonitorFacts[] = [];

/** Every interval this stage opened, and every one it closed. The PF6 claim is
 * literally the difference between these two sets. */
let openedIntervals: number[] = [];
let clearedIntervals: number[] = [];
let clearedEngines = 0;

beforeEach(() => {
  markers = [];
  openedIntervals = [];
  clearedIntervals = [];
  clearedEngines = 0;
  localStorage.clear();
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("GODVIEW_MONITOR ")) {
      markers.push(JSON.parse(line.slice("GODVIEW_MONITOR ".length)) as GodviewMonitorFacts);
    }
  });
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
  const realEngineClear = Matter.Engine.clear;
  vi.spyOn(Matter.Engine, "clear").mockImplementation((engine) => {
    clearedEngines += 1;
    return realEngineClear(engine);
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
  viewId: string = DEFAULT_MONITOR_VIEW_ID,
  door: MonitorDoor | null = fakeDoor(),
  panes: MonitorPaneFacts = PANES,
): Promise<HTMLElement> {
  const view = monitorViewFor(viewId);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewMonitor
        view={view}
        parameters={monitorParameterDefaults(view.parameterGroups)}
        door={door}
        panes={panes}
      />,
    );
  });
  return container;
}

const latest = (): GodviewMonitorFacts => markers[markers.length - 1] as GodviewMonitorFacts;
const ackText = (host: HTMLElement): string =>
  host.querySelector(".vf-monitor-ack")?.textContent ?? "";

describe("the monitor stage", () => {
  it("mounts on the registry's default view with the fold's rows and the deck's pane on it", async () => {
    const host = await mountMonitor();
    expect(latest().viewId).toBe("swarm");
    // Three managed agents plus the unclaimed pane — and the marker separates
    // them, because "rows" and "agents" are different claims.
    expect(latest().agents).toBe(4);
    expect(latest().agentBacked).toBe(3);
    expect(latest().localAgents).toBe(3);
    expect(latest().terminals).toBe(1);
    expect(latest().localState).toBe("live");
    expect(host.querySelectorAll(".vf-monitor-bubble").length).toBe(4);
  });

  it("WEARS THE CLAIM — the count of managed agents, in the DOM and in the marker; nothing says mock", async () => {
    // GT-D13's law was that invented rows say so. There are none: the chip now
    // counts what fieldd reports, and the word that used to disclose the mock
    // must be gone from the stage entirely — its presence would mean the
    // invented field is back.
    const host = await mountMonitor();
    const chip = host.querySelector(".vf-monitor-local-chip");
    expect(chip?.textContent).toBe("3 managed agents");
    expect(latest().localClaim).toBe("3 managed agents");
    expect(chip?.closest("[data-monitor-chrome]")).not.toBeNull();
    expect(host.textContent?.toLowerCase()).not.toContain("mock");
    expect(JSON.stringify(latest()).toLowerCase()).not.toContain("mock");
  });

  it("reads its colors from the live tokens rather than from a transcription", async () => {
    const host = await mountMonitor();
    const colors = new Set(
      [...host.querySelectorAll<HTMLElement>(".vf-monitor-bubble")].map((bubble) =>
        bubble.style.getPropertyValue("--agent-color"),
      ),
    );
    // Every color on the stage is one of §2.6's eight, and more than one is in
    // use — a single value would mean the accents never resolved.
    for (const color of colors) expect(Object.values(TOKENS)).toContain(color);
    expect(colors.size).toBeGreaterThan(1);
  });

  it("renders every view in the registry against the same field", async () => {
    // The contract's real claim: a view is a pure function of its props, so
    // swapping one changes what is drawn and nothing else.
    for (const [viewId, selector] of [
      ["list", ".vf-monitor-list-row"],
      ["rain", ".vf-monitor-rain-agents button"],
    ] as const) {
      const host = await mountMonitor(viewId);
      expect(latest().viewId).toBe(viewId);
      expect(host.querySelectorAll(selector).length).toBe(4);
      act(() => root?.unmount());
      container?.remove();
      root = null;
    }
  });

  it("PF6: closing disposes — every timer cleared, every engine cleared", async () => {
    await mountMonitor();
    expect(openedIntervals.length, "the mesh poll never started").toBeGreaterThan(0);
    expect(clearedIntervals).not.toEqual(expect.arrayContaining(openedIntervals));

    act(() => root?.unmount());
    root = null;

    // The whole PF6 claim for this stage, and it is stronger than the deck's:
    // the deck stays mounted and SILENCED, this is gone. Nothing is left
    // ticking, and matter's engine was torn down rather than left idling.
    for (const id of openedIntervals) {
      expect(clearedIntervals, `interval ${id} survived the close`).toContain(id);
    }
    expect(clearedEngines, "the physics engine was never cleared").toBeGreaterThan(0);
  });

  it("select MOUNTS a managed agent's PTY through the door, and says so (AR-3)", async () => {
    const door = fakeDoor();
    const host = await mountMonitor("list", door);
    // the claude row: an agent whose PTY no pane is showing yet
    const row = [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].find(
      (candidate) => candidate.textContent?.includes("vibe-field"),
    );
    expect(row).toBeDefined();

    await act(async () => row?.click());

    expect(door.mountLocal).toHaveBeenCalledTimes(1);
    expect(door.mountLocal.mock.calls[0]?.[0]).toBe("run-claude-pty");
    expect(door.attach).not.toHaveBeenCalled();
    expect(ackText(host)).toContain("mounted in the active pane");
  });

  it("AR-4: a row that names a replaced PTY the deck is showing hands that pane the new one through the door, once", async () => {
    // the codex run was resumed into a new PTY while the deck's pane still
    // shows the old one (`run-codex-pty`, in PANES): the monitor asks the
    // door to put the new PTY in that pane — with `replacing`, so the deck
    // targets the pane rather than the active one — and only once
    const door = fakeDoor([
      managedSummary({
        runtimeRunId: "run-codex",
        terminalSessionId: "run-codex-pty-2",
        replaced: "run-codex-pty",
        cwd: "/project/voyager",
      }),
    ]);
    const host = await mountMonitor("list", door);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(door.mountLocal).toHaveBeenCalledTimes(1);
    expect(door.mountLocal.mock.calls[0]).toEqual([
      "run-codex-pty-2",
      { replacing: "run-codex-pty" },
    ]);
    expect(ackText(host)).toContain("resumed in its pane");
  });

  it("an agent already in the active pane is acknowledged, not re-mounted", async () => {
    const door = fakeDoor();
    const host = await mountMonitor("list", door, { ...PANES, activeSessionId: "run-codex-pty" });
    const row = [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].find(
      (candidate) => candidate.textContent?.includes("voyager"),
    );
    await act(async () => row?.click());
    expect(door.mountLocal).not.toHaveBeenCalled();
    expect(ackText(host)).toContain("is in the active pane");
  });

  it("create SPAWNS the chosen provider through the door — from a view's gesture and from the chrome", async () => {
    const door = fakeDoor();
    const host = await mountMonitor("list", door);
    // the chrome chose the first AVAILABLE provider
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Agent provider"]');
    expect(select?.value).toBe("claude");
    expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual([
      "Claude",
      "Pi (not installed)",
    ]);

    const create = host.querySelector<HTMLButtonElement>(".vf-monitor-list-new");
    await act(async () => create?.click());
    expect(door.spawn).toHaveBeenCalledTimes(1);
    expect(door.spawn.mock.calls[0]?.[0]).toEqual({ provider: "claude" });
    expect(ackText(host)).toContain("Claude spawned in the active pane");

    const button = host.querySelector<HTMLButtonElement>(".vf-godview-spawn");
    await act(async () => button?.click());
    expect(door.spawn).toHaveBeenCalledTimes(2);
  });

  it("refuses to spawn a provider that is not installed, and says so before asking the door", async () => {
    const door = fakeDoor();
    const host = await mountMonitor("list", door);
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Agent provider"]');
    await act(async () => {
      if (select) {
        select.value = "pi";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-godview-spawn")?.click());
    expect(door.spawn).not.toHaveBeenCalled();
    expect(ackText(host)).toContain("not installed");
  });

  it("carries the deck's own words when a spawn cannot land", async () => {
    const door = fakeDoor();
    door.spawn.mockResolvedValueOnce({ state: "failed", reason: "the floor has no agent cell" });
    const host = await mountMonitor("list", door);
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    expect(ackText(host)).toContain("the floor has no agent cell");
    door.spawn.mockResolvedValueOnce({ state: "no-pane" });
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    expect(ackText(host)).toContain("no pane");
  });

  it("with NO door: no rows, no invented ones, the state says nobody was asked, and spawn is disabled", async () => {
    const host = await mountMonitor(DEFAULT_MONITOR_VIEW_ID, null, { sessionIds: [] });
    expect(host.querySelectorAll(".vf-monitor-bubble").length).toBe(0);
    expect(latest().agents).toBe(0);
    expect(latest().localState).toBe("no-door");
    expect(latest().localClaim).toBeNull();
    expect(host.querySelector(".vf-monitor-local-chip")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".vf-godview-spawn")?.disabled).toBe(true);
  });
});
