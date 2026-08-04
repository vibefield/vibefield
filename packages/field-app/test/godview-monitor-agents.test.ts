import type { SessionActivity, SessionSummary } from "@vibecook/ghosttea-protocol";
import { describe, expect, it } from "vitest";
import {
  assembleMonitorAgents,
  type MonitorAgentRecord,
  monitorAgentCounts,
  nextMonitorAgentForStatus,
} from "../src/godview/monitor/agents";
import type { AgentSessionInfo, AgentStateMessage } from "../src/godview/monitor/facet-types";

// The reference app's `monitor/agents.test.ts`, ported. This projection is the
// contract every view consumes, and it is pure — which is exactly why it can be
// tested with no renderer, no runtime and no terminal in sight.

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

function state(overrides: Partial<AgentStateMessage["state"]> = {}): AgentStateMessage {
  return {
    runtimeSessionId: "runtime-1",
    observationLevel: "structured",
    state: {
      lifecycle: "ready",
      tools: [],
      permissions: [],
      subagents: [],
      tasks: [],
      environment: {},
      counters: { toolsCompleted: 0, toolsFailed: 0, unknownEvents: 0 },
      lastSequence: 0,
      diagnostics: [],
      ...overrides,
    },
  };
}

function agentRecord(
  runtimeSessionId: string,
  terminalId: string,
  overrides: Partial<AgentStateMessage["state"]> = {},
  createdAtMs = 0,
): MonitorAgentRecord {
  return {
    info: {
      agent: "codex",
      sessionId: `native-${runtimeSessionId}`,
      runtimeSessionId,
      workspace: { mode: "direct", root: "/project/vibe-field", sourcePath: "/project/vibe-field" },
      session: session(terminalId, { createdAtMs }),
    } as AgentSessionInfo,
    state: state(overrides),
  };
}

describe("monitor agent assembly", () => {
  it("lists agents in launch order ahead of the terminals nothing has claimed", () => {
    const assembled = assembleMonitorAgents({
      accents: ACCENTS,
      agents: [
        agentRecord("runtime-b", "terminal-b", {}, 20),
        agentRecord("runtime-a", "terminal-a", {}, 10),
      ],
      terminals: [{ session: session("terminal-c") }],
    });
    expect(assembled.map((agent) => agent.id)).toEqual(["terminal-a", "terminal-b", "terminal-c"]);
    expect(assembled.map((agent) => Boolean(agent.agent))).toEqual([true, true, false]);
  });

  it("drops a terminal placeholder once an agent claims its session", () => {
    const assembled = assembleMonitorAgents({
      accents: ACCENTS,
      agents: [agentRecord("runtime-a", "terminal-a")],
      terminals: [{ session: session("terminal-a") }],
    });
    expect(assembled).toHaveLength(1);
    // The same body, so a view's placement survives the promotion.
    expect(assembled[0]?.id).toBe("terminal-a");
    expect(assembled[0]?.agent?.kind).toBe("codex");
  });

  it("excludes exited sessions and sessions that reached a terminal lifecycle", () => {
    const exited = agentRecord("runtime-a", "terminal-a");
    exited.info = { ...exited.info, session: session("terminal-a", { exited: true }) };
    const assembled = assembleMonitorAgents({
      accents: ACCENTS,
      agents: [exited, agentRecord("runtime-b", "terminal-b", { lifecycle: "failed" })],
      terminals: [],
    });
    expect(assembled).toEqual([]);
  });

  it("folds the shell-owned pane facts in, so no view looks them up itself", () => {
    const attachment = { primary: "#111", mirrors: ["#222"] };
    const [agent] = assembleMonitorAgents({
      accents: ACCENTS,
      agents: [agentRecord("runtime-a", "terminal-a")],
      terminals: [],
      attachments: new Map([["terminal-a", attachment]]),
      activeSessionId: "terminal-a",
    });
    expect(agent).toMatchObject({ active: true, attachment });
  });

  it("refreshes a terminal placeholder from the live session summary", () => {
    const [terminal] = assembleMonitorAgents({
      accents: ACCENTS,
      agents: [],
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
      agents: [
        agentRecord("runtime-a", "terminal-a", { permissions: [{ requestId: "approval-a" }] }, 10),
        agentRecord("runtime-b", "terminal-b", { permissions: [{ requestId: "approval-b" }] }, 20),
      ],
      terminals: [{ session: session("terminal-c") }],
    });
    expect(nextMonitorAgentForStatus(assembled, "waiting", undefined)?.id).toBe("terminal-a");
    expect(nextMonitorAgentForStatus(assembled, "waiting", "terminal-a")?.id).toBe("terminal-b");
    expect(nextMonitorAgentForStatus(assembled, "waiting", "terminal-b")?.id).toBe("terminal-a");
    // The idle terminal is visible to views but is not an agent to navigate to.
    expect(nextMonitorAgentForStatus(assembled, "idle", undefined)).toBeUndefined();
    expect(monitorAgentCounts(assembled)).toEqual({ idle: 0, working: 0, waiting: 2 });
  });

  it("assigns a §2.6 accent from the set it was handed, stably per session", () => {
    // The restyle's own property (GT-D13): a relationship color is one of the
    // curated accents, chosen by the id and by nothing else — not a free hue,
    // and never a §2.5 status color.
    const build = (): readonly ReturnType<typeof assembleMonitorAgents>[number][] =>
      assembleMonitorAgents({
        accents: ACCENTS,
        agents: [
          agentRecord("runtime-a", "terminal-a"),
          agentRecord("runtime-b", "terminal-b", {}, 5),
        ],
        terminals: [{ session: session("terminal-c") }],
      });
    const first = build();
    const second = build();
    for (const agent of first) expect(ACCENTS).toContain(agent.color);
    expect(second.map((agent) => agent.color)).toEqual(first.map((agent) => agent.color));
  });

  it("keeps an authoritative not-a-repo from being overwritten by the workspace branch", () => {
    // A git observation whose value is null MEANS "this cwd is not in a repo".
    // Falling through to `workspace.branch` there would replace an answer with a
    // guess — the exact honesty failure the projection is written to avoid.
    const record = agentRecord("runtime-a", "terminal-a", {
      environment: { git: { value: null, updatedAt: "now" } },
    });
    record.info = { ...record.info, workspace: { ...record.info.workspace, branch: "main" } };
    const [agent] = assembleMonitorAgents({ accents: ACCENTS, agents: [record], terminals: [] });
    expect(agent?.agent?.branch).toBeUndefined();

    // …and with no git observation at all, the workspace's branch is the best
    // thing we know, so it IS used.
    const unobserved = agentRecord("runtime-b", "terminal-b");
    unobserved.info = {
      ...unobserved.info,
      workspace: { ...unobserved.info.workspace, branch: "main" },
    };
    const [fallback] = assembleMonitorAgents({
      accents: ACCENTS,
      agents: [unobserved],
      terminals: [],
    });
    expect(fallback?.agent?.branch).toBe("main");
  });
});
