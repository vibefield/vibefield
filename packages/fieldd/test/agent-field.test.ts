import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentFieldRow,
  type AgentListResult,
  type AgentSessionSummary,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFieldSubscription,
  diffFieldRows,
  FieldProjection,
  projectFieldRow,
} from "../src/agent-field";
import { managedSummary as summary } from "./agent-field-summary";

// MF-1 (§5, §10.2) — the field projection, its revision counters, and one
// subscriber's cadence. The fold rows come from `agent-field-summary.ts`,
// which says why they are built here rather than borrowed from the renderer.

const board = (...sessions: AgentSessionSummary[]): AgentListResult => ({ sessions });

/** THE ALLOWLIST. The contract names the field row's vocabulary, so the
 * contract is where this test reads it — a denylist of content names could
 * only ever refuse the leaks someone thought of, and `AgentFieldRow` is
 * `.passthrough()`, so one stray property in `projectFieldRow` would ride to
 * every phone unnoticed. */
const CONTRACT_KEYS = Object.keys(AgentFieldRow.shape).sort();
/** what the producer emits: the contract's keys, minus the counter the
 * projection itself does not stamp */
const PRODUCED_KEYS = CONTRACT_KEYS.filter((key) => key !== "revision");

/** A fold row carrying EVERY fact the projection can read and every piece of
 * content it must refuse. */
const maximalSummary = (): AgentSessionSummary => ({
  ...summary({
    status: "blocked",
    permissionTool: "Bash",
    alive: true,
    // pending + alive is the one summary that carries both the mirror and the
    // AR-4 pending fact, so the row can show every optional at once
    pending: "the adapter would not attach",
    cumulativeTokens: 900,
    contextPercent: 41,
    effort: { value: "high", intent: "observed" },
    git: { branch: "main" },
    lastAssistantText: "a reply that must never travel",
    title: "a title that must never travel",
  }),
  profileId: "work",
  lastActivityAt: "2026-09-13T10:06:00.000Z",
});

