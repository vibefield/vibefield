import { emptySetupLedger } from "@vibefield/contracts/setup";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_WAIT,
  type ApprovalWaitRow,
  ApprovalWaits,
  approvalWaitOpen,
  approvalWaitStands,
} from "../src/account/approval-wait";
import { approvalWaited } from "../src/account/link";

// TS-4b (TS-D20 ruled A 2026-10-29; DESIGN.md §8 "Asking again") — an approval
// of this Mac's agent that waited more than ten minutes is said as it clears,
// timed by the backend's clocks, under the nudge's rules.

const T0 = Date.UTC(2026, 10, 2, 16, 0, 0);
const MIN = 60_000;

function row(overrides: Partial<ApprovalWaitRow> = {}): ApprovalWaitRow {
  return {
    id: "a1",
    kind: "agent",
    status: "working",
    statusSince: T0,
    alive: true,
    device: { self: true },
    project: { name: "vibe-field" },
    provider: { id: "claude-code", label: "Claude Code" },
    ...overrides,
  };
}
const waiting = (since: number, kind = "permission"): Partial<ApprovalWaitRow> => ({
  status: "blocked",
  statusSince: since,
  wait: { kind, since },
});

describe("the approval waits a window watches (TS-4b)", () => {
  it("answers a wait that cleared after more than ten minutes, timed by the backend", () => {
    const waits = new ApprovalWaits();
    expect(waits.observe([row(waiting(T0))])).toEqual([]);
    const cleared = waits.observe([row({ status: "working", statusSince: T0 + 14 * MIN })]);
    expect(cleared).toEqual([
      {
        rowId: "a1",
        clearedAt: T0 + 14 * MIN,
        waitedMs: 14 * MIN,
        project: "vibe-field",
        provider: { id: "claude-code", label: "Claude Code" },
      },
    ]);
    // said once: the next read is quiet
    expect(waits.observe([row({ status: "working", statusSince: T0 + 14 * MIN })])).toEqual([]);
  });

  it("says nothing for a short wait, a question, or a wait it never saw waiting", () => {
    const short = new ApprovalWaits();
    short.observe([row(waiting(T0))]);
    expect(short.observe([row({ statusSince: T0 + APPROVAL_WAIT.LONG_MS })])).toEqual([]);
    const question = new ApprovalWaits();
    question.observe([row(waiting(T0, "question"))]);
    expect(question.observe([row({ statusSince: T0 + 30 * MIN })])).toEqual([]);
    // a launch is never the moment: the first read sees only what is
    expect(new ApprovalWaits().observe([row({ statusSince: T0 + 30 * MIN })])).toEqual([]);
  });

  it("reads only this Mac's agents, and nothing of a run that ended while it waited", () => {
    const waits = new ApprovalWaits();
    waits.observe([
      row(waiting(T0)),
      row({ id: "t1", kind: "terminal", ...waiting(T0) }),
      row({ id: "p1", device: { self: false }, ...waiting(T0) }),
      row({ id: "a2", ...waiting(T0) }),
    ]);
    const later = T0 + 20 * MIN;
    const cleared = waits.observe([
      row({ statusSince: later, alive: false }),
      row({ id: "t1", kind: "terminal", statusSince: later }),
      row({ id: "p1", device: { self: false }, statusSince: later }),
    ]);
    expect(cleared).toEqual([]);
    // a2 left the model: its wait is forgotten, so its return says nothing
    expect(waits.observe([row({ id: "a2", statusSince: later })])).toEqual([]);
  });

  it("ends a wait at the next one's start, and answers the longest first", () => {
    const waits = new ApprovalWaits();
    waits.observe([row(waiting(T0)), row({ id: "a2", ...waiting(T0 + MIN) })]);
    const cleared = waits.observe([
      // a second approval right after the first: the first ended where it began
      row(waiting(T0 + 12 * MIN)),
      row({ id: "a2", status: "idle", statusSince: T0 + 31 * MIN }),
    ]);
    expect(cleared.map((fact) => [fact.rowId, fact.waitedMs])).toEqual([
      ["a2", 30 * MIN],
      ["a1", 12 * MIN],
    ]);
  });
});

describe("whether the line may be said (TS-4b)", () => {
  const putOff = (moments: Record<string, unknown> = {}) =>
    ({
      ...emptySetupLedger(),
      steps: { devices: { state: "later", at: "2026-10-28T09:00:00.000Z" } },
      moments,
    }) as ReturnType<typeof emptySetupLedger>;
  const open = { offersConnect: true, asksOn: true, ledger: putOff(), now: T0 };

  it("is open only unconnected, with the switch read and on, and Devices put off", () => {
    expect(approvalWaitOpen(open)).toBe(true);
    expect(approvalWaitOpen({ ...open, offersConnect: false })).toBe(false);
    expect(approvalWaitOpen({ ...open, asksOn: false })).toBe(false);
    expect(approvalWaitOpen({ ...open, asksOn: null })).toBe(false);
    expect(approvalWaitOpen({ ...open, ledger: null })).toBe(false);
    expect(approvalWaitOpen({ ...open, ledger: emptySetupLedger() })).toBe(false);
  });

  it("keeps the place's month and the day across places", () => {
    const at = (ago: number) => new Date(T0 - ago).toISOString();
    const month = putOff({
      "connect-ask:approval-wait": { state: "asked", at: at(29 * 86_400_000) },
    });
    expect(approvalWaitOpen({ ...open, ledger: month })).toBe(false);
    const day = putOff({ "connect-ask:away": { state: "asked", at: at(MIN) } });
    expect(approvalWaitOpen({ ...open, ledger: day })).toBe(false);
  });
});

describe("the line's words and its standing", () => {
  it("says the wait in whole minutes, and hours past the first", () => {
    expect(approvalWaited(14 * MIN + 59_000)).toBe("It waited 14m for you.");
    expect(approvalWaited(72 * MIN)).toBe("It waited 1h 12m for you.");
  });

  it("stands until its row moves or leaves", () => {
    const fact = { rowId: "a1", clearedAt: T0, waitedMs: 14 * MIN, project: "vibe-field" };
    expect(approvalWaitStands(fact, [{ id: "a1", statusSince: T0 }])).toBe(true);
    expect(approvalWaitStands(fact, [{ id: "a1", statusSince: T0 + 1 }])).toBe(false);
    expect(approvalWaitStands(fact, [])).toBe(false);
  });
});
