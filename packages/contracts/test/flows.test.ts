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
import {
  FLOW_ENTRY_STATES,
  FLOW_FILE_SUFFIX,
  FLOW_READ_REFUSALS,
  FLOW_RECORD_FORMAT,
  FLOW_RUN_STATES,
  FLOW_STEP_STATES,
  FlowApprovalRecord,
  FlowGate,
  FlowHash,
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
  flowEntryStateOf,
  flowRefusalOf,
  flowRunStateOf,
  flowStepStateOf,
} from "../src/flows";
import { METHODS, reachableFromTailnet } from "../src/methods";
import { FLOW_LIMITS, LAYOUT, LAYOUT_ROOT_LEVEL, PRODUCT_API_LIMITS } from "../src/registries";

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
