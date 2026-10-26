import {
  AGENT_FIELD,
  AgentDeskRow,
  type AgentFieldDelta,
  AgentListResult,
  type AgentSessionSummary,
  PRODUCT_API_LIMITS,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentListFor,
  boundText,
  createFieldSubscription,
  FieldProjection,
  projectDeskRow,
  projectFieldRow,
} from "../src/agent-field";
import { managedSummary as summary } from "./agent-field-summary";

// DS-3 (DS-D4) — the DESK projection, the chain's epoch and the heartbeat: the
// three things the mesh board asks of one desktop's own board. The fold rows
// come from `agent-field-summary.ts` (puppeteer's real shapes); a question
// blocker and a cost are written onto its mirror here, in the shapes
// `puppeteer/packages/core/src/monitor/types.ts` gives them.

const board = (...sessions: AgentSessionSummary[]): AgentListResult => ({ sessions });

/** A run blocked on a structured question (puppeteer's `kind: "question"`
 * arm: `questions[].prompt`, beside a `detail` the desk does not carry). */
function asking(base: AgentSessionSummary, prompt: string): AgentSessionSummary {
  const monitor = base.monitor;
  if (monitor === undefined) throw new Error("a question needs a mirror");
  return {
    ...base,
    status: "blocked",
    monitor: {
      ...monitor,
      status: "blocked",
      blockers: [
        {
          id: "q-1",
          kind: "question",
          since: "2026-09-30T21:14:02.000Z",
          detail: "the provider's own sentence about the question",
          questions: [{ prompt, options: [{ label: "Keep it" }, { label: "Drop it" }] }],
        },
      ],
    },
  };
}

/** Puppeteer's cost, as its usage aggregate carries it. */
function costing(base: AgentSessionSummary, costUsd: number, costCoverage: string) {
  const monitor = base.monitor;
  if (monitor === undefined) throw new Error("a cost needs a mirror");
  return {
    ...base,
    monitor: { ...monitor, usage: { ...(monitor.usage ?? {}), costUsd, costCoverage } },
  } as AgentSessionSummary;
}

describe("projectDeskRow — the field row plus the reply line, the question and the cost", () => {
  it("says every field fact the field's way, and adds only the desk's three", () => {
    const run = costing(
      asking(
        summary({ lastAssistantText: "Keeping it greyed.", cumulativeTokens: 900 }),
        "Keep it?",
      ),
      4.04,
      "complete",
    );
    const field = projectFieldRow(run);
    const desk = projectDeskRow(run);
    for (const [key, value] of Object.entries(field)) {
      if (key === "blockers" || key === "usage" || key === "nativeSessionId") continue;
      expect(desk[key], key).toEqual(value);
    }
    // the only NEW key is the reply line; the question and the cost ride
    // inside the blocker and the usage the field row already carries
    expect(Object.keys(desk).filter((key) => !(key in field))).toEqual(["lastAssistantMessage"]);
    expect(desk["lastAssistantMessage"]).toEqual({ text: "Keeping it greyed.", final: true });
    expect(desk.blockers).toEqual([{ ...field.blockers[0], question: "Keep it?" }]);
    expect(desk.usage).toEqual({ ...field.usage, costUsd: 4.04, costCoverage: "complete" });
    // and the contract reads it as a desk row
    expect(AgentDeskRow.safeParse({ ...desk, revision: 1 }).success).toBe(true);
  });

  it("PJ-7 — leaves the field row's conversation id off: the phone's cut carries it, a window reads its own runs' ids from `local`, a peer's desk wants none", () => {
    const run = summary({});
    expect(projectFieldRow(run).nativeSessionId).toBe(run.sessionId);
    expect(projectDeskRow(run)).not.toHaveProperty("nativeSessionId");
    const window = projectDeskRow(run, undefined, undefined, "window") as Record<string, unknown>;
    expect(window).not.toHaveProperty("nativeSessionId");
    expect((window["local"] as { nativeSessionId?: string }).nativeSessionId).toBe(run.sessionId);
  });

  it("bounds the reply and the question to the registry's number", () => {
    const long = "word ".repeat(200);
    const desk = projectDeskRow(asking(summary({ lastAssistantText: long }), long));
    const text = (desk["lastAssistantMessage"] as { text: string }).text;
    expect(Array.from(text)).toHaveLength(AGENT_FIELD.DESK_TEXT_CHARS);
    expect(text.endsWith("…")).toBe(true);
    const question = desk.blockers[0]?.["question"] as string;
    expect(Array.from(question)).toHaveLength(AGENT_FIELD.DESK_TEXT_CHARS);
  });

  it("is content for one person's desktops, not everything: no path, title, mirror or blocker input", () => {
    const desk = projectDeskRow(
      asking(summary({ lastAssistantText: "hi", title: "a title", cwd: "/Users/me/repo" }), "?"),
    );
    for (const key of ["monitor", "title", "workspace"]) expect(desk).not.toHaveProperty(key);
    for (const key of ["detail", "questions", "input", "permission"]) {
      expect(desk.blockers[0]).not.toHaveProperty(key);
    }
    expect(JSON.stringify(desk)).not.toContain("/Users/");
  });

  it("says nothing it was not given: no reply, no question, no cost", () => {
    const desk = projectDeskRow(summary({ permissionTool: "Bash" }));
    expect(desk).not.toHaveProperty("lastAssistantMessage");
    expect(desk.blockers[0]).not.toHaveProperty("question");
    expect(desk).not.toHaveProperty("usage");
    // an unobserved run (no mirror at all) is the field row, exactly — less
    // the phone's conversation id (PJ-7)
    const pending = summary({ monitor: false, pending: "not attached yet" });
    const { nativeSessionId: _phones, ...field } = projectFieldRow(pending);
    expect(projectDeskRow(pending)).toEqual(field);
  });
});

