import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NEEDS_CHOICES_MAX,
  NEEDS_ITEM_KINDS,
  NeedsItem,
  NeedsRun,
  NeedsScript,
  needsKindOf,
} from "../src/compose";
import { ErrorData, UnavailableDetails } from "../src/errors";
import {
  FLOW_CALL_WHATS,
  FLOW_ENTRY_STATES,
  FLOW_FILE_SUFFIX,
  FLOW_HOST_ENDINGS,
  FLOW_JOURNAL_KINDS,
  FLOW_READ_REFUSALS,
  FLOW_RECORD_FORMAT,
  FLOW_RUN_STATES,
  FLOW_STEP_STATES,
  FlowApprovalRecord,
  FlowCallKey,
  FlowGate,
  FlowHash,
  FlowJournalHead,
  FlowJournalLine,
  FlowMeta,
  FlowProposalRecord,
  FlowRead,
  FlowRunId,
  FlowSlug,
  FlowsListResult,
  FlowsRunParams,
  FlowsRunResult,
  FlowsScriptParams,
  FlowsScriptResult,
  FlowsStopResult,
  flowAnswerBytes,
  flowEntryStateOf,
  flowJournalLineOf,
  flowRefusalOf,
  flowRunStateOf,
  flowStepStateOf,
} from "../src/flows";
import { METHODS, reachableFromTailnet } from "../src/methods";
import {
  FLOW_HOST,
  FLOW_LIMITS,
  LAYOUT,
  LAYOUT_ROOT_LEVEL,
  PRODUCT_API_LIMITS,
  RECORD_STORES,
} from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

const FLOW_KINDS = [
  "flow-proposal",
  "flow-gate",
  "flow-changed",
  "flow-repair",
  "flow-cap",
  "flow-lost",
] as const;

describe("CP-4a1 — the window's flow doors (agents.manage, local; VF-PM 2026-11-05 01:22Z)", () => {
  const row = (m: string) => METHODS.find((r) => r.method === m);
  const doors = ["flows.list", "flows.subscribe", "flows.run", "flows.stop", "flows.script"];

  it("F1: five product doors, each agents.manage and local, so no phone or peer reaches a run", () => {
    for (const m of doors) {
      expect(row(m)?.surface, m).toBe("product");
      expect(row(m)?.scope, m).toBe("agents.manage");
      expect(row(m)?.locality, m).toBe("local");
      expect(reachableFromTailnet(row(m)!), m).toBe(false);
    }
    // gates, proposals, changed flows, repairs, the cap and a lost step are needs-you items (CP-D12), no door here
    expect(METHODS.filter((m) => m.method.startsWith("flows.")).map((m) => m.method)).toEqual(
      doors,
    );
  });

  it("F2: a run is a new act each time; the rest are declarative; the subscription sends whole lists", () => {
    expect(row("flows.run")?.idempotent).toBe(false);
    for (const m of ["flows.list", "flows.subscribe", "flows.stop", "flows.script"])
      expect(row(m)?.idempotent, m).toBe(true);
    expect(row("flows.subscribe")?.subscription).toEqual({
      shape: "stream",
      cadenceFloorMs: PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS,
    });
    for (const m of ["flows.list", "flows.run", "flows.stop", "flows.script"])
      expect(row(m)?.subscription, m).toBeUndefined();
  });
});

