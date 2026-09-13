// @vitest-environment node
/**
 * THE LOCAL SOURCE, as pure functions (AR-3).
 *
 * The field that replaced the mock: fieldd's fold, read through the door. Its
 * honest states and its identity rule are pure, so they are held here without
 * a renderer; the mounted half (frames reaching bubbles, the claims on screen)
 * is in `godview-monitor.test.tsx` and `godview-remote-door.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import { managedRowId, monitorAgentFromManaged } from "../src/godview/monitor/agents";
import {
  EMPTY_LOCAL_FIELD,
  localFieldAfterFailure,
  localFieldFromFrame,
} from "../src/godview/monitor/local-agent-field";
import { managedSummary } from "./managed-session-fixture";

const ACCENTS = ["#a1", "#a2", "#a3"] as const;

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

describe("a managed row's identity", () => {
  it("is the RUN, whatever PTY it is in and whether it is in one at all", () => {
    // The identity rule, stated as the three cases that used to give three
    // different answers: a run in a PTY, the same run resumed into another one
    // (AR-4), and a run hosting none. The row is the same row through all of
    // them, because the RUN is what the user is watching.
    expect(
      managedRowId(managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" })),
    ).toBe("run-a");
    expect(
      managedRowId(
        managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-b", replaced: "pty-a" }),
      ),
    ).toBe("run-a");
    expect(managedRowId(managedSummary({ runtimeRunId: "run-a", terminalSessionId: null }))).toBe(
      "run-a",
    );
  });

  it("carries the fold's row verbatim on the facet, and the tier as ruled", () => {
    const summary = managedSummary({ runtimeRunId: "run-a", profileId: "codex:abc" });
    const agent = monitorAgentFromManaged({ summary }, ACCENTS);
    expect(agent?.agent?.summary).toBe(summary);
    expect(agent?.agent?.tier).toBe("managed");
    expect(agent?.agent?.runtimeRunId).toBe("run-a");
    expect(agent?.agent?.profileId).toBe("codex:abc");
    // a row without a terminal here has no session and no pane join
    const homeless = monitorAgentFromManaged(
      { summary: managedSummary({ terminalSessionId: null }) },
      ACCENTS,
    );
    expect(homeless?.session).toBeUndefined();
  });
});
