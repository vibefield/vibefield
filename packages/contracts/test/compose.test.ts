import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentFieldSnapshot, AgentRemoteRow } from "../src/agent-field";
import { AgentSessionRecord, AgentSessionSummary, CrewId } from "../src/agent-session";
import {
  AgentInputQueueFile,
  COMPOSE_DESKTOP_STATES,
  COMPOSE_SAY_CHIPS_MAX,
  COMPOSE_SAY_STATES,
  ComposeAgentSendOutput,
  ComposeAgentSpawnOutput,
  ComposeAskUserInput,
  ComposeSparksCrewsFrame,
  ComposeSparksCrewsSubscribeParams,
  ComposeSparksHatchParams,
  ComposeSparksListParams,
  ComposeSparksListResult,
  ComposeSparksOpenParams,
  ComposeSparksSayParams,
  ComposeSparksSayResult,
  composeChipsFit,
  composeDesktopStateOf,
  composeSayStateOf,
  crewSharedModelOf,
  NEEDS_CHOICE_MAX,
  NEEDS_CHOICE_WORDS,
  NEEDS_JOINED_ITEMS_MAX,
  NEEDS_NAME_MAX,
  NEEDS_OPEN_PER_SPARK,
  NeedsAnswerParams,
  NeedsAnswerResult,
  NeedsItem,
  NeedsListParams,
  NeedsListResult,
  NeedsNotices,
  NeedsRecord,
  NeedsSubscribeParams,
  needsKindOf,
  needsNoticesOf,
  needsOutcomeOf,
  needsStateOf,
  SPARK_KEPT_FILE,
  SPARK_KEPT_FORMAT,
  SparkKeptRecord,
  SparkRecord,
  SparkSummary,
} from "../src/compose";
import { METHODS, reachableFromTailnet } from "../src/methods";
import {
  FLOW_LIMITS,
  LAYOUT,
  LAYOUT_ROOT_LEVEL,
  PEER_FIELDD_SCOPES,
  PRODUCT_API_LIMITS,
  SPARK_CREW_MEMBERS_MAX,
  SPARK_CREWS_KEPT,
  TAILNET_SCOPES,
} from "../src/registries";
import { sessionName } from "../src/session-name";

// CO — the compose plane, version 2 (ruled 2026-10-29; draft/compose-plane/v2/). What these hold: the window's spark
// doors are local agents.manage rows; a spark thinks under one of its own profiles; and a run's origin is read the way
// spawnedBy is, OPEN. The verb catalog moved to tools.ts in MT-0 (2026-10-30), and its lint to tools.test.ts.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

