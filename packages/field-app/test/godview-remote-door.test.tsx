// @vitest-environment happy-dom
/**
 * THE DOOR, MOUNTED (GT-4, GT-D17).
 *
 * The stage fixture beside this one (`godview-monitor.test.tsx`) proves the
 * mock half: rows appear, actions acknowledge, nothing mounts. This one adds
 * the half that is REAL — a fake door standing in for the deck's runtime and
 * workspace, because that pair needs Electron and this claim does not: what is
 * under test is the ROUTING, which is ours.
 *
 * What it holds:
 *   1. a peer's sessions become bubbles, beside the mock ones and unmistakable
 *   2. the label's claim narrows the moment they do
 *   3. clicking a remote bubble asks the door to attach — with the right session
 *   4. clicking a mock bubble asks NOTHING (the split-honesty test)
 *   5. every outcome the door can answer with is said out loud, honestly
 *   6. no door ⇒ no remote rows, and no invented ones
 *   7. PF6: the poll dies with the stage
 */

import type { RemoteHostSummary, SharedSessionSummary } from "@vibecook/ghosttea-protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { GodviewMonitor, MOCK_LABEL } from "../src/godview/GodviewMonitor";
import { useMonitorPalette } from "../src/godview/monitor/monitor-palette";
import { monitorParameterDefaults } from "../src/godview/monitor/parameters";
import { DEFAULT_MONITOR_VIEW_ID, monitorViewFor } from "../src/godview/monitor/registry";
import type { RemoteAttachOutcome, RemoteSessionDoor } from "../src/godview/monitor/remote-door";
import {
  type MonitorAgentsResult,
  useMonitorAgents,
} from "../src/godview/monitor/useMonitorAgents";
import { useInlineSwarmPhysics } from "./swarm-physics-inline";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

useInlineSwarmPhysics();

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

/** The nine the mock field always puts on the stage (GT-3m). */
const MOCK_ROWS = 9;

let root: Root | null = null;
let container: HTMLElement | null = null;
let markers: GodviewMonitorFacts[] = [];
let openedIntervals: number[] = [];
let clearedIntervals: number[] = [];

function shared(
  sessionId: string,
  overrides: Partial<SharedSessionSummary> = {},
): SharedSessionSummary {
  return {
    sessionId,
    title: "zsh",
    cwdLabel: "/Users/peer/src/truffle",
    running: true,
    attachable: true,
    readWrite: true,
    createdAtMs: 10,
    activity: { kind: "shell-idle" },
    ...overrides,
  } as SharedSessionSummary;
}

function host(deviceId: string, sessions: SharedSessionSummary[]): RemoteHostSummary {
  return {
    deviceId,
    deviceName: deviceId,
    online: true,
    protocolMajor: 1,
    protocolMinor: 13,
    hostInstanceId: `${deviceId}-instance`,
    sessions,
  } as RemoteHostSummary;
}

interface FakeDoor extends RemoteSessionDoor {
  attach: ReturnType<typeof vi.fn>;
  listHosts: ReturnType<typeof vi.fn>;
}

function fakeDoor(
  hosts: RemoteHostSummary[],
  outcome: RemoteAttachOutcome = { state: "attached", sessionId: "replica-1", readWrite: true },
): FakeDoor {
  return {
    listHosts: vi.fn(async () => hosts),
    attach: vi.fn(async () => outcome),
  };
}

beforeEach(() => {
  markers = [];
  openedIntervals = [];
  clearedIntervals = [];
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
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  vi.restoreAllMocks();
});

/** Mount the stage and let the first ask of the mesh settle — the field asks
 * once immediately, so a single flush is the whole of the wait. */
async function mountMonitor(
  door: RemoteSessionDoor | null,
  viewId: string = DEFAULT_MONITOR_VIEW_ID,
  panes: { sessionIds: readonly string[]; activeSessionId?: string } = { sessionIds: [] },
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
const remoteBubbles = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-bubble.is-remote"),
];
const ackText = (host: HTMLElement): string =>
  host.querySelector(".vf-monitor-ack")?.textContent ?? "";