describe("CP-4a1 — the library and fieldd's records on disk (CP4-Q18 (a))", () => {
  it("F3: the person's library per user, beside their sparks' homes; fieldd's records and key under fieldd", () => {
    expect(LAYOUT.FLOWS_LIBRARY_DIR).toEqual(["flows"]);
    expect(LAYOUT.FLOWS_DIR).toEqual(["fieldd", "flows"]);
    expect(LAYOUT.FLOWS_KEY_FILE).toEqual(["fieldd", "flows.key"]);
    expect(LAYOUT.FLOWS_KEY_FILE.slice(0, -1)).toEqual(LAYOUT.FLOWS_DIR.slice(0, -1));
    for (const key of ["FLOWS_LIBRARY_DIR", "FLOWS_DIR", "FLOWS_KEY_FILE"])
      expect(LAYOUT_ROOT_LEVEL, key).not.toContain(key);
    // fieldd's records never live in the folder the person edits
    expect(LAYOUT.FLOWS_DIR[0]).not.toBe(LAYOUT.FLOWS_LIBRARY_DIR[0]);
    // no other row names the same place
    const spelled = Object.entries(LAYOUT).map(([key, path]) => [key, path.join("/")]);
    for (const key of ["FLOWS_LIBRARY_DIR", "FLOWS_DIR", "FLOWS_KEY_FILE"] as const) {
      const path = LAYOUT[key].join("/");
      expect(spelled.filter(([, p]) => p === path).map(([k]) => k)).toEqual([key]);
    }
    expect(FLOW_FILE_SUFFIX).toBe(".flow.js");
  });

  it("F4: a run's bounds, provisional until measured (CP4-Q8 (a), CP4-S7, CP4-Q17 (a))", () => {
    expect(FLOW_LIMITS).toEqual({
      SCRIPT_MAX_BYTES: 65_536,
      RESULT_MAX_BYTES: 65_536,
      CALLS_MAX: 40,
      CALLS_MORE: 20,
      LIVE_STEPS_MAX: 8,
      // CP-4a2a (4A2-Q7 (b)): the run's host, provisional likewise
      HOST_HEAP_MB: 128,
      // bth's re-read N1 (13:24Z): the host's resident memory, measured
      HOST_RSS_MB: 512,
      HOST_PING_MS: 5_000,
      HOST_PING_MISSES: 3,
      // bth's review P1/P3 (11:46Z): how deep a call's arguments nest
      ARGS_DEPTH_MAX: 32,
      // bth's review P1 (11:46Z): a run's calls waiting at once, and its log lines
      HOST_CALLS_WAITING_MAX: 256,
      HOST_LOG_LINES_MAX: 10_000,
    });
  });

  it("F5: slugs, hashes and ids are fieldd's strict forms", () => {
    for (const ok of ["release-check", "a", "review-until-clean", "x".repeat(63)])
      expect(FlowSlug.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["Release check", "-x", "../x", "x.flow", "", "x".repeat(64), "a/b"])
      expect(FlowSlug.safeParse(bad).success, bad).toBe(false);
    const hash = createHash("sha256").update("x").digest("hex");
    expect(FlowHash.safeParse(hash).success).toBe(true);
    for (const bad of [hash.toUpperCase(), hash.slice(1), `sha256:${hash}`])
      expect(FlowHash.safeParse(bad).success, bad).toBe(false);
    expect(FlowRunId.safeParse("fr-k3v9q2m7x1").success).toBe(true);
    expect(FlowRunId.safeParse("run-12").success).toBe(false);
  });

  it("F6: an approval names its flow and its bytes' hash, and a record of another format is refused", () => {
    const approval = FlowApprovalRecord.parse(fixture("flow-approval-record.valid"));
    expect(approval).toMatchObject({
      format: FLOW_RECORD_FORMAT,
      flow: "release-check",
      by: "you",
    });
    expect((approval as { signature?: string }).signature).toMatch(/^[0-9a-f]{64}$/);
    for (const bad of [
      { ...approval, format: 2 },
      { ...approval, flow: "Release check" },
      { ...approval, hash: "abc" },
      { ...approval, approvedAt: "" },
    ])
      expect(FlowApprovalRecord.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const proposal = FlowProposalRecord.parse(fixture("flow-proposal-record.valid"));
    expect(proposal).toMatchObject({ id: "fp-9d4e2a7c1b", spark: "sp-7k2m9q4x" });
    expect(FlowProposalRecord.safeParse({ ...proposal, spark: "Vela" }).success).toBe(false);
    expect(FlowProposalRecord.safeParse({ ...proposal, id: "ny-9d4e2a7c1b" }).success).toBe(false);
  });
});

describe("CP-4a1 — the static read's shape (CP4-Q3 (a))", () => {
  it("F7: what the bytes say: meta, each agent call and each gate, nothing about money", () => {
    const read = FlowRead.parse(fixture("flow-read.valid"));
    expect(read.meta).toEqual({
      name: "Release check",
      phases: ["Review", "Ship"],
      input: { target: "session" },
    });
    expect(read.calls.map((c) => c.label)).toEqual(["review", "ship"]);
    expect(read.calls[1]?.in).toBe(true);
    expect(read.gates[0]?.choices).toEqual(["Push", "Hold"]);
    expect(read.unlisted).toBe(false);
    expect(read.refusals).toEqual([]);
    // CP4-S11: the meta has no budget, and no word of the read speaks of spend
    expect(Object.keys(FlowMeta.shape)).toEqual(["name", "phases", "input"]);
    expect(JSON.stringify(fixture("flow-read.valid"))).not.toMatch(/budget|usd|spend/i);
  });

  it("F8: a script the read cannot list says so, and one it refuses says why, in open words", () => {
    const unlisted = FlowRead.parse(fixture("flow-read.unlisted"));
    expect(unlisted.unlisted).toBe(true);
    expect(unlisted.calls[0]).toMatchObject({ computed: true, inLoop: true });
    const refused = FlowRead.parse(fixture("flow-read.refused"));
    expect(refused.meta).toBeUndefined();
    expect(refused.refusals.map((r) => flowRefusalOf(r))).toEqual(["meta", "choices"]);
    expect(flowRefusalOf({ reason: "too-clever" })).toBeUndefined();
    expect(FLOW_READ_REFUSALS).toEqual(["syntax", "meta", "default", "choices", "size"]);
  });

  it("C5: the read refuses the sandbox's three shapes in known words: import, eval and html-comment (CP-4a2b, Q-B3 (a))", () => {
    // the same read fieldd gives the fieldd fixture `real-calls.flow.js` (flows-static-read.test.ts, EL9)
    const refused = FlowRead.parse(fixture("flow-read.refused-import"));
    expect(refused.refusals.map((r) => flowRefusalOf(r))).toEqual([
      "import",
      "eval",
      "html-comment",
    ]);
    expect(refused.refusals.map((r) => r.line)).toEqual([3, 4, 6]);
  });

  it("F9: a gate takes at most four choices of the script's own: Stop the run takes the item's fifth place", () => {
    const four = ["a", "b", "c", "d"];
    expect(FlowGate.safeParse({ line: 1, choices: four }).success).toBe(true);
    expect(FlowGate.safeParse({ line: 1, choices: [...four, "e"] }).success).toBe(false);
    expect(FlowGate.safeParse({ line: 1, choices: [] }).success).toBe(false);
    expect(NEEDS_CHOICES_MAX).toBe(4);
  });
});

describe("CP-4a1 — the library and its runs on the wire", () => {
  it("F10: a library row says how its file stands against its approval; a run says where it is", () => {
    const { flows, runs } = FlowsListResult.parse(fixture("flows-list.valid"));
    expect(flows.map((f) => flowEntryStateOf(f))).toEqual([
      "approved",
      "changed",
      "new",
      "too-big",
    ]);
    expect(FLOW_ENTRY_STATES).toEqual(["approved", "changed", "new", "too-big"]);
    // a file too big is never read, so it has no hash
    expect(flows[3]?.hash).toBeUndefined();
    expect(flows[0]?.hash).toBe(flows[0]?.approved);
    expect(flows[1]?.hash).not.toBe(flows[1]?.approved);
    expect(runs.map((r) => flowRunStateOf(r))).toEqual(["holding", "stopped"]);
    expect(runs[1]?.ended).toBe(1);
    expect(runs[0]?.steps.map((s) => flowStepStateOf(s))).toEqual(["answered"]);
    expect(FLOW_RUN_STATES).toContain("lost");
    expect(FLOW_STEP_STATES).toContain("repairing");
  });

  it("F11: words a newer build says still read, as none this build names (the tolerant reader)", () => {
    const { flows, runs } = FlowsListResult.parse(fixture("flows-list.open-words"));
    expect(flowEntryStateOf(flows[0]!)).toBeUndefined();
    expect(flowRunStateOf(runs[0]!)).toBeUndefined();
    expect(flowStepStateOf(runs[0]!.steps[0]!)).toBeUndefined();
    expect((runs[0] as Record<string, unknown>).cost).toEqual({ usd: 0 });
  });

  it("F12: a Run starts a run, or names the item a changed flow waits in", () => {
    const params = FlowsRunParams.parse(fixture("flows-run-params.valid"));
    expect(params).toMatchObject({ flow: "release-check", spark: "sp-7k2m9q4x" });
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`in${i}`, "x"]));
    expect(FlowsRunParams.safeParse({ flow: "release-check", input: nine }).success).toBe(false);
    expect(
      FlowsRunParams.safeParse({ flow: "release-check", input: { "not a name": "x" } }).success,
    ).toBe(false);
    const started = FlowsRunResult.parse(fixture("flows-run.started"));
    expect(started.run?.state).toBe("running");
    expect(started.waits).toBeUndefined();
    const waits = FlowsRunResult.parse(fixture("flows-run.waits"));
    expect(waits.run).toBeUndefined();
    expect(waits.waits).toMatch(/^ny-/);
    expect(FlowsStopResult.parse(fixture("flows-stop.valid")).run.state).toBe("stopped");
  });

  it("F13: a script's text rides as text, bounded, and its hash is its bytes' SHA-256 (CP4-S10)", () => {
    const params = FlowsScriptParams.parse(fixture("flows-script-params.valid"));
    const script = FlowsScriptResult.parse(fixture("flows-script.valid"));
    expect(script.hash).toBe(params.hash);
    expect(createHash("sha256").update(script.text, "utf8").digest("hex")).toBe(script.hash);
    const big = "x".repeat(FLOW_LIMITS.SCRIPT_MAX_BYTES + 1);
    expect(FlowsScriptResult.safeParse({ ...script, text: big }).success).toBe(false);
  });
});

