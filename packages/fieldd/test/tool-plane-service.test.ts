import type {
  AgentProfileSet,
  IndexSearchResult,
  NativeDoorOpen,
  SparkRecord,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type ToolPlaneAudit, ToolPlaneService } from "../src/tool-plane";
import { MCP_MODERN } from "../src/tool-plane/mcp";

// MT-0 — the tool plane end to end inside fieldd, with the floor and the lane link faked (CP-1b's witness, widened).
// Each caller is listed its audience's rows (MT-D2): a spark every served row, a settled plain run the `agent` rows
// (History and the projects list), and a pane, the outside and an unsettled run nothing, with one plain line each.
// Every call is held to its row again at the call (MT-L2), held to the caller's own profiles, written to the audit log
// as the caller's before it answers (CP-L6), and refused as a fact the model reads, never a protocol error.

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
const set = (id: string, runtimeId: string): AgentProfileSet => ({
  id,
  kind: id === "native" ? "native" : "managed",
  label: id,
  default: id === "native",
  createdAt: "2026-10-01T00:00:00.000Z",
  personas: [
    {
      provider: "claude",
      profileId: `claude:${id}`,
      label: "claude",
      kind: "managed",
      createdAt: "2026-10-01T00:00:00.000Z",
      identity: { loggedIn: true, verifiedAt: "2026-10-01T00:00:00.000Z" },
      runtimeId,
    },
  ],
});
const SETS = [set("native", "rt-native"), set("work", "rt-work")];

const door = (connId: string, laneId: number, terminalSessionId?: string): NativeDoorOpen => ({
  connId,
  laneId,
  state: "open",
  caller: { pid: 4242, startedAtMs: 1793270000000 },
  ...(terminalSessionId ? { pane: { terminalSessionId, depth: 1 } } : {}),
});

// The lanes: 1001 a spark, 1002 a plain run filed under "work", 1003 a run naming a spark no store holds, 1004 a run
// whose record does not verify, 1005 a pane with no run, 1006 a caller outside every pane.
const DOORS = [
  door("c-spark", 1001, "sess-vela"),
  door("c-plain", 1002, "sess-plain"),
  door("c-forged", 1003, "sess-forged"),
  door("c-unread", 1004, "sess-unread"),
  door("c-pane", 1005, "sess-shell"),
  door("c-out", 1006),
];

