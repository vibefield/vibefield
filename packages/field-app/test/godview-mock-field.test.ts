import { describe, expect, it } from "vitest";
import { assembleMonitorAgents } from "../src/godview/monitor/agents";
import { AGENT_KINDS } from "../src/godview/monitor/facet-types";
import { MOCK_TIMELINE, mockFieldAt } from "../src/godview/monitor/mock-agent-field";

// THE MOCK's contract (GT-D13). It is the one module AR replaces, so what is
// asserted here is what AR has to keep providing: a projection-shaped source
// whose timeline is a pure function of the tick.

const ACCENTS = ["#a1", "#a2", "#a3", "#a4", "#a5", "#a6", "#a7", "#a8"] as const;

/** The whole timeline as a comparable value. Deliberately the ASSEMBLED rows and
 * not the raw records: what has to be reproducible is what a view sees, and the
 * projection sits between. */
function timeline(ticks: number): unknown {
  return Array.from({ length: ticks }, (_, tick) => {
    const snapshot = mockFieldAt(tick);
    return assembleMonitorAgents({
      accents: ACCENTS,
      agents: snapshot.agents,
      terminals: snapshot.terminals,
    }).map((agent) => ({
      id: agent.id,
      status: agent.status,
      detail: agent.detail,
      project: agent.project,
      color: agent.color,
      model: agent.agent?.model,
      branch: agent.agent?.branch,
      context: agent.agent?.contextWindow?.usedPercent,
    }));
  });
}

describe("the mock agent field", () => {
  it("replays the identical timeline from the same seed", () => {
    // Two independent runs over the same ticks. The seed is module scope and
    // never re-drawn, so this is a claim about the WHOLE module: no Date.now(),
    // no Math.random(), nothing that could make the second run differ.
    expect(timeline(40)).toEqual(timeline(40));
  });

  it("is a pure function of the tick, in any order", () => {
    // Stronger than replaying forwards: a snapshot must not depend on what was
    // asked for before it. A mock that accumulated state would pass the test
    // above and fail this one.
    const forwards = [12, 13, 14].map((tick) => mockFieldAt(tick));
    const shuffled = [14, 12, 13].map((tick) => mockFieldAt(tick));
    expect(shuffled[1]).toEqual(forwards[0]);
    expect(shuffled[2]).toEqual(forwards[1]);
    expect(shuffled[0]).toEqual(forwards[2]);
  });

  it("opens with a full field across the pinned providers", () => {
    const rows = assembleMonitorAgents({
      accents: ACCENTS,
      agents: mockFieldAt(0).agents,
      terminals: mockFieldAt(0).terminals,
    });
    // Eight agents plus the one terminal nobody has claimed.
    expect(rows.filter((row) => row.agent !== undefined)).toHaveLength(8);
    expect(rows.filter((row) => row.agent === undefined)).toHaveLength(1);
    const kinds = new Set(rows.flatMap((row) => (row.agent ? [row.agent.kind] : [])));
    for (const kind of AGENT_KINDS) expect(kinds, `${kind} is not on the stage`).toContain(kind);
  });

  it("walks every status, rather than freezing one reading", () => {
    const seen = new Set<string>();
    for (let tick = 0; tick < 40; tick += 1) {
      const snapshot = mockFieldAt(tick);
      for (const row of assembleMonitorAgents({
        accents: ACCENTS,
        agents: snapshot.agents,
        terminals: snapshot.terminals,
      })) {
        seen.add(row.status);
      }
    }
    expect([...seen].sort()).toEqual(["idle", "waiting", "working"]);
  });

  it("keeps ids and colors stable while an agent lives", () => {
    const colorsById = new Map<string, string>();
    for (let tick = 0; tick < MOCK_TIMELINE.leavesAtTick; tick += 1) {
      const snapshot = mockFieldAt(tick);
      for (const row of assembleMonitorAgents({
        accents: ACCENTS,
        agents: snapshot.agents,
        terminals: snapshot.terminals,
      })) {
        const known = colorsById.get(row.id);
        if (known !== undefined) expect(row.color, `${row.id} changed color`).toBe(known);
        colorsById.set(row.id, row.color);
      }
    }
    expect(colorsById.size).toBeGreaterThan(0);
  });

  it("fills context windows monotonically", () => {
    const previous = new Map<string, number>();
    for (let tick = 0; tick < 40; tick += 1) {
      for (const record of mockFieldAt(tick).agents) {
        const used = record.state?.state.contextWindow?.usedPercent;
        if (used === undefined) continue;
        const before = previous.get(record.info.runtimeSessionId);
        if (before !== undefined) expect(used).toBeGreaterThanOrEqual(before);
        previous.set(record.info.runtimeSessionId, used);
        expect(used).toBeLessThanOrEqual(100);
      }
    }
  });

  it("loses one agent and gains another mid-timeline", () => {
    // The shape of a real field: it is not a frieze. A viewer who watches for a
    // minute sees a death and a birth.
    const ids = (tick: number): string[] =>
      mockFieldAt(tick).agents.map((record) => record.info.session.id);

    expect(ids(MOCK_TIMELINE.leavesAtTick - 1)).toContain(MOCK_TIMELINE.leavingSessionId);
    expect(ids(MOCK_TIMELINE.leavesAtTick)).not.toContain(MOCK_TIMELINE.leavingSessionId);

    expect(ids(MOCK_TIMELINE.arrivesAtTick - 1)).not.toContain(MOCK_TIMELINE.arrivingSessionId);
    expect(ids(MOCK_TIMELINE.arrivesAtTick)).toContain(MOCK_TIMELINE.arrivingSessionId);
  });

  it("produces the STATE that yields a status, never the status directly", () => {
    // The classifier has to stay on the path. If the mock asserted statuses, the
    // module every view's meaning depends on would be bypassed by the only
    // source that currently feeds it — and AR would inherit an untested seam.
    let waitingSeen = false;
    for (let tick = 0; tick < 40 && !waitingSeen; tick += 1) {
      for (const record of mockFieldAt(tick).agents) {
        if (record.state?.state.permissions.length) waitingSeen = true;
      }
    }
    expect(waitingSeen, "no permission request is ever raised").toBe(true);
  });
});
