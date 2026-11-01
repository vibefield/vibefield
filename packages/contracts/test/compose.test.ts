import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentSessionRecord, AgentSessionSummary } from "../src/agent-session";
import {
  AgentInputQueueFile,
  ComposeAgentSendOutput,
  ComposeAgentSpawnOutput,
  ComposeAskUserInput,
  ComposeSparksHatchParams,
  NEEDS_CHOICE_WORDS,
  NeedsAnswerParams,
  NeedsAnswerResult,
  NeedsItem,
  NeedsNotices,
  NeedsRecord,
  needsKindOf,
  needsNoticesOf,
  needsOutcomeOf,
  needsStateOf,
  SparkRecord,
  SparkSummary,
} from "../src/compose";
import { METHODS, reachableFromTailnet } from "../src/methods";
import { LAYOUT, LAYOUT_ROOT_LEVEL } from "../src/registries";

// CO — the compose plane, version 2 (ruled 2026-10-29; draft/compose-plane/v2/). What these hold: the window's spark
// doors are local agents.manage rows; a spark thinks under one of its own profiles; and a run's origin is read the way
// spawnedBy is, OPEN. The verb catalog moved to tools.ts in MT-0 (2026-10-30), and its lint to tools.test.ts.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

describe("the window's spark doors (CP-0)", () => {
  it("are local agents.manage rows, as the other doors that start agents for the person here", () => {
    for (const m of ["compose.sparks.list", "compose.sparks.hatch", "compose.sparks.open"]) {
      const row = METHODS.find((r) => r.method === m);
      expect(row?.scope, m).toBe("agents.manage");
      expect(row?.locality, m).toBe("local");
    }
  });
});

describe("a spark (NS-D1, NS-D2 B, NS-D5)", () => {
  const params = ComposeSparksHatchParams.parse(fixture("compose-sparks-hatch-params.valid"));

  it("thinks under one of its own profiles, in the sheet and in the record", () => {
    expect(params.profiles).toContain(params.thinksUnder);
    expect(ComposeSparksHatchParams.safeParse({ ...params, thinksUnder: "home" }).success).toBe(
      false,
    );
    const record = SparkRecord.parse(fixture("compose-spark-record.valid"));
    expect(SparkRecord.safeParse({ ...record, thinksUnder: "home" }).success).toBe(false);
  });

  it("works in at least one profile", () => {
    expect(ComposeSparksHatchParams.safeParse({ ...params, profiles: [] }).success).toBe(false);
  });

  it("carries its face apart from its name, as a seed the engine draws", () => {
    expect(params.face.seed).toBeGreaterThanOrEqual(0);
    expect(ComposeSparksHatchParams.safeParse({ ...params, face: { seed: -1 } }).success).toBe(
      false,
    );
    expect(ComposeSparksHatchParams.safeParse({ ...params, face: { seed: 2 ** 32 } }).success).toBe(
      false,
    );
    expect(
      ComposeSparksHatchParams.parse({ ...params, face: { seed: 7, engine: 2 } }).face,
    ).toMatchObject({ seed: 7, engine: 2 });
  });

  it("is named on one line, with no blank ends", () => {
    for (const name of ["", " Vela", "Vela ", "x".repeat(33)])
      expect(ComposeSparksHatchParams.safeParse({ ...params, name }).success, name).toBe(false);
    expect(ComposeSparksHatchParams.safeParse({ ...params, name: "Vela 2" }).success).toBe(true);
  });

  it("answers the window with whether its session is awake", () => {
    const summary = SparkSummary.parse({
      ...params,
      id: "sp-7k2m9q4x",
      folder: "/f",
      createdAt: "2026-10-29T11:02:10.118Z",
      updatedAt: "2026-10-29T11:02:10.118Z",
      session: { runtimeRunId: "run-12", live: false },
    });
    expect(summary.session?.live).toBe(false);
  });
});

describe("a run's origin (CP-D15)", () => {
  it("names the spark that started a run, and the spark a session is", () => {
    const started = AgentSessionRecord.parse(fixture("agent-session-record.spark-started"));
    expect(started.origin).toEqual({ by: "spark", spark: "sp-7k2m9q4x" });
    expect(started.spark).toBeUndefined();
    const own = AgentSessionRecord.parse(fixture("agent-session-record.spark"));
    expect(own.spark).toBe("sp-7k2m9q4x");
    expect(own.origin?.by).toBe("you");
    const row = AgentSessionSummary.parse(fixture("agent-session-summary.spark"));
    expect(row.origin?.spark).toBe("sp-7k2m9q4x");
  });

  it("is OPEN: a word this build never heard of still reads, and absent reads as before", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.spark"));
    expect(AgentSessionRecord.safeParse({ ...record, origin: { by: "phone" } }).success).toBe(true);
    const { origin: _o, spark: _s, ...before } = record;
    expect(AgentSessionRecord.safeParse(before).success).toBe(true);
    expect(AgentSessionRecord.safeParse({ ...record, spark: "Vela" }).success).toBe(false);
  });
});