describe("CP-4a1 — a flow's items in the person's one queue (CP-D12)", () => {
  it("F14: six new kinds, the four of CP-3 kept first", () => {
    expect(NEEDS_ITEM_KINDS).toEqual([
      "question",
      "held-send",
      "held-spawn",
      "agent-ask",
      ...FLOW_KINDS,
    ]);
  });

  it("F15: each kind's item reads, naming its run, or the bytes a proposal or a changed flow is about", () => {
    for (const kind of FLOW_KINDS) {
      const item = NeedsItem.parse(fixture(`needs-item.${kind}`));
      expect(needsKindOf(item), kind).toBe(kind);
      if (kind === "flow-proposal" || kind === "flow-changed") {
        expect(item.script?.hash, kind).toMatch(/^[0-9a-f]{64}$/);
        expect(item.run, kind).toBeUndefined();
      } else {
        expect(FlowRunId.safeParse(item.run?.run).success, kind).toBe(true);
        expect(FlowSlug.safeParse(item.run?.flow).success, kind).toBe(true);
      }
    }
    const changed = NeedsItem.parse(fixture("needs-item.flow-changed"));
    expect(changed.script?.approved).not.toBe(changed.script?.hash);
    // a gate's acts are the script's own, then Stop the run, and no Not now (CP4-Q6 (a))
    const gate = NeedsItem.parse(fixture("needs-item.flow-gate"));
    expect(gate.choices?.at(-1)).toBe("Stop the run");
    expect(gate.choices).not.toContain("Not now");
    expect(gate.choices?.length).toBeLessThanOrEqual(NEEDS_CHOICES_MAX + 1);
  });

  it("F16: an item's run and bytes take fieldd's strict forms whole (NeedsRun, NeedsScript hold flows.ts's)", () => {
    const longest = `fr-${"z".repeat(32)}`;
    expect(FlowRunId.safeParse(longest).success).toBe(true);
    expect(NeedsRun.safeParse({ run: longest, flow: "x".repeat(63) }).success).toBe(true);
    const hash = createHash("sha256").update("flow").digest("hex");
    expect(NeedsScript.safeParse({ flow: "release-check", hash }).success).toBe(true);
    for (const bad of [hash.toUpperCase(), hash.slice(2)]) {
      expect(FlowHash.safeParse(bad).success, bad).toBe(false);
      expect(NeedsScript.safeParse({ flow: "release-check", hash: bad }).success, bad).toBe(false);
    }
    // a step is counted from 1, as a step's session record counts it (origin.call)
    expect(NeedsRun.safeParse({ run: "fr-k3v9q2m7x1", flow: "f", call: 0 }).success).toBe(false);
  });
});