describe("projectFieldRow — facts kept, content dropped (§10.1)", () => {
  it("emits EXACTLY the keys the contract names — an allowlist, not a denylist", () => {
    // Over a summary that carries every content field there is, the produced
    // row's key set is the contract's own. A new property in `projectFieldRow`
    // — however innocently named — fails here, which is the only check that
    // scales: the row is `.passthrough()`, so nothing downstream would stop it.
    expect(Object.keys(projectFieldRow(maximalSummary())).sort()).toEqual(PRODUCED_KEYS);
    // and a sparse row is a SUBSET of the same vocabulary, never a superset
    for (const row of [
      projectFieldRow(summary({ monitor: false })),
      projectFieldRow(summary({})),
    ]) {
      for (const key of Object.keys(row)) expect(PRODUCED_KEYS).toContain(key);
    }
  });

  it("speaks the same vocabulary as the golden the phone decodes", () => {
    // The contracts suite asserts the GOLDEN carries no content; this asserts
    // the PRODUCER and that golden cannot drift apart — a fixture nobody
    // produces is a fixture that can quietly stop describing the product.
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "contracts",
      "fixtures",
      "agent-field-slice.valid.json",
    );
    const golden = JSON.parse(readFileSync(fixture, "utf8")) as {
      rows: Array<Record<string, unknown>>;
    };
    const goldenKeys = [...new Set(golden.rows.flatMap((row) => Object.keys(row)))].sort();
    // the golden exercises every field the contract names — no more, no less
    expect(goldenKeys).toEqual(CONTRACT_KEYS);
    // and every key this producer can emit is one that golden shows
    expect(PRODUCED_KEYS.filter((key) => !goldenKeys.includes(key))).toEqual([]);
  });

  it("carries no content, whatever the fold's row holds", () => {
    const row = projectFieldRow(
      summary({
        permissionTool: "Bash",
        lastAssistantText: "I will now rewrite the universe",
        title: "the universe",
      }),
    );
    const keys = Object.keys(row);
    for (const absent of ["monitor", "lastAssistantMessage", "title", "workspace", "sessionId"]) {
      expect(keys, `field row must not carry ${absent}`).not.toContain(absent);
    }
    // and the blocker keeps its shape, not its words
    expect(row.blockers).toEqual([
      { id: "perm-1", kind: "permission", since: "2026-09-13T10:04:00.000Z", tool: "Bash" },
    ]);
  });

  it("reads a permission's tool from puppeteer's real shape, and tolerates its absence", () => {
    expect(projectFieldRow(summary({ permissionTool: "Edit" })).blockers[0]?.tool).toBe("Edit");
    // a permission observed before its tool is known carries none — upstream's
    // own field is optional, so this must not invent one
    expect(projectFieldRow(summary({ permissionTool: null })).blockers[0]?.tool).toBeUndefined();
    expect(projectFieldRow(summary({})).blockers).toEqual([]);
  });

  it("rebuilds usage and context instead of spreading the mirror's own objects", () => {
    const row = projectFieldRow(summary({ cumulativeTokens: 900, contextPercent: 41 }));
    // no samples, no asOf, no capacity — the phone keeps those ledgers itself
    expect(row.usage).toEqual({ cumulativeTokens: 900, burnRatePerMin: 120 });
    expect(row.context).toEqual({ usedPercent: 41 });
    expect(row.model).toEqual({ id: "claude-opus-5", displayName: "Opus 5" });
  });

  it("reads effort tolerantly — it rides the mirror's passthrough, not its schema", () => {
    expect(
      projectFieldRow(summary({ effort: { value: "high", intent: "observed" } })).effort,
    ).toEqual({ value: "high", intent: "observed" });
    // `configured`/`asOf` are upstream's, not the field's
    expect(
      projectFieldRow(summary({ effort: { value: "low", configured: "high", asOf: "x" } })).effort,
    ).toEqual({ value: "low" });
    // a shape this projection cannot read is simply absent, never a throw
    expect(projectFieldRow(summary({ effort: { configured: "high" } })).effort).toBeUndefined();
    expect(projectFieldRow(summary({})).effort).toBeUndefined();
  });

  it("takes the project from the monitor's environment, honestly about git", () => {
    // nothing looked: no branch key at all, which is NOT the same as "none"
    expect(projectFieldRow(summary({ cwd: "/repo" })).project).toEqual({ cwd: "/repo" });
    expect(projectFieldRow(summary({ cwd: "/repo", git: { branch: "mf/fd1" } })).project).toEqual({
      cwd: "/repo",
      branch: "mf/fd1",
    });
    // looked, and this is not a repo — null is a fact a card can draw
    expect(projectFieldRow(summary({ cwd: "/repo", git: null })).project).toEqual({
      cwd: "/repo",
      branch: null,
    });
    // a repo with no branch (a detached head) is the same honest null
    expect(projectFieldRow(summary({ cwd: "/repo", git: { branch: null } })).project).toEqual({
      cwd: "/repo",
      branch: null,
    });
  });

  it("keeps the terminal join verbatim — it is what a card attaches through (G3)", () => {
    const terminal = {
      hosted: "local" as const,
      runtimeSessionId: "pty-9",
      cellBootId: "cell-2",
      workloadClass: "agent",
      replaced: "pty-8",
    };
    expect(projectFieldRow(summary({ terminal })).terminal).toEqual(terminal);
    expect(projectFieldRow(summary({ terminal: { hosted: "none" } })).terminal).toEqual({
      hosted: "none",
    });
  });

  it("takes liveness from the mirror when there is one", () => {
    expect(projectFieldRow(summary({ alive: true })).alive).toBe(true);
    expect(projectFieldRow(summary({ alive: false })).alive).toBe(false);
  });

  it("a pending row is ALIVE while its PTY is hosted — unobserved is not gone", () => {
    // AR-4 (ruled 2026-09-13). This run has no monitor: fieldd could not
    // re-attach, so nothing is driving it. Its PTY is still on this device's
    // floor and fieldd will re-adopt or resume it, so the run IS alive, and
    // `pending` is the field that says nobody is at the wheel. Answering
    // `alive: false` here would read as GONE and drop a live agent off a phone.
    const pending = projectFieldRow(
      summary({ monitor: false, pending: "the adapter would not attach", status: "unknown" }),
    );
    expect(pending.alive).toBe(true);
    expect(pending.pending).toBe("resume-when-idle");
    expect(pending.terminal?.hosted).toBe("local");
    // and its `statusSince` falls back to the moment this boot learned of it
    expect(pending.statusSince).toBe("2026-09-13T10:05:00.000Z");
    expect(pending.blockers).toEqual([]);
  });

  it("a witnessed exit outranks the mirror and the pane (MF-1f)", () => {
    // The run's process is over — fieldd watched it end — while the floor
    // still lists the PTY so the deck can show the dead pane with its resume
    // verb. The mirror may not have caught up (a reading in flight), and the
    // terminal is still `local`; neither may be allowed to report a corpse as
    // a working agent.
    const stale = projectFieldRow(summary({ exited: true, alive: true, status: "working" }));
    expect(stale.alive).toBe(false);
    expect(stale.terminal?.hosted).toBe("local");
    // and it is NOT pending — a different question, and a different verb
    expect(stale.pending).toBeUndefined();
    // after a restart nothing observed it at all, and the answer is the same
    const restarted = projectFieldRow(summary({ exited: true, monitor: false }));
    expect(restarted.alive).toBe(false);
  });

  it("without a mirror, the floor's listing is the whole witness", () => {
    // the PTY is gone: no mirror, nothing hosted, nothing to claim
    const gone = projectFieldRow(
      summary({
        monitor: false,
        pending: "the adapter would not attach",
        terminal: { hosted: "none" },
      }),
    );
    expect(gone.alive).toBe(false);
    // and a row carrying no terminal at all is not alive either — absence of a
    // PTY is not evidence of one
    const homeless = projectFieldRow(summary({ monitor: false, noTerminal: true }));
    expect(homeless.alive).toBe(false);
  });
});