describe("item 60 — agent.list for its reader (agentListFor)", () => {
  /** a run doing something, asking something, with a long latest reply */
  const talking = (i: number, text: string): AgentSessionSummary => {
    const run = asking(summary({ runtimeRunId: `run-${i}`, lastAssistantText: text }), text);
    const monitor = run.monitor;
    if (monitor === undefined) throw new Error("a reply needs a mirror");
    return {
      ...run,
      monitor: { ...monitor, activity: { kind: "tool", line: text, since: monitor.statusSince } },
    };
  };
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
  const points = (text: unknown) => Array.from(String(text)).length;
  const ACROSS = ["peer-fieldd", "tailnet", "tailnet-guest"];
  const LOCAL = ["local-token", "shell-main", "plugin", "mcp-agent"];

  it("thirty 150 KB replies — item 60's measurement — reach a caller across the tailnet bounded, under PeerLink's reader; a window reads them whole", () => {
    const reply = "word ".repeat(30_000);
    const fold = board(...Array.from({ length: 30 }, (_, i) => talking(i, reply)));
    // the measurement's case: the whole fold is past the 4 MiB reader
    expect(bytes(fold)).toBeGreaterThan(PRODUCT_API_LIMITS.WS_MAX_INBOUND_BYTES);
    for (const kind of LOCAL) expect(agentListFor(kind, fold), kind).toBe(fold);
    for (const kind of ACROSS) {
      const cut = agentListFor(kind, fold);
      expect(bytes(cut), kind).toBeLessThan(PRODUCT_API_LIMITS.WS_MAX_INBOUND_BYTES / 16);
      expect(AgentListResult.safeParse(cut).success, kind).toBe(true);
      for (const [index, row] of cut.sessions.entries()) {
        const monitor = row.monitor as unknown as Record<string, unknown> & {
          lastAssistantMessage: { text: string; final?: boolean };
          activity: { line: string };
          blockers: Array<{ questions: Array<{ prompt: string; options: unknown[] }> }>;
        };
        expect(points(monitor.lastAssistantMessage.text)).toBe(AGENT_FIELD.DESK_TEXT_CHARS);
        expect(monitor.lastAssistantMessage.text.endsWith("…")).toBe(true);
        expect(monitor.lastAssistantMessage.final).toBe(true);
        expect(points(monitor.activity.line)).toBe(AGENT_FIELD.DESK_TEXT_CHARS);
        expect(points(monitor.blockers[0]?.questions[0]?.prompt)).toBe(AGENT_FIELD.DESK_TEXT_CHARS);
        expect(monitor.blockers[0]?.questions[0]?.options).toHaveLength(2);
        // nothing else of the row moved
        const whole = fold.sessions[index] as AgentSessionSummary;
        expect({ ...row, monitor: undefined }).toEqual({ ...whole, monitor: undefined });
        expect(monitor["revision"]).toBe(whole.monitor?.revision);
      }
    }
  });

  it("a short text, a row with no mirror and a blocker with no questions pass as they are", () => {
    const fold = board(
      talking(1, "Keeping it greyed."),
      summary({ runtimeRunId: "run-2", monitor: false }),
      summary({ runtimeRunId: "run-3", permissionTool: "Bash" }),
    );
    for (const kind of ACROSS) expect(agentListFor(kind, fold), kind).toEqual(fold);
  });
});