describe("remote sessions as monitor citizens", () => {
  it("puts a peer's sessions on the stage beside the mock ones", async () => {
    const view = await mountMonitor(fakeDoor([host("mini", [shared("s1"), shared("s2")])]));
    expect(view.querySelectorAll(".vf-monitor-bubble").length).toBe(MOCK_ROWS + 2);
    expect(latest().agents).toBe(MOCK_ROWS + 2);
    expect(latest().remoteSessions).toBe(2);
    expect(latest().remoteHosts).toBe(1);
    expect(latest().remoteState).toBe("serving");
  });

  it("marks them so they cannot be read as one of the invented ones", async () => {
    const view = await mountMonitor(fakeDoor([host("mini", [shared("s1")])]));
    const bubbles = remoteBubbles(view);
    expect(bubbles).toHaveLength(1);
    // The host eyebrow is the distinction, and no local row has one.
    expect(bubbles[0]?.querySelector(".vf-monitor-bubble-host")?.textContent).toBe("mini");
    expect(view.querySelectorAll(".vf-monitor-bubble-host").length).toBe(1);
    // …and it is not drawn as one of OUR unclaimed terminals either.
    expect(bubbles[0]?.classList.contains("is-unassigned")).toBe(false);
    expect(bubbles[0]?.getAttribute("aria-label")).toContain("on mini");
  });

  it("NARROWS the mock label's claim rather than covering a real row with it", async () => {
    // GT-D17's law, on screen: with a real session present, the chip stops
    // claiming the stage and says how many of the rows it speaks for.
    const view = await mountMonitor(fakeDoor([host("mini", [shared("s1")])]));
    const mockChip = view.querySelector(".vf-monitor-mock-chip")?.textContent ?? "";
    expect(mockChip).toBe(`preview — ${MOCK_ROWS} mock agents`);
    expect(mockChip).not.toBe(MOCK_LABEL);
    expect(latest().mockLabel).toBe(mockChip);
    // The other claim, in its own chip and its own words.
    expect(view.querySelector(".vf-monitor-remote-chip")?.textContent).toBe(
      "1 remote session · 1 peer",
    );
  });

  it("keeps the whole-stage claim when the stage IS only the mock field", async () => {
    const view = await mountMonitor(fakeDoor([]));
    expect(view.querySelector(".vf-monitor-mock-chip")?.textContent).toBe(MOCK_LABEL);
    expect(view.querySelector(".vf-monitor-remote-chip")).toBeNull();
    expect(latest().remoteSessions).toBe(0);
    expect(latest().remoteState).toBe("serving");
  });

  it("words a row's write policy as the HOST property it is, in both directions", async () => {
    // GT-5c / the review's 2b. What arrives is `allow_tailnet_write ||
    // capability.is_some()` — one boolean for the whole peer — and WHO gets
    // write is settled at attach. So a row may say what the host permits and
    // nothing about this viewer, and it must say it when the answer is yes as
    // well as when it is no: marking only refusal made silence mean "you can
    // type", which is the claim this row cannot make.
    const refusing = await mountMonitor(
      fakeDoor([host("mini", [shared("s1", { readWrite: false })])]),
      "list",
    );
    const refusingRow = refusing.querySelector(".vf-monitor-list-row.is-remote");
    expect(refusingRow?.querySelector(".vf-monitor-list-host em")?.textContent).toBe(
      "read-only host",
    );
    expect(refusingRow?.getAttribute("aria-label")).toContain("read-only host");

    const permitting = await mountMonitor(
      fakeDoor([host("mini", [shared("s1", { readWrite: true })])]),
      "list",
    );
    const permittingRow = permitting.querySelector(".vf-monitor-list-row.is-remote");
    expect(permittingRow?.querySelector(".vf-monitor-list-host em")?.textContent).toBe(
      "writable host",
    );
    // …and it does not upgrade a host property into a promise to the viewer.
    expect(permittingRow?.textContent).not.toContain("you");
  });
});

