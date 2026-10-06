import { describe, expect, it } from "vitest";
import {
  type LabDeckState,
  labDeckReady,
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