describe("FieldProjection — the revision that makes an idle board free (§10.2)", () => {
  it("bumps a row's revision only when its PROJECTION changed", () => {
    const projection = new FieldProjection();
    expect(projection.apply(board(summary({ cumulativeTokens: 100 })))).not.toBeNull();
    expect(projection.snapshot().rows[0]?.revision).toBe(1);

    // the mirror revised (a usage sample landed) but nothing the field carries
    // moved: no frame at all
    const quiet = summary({ cumulativeTokens: 100 });
    quiet.monitor = { ...quiet.monitor!, revision: 99 };
    expect(projection.apply(board(quiet))).toBeNull();
    expect(projection.snapshot().rows[0]?.revision).toBe(1);

    // now a field fact moves
    expect(projection.apply(board(summary({ cumulativeTokens: 200 })))).not.toBeNull();
    expect(projection.snapshot().rows[0]?.revision).toBe(2);
  });

  it("an idle board sends nothing, ever", () => {
    const projection = new FieldProjection();
    projection.apply(board(summary(), summary({ runtimeRunId: "run-2" })));
    for (let i = 0; i < 50; i += 1) {
      expect(projection.apply(board(summary(), summary({ runtimeRunId: "run-2" })))).toBeNull();
    }
    expect(projection.revision).toBe(1);
  });

  it("chains `since` → `revision` across frames, and withdraws a row that left", () => {
    const projection = new FieldProjection();
    projection.apply(board(summary(), summary({ runtimeRunId: "run-2" })));
    expect(projection.revision).toBe(1);

    const first = projection.apply(board(summary({ status: "working" })));
    expect(first).toMatchObject({ since: 1, revision: 2, removed: ["run-2"] });
    expect(first?.upserts.map((row) => row.runtimeRunId)).toEqual(["run-1"]);

    const second = projection.apply(board(summary({ status: "blocked", permissionTool: "Bash" })));
    // a client applies this on top of what the first frame left it at
    expect(second).toMatchObject({ since: 2, revision: 3, removed: [] });
    expect(second?.upserts[0]?.revision).toBe(3);
    expect(projection.snapshot()).toMatchObject({ revision: 3 });
  });

  it("hands out copies, so a consumer cannot mutate the board it will diff against", () => {
    const projection = new FieldProjection();
    projection.apply(board(summary()));
    const snapshot = projection.snapshot();
    snapshot.rows[0]!.status = "blocked";
    expect(projection.snapshot().rows[0]?.status).toBe("idle");
    expect(projection.apply(board(summary()))).toBeNull();
  });
});

describe("diffFieldRows", () => {
  const row = (runtimeRunId: string, revision: number) =>
    ({ ...projectFieldRow(summary({ runtimeRunId })), revision }) as never;

  it("upserts what moved, removes what left, and repeats nothing", () => {
    const prev = [row("a", 1), row("b", 4)];
    const next = [row("a", 1), row("b", 5), row("c", 1)];
    const diff = diffFieldRows(prev, next);
    expect(diff.upserts.map((r) => r.runtimeRunId)).toEqual(["b", "c"]);
    expect(diff.removed).toEqual([]);
    expect(diffFieldRows(next, [row("a", 1)])).toEqual({ upserts: [], removed: ["b", "c"] });
  });
});

