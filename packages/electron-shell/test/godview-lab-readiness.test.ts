import { describe, expect, it } from "vitest";
import {
  type LabDeckState,
  labDeckReady,
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