function harness() {
  const handlers = new Map<number, (p: Uint8Array) => void>();
  const sent = new Map<number, string>();
  const searched: string[] = [];
  const audited: {
    action: string;
    target: { kind: string; id: string };
    principal: unknown;
    reason?: unknown;
    outcome?: string | undefined;
  }[] = [];
  const audit: ToolPlaneAudit = {
    required: async (ctx, mutation, effect, describe) => {
      const value = await effect();
      audited.push({
        action: mutation.action,
        target: mutation.target,
        principal: ctx.principal,
        ...(mutation.attrs?.reason !== undefined ? { reason: mutation.attrs.reason } : {}),
        outcome: describe?.(value).outcome,
      });
      return value;
    },
  };
  const plane = new ToolPlaneService({
    native: {
      subscribe: async () => ({ snapshot: { doors: DOORS }, dispose: () => undefined }),
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
        ? { runtimeRunId: "run-12", verified: true, spark: SPARK.id, profileSet: "native" }
        : tid === "sess-plain"
          ? { runtimeRunId: "run-7", verified: true, profileSet: "work" }
          : tid === "sess-forged"
            ? { runtimeRunId: "run-9", verified: true, spark: "sp-forged00" }
            : tid === "sess-unread"
              ? { runtimeRunId: "run-8", verified: false }
              : undefined,
    spark: (id) => (id === SPARK.id ? SPARK : undefined),
    verbs: {
      profileSets: async () => SETS,
      agentLabel: () => undefined,
      models: async () => {
        throw new Error("unused");
      },
      runs: () => [],
      runFacts: () => undefined,
      projects: () => [{ key: "p-vibe", name: "vibe-field", folders: ["/p/vibe-field"] }],
      indexSessionFor: async () => undefined,
      indexSessionProfile: async () => ({}),
      timeline: async () => {
        throw new Error("unused");
      },
      search: async (_q, runtimeId): Promise<IndexSearchResult> => {
        searched.push(runtimeId);
        return {
          answered: true,
          state: { readiness: "ready" },
          hits: [
            {
              sessionId: `s-${runtimeId}`,
              timelineId: "t",
              kind: "user",
              snippet: `[routes] from ${runtimeId}`,
              at: 100,
              provider: "claude",
            },
          ],
        } as IndexSearchResult;
      },
    },
    audit,
    version: "0.1.0",
  });
  const ask = (laneId: number, msg: object) =>
    handlers.get(laneId)?.(
      new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`),
    );
  const call = (laneId: number, id: number, name: string, args: object = {}) =>
    ask(laneId, { id, method: "tools/call", params: { _meta: META, name, arguments: args } });
  const answers = (laneId: number) =>
    (sent.get(laneId) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { plane, ask, call, answers, audited, searched, settle };
}

const names = (answer: { result: { tools: { name: string }[] } }) =>
  answer.result.tools.map((t) => t.name);

describe("the tool plane in fieldd (MT-0)", () => {
  it("lists each caller its audience's rows, and an unnamed caller nothing with one plain line", async () => {
    const h = harness();
    await h.plane.ensureStarted();
    for (const d of DOORS)
      h.ask(d.laneId, { id: 1, method: "tools/list", params: { _meta: META } });
    await h.settle();
    expect(names(h.answers(1001)[0])).toEqual([
      "agents_available",
      "agents_list",
      "agent_read",
      "history_search",
      "history_read",
      "projects_list",
    ]);
    expect(h.answers(1001)[0].result.tools[0].annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(names(h.answers(1002)[0])).toEqual(["history_search", "history_read", "projects_list"]);
    for (const lane of [1003, 1004, 1005, 1006]) {
      expect(names(h.answers(lane)[0]), String(lane)).toEqual([]);
      expect(h.answers(lane)[0].result.ttlMs, String(lane)).toBe(0);
    }
    expect(h.answers(1002)[0].result.ttlMs).toBeGreaterThan(0);
    expect(
      h.audited.map((a) => `${a.action} ${a.target.id} ${String(a.reason)} ${a.outcome}`).sort(),
    ).toEqual([
      "tools.door.plain c-forged spark-unverified denied",
      "tools.door.plain c-out outside denied",
      "tools.door.plain c-pane pane denied",
      "tools.door.plain c-unread record-unverified denied",
    ]);
    expect([...h.plane.doors()].map(([id, c]) => `${id}:${c.kind}`).sort()).toEqual([
      "c-forged:run",
      "c-out:outside",
      "c-pane:pane",
      "c-plain:run",
      "c-spark:spark",
      "c-unread:run",
    ]);
  });

  // History's profile bound is verbs.ts's join alone (profile sets → personas → runtimes): the index's doors carry no
  // profile (the rooms survey, 2026-10-30 23:45Z). This row is what holds it for a plain run.
  it("holds a plain run's History to the profile it is filed under: another profile's session never shows", async () => {
    const h = harness();
    await h.plane.ensureStarted();
    h.call(1002, 2, "history_search", { query: "routes" });
    await h.settle();
    const out = h.answers(1002)[0].result.structuredContent;
    expect(h.searched).toEqual(["rt-work"]);
    expect(out.hits.map((x: { profile: string }) => x.profile)).toEqual(["work"]);
    expect(h.audited).toEqual([
      {
        action: "tools.history_search",
        target: { kind: "run", id: "run-7" },
        principal: { kind: "mcp-agent", sessionId: "run-7", scopes: [] },
        outcome: "succeeded",
      },
    ]);
    h.call(1001, 3, "history_search", { query: "routes" });
    await h.settle();
    expect(h.searched).toEqual(["rt-work", "rt-native"]);
  });

  it("refuses a plain run a spark's row at the call, as the fact `forbidden`, and records it", async () => {
    const h = harness();
    await h.plane.ensureStarted();
    h.call(1002, 4, "agents_list");
    await h.settle();
    expect(h.answers(1002)[0].result).toMatchObject({
      isError: true,
      structuredContent: { fact: "forbidden" },
    });
    expect(h.audited).toEqual([
      {
        action: "tools.agents_list",
        target: { kind: "run", id: "run-7" },
        principal: { kind: "mcp-agent", sessionId: "run-7", scopes: [] },
        outcome: "denied",
      },
    ]);
  });

  it("answers an unknown tool, a planned one and bad input as facts, before any audit line", async () => {
    const h = harness();
    await h.plane.ensureStarted();
    h.call(1001, 5, "nope");
    h.call(1001, 6, "agent_spawn", { agent: "claude" });
    h.call(1001, 7, "agent_read");
    await h.settle();
    expect(h.answers(1001).map((a) => a.result.structuredContent.fact)).toEqual([
      "unknown-tool",
      "unknown-tool",
      "bad-input",
    ]);
    for (const a of h.answers(1001)) expect(a.result.isError).toBe(true);
    expect(h.audited).toEqual([]);
  });

  it("writes a spark's call to the audit log as the spark's before it answers, and a room's refusal as its fact", async () => {
    const h = harness();
    await h.plane.ensureStarted();
    h.call(1001, 8, "agents_list");
    await h.settle();
    expect(h.answers(1001)[0].result.structuredContent).toEqual({ sessions: [] });
    expect(h.audited).toEqual([
      {
        action: "tools.agents_list",
        target: { kind: "spark", id: SPARK.id },
        principal: { kind: "mcp-agent", sessionId: "run-12", scopes: [] },
        outcome: "succeeded",
      },
    ]);
    h.call(1001, 9, "agent_read", { session: "run-404" });
    await h.settle();
    expect(h.answers(1001)[1].result).toMatchObject({
      isError: true,
      structuredContent: { fact: "not-found" },
    });
  });

  it("builds each caller's instructions from its rows, and gives an unnamed caller one line", async () => {
    const h = harness();
    await h.plane.ensureStarted();
    for (const lane of [1001, 1002, 1005])
      h.ask(lane, { id: 10, method: "server/discover", params: { _meta: META } });
    await h.settle();
    const spark = h.answers(1001)[0].result.instructions as string;
    const run = h.answers(1002)[0].result.instructions as string;
    const pane = h.answers(1005)[0].result.instructions as string;
    expect(spark).toContain("see which agents you can start");
    expect(spark).toContain("Every call is recorded.");
    expect(run).toContain("search and read History and list the user's projects");
    expect(run).not.toContain("agents you can start");
    expect(run).toContain("never as the user's words");
    expect(pane).toBe(
      "VibeField has not named this session, so it holds none of VibeField's tools yet.",
    );
  });
});
