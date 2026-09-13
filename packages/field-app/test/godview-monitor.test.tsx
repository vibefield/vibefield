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
 *   3. PF6 — closing disposes: every interval cleared, the physics disposed
 *   4. select MOUNTS through the door; create SPAWNS through the door
 *   5. with no door there are no rows and no invented ones
 *
 * AR-5 moved the views into `@vibecook/puppeteer-views`, and two things about
 * this fixture follow from that. The swarm PAINTS ON WEBGPU now, which happy-dom
 * does not have, so it draws its honest unavailable notice and its keyboard list
 * instead of DOM bubbles — the rows are still there to assert on, in
 * `.vf-monitor-swarm-list`, and anything that needs laid-out rows uses the list
 * view. And the physics engine belongs to the package, which resolves its own
 * matter-js copy, so the disposal claim below is made at the DRIVER — the seam
 * the stage actually owns — rather than by spying on an engine in this
 * workspace's copy that the package would never have called.
 */

import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  type AccountUsagePort,
  DEFAULT_MONITOR_VIEW_ID,
  type HistoryPort,
  monitorParameterDefaults,
  monitorViewFor,
} from "@vibecook/puppeteer-views";
import {
  createInlineSwarmPhysicsDriver,
  type SwarmPhysicsDriver,
} from "@vibecook/puppeteer-views/physics";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { GodviewMonitor } from "../src/godview/GodviewMonitor";
import type { AgentProviderSummary, AgentSessionSummary } from "../src/godview/monitor/facet-types";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import type { MonitorPaneFacts } from "../src/godview/monitor/useMonitorAgents";
import { setSwarmPhysicsDriverFactory } from "../src/godview/views/swarm/swarm-physics-driver";
import { managedSummary } from "./managed-session-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * §2.5 and record §02's tint, stamped onto the document — because the palette is
 * supposed to READ them, and a test with no tokens would prove only that the
 * fallbacks work.
 *
 * The tint pair is the load-bearing half. A project's colour is no longer one of
 * §2.6's eight accents: main deals the project a sequence, and `--tint-l` /
 * `--tint-c` (godview.css's light theme) are the lightness and chroma every hue
 * is drawn at, so nothing is louder than anything else. The palette's fallback
 * for both is 0, which is black — deliberately, obviously wrong — so a fixture
 * that forgot them would read every project as the same colour.
 */
const TOKENS: Record<string, string> = {
  "--tint-l": "0.6",
  "--tint-c": "0.15",
  "--text-faint": "rgba(0, 0, 0, 0.35)",
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

const CHECKED_AT = "2026-09-13T00:00:00.000Z";

/**
 * The two ports AR-5 added to the door, as honest fakes.
 *
 * The find sheet and the usage column are the PACKAGE's, and they are tested
 * there. What this fixture owes them is a port that answers without inventing:
 * an index nobody can reach (`reachable: false`, and a search that says it was
 * not answered rather than that there were no matches) and a usage feed that
 * has nothing in it yet. The adapters that build the real ones over fieldd have
 * their own fixture (`godview-monitor-doors.test.ts`).
 */
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
  mountLocal: ReturnType<typeof vi.fn>;
  spawn: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
  /** Send the subscriber another frame. The fold pushes whole fields at its own
   * cadence and re-sends them for reasons that are none of the stage's
   * business, so a test that only ever delivers one frame cannot see what the
   * stage does with the second — which is where the once-guards live. */
  push(rows: readonly AgentSessionSummary[]): void;
}

function fakeDoor(rows: readonly AgentSessionSummary[] = ROWS): FakeDoor {
  let publish: ((rows: readonly AgentSessionSummary[]) => void) | null = null;
  return {
    listHosts: vi.fn(async () => []),
    attach: vi.fn(async () => ({ state: "attached" as const, sessionId: "r", readWrite: true })),
    observe: vi.fn(({ onFrame }) => {
      publish = onFrame;
      onFrame(rows);
      return () => {
        publish = null;
      };
    }),
    push: (next) => publish?.(next),
    providers: vi.fn(async () => PROVIDERS),
    spawn: vi.fn(async () => ({
      state: "spawned" as const,
      sessionId: "born-1",
      runtimeRunId: "run-born",
      label: "Claude",
    })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    history: unreachableHistory(),
    usage: emptyUsage(),
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;
let markers: GodviewMonitorFacts[] = [];

/** Every interval this stage opened, and every one it closed. The PF6 claim is
 * literally the difference between these two sets. */
let openedIntervals: number[] = [];
let clearedIntervals: number[] = [];
let builtDrivers = 0;
let disposedDrivers = 0;

beforeEach(() => {
  markers = [];
  openedIntervals = [];
  clearedIntervals = [];
  builtDrivers = 0;
  disposedDrivers = 0;
  localStorage.clear();
  // GT-3c: happy-dom has no `Worker`, so the swarm simulates in-thread. The
  // stand-in is not a mock — it is the package's own inline driver, the same
  // host and the same world the worker runs — wrapped only to count the
  // lifecycle the stage is responsible for.
  setSwarmPhysicsDriverFactory((options) => {
    builtDrivers += 1;
    const driver: SwarmPhysicsDriver = createInlineSwarmPhysicsDriver(options);
    return {
      mode: driver.mode,
      post: (command, transfer) => driver.post(command, transfer),
      dispose: () => {
        disposedDrivers += 1;
        driver.dispose();
      },
    };
  });
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
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  setSwarmPhysicsDriverFactory(undefined);
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
const ackText = (host: HTMLElement): string =>
  host.querySelector(".vf-monitor-ack")?.textContent ?? "";
/** The swarm's rows in the DOM. It paints its bodies on WebGPU, so this is the
 * keyboard list beside the canvas — the same rows, reachable without a pointer,
 * and the only DOM the swarm has to count. */
const swarmRows = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-swarm-list li button"),
];
/** The view buttons on the package's instrument bar, and the one that is on. */
const viewButtons = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(
    '[role="group"][aria-label="Monitor view"] button[aria-pressed]',
  ),
];
const pressedView = (host: HTMLElement): string | undefined =>
  viewButtons(host)
    .find((button) => button.getAttribute("aria-pressed") === "true")
    ?.getAttribute("aria-label") ?? undefined;

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
    expect(swarmRows(host).length).toBe(4);
    // The bar is the header now, and it wears the chosen view rather than a
    // `<select>` — the one place the choice is readable off the screen.
    expect(pressedView(host)).toBe("SWARM view");
  });

  it("says WEBGPU UNAVAILABLE rather than drawing an empty field on a device with no GPU", async () => {
    // The honest-states law where AR-5's port put it. happy-dom has no WebGPU,
    // and a swarm that answered that with a blank canvas would look exactly
    // like a field with nothing in it. The section says what painted, the
    // marker repeats it, and the rows are still reachable underneath.
    const host = await mountMonitor();
    const swarm = host.querySelector(".vf-monitor-swarm");
    expect(swarm?.getAttribute("data-swarm-renderer")).toBe("unavailable");
    expect(swarm?.querySelector(".vf-monitor-empty")?.textContent).toContain("WEBGPU UNAVAILABLE");
    expect(latest().swarmRenderer).toBe("unavailable");
    // …and the physics still ran: what is missing is the painter, not the world.
    expect(latest().swarmPhysics).toBe("inline");
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

  it("colors a row by its PROJECT's dealt tint, read from the live tokens (record §02)", async () => {
    // Read off the LIST view, which lays its rows out in the DOM: the swarm
    // resolves the same palette into numbers for the GPU, so there is no
    // element left there to carry a custom property.
    //
    // The claim is §02's rather than §2.6's: a row's colour is its PROJECT's,
    // dealt once and drawn at the theme's own lightness and chroma — so three
    // projects are three colours, and the pane no agent claims belongs to no
    // project and wears the ramp. A palette that resolved nothing would make
    // all four black, which is exactly what the tint fallback is for.
    const host = await mountMonitor("list");
    const byProject = new Map<string, string>();
    for (const row of host.querySelectorAll<HTMLElement>(".vf-monitor-list-row")) {
      const project = row.querySelector(".vf-monitor-list-project")?.textContent ?? "";
      byProject.set(project, row.style.getPropertyValue("--agent-color"));
    }
    const ramp = byProject.get("scratch");
    const dealt = ["vibe-field", "voyager", "jabali"].map((project) => {
      const color = byProject.get(project);
      expect(color, `${project} was never drawn`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(color, `${project} wears the ramp instead of a dealt tint`).not.toBe(ramp);
      return color;
    });
    expect(new Set(dealt).size, "two projects were dealt the same hue").toBe(dealt.length);
    // The unclaimed terminal belongs to no project: the ramp, not a hue.
    expect(ramp).toBe(TOKENS["--text-faint"]);
  });

  it("renders every view in the registry against the same field", async () => {
    // The contract's real claim: a view is a pure function of its props, so
    // swapping one changes what is drawn and nothing else.
    for (const [viewId, selector] of [
      ["swarm", ".vf-monitor-swarm-list li button"],
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

  it("PF6: closing disposes — every timer cleared, the physics driver disposed", async () => {
    await mountMonitor();
    expect(openedIntervals.length, "the mesh poll never started").toBeGreaterThan(0);
    expect(clearedIntervals).not.toEqual(expect.arrayContaining(openedIntervals));
    expect(builtDrivers, "the swarm never started its physics").toBeGreaterThan(0);

    act(() => root?.unmount());
    root = null;

    // The whole PF6 claim for this stage, and it is stronger than the deck's:
    // the deck stays mounted and SILENCED, this is gone. Nothing is left
    // ticking, and the physics world was torn down rather than left pumping.
    for (const id of openedIntervals) {
      expect(clearedIntervals, `interval ${id} survived the close`).toContain(id);
    }
    expect(disposedDrivers, "a physics driver outlived the close").toBe(builtDrivers);
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
    const resumed = managedSummary({
      runtimeRunId: "run-codex",
      terminalSessionId: "run-codex-pty-2",
      replaced: "run-codex-pty",
      cwd: "/project/voyager",
    });
    const door = fakeDoor([resumed]);
    const host = await mountMonitor("list", door);
    const settle = async (): Promise<void> => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    await settle();
    expect(door.mountLocal).toHaveBeenCalledTimes(1);
    expect(door.mountLocal.mock.calls[0]).toEqual([
      "run-codex-pty-2",
      { replacing: "run-codex-pty" },
    ]);
    expect(ackText(host)).toContain("resumed in its pane");

    // ONCE, and this is where that word is actually earned. The pane facts do
    // not move in this fixture — the deck still reports the OLD PTY — so every
    // later frame still satisfies the condition that triggered the hand-over,
    // and only the guard stops it happening again. The identical frame is the
    // republish case (the fold re-sends its whole field at its own cadence);
    // the second carries a real change, which gets past the damage gate and
    // leaves the guard alone to do the work.
    await act(async () => door.push([resumed]));
    await settle();
    await act(async () =>
      door.push([
        managedSummary({
          runtimeRunId: "run-codex",
          terminalSessionId: "run-codex-pty-2",
          replaced: "run-codex-pty",
          cwd: "/project/jabali",
        }),
      ]),
    );
    await settle();
    // the frame REACHED the stage — without this the assertion below would
    // pass for a door nobody was listening to
    expect(host.textContent).toContain("jabali");
    expect(door.mountLocal).toHaveBeenCalledTimes(1);
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

  it("wears the package's instrument bar, with VibeField's own tools in its slots (AR-5)", async () => {
    // The header is the package's now. What is still OURS rides the two slots
    // it offers: the bridge notice leading, and trailing the birth (the
    // provider list and SPAWN) plus the two sheets. A test that only counted
    // the bar's own controls would pass for a bar with our tools dropped.
    const host = await mountMonitor("list", fakeDoor());
    const bar = host.querySelector(".vf-godview-header");
    expect(bar, "the instrument bar never mounted").not.toBeNull();
    expect(bar?.querySelector(".vf-godview-header-notice")).not.toBeNull();
    expect(bar?.querySelector('select[aria-label="Agent provider"]')).not.toBeNull();
    expect(bar?.querySelector(".vf-godview-spawn")).not.toBeNull();
    expect(
      bar?.querySelector('button[aria-label="Find an agent by what was said"]'),
    ).not.toBeNull();
    // AR-5b: `aria-controls` names an element that exists — the sheet returns
    // null while closed, so the control names it only while it is open
    expect(bar?.querySelector('button[aria-controls="vf-find-sheet"]')).toBeNull();
    expect(bar?.querySelector('button[aria-controls="vf-godview-tweak-panel"]')).not.toBeNull();
    // The bar owns the view marks and the theme switch, in that order.
    expect(viewButtons(host).map((button) => button.getAttribute("aria-label"))).toEqual([
      "SWARM view",
      "LIST view",
      "RAIN view",
    ]);
    expect(pressedView(host)).toBe("LIST view");
    expect(bar?.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });

  it("chooses the view with the bar's marks and the theme with its switch", async () => {
    const selected: string[] = [];
    const themes: string[] = [];
    const view = monitorViewFor("swarm");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      const door = fakeDoor();
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor
            view={view}
            parameters={monitorParameterDefaults(view.parameterGroups)}
            door={door}
            panes={PANES}
            onSelectView={(viewId) => selected.push(viewId)}
            onThemeChange={(theme) => themes.push(theme)}
          />
        </GodviewAgentsProvider>,
      );
    });
    const list = viewButtons(container).find(
      (button) => button.getAttribute("aria-label") === "LIST view",
    );
    await act(async () => list?.click());
    expect(selected).toEqual(["list"]);

    await act(async () => container?.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    // The switch offers the OTHER theme, which is what makes it a switch.
    expect(themes).toEqual(["dark"]);
  });

  it("with NO door: no rows, no invented ones, the state says nobody was asked, and spawn is disabled", async () => {
    const host = await mountMonitor(DEFAULT_MONITOR_VIEW_ID, null, { sessionIds: [] });
    expect(swarmRows(host).length).toBe(0);
    expect(latest().agents).toBe(0);
    expect(latest().localState).toBe("no-door");
    expect(latest().localClaim).toBeNull();
    expect(host.querySelector(".vf-monitor-local-chip")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".vf-godview-spawn")?.disabled).toBe(true);
  });
});