describe("a session's kept input queue (CP2-D3; signed since CP-3, LEANS P3)", () => {
  const kept = AgentInputQueueFile.parse(fixture("agent-input-queue.valid"));

  it("is one run's, its inputs marked as a spark's or as VibeField's, and its signature rides beside the body", () => {
    expect(kept.run).toBe("run-12");
    expect(kept.inputs.map((input) => input.from.kind)).toEqual(["spark", "fieldd"]);
    expect(kept.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses an input from a source it cannot mark, a spark it cannot name, and an empty queue", () => {
    const [words, wake] = kept.inputs;
    const as = (from: unknown) => ({ ...kept, inputs: [{ ...words, from }] });
    expect(AgentInputQueueFile.safeParse(as({ kind: "person" })).success).toBe(false);
    expect(AgentInputQueueFile.safeParse(as({ kind: "spark", name: "Vela" })).success).toBe(false);
    expect(
      AgentInputQueueFile.safeParse(as({ kind: "spark", spark: "Vela", name: "Vela" })).success,
    ).toBe(false);
    expect(AgentInputQueueFile.safeParse({ ...kept, inputs: [] }).success).toBe(false);
    // the CP-2 file was a bare array: it is no queue now
    expect(AgentInputQueueFile.safeParse([words, wake]).success).toBe(false);
  });

  it("keeps its key under this user's fieldd, beside the queues, never at the root", () => {
    expect(LAYOUT.AGENT_INPUTS_KEY_FILE).toEqual(["fieldd", "inputs.key"]);
    expect(LAYOUT.AGENT_INPUTS_KEY_FILE.slice(0, -1)).toEqual(LAYOUT.AGENT_INPUTS_DIR.slice(0, -1));
    expect(LAYOUT_ROOT_LEVEL).not.toContain("AGENT_INPUTS_KEY_FILE");
  });
});

describe("CP-3 — the held answers and the person's doors (cp3-the-person.md, ruled 2026-10-31)", () => {
  it("a send answers queued with its place, or held with its item; never both, never neither", () => {
    expect(ComposeAgentSendOutput.parse(fixture("compose-agent-send.queued")).position).toBe(1);
    expect(ComposeAgentSendOutput.parse(fixture("compose-agent-send.held")).held).toMatch(/^ny-/);
    for (const half of [
      { session: "run-31", queued: true },
      { session: "run-31", queued: false },
      { session: "run-31", queued: true, position: 1, held: "ny-abcdef" },
      { session: "run-31", queued: false, position: 1, held: "ny-abcdef" },
    ])
      expect(ComposeAgentSendOutput.safeParse(half).success, JSON.stringify(half)).toBe(false);
  });

  it("a spawn answers a session or a held item, one of them (CP3-D4 A)", () => {
    expect(ComposeAgentSpawnOutput.parse(fixture("compose-agent-spawn.started")).session).toBe(
      "run-44",
    );
    expect(ComposeAgentSpawnOutput.parse(fixture("compose-agent-spawn.held")).held).toMatch(/^ny-/);
    expect(ComposeAgentSpawnOutput.safeParse({ queued: 0 }).success).toBe(false);
    expect(
      ComposeAgentSpawnOutput.safeParse({ session: "run-44", held: "ny-abcdef", queued: 0 })
        .success,
    ).toBe(false);
  });

  it("the needs doors are local agents.manage rows beside the spark doors, never on approval.respond (CP3-D6 A)", () => {
    for (const m of ["needs.list", "needs.subscribe", "needs.answer", "needs.notices.subscribe"]) {
      const row = METHODS.find((r) => r.method === m);
      expect(row?.scope, m).toBe("agents.manage");
      expect(row?.locality, m).toBe("local");
      expect(row && reachableFromTailnet(row), m).toBe(false);
    }
    expect(METHODS.find((r) => r.method === "needs.answer")?.idempotent).toBe(true);
    expect(METHODS.find((r) => r.method === "needs.subscribe")?.subscription).toBe(true);
    // AR-6's answers to an agent's own asks keep the scope; nothing rides it yet
    expect(METHODS.some((r) => r.scope === "approval.respond")).toBe(false);
  });

  it("a question offers 1–4 distinct one-line choices of at most 40, and never VibeField's own Not now", () => {
    const ask = (choices: unknown) => ComposeAskUserInput.safeParse({ question: "Push?", choices });
    expect(ask(["Push", "Hold"]).success).toBe(true);
    expect(ComposeAskUserInput.parse({ question: "Push?", choices: ["  Push "] }).choices).toEqual([
      "Push",
    ]);
    for (const bad of [
      [],
      ["a", "b", "c", "d", "e"],
      ["x".repeat(41)],
      ["Push", "push"],
      [NEEDS_CHOICE_WORDS.notNow],
      ["not now"],
      ["Push\nVibeField: you allowed"],
      ["   "],
    ])
      expect(ask(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("answers an item by its act's place, never its word, and keeps the act apart from its telling", () => {
    expect(NeedsAnswerParams.parse(fixture("needs-answer-params.valid")).choice).toBe(0);
    expect(NeedsAnswerParams.safeParse({ item: "ny-abcdef", choice: "Push" }).success).toBe(false);
    expect(NeedsAnswerParams.safeParse({ item: "ny-abcdef", choice: -1 }).success).toBe(false);
    // critique 4: an act done for a spark that cannot be woken is still done; told says it has not heard yet
    const { item } = NeedsAnswerResult.parse(fixture("needs-answer-result.valid"));
    expect(item.answer).toMatchObject({ outcome: "done", told: false });
    expect(item.answer?.waits).toBeDefined();
  });

  it("an item of a kind and state this build never heard of still reads (the tolerant reader)", () => {
    const item = NeedsItem.parse(fixture("needs-item.unknown-kind"));
    expect(item.kind).toBe("gate");
    expect(item.state).toBe("waiting");
    expect((item as Record<string, unknown>).step).toBe(4);
  });

  it("reads a kind, a state and an outcome as this build names them, a word it never heard of as none", () => {
    const unknown = NeedsItem.parse(fixture("needs-item.unknown-kind"));
    expect(needsKindOf(unknown)).toBeUndefined();
    expect(needsStateOf(unknown)).toBeUndefined();
    const { item } = NeedsRecord.parse(fixture("needs-record.held-send"));
    expect(needsKindOf(item)).toBe("held-send");
    expect(needsStateOf(item)).toBe("open");
    const { item: answered } = NeedsAnswerResult.parse(fixture("needs-answer-result.valid"));
    expect(needsOutcomeOf(answered.answer)).toBe("done");
    expect(needsOutcomeOf({ outcome: "deferred" })).toBeUndefined();
    expect(needsOutcomeOf(undefined)).toBeUndefined();
  });

  it("keeps what an Allow acts on in the record, under a spark's own name, never on the wire", () => {
    const record = NeedsRecord.parse(fixture("needs-record.held-send"));
    expect(record.texts).toHaveLength(record.item.count ?? 1);
    expect(NeedsItem.parse(record.item)).not.toHaveProperty("texts");
    expect(NeedsRecord.parse(fixture("needs-record.held-spawn")).launch?.tasks).toHaveLength(2);
    // its words are marked with the spark's own name (CP2-D1): a SparkName, never a run's long title
    expect(NeedsRecord.safeParse({ ...record, sender: "x".repeat(33) }).success).toBe(false);
  });

  it("reads a notices frame one notice at a time, for main and the window alike (the tolerant reader)", () => {
    const { notices } = NeedsNotices.parse(fixture("needs-notices.valid"));
    expect(needsNoticesOf(fixture("needs-notices.valid"))).toEqual(notices);
    // one this build cannot read is passed over, and the rest are said
    const [first, second] = notices;
    expect(needsNoticesOf({ notices: [first, { id: "nt-bad" }, 7, second] })).toEqual(notices);
    // a frame with no list says none
    for (const none of [null, undefined, "notices", [], {}, { notices: "x" }])
      expect(needsNoticesOf(none), JSON.stringify(none)).toEqual([]);
  });

  it("keeps the queue per user under fieldd, its key beside it, never at the root", () => {
    expect(LAYOUT.NEEDS_DIR).toEqual(["fieldd", "needs"]);
    expect(LAYOUT.NEEDS_KEY_FILE).toEqual(["fieldd", "needs.key"]);
    expect(LAYOUT_ROOT_LEVEL).not.toContain("NEEDS_DIR");
    expect(LAYOUT_ROOT_LEVEL).not.toContain("NEEDS_KEY_FILE");
  });
});