describe("select routes by source", () => {
  it("a REMOTE bubble asks the door to attach — with that peer's session", async () => {
    const door = fakeDoor([host("mini", [shared("s1"), shared("s2")])]);
    const view = await mountMonitor(door);
    const target = remoteBubbles(view)[1];

    await act(async () => target?.click());

    expect(door.attach).toHaveBeenCalledTimes(1);
    expect(door.attach.mock.calls[0]?.[0]).toMatchObject({
      deviceId: "mini",
      deviceName: "mini",
      remoteSessionId: "s2",
    });
    // The row's own accent travels with the attach: it is what paints the pane
    // the session lands in, which is the deck↔monitor link.
    expect(door.attach.mock.calls[0]?.[0].color).toMatch(/^#/);
    expect(ackText(view)).toContain("attached from mini");
  });

  it("a MOCK bubble asks NOTHING (the split-honesty test)", async () => {
    // The other half of GT-D17: an invented agent still mounts nothing, and
    // the door it would have to go through is never touched.
    const door = fakeDoor([host("mini", [shared("s1")])]);
    const view = await mountMonitor(door);
    const mock = [...view.querySelectorAll<HTMLButtonElement>(".vf-monitor-bubble")].find(
      (bubble) => !bubble.classList.contains("is-remote"),
    );

    await act(async () => mock?.click());

    expect(door.attach).not.toHaveBeenCalled();
    expect(ackText(view)).toContain("nothing was mounted");
  });

  it("says view-only in the same breath as the success, not as a failure", async () => {
    const door = fakeDoor([host("mini", [shared("s1", { readWrite: false })])], {
      state: "attached",
      sessionId: "replica-1",
      readWrite: false,
    });
    const view = await mountMonitor(door);

    await act(async () => remoteBubbles(view)[0]?.click());

    expect(door.attach).toHaveBeenCalledTimes(1);
    expect(ackText(view)).toContain("view only");
    expect(ackText(view)).toContain("attached");
  });

  it("a deck with no panes is told so, and nothing pretends otherwise", async () => {
    const door = fakeDoor([host("mini", [shared("s1")])], { state: "no-pane" });
    const view = await mountMonitor(door);

    await act(async () => remoteBubbles(view)[0]?.click());

    expect(ackText(view)).toContain("no pane");
    expect(view.querySelector(".vf-monitor-bubble.is-linked")).toBeNull();
  });

  it("carries the floor's own words when an attach fails", async () => {
    const door = fakeDoor([host("mini", [shared("s1")])], {
      state: "failed",
      reason: "peer refused the ticket",
    });
    const view = await mountMonitor(door);

    await act(async () => remoteBubbles(view)[0]?.click());

    expect(ackText(view)).toContain("peer refused the ticket");
  });

  it("refuses an unshared session without asking the door at all", async () => {
    const door = fakeDoor([host("mini", [shared("s1", { attachable: false })])]);
    const view = await mountMonitor(door);

    await act(async () => remoteBubbles(view)[0]?.click());

    expect(door.attach).not.toHaveBeenCalled();
    expect(ackText(view)).toContain("not sharing");
  });

  it("links the row to the pane it landed in, and unlinks when that pane goes", async () => {
    // `PaneAttachment`, alive for the first time. It is a live pane FACT, so
    // the same row with the pane gone is no longer linked — a bubble that
    // remembered an attach would be reporting an event, not a state.
    const door = fakeDoor([host("mini", [shared("s1")])]);
    const view = await mountMonitor(door, DEFAULT_MONITOR_VIEW_ID, {
      sessionIds: ["replica-1"],
      activeSessionId: "replica-1",
    });

    await act(async () => remoteBubbles(view)[0]?.click());
    expect(remoteBubbles(view)[0]?.classList.contains("is-linked")).toBe(true);
    expect(remoteBubbles(view)[0]?.getAttribute("aria-current")).toBe("true");

    await act(async () => {
      root?.render(
        <GodviewMonitor
          view={monitorViewFor(DEFAULT_MONITOR_VIEW_ID)}
          parameters={monitorParameterDefaults(
            monitorViewFor(DEFAULT_MONITOR_VIEW_ID).parameterGroups,
          )}
          door={door}
          panes={{ sessionIds: [] }}
        />,
      );
    });
    expect(remoteBubbles(view)[0]?.classList.contains("is-linked")).toBe(false);
  });
});

describe("the field without a floor", () => {
  it("with NO door: mock rows only, and the state says nobody was asked", async () => {
    const view = await mountMonitor(null);
    expect(view.querySelectorAll(".vf-monitor-bubble").length).toBe(MOCK_ROWS);
    expect(remoteBubbles(view)).toHaveLength(0);
    expect(latest().remoteState).toBe("no-door");
    // The whole-stage claim is correct again, because the stage IS the mock.
    expect(view.querySelector(".vf-monitor-mock-chip")?.textContent).toBe(MOCK_LABEL);
  });

  it("with a REFUSING floor: no rows, no invented peers, and the reason ON THE SCREEN", async () => {
    const door: RemoteSessionDoor = {
      listHosts: vi.fn(async () => {
        throw new Error("terminal mesh is not configured");
      }),
      attach: vi.fn(),
    };
    const view = await mountMonitor(door);
    expect(remoteBubbles(view)).toHaveLength(0);
    expect(latest().remoteState).toBe("unavailable");
    expect(latest().remoteReason).toContain("mesh is not configured");
    expect(view.querySelector(".vf-monitor-remote-chip")).toBeNull();
    // GT-5c / the review's 2d: the marker carried this state from the day it
    // was built and the SCREEN did not, so a mesh that was on with its gateway
    // down showed exactly what a healthy empty mesh shows — at the surface
    // GT-D17 declared to BE the door.
    const chip = view.querySelector(".vf-monitor-remote-unavailable-chip");
    expect(chip?.textContent).toBe("mesh unavailable · terminal mesh is not configured");
    expect(chip?.getAttribute("title")).toContain("mesh is not configured");
  });

  it("says nothing about the mesh before anybody has been asked", async () => {
    // `no-door` is a deck still coming up, not a mesh that is down.
    const view = await mountMonitor(null);
    expect(view.querySelector(".vf-monitor-remote-unavailable-chip")).toBeNull();
  });

  it("says a REMOTE row cannot be attached yet rather than doing nothing", async () => {
    // The one path where clicking announced nothing (the review's finding 9):
    // `select` on a remote row with a null door returned SILENTLY, while every
    // other outcome — refusal, no pane, failure, success — is said out loud.
    //
    // It is reached the way a user reaches it: a row the mesh put on the stage,
    // and then a deck that goes away underneath it. The row the user is looking
    // at is the row they click.
    let seam: MonitorAgentsResult | undefined;
    function Probe({ door }: { door: RemoteSessionDoor | null }): null {
      seam = useMonitorAgents({ palette: useMonitorPalette(), door });
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Probe door={fakeDoor([host("mini", [shared("s1")])])} />);
    });
    const row = seam?.agents.find((agent) => agent.remote !== undefined);
    expect(row).toBeDefined();

    // The deck dies; the row the user was already looking at is still the row.
    await act(async () => root?.render(<Probe door={null} />));
    await act(async () => {
      if (row) seam?.actions.select(row);
    });
    expect(seam?.acknowledgement?.message).toContain("mini");
    expect(seam?.acknowledgement?.message).toContain("no connection");
  });

  it("PF6: the mesh poll dies with the stage", async () => {
    await mountMonitor(fakeDoor([host("mini", [shared("s1")])]));
    expect(openedIntervals.length).toBeGreaterThan(1); // the mock's tick AND the poll

    act(() => root?.unmount());
    root = null;

    for (const id of openedIntervals) {
      expect(clearedIntervals, `interval ${id} survived the close`).toContain(id);
    }
  });
});
