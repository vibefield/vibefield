import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeDoorOpen, ObjectIntentAnswer } from "@vibefield/contracts";
import { AuditActionV1, type AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import { AuditService, verifyAuditSegment } from "../src/audit-service";
import { instructionsFor, type ToolPlaneAudit, ToolPlaneService } from "../src/tool-plane";
import { MCP_MODERN } from "../src/tool-plane/mcp";
import { cleanupWorlds, ordinaryWindow, world } from "./desk-fixtures";

// OB-3b — the desk room through the real plane: what a caller is listed and told, the audit line written before the act
// with `ref` and `tool` and no contents (CP-L6), and a refusal reaching the model as a fact with what it needs to mend
// the call.
//
// Given an injected `bornFor`, `marks` and (where a row gives one) `key`: every row here builds its desk through
// desk-fixtures.ts, which hands the store and the desk those collaborators, and shows the store's rule given them.
// That production binds the real ones is proved by the rows through the real daemon,
// `packages/fieldd/test/custody-boot.test.ts`.

afterEach(cleanupWorlds);

const trails: string[] = [];
afterEach(() => {
  for (const dir of trails.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Every record the real writer kept, each segment verified as the ledger's own reader verifies it. */
async function trailOf(root: string): Promise<AuditRecordV1[]> {
  const kept: AuditRecordV1[] = [];
  for (const name of readdirSync(root)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()) {
    const verified = await verifyAuditSegment(join(root, name));
    expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
    kept.push(...verified.records);
  }
  return kept;
}

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

/** How long a row waits for a call's own answer before it fails by name (item 557, 2026-11-18). */
const CALL_ANSWER_MS = 10_000;

/** `real`: the audit the plane is given in place of the recording fake (item 526's real-trail row). `actTurns` (item
 * 557, 2026-11-18): the window answers an act only this many turns after it arrives, as a window slower than a
 * reader's count. */
function harness(real?: ToolPlaneAudit, actTurns = 0) {
  const h = world();
  h.window((intent) => {
    const answer = ordinaryWindow(intent);
    if (actTurns === 0 || intent.op !== "act" || answer === undefined) return answer;
    void (async () => {
      for (let i = 0; i < actTurns; i += 1) await new Promise((r) => setTimeout(r, 0));
      h.desk.intents.answer(
        { ...answer, intent: intent.intent } as ObjectIntentAnswer,
        "tok-window",
      );
    })().catch(() => undefined);
    return undefined;
  });
  const handlers = new Map<number, (p: Uint8Array) => void>();
  const sent = new Map<number, string>();
  const order: string[] = [];
  const audited: { action: string; attrs?: Record<string, unknown> }[] = [];
  const fake: ToolPlaneAudit = {
    required: async (_ctx, mutation, effect) => {
      // the real writer refuses an action outside the audit's own grammar: the fake holds the plane to it as well
      AuditActionV1.parse(mutation.action);
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
    audit: real ?? fake,
    version: "0.1.0",
    now: () => 1_000_000,
  });
  const call = async (id: number, name: string, args: object) => {
    handlers.get(1)?.(
      new TextEncoder().encode(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { _meta: META, name, arguments: args } })}\n`,
      ),
    );
    // item 557, 2026-11-18 — this call's own answer, waited for, never a count of turns: the plane answers only once
    // its audit lines are written, and a real writer's lines take the machine's own time
    const deadline = Date.now() + CALL_ANSWER_MS;
    for (;;) {
      const answer = (sent.get(1) ?? "")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .find((l: { id: number }) => l.id === id);
      if (answer !== undefined)
        return answer.result as
          | {
              isError?: boolean;
              structuredContent?: Record<string, unknown>;
              content?: { text: string }[];
            }
          | undefined;
      if (Date.now() > deadline)
        throw new Error(`call ${id} (${name}) had no answer within ${CALL_ANSWER_MS} ms`);
      await new Promise((r) => setTimeout(r, 0));
    }
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
    expect(result).toBeDefined();
    expect(result?.isError).toBeUndefined();
    const line = audited.find((a) => a.action === "tools.object_act");
    expect(line?.attrs).toMatchObject({ verb: "object_act", ref, tool: "write_text" });
    expect(JSON.stringify(line)).not.toContain("milk");
    expect(JSON.stringify(line)).not.toContain("shopping");
  });

  it("writes the act's `tools.object_act` lines through the real audit writer, attempt then outcome (item 526)", async () => {
    // the fake above holds the grammar; this row holds the trail itself: the line a real writer keeps, read back
    const dataDir = mkdtempSync(join(tmpdir(), "vf-desk-trail-"));
    trails.push(dataDir);
    const service = new AuditService({ dataDir, bootId: "fieldd-desk-trail" });
    await service.start();
    const { h, plane, call } = harness(service);
    await plane.ensureStarted();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const result = await call(1, "object_act", {
      doing: "Replace the shopping list",
      ref,
      tool: "write_text",
      input: { text: "milk" },
    });
    expect(result).toBeDefined();
    expect(result?.isError).toBeUndefined();
    await service.close();
    const lines = (await trailOf(service.root)).filter((r) => r.action === "tools.object_act");
    expect(lines.map((r) => r.phase)).toEqual(["attempt", "outcome"]);
    expect(lines[0]?.attrs).toMatchObject({ verb: "object_act", ref, tool: "write_text" });
    expect(JSON.stringify(lines)).not.toContain("milk");
  });

  it("keeps the act's outcome in the trail when the window answers after a reader's count of turns (item 557)", async () => {
    // the act's answer comes 40 turns after the act reaches the window: a reader that counts turns rather than waiting
    // for its answer closes the trail before the outcome is asked for, and the outcome is refused
    const dataDir = mkdtempSync(join(tmpdir(), "vf-desk-trail-"));
    trails.push(dataDir);
    const service = new AuditService({ dataDir, bootId: "fieldd-desk-trail-late" });
    await service.start();
    const { h, plane, call } = harness(service, 40);
    await plane.ensureStarted();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const result = await call(1, "object_act", {
      doing: "Replace the shopping list",
      ref,
      tool: "write_text",
      input: { text: "milk" },
    });
    expect(result).toBeDefined();
    expect(result?.isError).toBeUndefined();
    await service.close();
    const lines = (await trailOf(service.root)).filter((r) => r.action === "tools.object_act");
    expect(lines.map((r) => r.phase)).toEqual(["attempt", "outcome"]);
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

  // EY-0 (2026-11-18): the plane's facts are contracts' TOOL_FACTS and the desk room's OBJECT_FACTS together.
  // `no-tool` is said by the desk room alone, so it reaches the model as itself only while the desk's list is in the
  // plane's; without it, the refusal would read as its error kind's fact.
  it("answers no-tool, a fact only the desk room says, as itself in the model's tool result", async () => {
    const { h, plane, call } = harness();
    await plane.ensureStarted();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const refused = await call(3, "object_read", { ref, tool: "nope" });
    expect(refused?.isError).toBe(true);
    expect(refused?.content?.[0]?.text).toMatch(/^no-tool: /);
    expect(refused?.content?.[0]?.text).toContain("read_text, write_text");
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
