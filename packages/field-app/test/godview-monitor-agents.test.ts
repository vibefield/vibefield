import type { SessionActivity, SessionSummary } from "@vibecook/ghosttea-protocol";
import { describe, expect, it } from "vitest";
import {
  assembleMonitorAgents,
  type MonitorManagedRecord,
  managedRowId,
  monitorAgentCounts,
  monitorAgentFromManaged,
  nextMonitorAgentForStatus,
} from "../src/godview/monitor/agents";
import { managedSummary } from "./managed-session-fixture";

// The reference app's `monitor/agents.test.ts`, ported at GT-3m and re-fed at
// AR-3: the records are now fieldd's fold rows (SessionSummary v2). This
// projection is the contract every view consumes, and it is pure — which is
// exactly why it can be tested with no renderer, no runtime and no terminal.

const ACCENTS = ["#a1", "#a2", "#a3", "#a4", "#a5", "#a6", "#a7", "#a8"] as const;

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    exited: false,
    createdAtMs: 0,
    cwd: "/project/vibe-field",
    ...overrides,
  } as SessionSummary;
}

function managed(
  runtimeRunId: string,
  terminalId: string,
  overrides: Parameters<typeof managedSummary>[0] = {},
  createdAtMs = 0,
): MonitorManagedRecord {
  return {
    summary: managedSummary({ runtimeRunId, terminalSessionId: terminalId, ...overrides }),
    session: session(terminalId, { createdAtMs }),
  };
}

