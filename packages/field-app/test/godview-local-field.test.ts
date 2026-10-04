// @vitest-environment node
/**
 * THE LOCAL SOURCE, as pure functions (AR-3).
 *
 * The field that replaced the mock: fieldd's fold, read through the door. Its
 * honest states are pure, so they are held here without a renderer; the mounted
 * half (the deck's pane frames reading the fold's facts) is in
 * `godview-agents-provider.test.tsx` and `godview-deck-frames.test.tsx`.
 *
 * MV-3b: the monitor's ROWS no longer come from this fold — the backend's model
 * does, through the window's replica — so the row identity this file used to
 * hold (`managedRowId`: the RUN) is the backend's now (`idOf`, M22), witnessed
 * by `godview-model-differential.test.ts`. The fold stays for the readers the
 * model does not serve (M19), and these states are theirs.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_LOCAL_FIELD,
  localFieldAfterFailure,
  localFieldFromFrame,
} from "../src/godview/monitor/local-agent-field";
import { managedSummary } from "./managed-session-fixture";

describe("the local field's honest states", () => {
  it("starts with nobody asked — which is not the same as an empty fold", () => {
    expect(EMPTY_LOCAL_FIELD).toEqual({ rows: [], state: "no-door" });
  });

  it("a frame replaces everything: the daemon sends whole fields, never edges", () => {
    const first = localFieldFromFrame([managedSummary({ runtimeRunId: "run-a" })]);
    expect(first.state).toBe("live");
    expect(first.rows.map((row) => row.runtimeRunId)).toEqual(["run-a"]);
    const second = localFieldFromFrame([]);
    expect(second).toEqual({ rows: [], state: "live" });
  });

  it("a failure withdraws the rows and says why, and returns the SAME object when nothing changed", () => {
    const live = localFieldFromFrame([managedSummary()]);
    const down = localFieldAfterFailure(live, "FORBIDDEN_SCOPE");
    expect(down).toEqual({ rows: [], state: "unavailable", reason: "FORBIDDEN_SCOPE" });
    expect(localFieldAfterFailure(down, "FORBIDDEN_SCOPE")).toBe(down);
    expect(localFieldAfterFailure(down, "the daemon is gone")).not.toBe(down);
  });
});
