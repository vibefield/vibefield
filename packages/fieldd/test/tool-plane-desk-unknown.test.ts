import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeDoorOpen, ObjectIntent } from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import { AuditService, verifyAuditSegment } from "../src/audit-service";
import { ToolPlaneService } from "../src/tool-plane";
import { MCP_MODERN } from "../src/tool-plane/mcp";
import { type Answer, cleanupWorlds, ordinaryWindow, world } from "./desk-fixtures";

// Item 559, 2026-11-18 (LOG-45; objects-at-work §5.5 step 7) — a desk act the window was sent and never answered,
// through the real plane and the real audit writer. The window may have applied it before it went, so the model is told
// that VibeField cannot tell whether it happened, and the trail closes the act's attempt with one recovery record,
// EFFECT_UNKNOWN, never a `failed` outcome. A read that is never answered changed nothing and stays `failed`.

afterEach(cleanupWorlds);

const trails: string[] = [];
afterEach(() => {
  for (const dir of trails.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NO_ANSWER =
  "The window did not answer, so VibeField cannot tell whether this happened. Look before you try again.";

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

/** Waits for `happened`, by a deadline and never by a count of turns: the real writer's sync takes what it takes. */
async function until(happened: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!happened()) {
    if (Date.now() > deadline) throw new Error(`${what} did not happen within 10 s`);
    await new Promise((r) => setTimeout(r, 0));
  }
}

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

/** The plane over a real audit writer, with a window that answers by `respond`. */
async function harness(respond: (intent: ObjectIntent) => Answer | undefined) {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-desk-unknown-"));
  trails.push(dataDir);
  const service = new AuditService({ dataDir, bootId: "fieldd-desk-unknown" });
  await service.start();
  const h = world();
  const win = h.window(respond);
  const handlers = new Map<number, (p: Uint8Array) => void>();
  const sent = new Map<number, string>();
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
    desk: { objects: h.desk },
    audit: service,
    version: "0.1.0",
    now: () => 1_000_000,
  });
  await plane.ensureStarted();
  /** Sends one call; the answer is awaited by its own id, under a deadline. */
  const call = async (id: number, name: string, args: object) => {
    handlers.get(1)?.(
      new TextEncoder().encode(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { _meta: META, name, arguments: args } })}\n`,
      ),
    );
    let answer: { result?: { isError?: boolean; content?: { text: string }[] } } | undefined;
    await until(() => {
      answer = (sent.get(1) ?? "")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .find((l: { id: number }) => l.id === id);
      return answer !== undefined;
    }, `call ${id} (${name})'s answer`);
    return answer?.result;
  };
  return { h, win, service, call };
}

describe("a desk act its window was sent and never answered (item 559)", () => {
  it("is an unknown effect: the model is told so, and the trail never says it failed", async () => {
    const { h, win, service, call } = await harness((intent) =>
      intent.op === "act" ? undefined : ordinaryWindow(intent),
    );
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const answered = call(1, "object_act", {
      doing: "Replace the shopping list",
      ref,
      tool: "write_text",
      input: { text: "milk" },
    });
    // the act reaches the window, which reloads before it answers
    await until(() => win.seen.some((i) => i.op === "act"), "the act reaching the window");
    h.window(ordinaryWindow);
    const result = await answered;
    expect(result).toBeDefined();
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toBe(`unavailable (desk: no-answer): ${NO_ANSWER}`);
    await service.close();
    const kept = await trailOf(service.root);
    const act = kept.filter((r) => r.action === "tools.object_act");
    expect(act.map((r) => r.phase)).toEqual(["attempt"]);
    expect(
      kept.filter(
        (r) => r.operationId === act[0]?.operationId && r.action === "audit.outcome.recovery",
      ),
    ).toEqual([
      expect.objectContaining({
        outcome: "failed",
        reasonCode: "EFFECT_UNKNOWN",
        attrs: expect.objectContaining({
          originalAction: "tools.object_act",
          intendedOutcome: "unknown",
          effectResolution: "unknown",
        }),
      }),
    ]);
  });

  it("keeps a read its window never answered failed: it changed nothing", async () => {
    const { h, win, service, call } = await harness((intent) =>
      intent.op === "open" ? undefined : ordinaryWindow(intent),
    );
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const answered = call(1, "object_open", { ref });
    await until(() => win.seen.some((i) => i.op === "open"), "the open reaching the window");
    h.window(ordinaryWindow);
    const result = await answered;
    expect(result).toBeDefined();
    expect(result?.content?.[0]?.text).toBe(`unavailable (desk: no-answer): ${NO_ANSWER}`);
    await service.close();
    const kept = await trailOf(service.root);
    expect(kept.filter((r) => r.action === "audit.outcome.recovery")).toEqual([]);
    expect(
      kept
        .filter((r) => r.action === "tools.object_open")
        .map((r) => [r.phase, r.outcome, r.reasonCode]),
    ).toEqual([
      ["attempt", undefined, undefined],
      ["outcome", "failed", "UNAVAILABLE"],
    ]);
  });
});