describe("boundText", () => {
  it("keeps a short text whole and cuts a long one at the bound with an ellipsis", () => {
    expect(boundText("hello", 5)).toBe("hello");
    expect(boundText("hello!", 5)).toBe("hell…");
  });

  it("counts code points, and never cuts through a surrogate pair", () => {
    const emoji = "😀".repeat(10); // 20 UTF-16 units, 10 code points
    expect(boundText(emoji, 10)).toBe(emoji);
    const cut = boundText(emoji, 4);
    expect(Array.from(cut)).toEqual(["😀", "😀", "😀", "…"]);
    // a megabyte-long reply is cut without walking it
    expect(Array.from(boundText("x".repeat(1_000_000), 280))).toHaveLength(280);
  });
});

describe("the desk board and the field board move on different facts", () => {
  it("a new reply line moves a desk row and leaves a field row where it was", () => {
    const desk = new FieldProjection(projectDeskRow);
    const field = new FieldProjection();
    desk.apply(board(summary({ lastAssistantText: "one" })));
    field.apply(board(summary({ lastAssistantText: "one" })));
    expect(desk.apply(board(summary({ lastAssistantText: "two" })))?.upserts).toHaveLength(1);
    expect(field.apply(board(summary({ lastAssistantText: "two" })))).toBeNull();
  });
});

describe("createFieldSubscription — the chain's epoch and the heartbeat (DS-3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fold(initial: AgentListResult) {
    let current = initial;
    const listeners = new Set<(rows: AgentListResult) => void>();
    return {
      list: () => current,
      subscribe: (fn: (rows: AgentListResult) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      publish(next: AgentListResult) {
        current = next;
        for (const fn of [...listeners]) fn(next);
      },
    };
  }

  it("stamps its epoch on the snapshot and on every delta", () => {
    const source = fold(board(summary()));
    const frames: AgentFieldDelta[] = [];
    const sub = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => frames.push(delta),
      minIntervalMs: 100,
      epoch: "fieldd-test.7",
    });
    expect(sub.snapshot).toMatchObject({ epoch: "fieldd-test.7", revision: 1 });
    source.publish(board(summary({ status: "working" })));
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([
      expect.objectContaining({ epoch: "fieldd-test.7", since: 1, revision: 2 }),
    ]);
    sub.dispose();
  });

  it("a heartbeat is an empty delta at the revision last sent, spoken only into silence", () => {
    const source = fold(board(summary()));
    const frames: AgentFieldDelta[] = [];
    const sub = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => frames.push(delta),
      minIntervalMs: 100,
      epoch: "fieldd-test.1",
      heartbeatMs: 1_000,
    });
    vi.advanceTimersByTime(999);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(frames).toEqual([
      { epoch: "fieldd-test.1", since: 1, revision: 1, upserts: [], removed: [] },
    ]);
    // a real frame re-arms the clock: the next beat is a full period after it
    vi.advanceTimersByTime(500);
    source.publish(board(summary({ status: "working" })));
    vi.advanceTimersByTime(100);
    expect(frames.at(-1)).toMatchObject({ since: 1, revision: 2 });
    vi.advanceTimersByTime(999);
    expect(frames).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(frames.at(-1)).toEqual({
      epoch: "fieldd-test.1",
      since: 2,
      revision: 2,
      upserts: [],
      removed: [],
    });
    sub.dispose();
    vi.advanceTimersByTime(5_000);
    expect(frames).toHaveLength(3);
  });

  it("asks for no heartbeat by default: a window's stream is exactly as before", () => {
    const source = fold(board(summary()));
    const frames: AgentFieldDelta[] = [];
    const sub = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => frames.push(delta),
    });
    expect(sub.snapshot).not.toHaveProperty("epoch");
    vi.advanceTimersByTime(60_000);
    expect(frames).toHaveLength(0);
    sub.dispose();
  });
});
