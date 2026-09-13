// @vitest-environment node
/**
 * THE FRAME'S FACTS (GT-6) — the fold's row projected into what the views
 * package's pane frame reads (record §07, PU-14).
 *
 * A pure seam deserves a pure fixture: no pane, no GPU, no daemon. What is
 * asserted here is every rule the projection makes on VibeField's side — which
 * row yields facts at all, which word each status becomes, which number the
 * meter is allowed to draw — because the frame itself is upstream's and tested
 * there, and a wrong projection would be a frame lying in the reference's
 * handwriting.
 */

import { describe, expect, it } from "vitest";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import {
  paneFrameAgentFacts,
  paneFrameAgents,
  paneFrameFactsKey,
  paneFrameStatus,
  runIdsBySession,
} from "../src/godview/monitor/pane-frame-facts";
import { managedSummary } from "./managed-session-fixture";

/** The mirror is `.passthrough()`, so `effort` and `percentageSource` ride
 * verbatim and the fixture adds them the way fieldd would carry them. */
function withMirror(row: AgentSessionSummary, patch: Record<string, unknown>): AgentSessionSummary {
  return { ...row, monitor: { ...(row.monitor as object), ...patch } } as AgentSessionSummary;
}

describe("the pane frame's facts", () => {
  it("reads every field the frame draws off one managed row", () => {
    const row = withMirror(
      managedSummary({
        runtimeRunId: "run-a",
        kind: "claude",
        label: "Claude",
        status: "working",
        cwd: "/Users/j/src/vibe-field",
        model: { id: "claude-opus-5", displayName: "Opus 5" },
        contextPercent: 86,
      }),
      { statusSince: "2026-09-13T20:58:18.000Z", effort: { value: "high", intent: "configured" } },
    );

    expect(paneFrameAgentFacts(row)).toEqual({
      providerId: "claude",
      providerLabel: "Claude",
      status: "working",
      alive: true,
      statusSince: "2026-09-13T20:58:18.000Z",
      project: "vibe-field",
      cwd: "/Users/j/src/vibe-field",
      model: "Opus 5",
      effort: { value: "high", configured: true },
      contextPercent: 86,
    });
  });

  it("gives a run that has said nothing NO facts at all — the bare badge, never an invented readout", () => {
    const starting = managedSummary({ runtimeRunId: "run-b", monitor: false });
    expect(starting.monitor).toBeUndefined();
    expect(paneFrameAgentFacts(starting)).toBeUndefined();
  });

  it("keeps a run the monitor would drop, because an ended run is what the resume verb is for", () => {
    const ended = managedSummary({ runtimeRunId: "run-c", alive: false, status: "idle" });
    expect(paneFrameAgentFacts(ended)?.alive).toBe(false);
  });

  it("reads `unknown` as idle rather than as the monitor's working·starting", () => {
    expect(paneFrameStatus("unknown")).toBe("idle");
    expect(paneFrameStatus("blocked")).toBe("blocked");
    expect(paneFrameStatus("working")).toBe("working");
    expect(paneFrameStatus("idle")).toBe("idle");
    // A pending row carries `unknown` with a mirror from before (AR-4).
    const pending = managedSummary({ runtimeRunId: "run-d", pending: "no adapter", alive: true });
    expect(pending.status).toBe("unknown");
    expect(paneFrameAgentFacts(pending)?.status).toBe("idle");
  });

  it("draws no meter when the provider cannot say how full its window is", () => {
    const derived = withMirror(managedSummary({ contextPercent: 44 }), {
      context: {
        usedTokens: 88_000,
        capacityTokens: 200_000,
        usedPercent: 44,
        percentageSource: "derived",
      },
    });
    expect(paneFrameAgentFacts(derived)?.contextPercent).toBe(44);

    const unavailable = withMirror(managedSummary({ contextPercent: 44 }), {
      context: {
        usedTokens: 88_000,
        capacityTokens: 200_000,
        usedPercent: 44,
        percentageSource: "unavailable",
      },
    });
    expect(paneFrameAgentFacts(unavailable)?.contextPercent).toBeUndefined();
  });

  it("says whether the effort is the user's intent or the provider's evidence", () => {
    const configured = withMirror(managedSummary({}), {
      effort: { value: "high", intent: "configured" },
    });
    expect(paneFrameAgentFacts(configured)?.effort).toEqual({ value: "high", configured: true });

    const observed = withMirror(managedSummary({}), {
      effort: { value: "medium", intent: "observed" },
    });
    expect(paneFrameAgentFacts(observed)?.effort).toEqual({ value: "medium", configured: false });

    // Read tolerantly: a shape this cannot make sense of is no effort at all,
    // never a readout saying "[object Object]".
    expect(
      paneFrameAgentFacts(withMirror(managedSummary({}), { effort: "high" }))?.effort,
    ).toBeUndefined();
    expect(
      paneFrameAgentFacts(withMirror(managedSummary({}), { effort: { intent: "configured" } }))
        ?.effort,
    ).toBeUndefined();
  });

  it("names the model by its display name, and by its id when that is all there is", () => {
    const named = managedSummary({ model: { id: "claude-opus-5", displayName: "Opus 5" } });
    expect(paneFrameAgentFacts(named)?.model).toBe("Opus 5");
    const bare = managedSummary({ model: { id: "gpt-5-codex" } });
    expect(paneFrameAgentFacts(bare)?.model).toBe("gpt-5-codex");
    // No model at all: the frame falls back to the provider's own label, which
    // is why the label crosses the seam even when a model does not.
    expect(paneFrameAgentFacts(managedSummary({}))?.model).toBeUndefined();
  });

  it("names the project from the monitor's cwd, and leaves the badge to the pane when nothing does", () => {
    const observed = managedSummary({ cwd: "/Users/j/src/rosetta" });
    expect(paneFrameAgentFacts(observed)?.project).toBe("rosetta");

    const nowhere: AgentSessionSummary = {
      ...withMirror(managedSummary({}), { environment: { worktrees: [] } }),
      workspace: { mode: "direct" },
    };
    const facts = paneFrameAgentFacts(nowhere);
    expect(facts?.project).toBeUndefined();
    expect(facts?.cwd).toBeUndefined();
  });

  it("keys the frames by the floor session a pane shows, and leaves out a row with nothing to give", () => {
    const speaking = managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" });
    const silent = managedSummary({
      runtimeRunId: "run-b",
      terminalSessionId: "pty-b",
      monitor: false,
    });
    const byTerminal = new Map([
      ["pty-a", speaking],
      ["pty-b", silent],
    ]);
    const agents = paneFrameAgents(byTerminal);
    expect([...agents.keys()]).toEqual(["pty-a"]);
    // The run map keeps BOTH: a starting run's pane can still be stopped.
    expect([...runIdsBySession(byTerminal)]).toEqual([
      ["pty-a", "run-a"],
      ["pty-b", "run-b"],
    ]);
  });

  it("changes its key only for facts a frame draws — a busier mirror is not news", () => {
    const row = managedSummary({
      runtimeRunId: "run-a",
      terminalSessionId: "pty-a",
      status: "working",
    });
    const key = (summary: AgentSessionSummary): string => {
      const byTerminal = new Map([["pty-a", summary]]);
      return paneFrameFactsKey(paneFrameAgents(byTerminal), runIdsBySession(byTerminal));
    };

    const busier = withMirror(row, {
      revision: 91,
      usage: { cumulativeTokens: 412_000, burnRatePerMin: 2_100 },
      lastAssistantMessage: { text: "still going" },
      freshness: { lastEvidenceAt: "2026-09-13T21:04:00.000Z", level: "native-hooks" },
    });
    expect(key(busier)).toBe(key(row));

    // A fraction of a percent does not move a meter drawn to the whole.
    const nudged = withMirror(row, {
      context: { usedTokens: 60_400, capacityTokens: 200_000, usedPercent: 30.2 },
    });
    const nudgedAgain = withMirror(row, {
      context: { usedTokens: 60_800, capacityTokens: 200_000, usedPercent: 30.4 },
    });
    expect(key(nudgedAgain)).toBe(key(nudged));
    expect(key(nudged)).not.toBe(key(row));

    // The things a frame does draw do move it.
    expect(key({ ...row, status: "blocked" })).not.toBe(key(row));
    expect(key(withMirror(row, { alive: false }))).not.toBe(key(row));
    expect(key(withMirror(row, { statusSince: "2026-09-13T21:09:00.000Z" }))).not.toBe(key(row));
    expect(
      key(managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a", monitor: false })),
    ).not.toBe(key(row));
  });
});
