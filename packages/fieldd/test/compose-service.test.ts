import type { NativeDoorOpen, SparkRecord } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type ComposeAudit, ComposeService } from "../src/compose";
import { MCP_MODERN } from "../src/compose/mcp";

// CP-1b — the compose plane end to end inside fieldd, with the floor and the lane link faked: the version 2 page's
// CP-1 witness at fieldd's level. A spark's own session lists the built verbs and each call is audited before it acts;
// a plain agent that runs the bridge gets an empty list and one audit line (CP-L1, CP-L6).

const META = {
  "io.modelcontextprotocol/protocolVersion": MCP_MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
};
const SPARK: SparkRecord = {
  format: 1,
  id: "sp-7k2m9q4x",
  name: "Vela",
  face: { seed: 7 },
  agent: "claude",
  profiles: ["native"],
  thinksUnder: "native",
  folder: "/f/sparks/vela",
  createdAt: "2026-10-29T11:00:00.000Z",
  updatedAt: "2026-10-29T11:00:00.000Z",
};
const door = (connId: string, laneId: number, terminalSessionId: string): NativeDoorOpen => ({
  connId,
  laneId,
  state: "open",
  caller: { pid: 4242, startedAtMs: 1793270000000 },
  pane: { terminalSessionId, depth: 1 },
});

function harness() {
  const handlers = new Map<number, (p: Uint8Array) => void>();
  const sent = new Map<number, string>();
  const audited: {
    action: string;
    target: { kind: string; id: string };
    principal: unknown;
    outcome?: string | undefined;
  }[] = [];
  const audit: ComposeAudit = {
    required: async (ctx, mutation, effect, describe) => {
      const value = await effect();
      audited.push({
        action: mutation.action,
        target: mutation.target,
        principal: ctx.principal,
        outcome: describe?.(value).outcome,
      });
      return value;
    },
  };
  const compose = new ComposeService({
    native: {
      subscribe: async () => ({
        snapshot: {
          doors: [door("c-spark", 1001, "sess-vela"), door("c-plain", 1002, "sess-codex")],
        },
        dispose: () => undefined,
      }),
      request: async () => ({ closed: true }),
    },
    lanes: {
      onLane: (id, h) => handlers.set(id, h),
      offLane: (id) => handlers.delete(id),
      send: (id, p) => {
        sent.set(id, (sent.get(id) ?? "") + new TextDecoder().decode(p));
        return true;
      },
      flush: async () => undefined,
    },
    runForTerminal: (tid) =>
      tid === "sess-vela"
        ? { runtimeRunId: "run-12", spark: SPARK.id }
        : tid === "sess-codex"
          ? { runtimeRunId: "run-7" }
          : undefined,
    spark: (id) => (id === SPARK.id ? SPARK : undefined),
    verbs: {
      profileSets: async () => [],
      agentLabel: () => undefined,
      models: async () => {
        throw new Error("unused");
      },
      runs: () => [],
      runFacts: () => undefined,
      projects: () => [],
      indexSessionFor: async () => undefined,
      indexSessionProfile: async () => ({}),
      timeline: async () => {
        throw new Error("unused");
      },
      search: async () => {
        throw new Error("unused");
      },
    },
    audit,
    version: "0.1.0",
  });
  const ask = (laneId: number, msg: object) =>
    handlers.get(laneId)?.(
      new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`),
    );
  const answers = (laneId: number) =>
    (sent.get(laneId) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { compose, ask, answers, audited, settle };
}

describe("the compose plane in fieldd (CP-1b)", () => {
  it("serves a spark's own session the six read verbs, and a plain agent's bridge none, with one audit line", async () => {
    const h = harness();
    await h.compose.ensureStarted();
    h.ask(1001, { id: 1, method: "tools/list", params: { _meta: META } });
    h.ask(1002, { id: 1, method: "tools/list", params: { _meta: META } });
    await h.settle();
    expect(h.answers(1001)[0].result.tools.map((t: { name: string }) => t.name)).toEqual([
      "agents_available",
      "projects_list",
      "agents_list",
      "agent_read",
      "history_search",
      "history_read",
    ]);
    expect(h.answers(1001)[0].result.tools[0].annotations).toEqual({ readOnlyHint: true });
    expect(h.answers(1002)[0].result.tools).toEqual([]);
    expect(h.audited).toEqual([
      {
        action: "compose.door.plain",
        target: { kind: "door", id: "c-plain" },
        principal: { kind: "mcp-agent", sessionId: "run-7", scopes: [] },
        outcome: "denied",
      },
    ]);
    expect([...h.compose.doors()].map(([id, c]) => `${id}:${c.kind}`).sort()).toEqual([
      "c-plain:run",
      "c-spark:spark",
    ]);
  });

  it("writes a call to the audit log as the spark's before it answers, and refuses input its schema refuses", async () => {
    const h = harness();
    await h.compose.ensureStarted();
    h.ask(1001, {
      id: 2,
      method: "tools/call",
      params: { _meta: META, name: "agents_list", arguments: {} },
    });
    await h.settle();
    expect(h.answers(1001)[0].result.structuredContent).toEqual({ sessions: [] });
    expect(h.audited).toEqual([
      {
        action: "compose.agents_list",
        target: { kind: "spark", id: SPARK.id },
        principal: { kind: "mcp-agent", sessionId: "run-12", scopes: [] },
        outcome: "succeeded",
      },
    ]);
    h.ask(1001, {
      id: 3,
      method: "tools/call",
      params: { _meta: META, name: "agent_read", arguments: {} },
    });
    await h.settle();
    expect(h.answers(1001)[1].result).toMatchObject({ isError: true });
    expect(h.audited).toHaveLength(1);
  });

  it("refuses a plain agent's call as a tool it does not hold", async () => {
    const h = harness();
    await h.compose.ensureStarted();
    h.ask(1002, {
      id: 4,
      method: "tools/call",
      params: { _meta: META, name: "agents_list", arguments: {} },
    });
    await h.settle();
    expect(h.answers(1002)[0].error.code).toBe(-32602);
  });
});
