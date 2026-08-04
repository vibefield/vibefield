import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import { describe, expect, it } from "vitest";
import {
  agentAccentSlot,
  agentDetail,
  classifyAgentStatus,
  classifyTerminalStatus,
  projectLabel,
  providerLabel,
} from "../src/godview/monitor/agent-status";
import type { AgentSessionInfo, AgentStateMessage } from "../src/godview/monitor/facet-types";
import { folderName } from "../src/godview/monitor/folder-name";
import { ACCENT_SLOTS } from "../src/godview/monitor/monitor-palette";

// The reference app's `agent-status.test.ts`, ported. The classifier is the
// module the whole monitor rests on — everything a view draws is downstream of
// "what is this session doing", and that answer has to come from reduced runtime
// state rather than from anything a terminal printed (ADR-003, our EL2 grain).

function state(overrides: Partial<AgentStateMessage["state"]> = {}): AgentStateMessage {
  return {
    runtimeSessionId: "session-1",
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

const info = {
  agent: "codex",
  sessionId: "native-1",
  runtimeSessionId: "session-1",
  workspace: { mode: "direct", root: "/project/vibe-field", sourcePath: "/project/vibe-field" },
  session: { exited: false } as SessionSummary,
} as AgentSessionInfo;

describe("Godview agent status", () => {
  it("maps ready, active, and permission states to the three statuses", () => {
    expect(classifyAgentStatus(state())).toBe("idle");
    expect(
      classifyAgentStatus(state({ lifecycle: "running", activeTurn: { startedAt: "now" } })),
    ).toBe("working");
    expect(classifyAgentStatus(state({ permissions: [{ requestId: "approval" }] }))).toBe(
      "waiting",
    );
  });

  it("drops sessions that reached a terminal lifecycle", () => {
    expect(classifyAgentStatus(state({ lifecycle: "failed" }))).toBeUndefined();
    expect(classifyAgentStatus(state({ lifecycle: "exited" }))).toBeUndefined();
  });

  it("treats a missing state as starting rather than as absent", () => {
    // A session we have heard of but have no state for is REAL and is doing
    // something; showing nothing would be the dishonest reading.
    expect(classifyAgentStatus(undefined)).toBe("working");
    expect(agentDetail(undefined, "working")).toBe("starting");
  });

  it("uses foreground activity for unassigned terminals, and unknown falls to idle", () => {
    expect(classifyTerminalStatus({ kind: "shell-idle" })).toBe("idle");
    expect(classifyTerminalStatus({ kind: "foreground-job" })).toBe("working");
    expect(classifyTerminalStatus({ kind: "unknown" })).toBe("idle");
    expect(classifyTerminalStatus(undefined)).toBe("idle");
  });

  it("labels a session from its workspace and its provider from its kind", () => {
    expect(projectLabel(info)).toBe("vibe-field");
    expect(projectLabel(info, "/project/vibe-field/packages/field-app")).toBe("field-app");
    expect(providerLabel("codex")).toBe("Codex");
    expect(providerLabel("acp")).toBe("ACP");
  });

  it("describes what an agent is doing without reading the terminal", () => {
    expect(agentDetail(state({ permissions: [{ requestId: "a", tool: "Bash" }] }), "waiting")).toBe(
      "permission · Bash",
    );
    expect(
      agentDetail(
        state({ tools: [{ toolCallId: "t", tool: "Read", state: "running" }] }),
        "working",
      ),
    ).toBe("Read");
    expect(agentDetail(state({ activeReasoning: { startedAt: "now" } }), "working")).toBe(
      "thinking",
    );
    expect(agentDetail(state({ activeTurn: { startedAt: "now" } }), "working")).toBe("responding");
  });

  it("assigns a stable per-session accent SLOT, in range", () => {
    // The property the reference's color hash had, kept: same id ⇒ same slot,
    // forever. What changed is the codomain — a curated §2.6 set instead of a
    // free hue wheel, so a relationship color can never wander onto a hue §2.5
    // has already given a meaning.
    expect(agentAccentSlot("session-1", ACCENT_SLOTS)).toBe(
      agentAccentSlot("session-1", ACCENT_SLOTS),
    );
    expect(agentAccentSlot("session-1", ACCENT_SLOTS)).not.toBe(
      agentAccentSlot("session-2", ACCENT_SLOTS),
    );
    for (const id of ["a", "bb", "ccc", "session-9", ""]) {
      const slot = agentAccentSlot(id, ACCENT_SLOTS);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(ACCENT_SLOTS);
    }
  });

  it("takes the last path component, and falls back when there is none", () => {
    expect(folderName("/a/b/c", "x")).toBe("c");
    expect(folderName("/a/b/c/", "x")).toBe("c");
    expect(folderName(undefined, "claude")).toBe("claude");
    expect(folderName("", "claude")).toBe("claude");
  });
});
