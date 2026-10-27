import type { MonitorAgentRow } from "@vibefield/puppeteer-view-sdk/model";
import { describe, expect, it } from "vitest";
import { keepsFailure } from "../src/godview/monitor/failed-bodies";

// Q06 (James, 2026-10-27, "B · Keep a failed body until you look") — which
// dead rows the window still draws: a crashed agent's, while a pane here can
// show it. The leave is fieldd's (the failure acknowledged once a screen has
// shown its pane, `godview-monitor.test.tsx`); this is the keep.

function row(overrides: Partial<MonitorAgentRow> = {}): MonitorAgentRow {
  return {
    id: "run-crash",
    kind: "agent",
    createdAt: 0,
    status: "blocked",
    statusSince: 0,
    stale: false,
    alive: false,
    observed: true,
    detail: "",
    project: { name: "vibe-field" },
    unread: false,
    device: { id: "this-device", name: "This Mac", self: true },
    attachable: false,
    writable: false,
    wait: { kind: "failure", since: 5, code: "signal", detail: "Run failed: signal" },
    ...overrides,
  };
}

const PANE = new Map([["run-crash", "run-crash-pty"]]);

describe("a crashed run's body stays (Q06)", () => {
  it("keeps a dead agent row whose wait is the runtime's failure, while a pane here joins it", () => {
    expect(keepsFailure(row(), PANE)).toBe(true);
  });

  it("hides every other dead row as before: no failure, another wait, no pane here, a terminal", () => {
    const asking = row({ wait: { kind: "permission", since: 5, tool: "Bash" } });
    expect(keepsFailure(row({ wait: undefined }), PANE)).toBe(false);
    expect(keepsFailure(asking, PANE)).toBe(false);
    // a failure with no pane on this desktop has nothing to be seen in
    expect(keepsFailure(row(), new Map())).toBe(false);
    expect(keepsFailure(row({ kind: "terminal" }), PANE)).toBe(false);
  });

  it("says nothing of a live row: a live failure is the ordinary blocked body, drawn anyway", () => {
    expect(keepsFailure(row({ alive: true }), PANE)).toBe(false);
  });
});