describe("monitor agent assembly", () => {
  it("lists agents in launch order ahead of the terminals nothing has claimed", () => {
    const assembled = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [managed("run-b", "terminal-b", {}, 20), managed("run-a", "terminal-a", {}, 10)],
      terminals: [{ session: session("terminal-c") }],
    });
    // Two id spaces on one stage, deliberately: a managed row is its RUN, an
    // unclaimed terminal is its floor session.
    expect(assembled.map((agent) => agent.id)).toEqual(["run-a", "run-b", "terminal-c"]);
    expect(assembled.map((agent) => Boolean(agent.agent))).toEqual([true, true, false]);
  });

  it("drops a terminal placeholder once an agent claims its session", () => {
    const assembled = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [managed("run-a", "terminal-a")],
      terminals: [{ session: session("terminal-a") }],
    });
    expect(assembled).toHaveLength(1);
    // The row that survives is the RUN's. The floor session it claimed is not
    // its id but its JOIN — and the join is what dropped the placeholder, so
    // the two ids have to be read from different places to pass this.
    expect(assembled[0]?.id).toBe("run-a");
    expect(assembled[0]?.session?.id).toBe("terminal-a");
    expect(
      managedRowId(managedSummary({ runtimeRunId: "run-a", terminalSessionId: "terminal-a" })),
    ).toBe("run-a");
    expect(assembled[0]?.agent?.kind).toBe("codex");
    expect(assembled[0]?.agent?.provider).toBe("Codex");
    expect(assembled[0]?.agent?.tier).toBe("managed");
  });

  it("joins a managed row to the deck's summary of its PTY by the floor session id", () => {
    // The fold names the floor session; the deck holds the summary. When the
    // record arrives without one, the `sessions` map supplies it — the same
    // join the terminal placeholders use.
    const [agent] = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [{ summary: managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" }) }],
      terminals: [],
      sessions: new Map([["pty-a", session("pty-a", { createdAtMs: 77 })]]),
    });
    expect(agent?.session?.id).toBe("pty-a");
    expect(agent?.createdAtMs).toBe(77);
  });

  it("excludes exited sessions and runs puppeteer reports as no longer alive", () => {
    const exited = managed("run-a", "terminal-a");
    exited.session = session("terminal-a", { exited: true });
    const assembled = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [exited, managed("run-b", "terminal-b", { alive: false })],
      terminals: [],
    });
    expect(assembled).toEqual([]);
  });

  it("folds the shell-owned pane facts in, so no view looks them up itself", () => {
    const attachment = { primary: "#111", mirrors: ["#222"] };
    const [agent] = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [managed("run-a", "terminal-a")],
      terminals: [],
      attachments: new Map([["terminal-a", attachment]]),
      activeSessionId: "terminal-a",
    });
    expect(agent).toMatchObject({ active: true, attachment });
  });

  it("refreshes a terminal placeholder from the live session summary", () => {
    const [terminal] = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [],
      terminals: [{ session: session("terminal-a"), cwd: "/project/vibe-field" }],
      sessions: new Map([
        [
          "terminal-a",
          session("terminal-a", { activity: { kind: "foreground-job" } as SessionActivity }),
        ],
      ]),
    });
    expect(terminal).toMatchObject({ status: "working", project: "vibe-field" });
    expect(terminal?.agent).toBeUndefined();
  });

  it("cycles and counts agent-backed sessions only", () => {
    const assembled = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [
        managed("run-a", "terminal-a", { status: "blocked", blocker: { kind: "permission" } }, 10),
        managed("run-b", "terminal-b", { status: "blocked", blocker: { kind: "permission" } }, 20),
      ],
      terminals: [{ session: session("terminal-c") }],
    });
    // The cursor is a SESSION id (what the deck's active pane carries) and the
    // answer is a ROW — the two id spaces meeting, which is the whole reason
    // the cycle compares `session?.id` and not `id`.
    expect(nextMonitorAgentForStatus(assembled, "waiting", undefined)?.id).toBe("run-a");
    expect(nextMonitorAgentForStatus(assembled, "waiting", "terminal-a")?.id).toBe("run-b");
    expect(nextMonitorAgentForStatus(assembled, "waiting", "terminal-b")?.id).toBe("run-a");
    // The idle terminal is visible to views but is not an agent to navigate to.
    expect(nextMonitorAgentForStatus(assembled, "idle", undefined)).toBeUndefined();
    expect(monitorAgentCounts(assembled)).toEqual({ idle: 0, working: 0, waiting: 2 });
  });

  it("assigns a §2.6 accent from the set it was handed, stably per RUN", () => {
    // The restyle's own property (GT-D13): a relationship color is one of the
    // curated accents, chosen by the id and by nothing else — not a free hue,
    // and never a §2.5 status color. Since AR-3 the id is the RUN's, so the
    // same run keeps its color whichever pane shows it.
    const build = (
      terminalId: string,
    ): readonly ReturnType<typeof assembleMonitorAgents>[number][] =>
      assembleMonitorAgents({
        accents: ACCENTS,
        managed: [managed("run-a", terminalId), managed("run-b", "terminal-b", {}, 5)],
        terminals: [{ session: session("terminal-c") }],
      });
    const first = build("terminal-a");
    const second = build("terminal-a2");
    for (const agent of first) expect(ACCENTS).toContain(agent.color);
    expect(second.map((agent) => agent.color)).toEqual(first.map((agent) => agent.color));
  });

  it("keeps an authoritative not-a-repo from being overwritten by the workspace branch", () => {
    // A git observation whose value is null MEANS "this cwd is not in a repo".
    // Falling through to `workspace.branch` there would replace an answer with a
    // guess — the exact honesty failure the projection is written to avoid.
    const observedNull = managedSummary({
      runtimeRunId: "run-a",
      gitObserved: true,
      branch: null,
    });
    observedNull.workspace = { ...observedNull.workspace, mode: "direct", branch: "main" };
    const agent = monitorAgentFromManaged({ summary: observedNull }, ACCENTS);
    expect(agent?.agent?.branch).toBeUndefined();

    // …and with no git observation at all, the workspace's branch is the best
    // thing we know, so it IS used.
    const unobserved = monitorAgentFromManaged(
      { summary: managedSummary({ runtimeRunId: "run-b", branch: "main" }) },
      ACCENTS,
    );
    expect(unobserved?.agent?.branch).toBe("main");
  });

  it("carries the model and the context window from the monitor projection", () => {
    const agent = monitorAgentFromManaged(
      {
        summary: managedSummary({
          model: { id: "gpt-5-codex", displayName: "GPT-5 Codex" },
          contextPercent: 42.5,
        }),
      },
      ACCENTS,
    );
    expect(agent?.agent?.model).toBe("GPT-5 Codex");
    expect(agent?.agent?.contextWindow).toMatchObject({
      usedPercent: 42.5,
      modelId: "gpt-5-codex",
    });
    // …and the row itself rides along for a view that wants the rest
    expect(agent?.agent?.summary.monitor?.schemaVersion).toBe(2);
  });

  it("a run before its first monitor state is a real row, starting", () => {
    const agent = monitorAgentFromManaged(
      { summary: managedSummary({ status: "unknown", monitor: false }) },
      ACCENTS,
    );
    expect(agent).toMatchObject({ status: "working", detail: "starting" });
  });

  it("AR-4: a PENDING row reads idle and says so; a re-attached row is an ordinary row; a resumed row names the PTY it replaced", () => {
    // a live PTY fieldd could not re-attach to: no monitor, status unknown —
    // and the honest reading is idle with the reason in words, not "starting"
    const pending = monitorAgentFromManaged(
      { summary: managedSummary({ pending: "the adapter cannot attach to a running session" }) },
      ACCENTS,
    );
    expect(pending).toMatchObject({ status: "idle", detail: "unobserved · resumes when idle" });
    expect(pending?.agent?.summary.continuation?.pending).toBe("resume-when-idle");
    // re-attached across a restart: the same row as before the restart
    const reattached = monitorAgentFromManaged(
      { summary: managedSummary({ reattached: true, lastAssistantText: "done" }) },
      ACCENTS,
    );
    expect(reattached).toMatchObject({ status: "idle", detail: "done" });
    expect(reattached?.agent?.summary.continuation?.reattached).toBe(true);
    // resumed into a new PTY: the row's id is still the RUN, the new floor
    // session is the join, and the old one rides along for the pane hand-over
    const resumed = monitorAgentFromManaged(
      {
        summary: managedSummary({
          runtimeRunId: "run-2",
          terminalSessionId: "pty-2",
          replaced: "pty-1",
        }),
      },
      ACCENTS,
    );
    expect(resumed?.id).toBe("run-2");
    expect(resumed?.agent?.summary.terminal?.runtimeSessionId).toBe("pty-2");
    expect(resumed?.agent?.summary.terminal?.replaced).toBe("pty-1");
  });

  it("AR-4: a pending row whose mirror says the run is gone is not a row at all", () => {
    // ORDER, not truth: both branches are right about what they test, and the
    // one that has to be asked first is the FACT — "puppeteer says this run is
    // not alive" — because pending is a reading of a row still presumed to
    // exist. Asked second, it answered for a dead run and the stage drew it as
    // a live idle agent, which is the loudest lie this classifier can tell.
    const gone = monitorAgentFromManaged(
      { summary: managedSummary({ pending: "the adapter cannot attach", alive: false }) },
      ACCENTS,
    );
    expect(gone).toBeUndefined();
    // …and a pending row the mirror does not contradict is still AR-4's honest
    // idle row, with the reason in words
    const waiting = monitorAgentFromManaged(
      { summary: managedSummary({ pending: "the adapter cannot attach", alive: true }) },
      ACCENTS,
    );
    expect(waiting).toMatchObject({ status: "idle", detail: "unobserved · resumes when idle" });
  });

  it("AR-4: a run keeps its row id and its accent through the PTY swap, so the swarm keeps the bubble", () => {
    // The finding this rule exists for: keyed by the floor session, a
    // resume-when-idle made run-a a DIFFERENT row, and the swarm — which keys
    // its elements AND its physics bodies by `agent.id` — destroyed the bubble
    // and respawned a stranger in its place. The run is what the user is
    // watching; the PTY under it is an implementation detail of being watched.
    const before = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [managed("run-a", "pty-1")],
      terminals: [],
    });
    const after = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [managed("run-a", "pty-2", { replaced: "pty-1" })],
      terminals: [],
    });
    expect(before[0]?.id).toBe("run-a");
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.color).toBe(before[0]?.color);
    // …and the join moved, which is the half that SHOULD change
    expect(before[0]?.session?.id).toBe("pty-1");
    expect(after[0]?.session?.id).toBe("pty-2");
  });

  it("AR-4: the PTY a resumed run replaced is not a phantom unclaimed terminal", () => {
    // The pane is still showing the old PTY until the hand-over lands, so the
    // deck still reports it as a session — and the fold no longer names it as
    // anybody's `runtimeSessionId`. Left to the claimed-set alone it came back
    // as a terminal row: a bubble for a shell nobody opened, for exactly as
    // long as the remount took. The row that replaced it speaks for it.
    const assembled = assembleMonitorAgents({
      accents: ACCENTS,
      managed: [managed("run-a", "pty-2", { replaced: "pty-1" })],
      terminals: [{ session: session("pty-1") }, { session: session("pty-9") }],
    });
    expect(assembled.map((agent) => agent.id)).toEqual(["run-a", "pty-9"]);
  });
});
