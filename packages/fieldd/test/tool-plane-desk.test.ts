import type { NativeDoorOpen } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { instructionsFor, type ToolPlaneAudit, ToolPlaneService } from "../src/tool-plane";
import { MCP_MODERN } from "../src/tool-plane/mcp";
import { cleanupWorlds, ordinaryWindow, world } from "./desk-fixtures";

// OB-3b — the desk room through the real plane: what a caller is listed and told, the audit line written before the act
// with `ref` and `tool` and no contents (CP-L6), and a refusal reaching the model as a fact with what it needs to mend
// the call.

afterEach(cleanupWorlds);

const META = {
  "io.modelcontextprotocol/protocolVersion": MCP_MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
};
const DOOR: NativeDoorOpen = {
  connId: "c-plain",
  laneId: 1,
  state: "open",
  caller: { pid: 4242, startedAtMs: 1793270000000 },
  pane: { terminalSessionId: "sess-plain", depth: 1 },
};

function harness() {
  const h = world();
  h.window(ordinaryWindow);
  const handlers = new Map<number, (p: Uint8Array) => void>();
  const sent = new Map<number, string>();
  const order: string[] = [];
  const audited: { action: string; attrs?: Record<string, unknown> }[] = [];
  const audit: ToolPlaneAudit = {
    required: async (_ctx, mutation, effect) => {
      order.push(`audit ${mutation.action}`);
      audited.push({
        action: mutation.action,
        ...(mutation.attrs ? { attrs: mutation.attrs } : {}),
      });
      return effect();
    },
  };
  const objects = h.desk;
  const plane = new ToolPlaneService({
    native: {
      subscribe: async () => ({ snapshot: { doors: [DOOR] }, dispose: () => undefined }),
      request: async () => ({ closed: true }),
    },
    lanes: {
      onLane: (id, f) => handlers.set(id, f),
      offLane: (id) => handlers.delete(id),
      send: (id, p) => {
        sent.set(id, (sent.get(id) ?? "") + new TextDecoder().decode(p));
        return true;
      },
      flush: async () => undefined,
    },
    runForTerminal: () => ({ runtimeRunId: "run-a", verified: true, profileSet: "work" }),
    personaSets: () => new Map(),
    spark: () => undefined,
    verbs: {
      profileSets: async () => [],
      personaSets: () => new Map(),
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
    desk: { objects },
    audit,
    version: "0.1.0",
    now: () => 1_000_000,
  });
  const call = async (id: number, name: string, args: object) => {
    handlers.get(1)?.(
      new TextEncoder().encode(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { _meta: META, name, arguments: args } })}\n`,
      ),
    );
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
    const lines = (sent.get(1) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    return lines.find((l: { id: number }) => l.id === id)?.result as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
      content?: { text: string }[];
    };
  };
  return { h, plane, call, audited, order };
}

describe("the desk room through the plane (OB-3b)", () => {
  it("records ref and tool, and no contents, before the act", async () => {
    const { h, plane, call, audited } = harness();
    await plane.ensureStarted();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const result = await call(1, "object_act", {
      doing: "Replace the shopping list",
      ref,
      tool: "write_text",
      input: { text: "milk" },
    });
    expect(result?.isError).toBeUndefined();
    const line = audited.find((a) => a.action === "tools.object_act");
    expect(line?.attrs).toMatchObject({ verb: "object_act", ref, tool: "write_text" });
    expect(JSON.stringify(line)).not.toContain("milk");
    expect(JSON.stringify(line)).not.toContain("shopping");
  });

  it("answers not-handed as the words of the model's own tool result, with the instruction", async () => {
    const { h, plane, call } = harness();
    await plane.ensureStarted();
    const ref = h.refOf("k1", "desk.note");
    const refused = await call(2, "object_open", { ref });
    expect(refused?.isError).toBe(true);
    // a validating client refuses structuredContent that misses the row's outputSchema, so a refusal carries none
    expect(refused?.structuredContent).toBeUndefined();
    expect(refused?.content?.[0]?.text).toMatch(/^not-handed: /);
    expect(refused?.content?.[0]?.text).toContain("Ask the user to hand it to you");
  });

  it("says a bad input's path and expected shape to the model in the words it reads", async () => {
    const { h, plane, call } = harness();
    await plane.ensureStarted();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const refused = await call(3, "object_act", {
      doing: "Change it",
      ref,
      tool: "write_text",
      input: { text: 7 },
    });
    expect(refused?.structuredContent).toBeUndefined();
    expect(refused?.content?.[0]?.text).toMatch(/^bad-input: input\.text: /);
    expect(refused?.content?.[0]?.text).toContain('"type":"string"');
  });

  it("names the path and the shape when the outer input is what's wrong", async () => {
    const { plane, call } = harness();
    await plane.ensureStarted();
    const refused = await call(30, "object_open", { ref: "not-a-ref" });
    expect(refused?.isError).toBe(true);
    const text = refused?.content?.[0]?.text ?? "";
    expect(text).toMatch(/^bad-input: ref: must look like vf:obj\//);
    expect(text).toContain('"pattern"');
    const wrongType = await call(31, "object_open", { ref: 7 });
    expect(wrongType?.content?.[0]?.text).toContain('"type":"string"');
  });

  it("says UNAVAILABLE's service and state to the model when no window holds the board", async () => {
    const { h, plane, call } = harness();
    await plane.ensureStarted();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    // a second board's ref, on a doc no window holds
    h.desk.registry.grant(
      h.desk.registry.refFor("doc-closed", "k2", "desk.note"),
      "run-a",
      "handed",
    );
    const closed = h.desk.registry.refFor("doc-closed", "k2");
    const refused = await call(4, "object_open", { ref: closed });
    expect(refused?.structuredContent).toBeUndefined();
    expect(refused?.content?.[0]?.text).toMatch(/^unavailable \(desk: no-window\): /);
  });

  it("tells a caller the desk's rules in one short paragraph, inside Claude Code's 4,096 characters", () => {
    const words = instructionsFor({
      kind: "run",
      runtimeRunId: "run-a",
      profiles: ["work"],
    });
    expect(words).toContain("vf:obj/");
    expect(words).toContain("before its tools");
    expect(words).toContain("placed or the user handed you");
    expect(words).toContain("The user's hand wins");
    expect(words).toContain("Every call is recorded");
    expect(words).toContain("never the user's words");
    expect(words.length).toBeLessThan(4_096);
  });

  it("says nothing of the desk to a caller that holds nothing", () => {
    const words = instructionsFor({ kind: "outside" });
    expect(words).not.toContain("vf:obj/");
  });
});