describe("createFieldSubscription — one subscriber's floor (§5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** the fold's own publish stream, as `AgentRuntimeService.subscribe` gives it */
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
      get subscribers() {
        return listeners.size;
      },
    };
  }

  it("answers a snapshot now and coalesces a burst into one trailing frame", () => {
    const source = fold(board(summary()));
    const frames: unknown[] = [];
    const sub = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => frames.push(delta),
      minIntervalMs: 250,
    });
    expect(sub.snapshot).toMatchObject({ revision: 1 });
    expect(sub.snapshot.rows).toHaveLength(1);

    // twenty publishes inside one window
    for (let i = 0; i < 20; i += 1) {
      source.publish(board(summary({ status: i % 2 === 0 ? "working" : "idle" })));
    }
    source.publish(board(summary({ status: "blocked", permissionTool: "Bash" })));
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(249);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(frames).toHaveLength(1);
    // ONE frame, carrying the LAST state — the flaps in between are not
    // history the field owes anyone, they are what a 250 ms floor MEANS
    expect(frames[0]).toMatchObject({ since: 1, revision: 2 });
    const [frame] = frames as [{ upserts: { status: string }[] }];
    expect(frame.upserts.map((row) => row.status)).toEqual(["blocked"]);
    sub.dispose();
  });

  it("sends nothing for a burst that ends where it started", () => {
    // The honest consequence of a trailing-edge floor: a run that flapped
    // working → idle → working inside one window is, at the end of that
    // window, exactly what the subscriber already believes. Sending a frame
    // would cost a phone's radio to tell it nothing.
    const source = fold(board(summary({ status: "idle" })));
    const frames: unknown[] = [];
    const sub = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => frames.push(delta),
      minIntervalMs: 250,
    });
    for (const status of ["working", "blocked", "working", "idle"] as const) {
      source.publish(board(summary({ status })));
    }
    vi.advanceTimersByTime(250);
    expect(frames).toEqual([]);
    sub.dispose();
  });

  it("stays silent when the window's publishes changed nothing the field carries", () => {
    const source = fold(board(summary({ cumulativeTokens: 10 })));
    const frames: unknown[] = [];
    const sub = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => frames.push(delta),
      minIntervalMs: 250,
    });
    for (let i = 0; i < 5; i += 1) {
      const quiet = summary({ cumulativeTokens: 10 });
      quiet.monitor = { ...quiet.monitor!, revision: 100 + i };
      source.publish(board(quiet));
    }
    vi.advanceTimersByTime(1_000);
    expect(frames).toEqual([]);
    sub.dispose();
  });

  it("keeps each subscriber's cadence and revision chain to itself", () => {
    const source = fold(board(summary()));
    const fast: unknown[] = [];
    const slow: unknown[] = [];
    const a = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => fast.push(delta),
      minIntervalMs: 100,
    });
    const b = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => slow.push(delta),
      minIntervalMs: 1_000,
    });
    source.publish(board(summary({ status: "working" })));
    vi.advanceTimersByTime(100);
    expect(fast).toHaveLength(1);
    expect(slow).toHaveLength(0);

    source.publish(board(summary({ status: "blocked", permissionTool: "Bash" })));
    vi.advanceTimersByTime(900);
    expect(fast).toHaveLength(2);
    // the slow reader got ONE frame carrying both moves, chained from its own
    // snapshot revision — not from the fast reader's
    expect(slow).toHaveLength(1);
    expect(slow[0]).toMatchObject({ since: 1, revision: 2 });
    a.dispose();
    b.dispose();
  });

  it("defaults to the registry's floor and lets go of the fold on dispose", () => {
    const source = fold(board(summary()));
    const frames: unknown[] = [];
    const sub = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: (delta) => frames.push(delta),
    });
    expect(source.subscribers).toBe(1);
    source.publish(board(summary({ status: "working" })));
    vi.advanceTimersByTime(249);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(frames).toHaveLength(1);

    sub.dispose();
    expect(source.subscribers).toBe(0);
    source.publish(board(summary({ status: "blocked" })));
    vi.advanceTimersByTime(5_000);
    expect(frames).toHaveLength(1);
  });

  it("logs a throwing consumer instead of tearing the fold's publish down", () => {
    const source = fold(board(summary()));
    const errors: unknown[] = [];
    const sub = createFieldSubscription({
      list: source.list,
      subscribe: source.subscribe,
      emit: () => {
        throw new Error("socket died mid-frame");
      },
      minIntervalMs: 10,
      onError: (error) => errors.push(error),
    });
    source.publish(board(summary({ status: "working" })));
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(errors).toHaveLength(1);
    sub.dispose();
  });
});