describe("CP-4a2a — a run's journal (CP4-S15, CP-D9; the fixtures' MACs are real, under fieldd's fixture key)", () => {
  const HEX_64 = /^[0-9a-f]{64}$/;
  const answerFixture = () => fixture("flow-journal-line.answer") as Record<string, unknown>;

  it("F17: the head names the run, its flow, the approved bytes and who started it, as the file's first line", () => {
    const head = FlowJournalHead.parse(fixture("flow-journal-head.valid"));
    expect(head).toMatchObject({
      format: FLOW_RECORD_FORMAT,
      seq: 1,
      kind: "head",
      run: "fr-k3v9q2m7x1",
      flow: "release-check",
      name: "Release check",
      starter: { by: "you" },
      input: { target: "session-7f3a2c" },
    });
    expect(FlowHash.safeParse(head.hash).success).toBe(true);
    expect((head as { mac?: unknown }).mac).toMatch(HEX_64);
    expect(flowJournalLineOf(head)?.kind).toBe("head");
    for (const bad of [
      { ...head, seq: 2 },
      { ...head, run: "run-12" },
      { ...head, flow: "Release check" },
      { ...head, hash: "abc" },
      { ...head, n: 0 },
    ])
      expect(FlowJournalHead.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("F18: a call names its number, what it is, its replay key and its n; its answer names the same call", () => {
    const call = flowJournalLineOf(fixture("flow-journal-line.call"));
    expect(call).toMatchObject({
      kind: "call",
      seq: 2,
      call: 1,
      what: "agent",
      n: 1,
      label: "review",
    });
    expect(call?.kind === "call" && FlowCallKey.safeParse(call.key).success).toBe(true);
    const answer = flowJournalLineOf(answerFixture());
    expect(answer).toMatchObject({ kind: "answer", seq: 3, call: 1, value: { verdict: "clean" } });
    for (const bad of [
      { ...answerFixture(), call: 0 },
      { ...(call as object), key: "abc" },
    ])
      expect(flowJournalLineOf(bad), JSON.stringify(bad)).toBeUndefined();
  });

  it("F19: an answer is a value or a refusal, never both and never neither; `cut` marks a text cut short", () => {
    const { value: _value, ...bare } = answerFixture();
    const refused = flowJournalLineOf({ ...bare, refused: "VibeField ended this step." });
    expect(refused?.kind).toBe("answer");
    expect(flowJournalLineOf({ ...answerFixture(), refused: "both" })).toBeUndefined();
    expect(flowJournalLineOf(bare)).toBeUndefined();
    expect(flowJournalLineOf({ ...bare, value: null })?.kind).toBe("answer");
    const cutText = flowJournalLineOf({ ...bare, value: "the step's last message", cut: true });
    expect(cutText?.kind).toBe("answer");
    expect(flowJournalLineOf({ ...bare, value: { cut: "not text" }, cut: true })).toBeUndefined();
  });

  it("F20: an answer's value is bounded at RESULT_MAX_BYTES of its JSON's UTF-8 bytes", () => {
    const { value: _value, ...bare } = answerFixture();
    const max = FLOW_LIMITS.RESULT_MAX_BYTES;
    const fits = "x".repeat(max - 2); // the JSON string's two quotes
    expect(flowAnswerBytes(fits)).toBe(max);
    expect(flowJournalLineOf({ ...bare, value: fits })?.kind).toBe("answer");
    expect(flowJournalLineOf({ ...bare, value: `${fits}x` })).toBeUndefined();
    // bytes, not characters: "é" is two
    expect(flowAnswerBytes("é")).toBe(4);
    expect(flowJournalLineOf({ ...bare, value: `${"x".repeat(max - 3)}é` })).toBeUndefined();
  });

  it("F21: the open head reads a newer format and a kind it never heard of; the known reader takes neither", () => {
    for (const line of [
      { ...answerFixture(), format: FLOW_RECORD_FORMAT + 1 },
      { ...answerFixture(), kind: "checkpoint" },
    ]) {
      expect(FlowJournalLine.safeParse(line).success, JSON.stringify(line)).toBe(true);
      expect(flowJournalLineOf(line), JSON.stringify(line)).toBeUndefined();
    }
  });

  it("F22: the forged line has a line's shape and the original's MAC: the contract reads it, fieldd checks", () => {
    const forged = fixture("flow-journal-line.forged") as Record<string, unknown>;
    const answer = answerFixture();
    expect(forged["mac"]).toBe(answer["mac"]);
    expect(forged["value"]).not.toEqual(answer["value"]);
    expect(flowJournalLineOf(forged)?.kind).toBe("answer");
  });

  it("F23: the journal's open words, and an end that names why fieldd ended its host", () => {
    expect(FLOW_JOURNAL_KINDS).toEqual(["head", "call", "answer", "log", "end"]);
    expect(FLOW_CALL_WHATS).toEqual(["agent", "ask"]);
    expect(FLOW_HOST_ENDINGS).toEqual(["unanswered", "memory", "protocol", "flood"]);
    const end = { format: 1, seq: 4, kind: "end", at: "2026-11-05T11:10:00.000Z", state: "failed" };
    const ended = flowJournalLineOf({ ...end, host: "unanswered" });
    expect(ended).toMatchObject({ state: "failed", host: "unanswered" });
    // OPEN: a newer VibeField's reason and state read, as none this build names
    expect(flowJournalLineOf({ ...end, state: "paused", host: "tired" })?.kind).toBe("end");
    expect(flowJournalLineOf({ ...end, threw: "x".repeat(201) })).toBeUndefined();
    const log = { format: 1, seq: 4, kind: "log", at: end.at, text: "reviewed 3 files" };
    expect(flowJournalLineOf(log)?.kind).toBe("log");
    expect(flowJournalLineOf({ ...log, text: "" })).toBeUndefined();
  });

  it("F24: a host this copy cannot start is UNAVAILABLE flows `unconfigured`, not retryable", () => {
    expect(FLOW_HOST).toEqual({ SERVICE: "flows", STATE_UNCONFIGURED: "unconfigured" });
    expect(FLOW_HOST.SERVICE).toBe(RECORD_STORES.SERVICE_FLOWS);
    const data = ErrorData.parse(fixture("error-data.flows-host-unavailable"));
    expect(data.kind).toBe("UNAVAILABLE");
    expect(data.retryable).toBe(false);
    expect(UnavailableDetails.parse(data.details)).toMatchObject({
      service: FLOW_HOST.SERVICE,
      state: FLOW_HOST.STATE_UNCONFIGURED,
    });
  });
});