describe("the spark doors (CP-0; IOS-12a, PC-D7 A: the person's, from any screen, through the home)", () => {
  const row = (m: string) => METHODS.find((r) => r.method === m);

  it("ride sparks.use, which the phone's preset holds and a peer daemon holds only by derivation", () => {
    for (const m of [
      "compose.sparks.list",
      "compose.sparks.hatch",
      "compose.sparks.open",
      "compose.sparks.say",
    ])
      expect(row(m)?.scope, m).toBe("sparks.use");
    expect(TAILNET_SCOPES).toContain("sparks.use");
    expect(PEER_FIELDD_SCOPES).toContain("sparks.use");
  });

  it("federate the list, open and say through the home, and hatch where the call lands (PC-L2, PC-D8 A)", () => {
    expect(row("compose.sparks.list")?.locality).toBe("federate");
    expect(row("compose.sparks.open")?.locality).toBe("federate");
    expect(row("compose.sparks.say")?.locality).toBe("federate");
    expect(row("compose.sparks.hatch")?.locality).toBe("local");
    // a say is a mutation, so a forward of it is keyed; open is declarative
    expect(row("compose.sparks.say")?.idempotent).toBe(false);
    expect(row("compose.sparks.open")?.idempotent).toBe(true);
    for (const m of ["compose.sparks.list", "compose.sparks.open", "compose.sparks.say"])
      expect(reachableFromTailnet(row(m)!), m).toBe(true);
  });

  it("name a spark's desktop on every merged row, and say how each desktop answered (PC-L4)", () => {
    const merged = ComposeSparksListResult.parse(fixture("compose-sparks-list.merged"));
    expect(merged.sparks.map((s) => s.device)).toEqual(["dev-01HQ9S7UD1", "dev-01HQ9S7XZ2"]);
    expect(merged.desktops?.map((d) => composeDesktopStateOf(d))).toEqual([
      "answered",
      "answered",
      "asleep",
    ]);
    // a word a newer home says still reads, as none this build names
    expect(composeDesktopStateOf({ state: "migrating" })).toBeUndefined();
    expect(COMPOSE_DESKTOP_STATES).toEqual([
      "answered",
      "asleep",
      "timeout",
      "incompatible",
      "unreachable",
    ]);
    // a row from a daemon before IOS-12a names no desktop and still reads
    expect(ComposeSparksListResult.parse(fixture("compose-sparks-list.valid")).desktops).toBe(
      undefined,
    );
    expect(ComposeSparksOpenParams.parse({ spark: "sp-7k2m9q4x" }).device).toBeUndefined();
  });

  it("list this desktop's own unless the home's merge is asked for: the Mac's Chat lists as it always has", () => {
    for (const Params of [ComposeSparksListParams, NeedsListParams]) {
      expect(Params.parse({}).scope).toBeUndefined();
      expect(Params.parse({ scope: "mesh" }).scope).toBe("mesh");
      expect(Params.safeParse({ scope: "everywhere" }).success).toBe(false);
    }
  });
});

describe("your words to a spark (IOS-12a; PC-D3 A, CP2-D2)", () => {
  it("carry a request id and the spark's desktop, at a spark's send's bound", () => {
    const say = ComposeSparksSayParams.parse(fixture("compose-sparks-say-params.valid"));
    expect(say.device).toBe("dev-01HQ9S7XZ2");
    for (const requestId of ["short", "has space in it", "x".repeat(65), ""])
      expect(ComposeSparksSayParams.safeParse({ ...say, requestId }).success, requestId).toBe(
        false,
      );
    expect(ComposeSparksSayParams.safeParse({ ...say, text: "" }).success).toBe(false);
    expect(ComposeSparksSayParams.safeParse({ ...say, text: "x".repeat(32_001) }).success).toBe(
      false,
    );
  });

  it("answer a receipt that is always queued, with a place while it waits", () => {
    const queued = ComposeSparksSayResult.parse(fixture("compose-sparks-say.queued"));
    expect([queued.state, queued.position]).toEqual(["queued", 1]);
    expect(ComposeSparksSayResult.parse(fixture("compose-sparks-say.waking")).state).toBe("waking");
    const delivered = ComposeSparksSayResult.parse(fixture("compose-sparks-say.delivered"));
    expect([delivered.state, delivered.position]).toEqual(["delivered", undefined]);
    // a person's words are never held: a receipt that is not queued is no receipt
    expect(ComposeSparksSayResult.safeParse({ ...queued, queued: false }).success).toBe(false);
    expect(composeSayStateOf({ state: "migrated" })).toBeUndefined();
    expect(COMPOSE_SAY_STATES).toEqual([
      "queued",
      "waking",
      "waiting",
      "delivered",
      "uncertain",
      "dropped",
    ]);
  });

  it("are kept as yours, unmarked, with the say's request id", () => {
    const kept = AgentInputQueueFile.parse(fixture("agent-input-queue.you"));
    const [, yours] = kept.inputs;
    expect(yours?.from).toEqual({ kind: "you" });
    expect(yours?.requestId).toBe("say-01JC4M8Q2V7T");
  });

  it("carry their chips as spans inside the words, and refuse one outside them (TH-1; TH-Q25 (a))", () => {
    const say = ComposeSparksSayParams.parse(fixture("compose-sparks-say-params.chips"));
    const [chip] = say.chips ?? [];
    expect(chip?.kind).toBe("session");
    expect(say.text.slice(chip?.start, (chip?.start ?? 0) + (chip?.length ?? 0))).toBe(
      "Claude Code in vibe-field (session run-7f3c2a)",
    );
    // a say from a desktop before TH-1 carries none, and still reads
    expect(ComposeSparksSayParams.parse(fixture("compose-sparks-say-params.valid")).chips).toBe(
      undefined,
    );
    const at = (start: number, length: number) => ({
      ...say,
      chips: [{ start, length, kind: "card" }],
    });
    expect(ComposeSparksSayParams.safeParse(at(say.text.length - 2, 3)).success).toBe(false);
    expect(ComposeSparksSayParams.safeParse(at(-1, 3)).success).toBe(false);
    expect(ComposeSparksSayParams.safeParse(at(0, 0)).success).toBe(false);
    // in order, none overlapping
    const two = (a: number, b: number) => ({
      ...say,
      chips: [
        { start: a, length: 4, kind: "agent" },
        { start: b, length: 4, kind: "agent" },
      ],
    });
    expect(ComposeSparksSayParams.safeParse(two(0, 4)).success).toBe(true);
    expect(ComposeSparksSayParams.safeParse(two(0, 3)).success).toBe(false);
    expect(ComposeSparksSayParams.safeParse(two(8, 0)).success).toBe(false);
    expect(composeChipsFit("ab", [])).toBe(true);
    expect(COMPOSE_SAY_CHIPS_MAX).toBe(64);
  });
});

