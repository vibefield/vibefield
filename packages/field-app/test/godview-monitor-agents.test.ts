import type { SessionActivity, SessionSummary } from "@vibecook/ghosttea-protocol";
import { projectTint, type UsageHistory } from "@vibecook/puppeteer-views";
import { describe, expect, it } from "vitest";
import {
  assembleMonitorAgents,
  type MonitorColours,
  type MonitorManagedRecord,
  managedRowId,
  monitorAgentCounts,
  monitorAgentFromManaged,
  nextMonitorAgentForStatus,
} from "../src/godview/monitor/agents";
import { managedSummary } from "./managed-session-fixture";

// The reference app's `monitor/agents.test.ts`, ported at GT-3m, re-fed at AR-3
// and re-expressed at AR-5 over the views package's API: the row is the
// package's `MonitorAgent`, the status word is Core's three, and the colour is
// the PROJECT's dealt tint rather than one of eight accent slots. This
// projection is the contract every view consumes, and it is pure — which is
// exactly why it can be tested with no renderer, no runtime and no terminal.

/** The theme's tokens, passed in rather than read, so this file needs no
 * palette and no renderer (`MonitorColours` is the whole of what the fold
 * takes from the design system). The numbers are the record's own light tint. */
const COLOURS: MonitorColours = { tint: { l: 0.6, c: 0.15 }, neutral: "oklch(0.5 0 0)" };
/** Nothing has been dealt a sequence: every row wears the ramp. */
const NO_PROJECTS: ReadonlyMap<string, number> = new Map();
/** What the two pure entry points need of the input, and nothing else. */
const PURE = { colours: COLOURS, projectSeqs: NO_PROJECTS } as const;

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
      ...PURE,
      managed: [managed("run-b", "terminal-b", {}, 20), managed("run-a", "terminal-a", {}, 10)],
      terminals: [{ session: session("terminal-c") }],
    });
    // Two id spaces on one stage, deliberately: a managed row is its RUN, an
    // unclaimed terminal is its floor session.
    expect(assembled.map((agent) => agent.id)).toEqual(["run-a", "run-b", "terminal-c"]);
    expect(assembled.map((agent) => Boolean(agent.agent))).toEqual([true, true, false]);
  });

  it("SB-3: a terminal row and a floor row carry the Agent Profile their shell was born under, in fieldd's words", () => {
    const assembled = assembleMonitorAgents({
      ...PURE,
      managed: [],
      terminals: [{ session: session("work-shell") }, { session: session("bare-shell") }],
      floor: [{ sessionId: "unpaned-work", workloadClass: "interactive" }],
      profileSets: new Map([
        ["work-shell", "work"],
        ["unpaned-work", "work"],
      ]),
    });
    expect(assembled.map((agent) => [agent.id, agent.profileSet])).toEqual([
      ["work-shell", "work"],
      ["bare-shell", undefined],
      ["unpaned-work", "work"],
    ]);
    // a shell under none carries no key at all, rather than an undefined one
    expect("profileSet" in (assembled[1] ?? {})).toBe(false);
  });

  it("keeps spatial identity while actions and usage retain the managed run id", () => {
    const before = assembleMonitorAgents({
      ...PURE,
      managed: [],
      terminals: [{ session: session("shell") }],
    });
    const after = assembleMonitorAgents({
      ...PURE,
      managed: [managed("run", "agent-pty")],
      terminals: [],
      visualIds: new Map([["agent-pty", "shell"]]),
    });
    expect(before[0]?.visualId).toBe("shell");
    expect(after[0]).toMatchObject({ id: "run", visualId: "shell" });
    const typed = assembleMonitorAgents({
      ...PURE,
      managed: [managed("run", "shell")],
      terminals: [],
    });
    expect(typed[0]).toMatchObject({ id: "run", visualId: "shell" });
  });

  it("keeps a run's bubble through subsequent PTY replacements", () => {
    const [agent] = assembleMonitorAgents({
      ...PURE,
      managed: [managed("run", "resumed-pty")],
      terminals: [],
      previousVisualIds: new Map([["run", "original-shell"]]),
    });
    expect(agent).toMatchObject({ id: "run", visualId: "original-shell" });
  });

  it("shows one body while a launcher handoff still has the old shell in the roster", () => {
    const rows = assembleMonitorAgents({
      ...PURE,
      managed: [managed("run", "agent-pty")],
      terminals: [{ session: session("shell") }],
      visualIds: new Map([["agent-pty", "shell"]]),
    });
    expect(rows.map((row) => [row.id, row.visualId])).toEqual([["run", "shell"]]);
  });

  it("drops a terminal placeholder once an agent claims its session", () => {
    const assembled = assembleMonitorAgents({
      ...PURE,
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
    // The provider is a REF since AR-5 — the open id beside the adapter's own
    // label — and `kind` is VibeField's own copy of the id on its extension.
    expect(assembled[0]?.agent?.provider).toEqual({ id: "codex", label: "Codex" });
    expect(assembled[0]?.agent?.kind).toBe("codex");
    expect(assembled[0]?.agent?.tier).toBe("managed");
  });

  it("joins a managed row to the deck's summary of its PTY by the floor session id", () => {
    // The fold names the floor session; the deck holds the summary. When the
    // record arrives without one, the `sessions` map supplies it — the same
    // join the terminal placeholders use.
    const [agent] = assembleMonitorAgents({
      ...PURE,
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
      ...PURE,
      managed: [exited, managed("run-b", "terminal-b", { alive: false })],
      terminals: [],
    });
    expect(assembled).toEqual([]);
  });

  it("folds the shell-owned pane facts in, so no view looks them up itself", () => {
    // The attachment is the PACKAGE's shape since AR-5: the pane a session is
    // worked in, every pane showing it, and that pane's own colour — a pane
    // owns its colour, the session wears it while mounted there.
    const attachment = { primaryPaneId: "pane-1", paneIds: ["pane-1", "pane-2"], color: "#a3" };
    const [agent] = assembleMonitorAgents({
      ...PURE,
      managed: [managed("run-a", "terminal-a")],
      terminals: [],
      attachments: new Map([["terminal-a", attachment]]),
      activeSessionId: "terminal-a",
    });
    // Keyed by the SESSION, not by the row: the deck knows PTYs, not runs.
    expect(agent).toMatchObject({ active: true, attachment });
  });

  it("refreshes a terminal placeholder from the live session summary", () => {
    const [terminal] = assembleMonitorAgents({
      ...PURE,
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
      ...PURE,
      managed: [
        managed("run-a", "terminal-a", { status: "blocked", blocker: { kind: "permission" } }, 10),
        managed("run-b", "terminal-b", { status: "blocked", blocker: { kind: "permission" } }, 20),
      ],
      terminals: [{ session: session("terminal-c") }],
    });
    // The cursor is a SESSION id (what the deck's active pane carries) and the
    // answer is a ROW — the two id spaces meeting, which is the whole reason
    // the cycle compares `session?.id` and not `id`.
    // AR-5b: the cycle compares ROW ids — the current row is the one the deck
    // marked active, and a managed row with no pane has no session at all, so
    // matching on a session id of undefined kept answering the same row
    expect(nextMonitorAgentForStatus(assembled, "blocked", undefined)?.id).toBe("run-a");
    expect(nextMonitorAgentForStatus(assembled, "blocked", "run-a")?.id).toBe("run-b");
    expect(nextMonitorAgentForStatus(assembled, "blocked", "run-b")?.id).toBe("run-a");
    // The idle terminal is visible to views but is not an agent to navigate to.
    expect(nextMonitorAgentForStatus(assembled, "idle", undefined)).toBeUndefined();
    expect(monitorAgentCounts(assembled)).toEqual({ idle: 0, working: 0, blocked: 2 });
  });

  it("wears its PROJECT's dealt tint, and the ramp for a project nothing has dealt", () => {
    // Record §02/D3, replacing GT-D13's eight accent slots: the colour is the
    // project's, not the row's, so two runs in one repository are visibly one
    // project and a bare terminal — which belongs to none — wears the ramp.
    const projectSeqs = new Map([
      ["/project/vibe-field", 0],
      ["/project/truffle", 3],
    ]);
    const assembled = assembleMonitorAgents({
      colours: COLOURS,
      projectSeqs,
      managed: [
        managed("run-a", "pty-a", { cwd: "/project/vibe-field" }, 10),
        managed("run-b", "pty-b", { cwd: "/project/vibe-field" }, 20),
        managed("run-c", "pty-c", { cwd: "/project/truffle" }, 30),
        managed("run-d", "pty-d", { cwd: "/project/undealt" }, 40),
      ],
      terminals: [{ session: session("terminal-e") }],
    });
    const [a, b, c, d, terminal] = assembled;
    expect(a?.color).toBe(projectTint(0, COLOURS.tint));
    expect(b?.color).toBe(a?.color);
    expect(c?.color).toBe(projectTint(3, COLOURS.tint));
    expect(c?.color).not.toBe(a?.color);
    // A project the ledger has not dealt yet, and a terminal that belongs to
    // no project at all, are the same case: the ramp, never an invented hue.
    expect(d?.color).toBe(COLOURS.neutral);
    expect(terminal?.color).toBe(COLOURS.neutral);
  });

  it("attaches the UI's usage history to the row it belongs to, keyed by the RUN", () => {
    // The package's ledger is folded above this seam and handed in by row id;
    // the key is the run, so a resume-when-idle keeps the burn history that a
    // key on the PTY would have thrown away.
    const history: UsageHistory = { total: 1234, steps: [0, 10, 20], stepMs: 60_000 };
    const [a, b] = assembleMonitorAgents({
      ...PURE,
      managed: [managed("run-a", "pty-a", {}, 10), managed("run-b", "pty-b", {}, 20)],
      terminals: [],
      usage: new Map([["run-a", history]]),
    });
    expect(a?.agent?.usage).toBe(history);
    expect(b?.agent?.usage).toBeUndefined();
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
    const agent = monitorAgentFromManaged({ summary: observedNull }, PURE);
    expect(agent?.agent?.branch).toBeUndefined();

    // …and with no git observation at all, the workspace's branch is the best
    // thing we know, so it IS used.
    const unobserved = monitorAgentFromManaged(
      { summary: managedSummary({ runtimeRunId: "run-b", branch: "main" }) },
      PURE,
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
      PURE,
    );
    expect(agent?.agent?.model).toBe("GPT-5 Codex");
    expect(agent?.agent?.contextWindow).toMatchObject({ usedPercent: 42.5 });
    // The mirror rides along verbatim for a view that wants the rest, at the
    // generation the contract pins (`AGENT_MONITOR_SCHEMA_VERSION`, 3 at AR-5).
    expect(agent?.agent?.monitor?.schemaVersion).toBe(3);
    expect(agent?.agent?.summary.monitor?.schemaVersion).toBe(3);
    // The provider-native id is the find sheet's join key, whatever its basis.
    expect(agent?.agent?.nativeSessionId).toBe("run-1-native");
  });

  it("reads recency off the evidence clock, and calls an unknown age nothing", () => {
    // Recency is presentation metadata, never a fourth status: `stale` is set
    // only when there IS a clock and the evidence is older than the policy.
    const summary = managedSummary();
    const fresh = monitorAgentFromManaged(
      { summary },
      { ...PURE, nowMs: Date.parse("2026-09-12T10:00:10.000Z") },
    );
    expect(fresh?.agent?.recency).toBe("fresh");
    expect(fresh?.stale).toBeUndefined();
    const stale = monitorAgentFromManaged(
      { summary },
      { ...PURE, nowMs: Date.parse("2026-09-12T10:05:00.000Z") },
    );
    expect(stale?.agent?.recency).toBe("stale");
    expect(stale?.stale).toBe(true);
    // No clock at all is `unknown` — and unknown is not stale.
    const unclocked = monitorAgentFromManaged({ summary }, PURE);
    expect(unclocked?.agent?.recency).toBe("unknown");
    expect(unclocked?.stale).toBeUndefined();
  });

  it("a run before its first monitor state is a real row, starting", () => {
    const agent = monitorAgentFromManaged(
      { summary: managedSummary({ status: "unknown", monitor: false }) },
      PURE,
    );
    expect(agent).toMatchObject({ status: "working", detail: "starting" });
    // The facet's mirror is absent rather than invented — a starting row.
    expect(agent?.agent?.monitor).toBeUndefined();
  });

  it("AR-4: a PENDING row reads idle and says so; a re-attached row is an ordinary row; a resumed row names the PTY it replaced", () => {
    // a live PTY fieldd could not re-attach to: no monitor, status unknown —
    // and the honest reading is idle with the reason in words, not "starting"
    const pending = monitorAgentFromManaged(
      { summary: managedSummary({ pending: "the adapter cannot attach to a running session" }) },
      PURE,
    );
    expect(pending).toMatchObject({ status: "idle", detail: "unobserved · resumes when idle" });
    expect(pending?.agent?.summary.continuation?.pending).toBe("resume-when-idle");
    // re-attached across a restart: the same row as before the restart
    const reattached = monitorAgentFromManaged(
      { summary: managedSummary({ reattached: true, lastAssistantText: "done" }) },
      PURE,
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
      PURE,
    );
    expect(resumed?.id).toBe("run-2");
    expect(resumed?.agent?.runtimeRunId).toBe("run-2");
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
      PURE,
    );
    expect(gone).toBeUndefined();
    // …and a pending row the mirror does not contradict is still AR-4's honest
    // idle row, with the reason in words
    const waiting = monitorAgentFromManaged(
      { summary: managedSummary({ pending: "the adapter cannot attach", alive: true }) },
      PURE,
    );
    expect(waiting).toMatchObject({ status: "idle", detail: "unobserved · resumes when idle" });
  });

  it("AR-4: a run keeps its row id and its colour through the PTY swap, so the swarm keeps the bubble", () => {
    // The finding this rule exists for: keyed by the floor session, a
    // resume-when-idle made run-a a DIFFERENT row, and the swarm — which keys
    // its elements AND its physics bodies by `agent.id` — destroyed the bubble
    // and respawned a stranger in its place. The run is what the user is
    // watching; the PTY under it is an implementation detail of being watched.
    // Since AR-5 the colour is the PROJECT's, which the swap does not move
    // either — so the bubble keeps its hue as well as its identity.
    const projectSeqs = new Map([["/project/vibe-field", 2]]);
    const before = assembleMonitorAgents({
      colours: COLOURS,
      projectSeqs,
      managed: [managed("run-a", "pty-1")],
      terminals: [],
    });
    const after = assembleMonitorAgents({
      colours: COLOURS,
      projectSeqs,
      managed: [managed("run-a", "pty-2", { replaced: "pty-1" })],
      terminals: [],
    });
    expect(before[0]?.id).toBe("run-a");
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.color).toBe(before[0]?.color);
    expect(after[0]?.color).toBe(projectTint(2, COLOURS.tint));
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
      ...PURE,
      managed: [managed("run-a", "pty-2", { replaced: "pty-1" })],
      terminals: [{ session: session("pty-1") }, { session: session("pty-9") }],
    });
    expect(assembled.map((agent) => agent.id)).toEqual(["run-a", "pty-9"]);
  });
});
