import { describe, expect, it } from "vitest";
import {
  type LabDeckState,
  labDeckMissing,
  labDeckReady,
  labDeckSeen,
  labDeckTimeout,
  labMonitorMembership,
  singlePaneLabDeck,
} from "../src/testing/godview-lab-readiness";

const healthy: LabDeckState = {
  active: true,
  panes: 1,
  sessions: 1,
  poolPhase: "open",
  rosterState: "observed",
  rendererBackend: "webgpu",
};

describe("the Godview lab's real host workload", () => {
  it("rejects the dormant control that still mounts a working monitor", () => {
    const dormant = {
      ...healthy,
      panes: 0,
      sessions: 0,
      poolPhase: "dormant",
      rosterState: "unread",
    };
    expect(labDeckReady(dormant)).toBe(false);
    expect(() => singlePaneLabDeck(dormant)).toThrow("one healthy terminal pane");
  });

  it.each<Partial<LabDeckState>>([
    { active: false },
    { poolPhase: "failed" },
    { rosterState: "unavailable" },
    { rendererBackend: "canvas2d" },
    { error: "the terminal cell could not start" },
    { panes: Number.NaN },
    { sessions: 0 },
  ])("refuses an incomplete host even when its pane count looks ready: %j", (change) => {
    expect(labDeckReady({ ...healthy, ...change })).toBe(false);
    expect(() => singlePaneLabDeck({ ...healthy, ...change })).toThrow();
  });

  it("waits for a marker and rejects extra real panes in a fresh perf process", () => {
    expect(labDeckReady(null)).toBe(false);
    expect(() => singlePaneLabDeck(null)).toThrow();
    const extra = { ...healthy, panes: 2, sessions: 2 };
    expect(labDeckReady(extra)).toBe(true);
    expect(() => singlePaneLabDeck(extra)).toThrow();
  });

  it("records a detached comparable snapshot without unrelated marker fields", () => {
    const marker = { ...healthy, sessionIds: ["private-session"], glass: { opacity: 0.82 } };
    const snapshot = singlePaneLabDeck(marker);
    expect(snapshot).toEqual(healthy);
    expect(snapshot).not.toBe(marker);
    marker.panes = 0;
    expect(snapshot.panes).toBe(1);
  });
});

describe("a wait for the lab's deck that timed out", () => {
  // the deck as a launch that never came ready leaves it: mounted, its pool still opening
  const opening: LabDeckState = {
    ...healthy,
    panes: 0,
    sessions: 0,
    poolPhase: "opening",
    rosterState: "unread",
  };

  it("names every readiness condition the last state lacked, with what it read", () => {
    expect(labDeckMissing(healthy)).toEqual([]);
    expect(labDeckMissing(opening)).toEqual([
      "a pane (panes 0)",
      "a session (sessions 0)",
      'an open pool (poolPhase "opening")',
      'an observed roster (rosterState "unread")',
    ]);
    expect(
      labDeckMissing({ ...healthy, active: false, rendererBackend: "canvas2d", error: "no cell" }),
    ).toEqual([
      "an active deck (active false)",
      'a WebGPU terminal renderer (rendererBackend "canvas2d")',
      'no deck error (error "no cell")',
    ]);
    expect(labDeckMissing({ ...healthy, panes: Number.NaN })).toEqual(["a pane (panes NaN)"]);
  });

  it("says a marker that never came is what is missing", () => {
    expect(labDeckMissing(null)).toEqual(["a GODVIEW_DECK marker (none was read)"]);
    expect(labDeckSeen(null)).toBe("no GODVIEW_DECK marker");
    expect(labDeckTimeout(null)).toBe(
      "the deck last said no GODVIEW_DECK marker; still missing: a GODVIEW_DECK marker (none was read)",
    );
  });

  it("prints the last state whole as JSON, the readiness facts first", () => {
    // the marker's own order puts other fields between them
    const marker = { sessionIds: ["s-1"], ...opening, zoom: { phase: "idle", commits: 0 } };
    const seen = labDeckSeen(marker);
    expect(JSON.parse(seen)).toEqual(marker);
    expect(seen).toBe(
      '{"active":true,"panes":0,"sessions":0,"poolPhase":"opening","rosterState":"unread",' +
        '"rendererBackend":"webgpu","sessionIds":["s-1"],"zoom":{"phase":"idle","commits":0}}',
    );
    expect(labDeckSeen({ ...healthy, error: "the cell died" })).toContain(
      '"rendererBackend":"webgpu","error":"the cell died"}',
    );
  });

  it("bounds what it prints, and the readiness facts survive the bound", () => {
    const crowded = {
      ...opening,
      sessionIds: Array.from({ length: 400 }, (_, index) => `session-${index}`),
    };
    const seen = labDeckSeen(crowded);
    expect(seen).toHaveLength(600);
    expect(seen.endsWith("…")).toBe(true);
    expect(seen).toContain(
      '"poolPhase":"opening","rosterState":"unread","rendererBackend":"webgpu"',
    );
    expect(labDeckSeen(crowded, 80)).toHaveLength(80);
  });

  it("is one line: what the deck last said, then what that state still lacked", () => {
    expect(labDeckTimeout(opening)).toBe(
      'the deck last said {"active":true,"panes":0,"sessions":0,"poolPhase":"opening",' +
        '"rosterState":"unread","rendererBackend":"webgpu"}; still missing: a pane (panes 0), ' +
        'a session (sessions 0), an open pool (poolPhase "opening"), ' +
        'an observed roster (rosterState "unread")',
    );
    expect(labDeckTimeout(healthy)).toContain("still missing: nothing (ready as the wait ended)");
  });
});

const membership = {
  viewId: "list",
  agents: 25,
  localAgents: 20,
  terminals: 0,
  remoteSessions: 5,
  remoteHosts: 1,
  shownAgents: 25,
};

describe("the Godview lab's monitor membership", () => {
  it.each([
    null,
    { viewId: "list", agents: 25 },
    { ...membership, viewId: "rain" },
    { ...membership, agents: 26 },
    { ...membership, terminals: -1 },
    { ...membership, localAgents: 20.5 },
    { ...membership, shownAgents: 26 },
    { ...membership, remoteHosts: 6 },
    { ...membership, agents: 0, localAgents: 0, remoteSessions: 0, shownAgents: 0, remoteHosts: 0 },
  ])("rejects incomplete, stale or inconsistent monitor facts: %j", (state) => {
    expect(() => labMonitorMembership(state, "list")).toThrow("monitor membership");
  });

  it("copies only bounded comparable facts after the measured interval", () => {
    const marker = { ...membership, runs: [{ id: "private-run" }], status: "busy" };
    const proof = labMonitorMembership(marker, "list");
    expect(proof).toEqual(membership);
    expect(proof).not.toBe(marker);
    marker.agents = 0;
    expect(proof.agents).toBe(25);
  });
});