describe("a spark on the remote cut (IOS-12a; PG-2, SP-1b)", () => {
  it("carries the run's spark and origin, as the field row does, and a row without them still reads", () => {
    const own = AgentRemoteRow.parse(fixture("agent-remote-row.spark"));
    expect(own.spark).toBe("sp-7k2m9q4x");
    expect(own.origin).toEqual({ by: "you" });
    const plain = AgentRemoteRow.parse(fixture("agent-remote-row.valid"));
    expect([plain.spark, plain.origin]).toEqual([undefined, undefined]);
    expect(AgentRemoteRow.safeParse({ ...own, spark: "Vela" }).success).toBe(false);
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

describe("TU-1 (Q1) — a spark says whether it has worked", () => {
  it("reads a time, null or nothing, as the list answers it", () => {
    const { sparks } = ComposeSparksListResult.parse(fixture("compose-sparks-list.turned"));
    expect(sparks.map((spark) => spark.turnedAt)).toEqual([
      "2026-11-01T08:40:12.000Z",
      null,
      undefined,
    ]);
    // a spark from before TU-1 carries no key at all: unknown, never null
    expect("turnedAt" in (sparks[2] ?? {})).toBe(false);
    const older = ComposeSparksListResult.parse(fixture("compose-sparks-list.valid"));
    expect(older.sparks.every((spark) => !("turnedAt" in spark))).toBe(true);
  });

  it("is the signed record's: it takes null and a time, and refuses a clock that is not one", () => {
    const record = SparkRecord.parse(fixture("compose-spark-record.valid"));
    expect(SparkRecord.parse({ ...record, turnedAt: null }).turnedAt).toBeNull();
    expect(SparkRecord.parse({ ...record, turnedAt: "2026-11-01T08:40:12.000Z" }).turnedAt).toBe(
      "2026-11-01T08:40:12.000Z",
    );
    for (const bad of ["", 42, false])
      expect(SparkRecord.safeParse({ ...record, turnedAt: bad }).success, String(bad)).toBe(false);
  });

  it("is fieldd's alone: the sheet's answers name no turn", () => {
    expect(Object.keys(ComposeSparksHatchParams.innerType().shape)).not.toContain("turnedAt");
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

  it("is one run's, its inputs marked as a spark's, as VibeField's or as yours, and its signature rides beside the body", () => {
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

  it("the needs doors ride sparks.use through the home, the notices stay the window's, never on approval.respond (CP3-D6 A, corrected by IOS-12a)", () => {
    for (const m of ["needs.list", "needs.subscribe", "needs.answer"]) {
      const row = METHODS.find((r) => r.method === m);
      expect(row?.scope, m).toBe("sparks.use");
      expect(row?.locality, m).toBe("federate");
      expect(row && reachableFromTailnet(row), m).toBe(true);
    }
    expect(METHODS.find((r) => r.method === "needs.answer")?.idempotent).toBe(true);
    // one desktop's queue per subscription, whole lists at the product API's stream floor
    expect(METHODS.find((r) => r.method === "needs.subscribe")?.subscription).toEqual({
      shape: "stream",
      cadenceFloorMs: PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS,
    });
    expect(NeedsSubscribeParams.parse({ device: "dev-01HQ9S7XZ2" }).device).toBe("dev-01HQ9S7XZ2");
    // main's OS notice and the window's status line: the window's alone
    const notices = METHODS.find((r) => r.method === "needs.notices.subscribe");
    expect([notices?.scope, notices?.locality, notices?.subscription]).toEqual([
      "agents.manage",
      "local",
      true,
    ]);
    // AR-6's answers to an agent's own asks keep the scope; nothing rides it yet
    expect(METHODS.some((r) => r.scope === "approval.respond")).toBe(false);
  });

  it("the home's merged queue names each item's desktop and how each desktop answered (IOS-12a, PC-L2)", () => {
    const merged = NeedsListResult.parse(fixture("needs-list.merged"));
    expect(merged.items.map((item) => item.device)).toEqual(["dev-01HQ9S7UD1", "dev-01HQ9S7UD1"]);
    expect(merged.desktops?.map((d) => d.state)).toEqual(["answered", "timeout", "asleep"]);
    expect(NeedsAnswerParams.parse({ item: "ny-3f9a1c0b7e2d4a61", choice: 0 }).device).toBe(
      undefined,
    );
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

describe("item 158 — a kept input's delivery stamp and the items its line carries; a needs record's telling (TH-Q32 (a), CO-Q9 (b))", () => {
  const kept = AgentInputQueueFile.parse(fixture("agent-input-queue.valid"));
  /** `n` distinct needs-you item ids */
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `ny-${String(i).padStart(6, "0")}`);
  /** CP-3's file, its wake carrying `items` */
  const carrying = (items: unknown) => ({
    ...kept,
    inputs: [kept.inputs[0], { ...kept.inputs[1], items }],
  });

  it("C1: a CP-3 kept queue, with no stamp and no items, reads as before (the format stays 1)", () => {
    expect(kept.format).toBe(1);
    expect(kept.inputs.map((input) => [input.sending, input.items])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("C2: a head stamped when its delivery began, and a joined wake that carries its items, read", () => {
    const stamped = AgentInputQueueFile.parse(fixture("agent-input-queue.sending"));
    const [head, wake] = stamped.inputs;
    expect(head).toMatchObject({ from: { kind: "spark" }, sending: "2026-11-04T16:02:11.402Z" });
    expect(head?.items).toBeUndefined();
    expect(wake?.from.kind).toBe("fieldd");
    expect(wake?.sending).toBeUndefined();
    expect(wake?.items).toEqual(["ny-8c41d2e09a77b305", "ny-3f9a1c0b7e2d4c19"]);
  });

  it("C3: refuses a line that carries no item, a seventeenth item, an item that is no id, and a stamp that is no time", () => {
    expect(AgentInputQueueFile.safeParse(carrying([])).success).toBe(false);
    expect(AgentInputQueueFile.safeParse(carrying(ids(17))).success).toBe(false);
    expect(AgentInputQueueFile.safeParse(carrying(["Vela"])).success).toBe(false);
    expect(AgentInputQueueFile.safeParse(carrying(ids(16))).success).toBe(true);
    const stampedWith = (sending: unknown) => ({
      ...kept,
      inputs: [{ ...kept.inputs[0], sending }, kept.inputs[1]],
    });
    expect(AgentInputQueueFile.safeParse(stampedWith("")).success).toBe(false);
    expect(AgentInputQueueFile.safeParse(stampedWith(1_762_272_131_402)).success).toBe(false);
    // twice what one spark may have waiting on the person: its open items' facts, joined into one line
    expect(NEEDS_JOINED_ITEMS_MAX).toBe(2 * NEEDS_OPEN_PER_SPARK);
  });

  it("C4: a needs record keeps the run whose queue holds its owed fact, and refuses a telling that names none", () => {
    const record = NeedsRecord.parse(fixture("needs-record.held-send"));
    const at = "2026-11-04T16:04:52.000Z";
    expect(NeedsRecord.safeParse({ ...record, telling: {} }).success).toBe(false);
    expect(NeedsRecord.safeParse({ ...record, telling: { run: "", at } }).success).toBe(false);
    expect(NeedsRecord.safeParse({ ...record, telling: { run: "run-12" } }).success).toBe(false);
    expect(NeedsRecord.parse({ ...record, telling: { run: "run-12", at } }).telling).toEqual({
      run: "run-12",
      at,
    });
    const telling = NeedsRecord.parse(fixture("needs-record.telling"));
    expect(telling.telling).toEqual({ run: "run-12", at: "2026-11-04T16:04:52.118Z" });
    // owed until the spark's session confirms it, while `told` says it is in the spark's queue (§8 Q1 (b))
    expect(telling.owed).toBeDefined();
    expect(telling.item.answer).toMatchObject({ outcome: "done", told: true });
  });
});

describe("item 159 — the spark's kept record, in the spark's own folder (TH0-Q11 (b))", () => {
  it("K1: one folder per spark under this user's fieldd, its key beside it, never at the root or in the spark's home", () => {
    expect(LAYOUT.SPARK_FILES_DIR).toEqual(["fieldd", "spark-files"]);
    expect(LAYOUT.SPARK_FILES_KEY_FILE).toEqual(["fieldd", "spark-files.key"]);
    expect(LAYOUT.SPARK_FILES_KEY_FILE.slice(0, -1)).toEqual(LAYOUT.SPARK_FILES_DIR.slice(0, -1));
    expect(LAYOUT_ROOT_LEVEL).not.toContain("SPARK_FILES_DIR");
    expect(LAYOUT_ROOT_LEVEL).not.toContain("SPARK_FILES_KEY_FILE");
    // fieldd's records never live in the folder the spark's agent works in
    expect(LAYOUT.SPARK_FILES_DIR[0]).not.toBe(LAYOUT.SPARK_HOMES_DIR[0]);
  });

  it("K2: a kept record is its spark's, one file in its folder, the format 1, and a section this build does not know is kept whole", () => {
    expect(SPARK_KEPT_FORMAT).toBe(1);
    expect(SPARK_KEPT_FILE).toBe("kept.json");
    const record = SparkKeptRecord.parse(fixture("spark-kept-record.valid"));
    expect(record).toMatchObject({ format: 1, spark: "sp-7k2m9q4x" });
    expect((record as { signature?: string }).signature).toMatch(/^[0-9a-f]{64}$/);
    // *SP-1e2 (2026-11-05):* this section was `crews`, unknown until SP-1e2 made it the record's own, so it is `later`
    const later = SparkKeptRecord.parse(fixture("spark-kept-record.unknown-section"));
    expect((later as Record<string, unknown>).later).toEqual([
      { name: "review", sessions: ["run-31", "run-44"] },
    ]);
  });

  it("K3: refuses a record that names no spark, another format, or no time it was written", () => {
    expect(SparkKeptRecord, "the kept record's schema").toBeDefined();
    const record = SparkKeptRecord.parse(fixture("spark-kept-record.valid"));
    for (const bad of [
      { ...record, spark: "Vela" },
      { ...record, format: 2 },
      { ...record, updatedAt: "" },
      { format: 1, spark: "sp-7k2m9q4x" },
    ])
      expect(SparkKeptRecord.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("SP-1e2 — a spark's crews: the crew on the origin, the held spawn's crew, the kept record's crews and their door", () => {
  const CREW = "cr-3n8w5t1v";

  it("C1: a crew's id is fieldd's, an id and never a word", () => {
    expect(CrewId.parse(CREW)).toBe(CREW);
    for (const bad of [
      "",
      "cr-",
      "cr-abc",
      "crew-3n8w5t1v",
      "cr-3N8W5T1V",
      "Research",
      "sp-3n8w5t1v",
    ])
      expect(CrewId.safeParse(bad).success, bad).toBe(false);
  });

  it("C2: a spark's spawn names its crew on its origin, the record and the board alike; a run from before SP-1e2 names none (SPE-Q4, SPE-Q15)", () => {
    const record = AgentSessionRecord.parse(fixture("agent-session-record.spark-crew"));
    expect(record.origin).toEqual({ by: "spark", spark: "sp-7k2m9q4x", crew: CREW });
    expect(AgentSessionRecord.parse(fixture("agent-session-record.spark-started")).origin).toEqual({
      by: "spark",
      spark: "sp-7k2m9q4x",
    });
    const board = AgentFieldSnapshot.parse(fixture("agent-field-snapshot.crew"));
    const crewOf = (run: string) =>
      board.rows.find((row) => row.runtimeRunId === run)?.origin?.crew;
    expect(["run-22", "run-23", "run-24"].map(crewOf)).toEqual([CREW, CREW, CREW]);
    // the spark's own run is no member of its crews
    expect(crewOf("run-12")).toBeUndefined();
    // a crew that is not an id is refused, never read as a word
    expect(
      AgentSessionRecord.safeParse({ ...record, origin: { ...record.origin, crew: "research" } })
        .success,
    ).toBe(false);
  });

  it("C3: a held spawn keeps the crew it was asked in; a held spawn from before SP-1e2 keeps none", () => {
    expect(NeedsRecord.parse(fixture("needs-record.held-spawn-crew")).launch?.crew).toBe(CREW);
    expect(NeedsRecord.parse(fixture("needs-record.held-spawn")).launch?.crew).toBeUndefined();
  });

  it("C4: the kept record holds the newest SPARK_CREWS_KEPT crews, each its members by start, an ended one named at its end (SPE-Q14 (a), SPE-Q28 (b))", () => {
    expect(SPARK_CREWS_KEPT).toBe(256);
    const kept = SparkKeptRecord.parse(fixture("spark-kept-record.crews"));
    const [first, second] = kept.crews ?? [];
    expect(first).toMatchObject({ id: CREW, sparkRun: "run-12", at: "2026-11-05T02:10:01.003Z" });
    expect(first?.members.map((m) => m.runtimeRunId)).toEqual([
      "run-21",
      "run-22",
      "run-23",
      "run-24",
    ]);
    expect(first?.members[0]).toMatchObject({
      endedAt: "2026-11-05T02:31:40.880Z",
      name: "Claude Code in vibe-field",
    });
    // a member whose row has not named its model yet
    expect(first?.members[3]?.model).toBeUndefined();
    expect(second?.members).toHaveLength(1);
    // a record from before SP-1e2 holds no crews, and still reads
    expect(SparkKeptRecord.parse(fixture("spark-kept-record.valid")).crews).toBeUndefined();
    // the bounds: past them the signed file is refused whole, so fieldd never writes past them
    const crew = first!;
    const crews = (n: number) => Array.from({ length: n }, () => crew);
    expect(SparkKeptRecord.safeParse({ ...kept, crews: crews(SPARK_CREWS_KEPT) }).success).toBe(
      true,
    );
    expect(SparkKeptRecord.safeParse({ ...kept, crews: crews(SPARK_CREWS_KEPT + 1) }).success).toBe(
      false,
    );
    const members = (n: number) => Array.from({ length: n }, () => crew.members[1]!);
    expect(SPARK_CREW_MEMBERS_MAX).toBe(64);
    expect(
      SparkKeptRecord.safeParse({
        ...kept,
        crews: [{ ...crew, members: members(SPARK_CREW_MEMBERS_MAX + 1) }],
      }).success,
    ).toBe(false);
    // a crew names the spark's run it was made in, and its id; a member its run, its start and its agent
    for (const bad of [
      { ...crew, sparkRun: undefined },
      { ...crew, id: "research" },
      { ...crew, members: [{ ...crew.members[0], agent: undefined }] },
      { ...crew, members: [{ ...crew.members[0], runtimeRunId: "" }] },
    ])
      expect(
        SparkKeptRecord.safeParse({ ...kept, crews: [bad] }).success,
        JSON.stringify(bad),
      ).toBe(false);
  });

  it("C5: compose.sparks.crews.subscribe is the person's, the sparks' family, whole lists at the stream floor (SPE-Q27 (a), SPE-Q40, X2-crews)", () => {
    const row = METHODS.find((r) => r.method === "compose.sparks.crews.subscribe");
    expect(row).toMatchObject({
      surface: "product",
      scope: "sparks.use",
      idempotent: true,
      locality: "federate",
    });
    expect(row && reachableFromTailnet(row)).toBe(true);
    expect(row?.subscription).toEqual({
      shape: "stream",
      cadenceFloorMs: PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS,
    });
    expect(ComposeSparksCrewsSubscribeParams.parse({ spark: "sp-7k2m9q4x" })).toEqual({
      spark: "sp-7k2m9q4x",
    });
    expect(
      ComposeSparksCrewsSubscribeParams.parse({ spark: "sp-7k2m9q4x", device: "dev-01HQ9S7XZ2" })
        .device,
    ).toBe("dev-01HQ9S7XZ2");
    for (const bad of [{}, { spark: "Vela" }, { spark: "sp-7k2m9q4x", device: "" }])
      expect(ComposeSparksCrewsSubscribeParams.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
  });

  it("C6: a frame is the spark's crews whole, with how many tasks each live member still holds (SPE-Q32 (a)), and one resumed member is one member (SPE-Q30 (a))", () => {
    const live = ComposeSparksCrewsFrame.parse(fixture("compose-sparks-crews.valid"));
    expect(live.spark).toBe("sp-7k2m9q4x");
    expect(live.crews[0]?.members).toHaveLength(4);
    expect(live.waiting?.find((w) => w.runtimeRunId === "run-22")?.tasks).toBe(1);
    const ended = ComposeSparksCrewsFrame.parse(fixture("compose-sparks-crews.ended-member"));
    const members = ended.crews[0]?.members ?? [];
    expect(members.filter((m) => m.endedAt !== undefined).map((m) => m.name)).toEqual([
      "Claude Code in vibe-field",
      "Claude Code in vibe-field",
    ]);
    expect(members.find((m) => m.continues === "run-22")?.runtimeRunId).toBe("run-41");
    expect(members.some((m) => m.runtimeRunId === "run-22")).toBe(false);
    // no live state is kept: a frame's `waiting` is the door's alone
    expect(SparkKeptRecord.parse(fixture("spark-kept-record.crews"))).not.toHaveProperty("waiting");
    for (const bad of [
      { ...live, spark: undefined },
      { ...live, waiting: [{ runtimeRunId: "run-22", tasks: -1 }] },
      { ...live, waiting: [{ runtimeRunId: "run-22", tasks: 0.5 }] },
    ])
      expect(ComposeSparksCrewsFrame.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("a crew's shared model (SP-1e2, SR-Q2: the act line's words and the card's head read one rule)", () => {
  it("C7: says the model and effort every member shares, the model alone when none names an effort, and nothing when they differ or one is not named yet", () => {
    const opus = { model: "Opus 5.5", effort: "high" };
    expect(crewSharedModelOf([opus, opus, opus, opus])).toEqual({
      model: "Opus 5.5",
      effort: "high",
    });
    // J2 at its lean (a): one model, no effort named by any member
    expect(crewSharedModelOf([{ model: "Grok 4" }, { model: "Grok 4" }])).toEqual({
      model: "Grok 4",
    });
    expect(crewSharedModelOf([{ model: "Grok 4" }])).not.toHaveProperty("effort");
    for (const differ of [
      [opus, { model: "Sonnet 5.5", effort: "high" }],
      [opus, { model: "Opus 5.5", effort: "low" }],
      [opus, { model: "Opus 5.5" }],
      [opus, {}],
      [{}, opus],
      [],
    ])
      expect(crewSharedModelOf(differ), JSON.stringify(differ)).toBeNull();
  });
});

describe("a session's name where no handle is said (SP-1e2, SR-Q4 (a): one rule for fieldd and the window)", () => {
  it("C8: its title, else its agent's label in its folder, else that label, else its id; one line, cut at NEEDS_NAME_MAX", () => {
    expect(sessionName({ title: " Fix\nthe restore ", label: "Claude Code", id: "run-1" })).toBe(
      "Fix the restore",
    );
    expect(sessionName({ label: "Claude Code", folder: "vibe-field", id: "run-1" })).toBe(
      "Claude Code in vibe-field",
    );
    expect(sessionName({ label: "Claude Code", folder: " ", id: "run-1" })).toBe("Claude Code");
    expect(sessionName({ id: "run-1" })).toBe("run-1");
    const long = sessionName({ title: "x".repeat(200), id: "run-1" });
    expect(long).toHaveLength(NEEDS_NAME_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("CP-4a2b — a flow's seven acts, one authority (13b.3's C7; DESIGN.md §9 \"When a run can't go on, or waits\")", () => {
  const ACTS = {
    stopRun: "Stop the run",
    allowMore: "Allow 20 more",
    askOnceMore: "Ask once more",
    resumeStep: "Resume the step",
    seeChange: "See the change",
    runThisVersion: "Run this version",
    runApproved: "Run the one you approved",
  } as const;
  const words = NEEDS_CHOICE_WORDS as Record<string, string | undefined>;

  it("C7: NEEDS_CHOICE_WORDS holds the seven acts, each one line within NEEDS_CHOICE_MAX", () => {
    for (const [key, act] of Object.entries(ACTS)) {
      expect(words[key], key).toBe(act);
      expect(act.length, key).toBeLessThanOrEqual(NEEDS_CHOICE_MAX);
      expect(act, key).not.toMatch(/[\r\n]/);
    }
    // the Allow's number is the cap's own (FLOW_LIMITS.CALLS_MORE), so the two never drift
    expect(words["allowMore"]).toBe(`Allow ${FLOW_LIMITS.CALLS_MORE} more`);
  });

  it("C7: every VibeField act a flow's item fixture offers is one of the seven, or Not now", () => {
    const own = new Set<string>(Object.values(NEEDS_CHOICE_WORDS));
    const offered = [
      ["needs-item.flow-cap", ["Allow 20 more", "Stop the run"]],
      ["needs-item.flow-changed", ["Run this version", "Run the one you approved", "Not now"]],
      ["needs-item.flow-gate", ["Stop the run"]],
      ["needs-item.flow-lost", ["Resume the step", "Stop the run"]],
      ["needs-item.flow-repair", ["Ask once more", "Stop the run"]],
    ] as const;
    for (const [name, acts] of offered) {
      const choices = (fixture(name) as { choices: string[] }).choices;
      for (const act of acts) {
        expect(choices, name).toContain(act);
        expect(own.has(act), act).toBe(true);
      }
    }
  });
});
