import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_MONITOR_SCHEMA_VERSION,
  AgentMonitorMirror,
  AgentPlanTier,
  NATIVE_PROFILE_SET_ID,
  PLAN_TIER_LABEL_MAX,
} from "@vibefield/contracts";
import {
  PlanTierSchema,
  AGENT_MONITOR_SCHEMA_VERSION as UPSTREAM_MONITOR_SCHEMA_VERSION,
  NATIVE_PROFILE_SET_ID as UPSTREAM_NATIVE_PROFILE_SET_ID,
  PLAN_TIER_LABEL_MAX as UPSTREAM_PLAN_TIER_LABEL_MAX,
} from "@vibefield/puppeteer-core";
import { NATIVE_PROFILE_SET as MONITOR_NATIVE_PROFILE_SET } from "@vibefield/puppeteer-monitor";
import { describe, expect, it } from "vitest";

// The monitor generation pin, gated against the PINNED puppeteer itself (AR-4b;
// the AR-3 ledger claimed "a generation bump upstream is a red gate here" while
// nothing in the tree read the upstream constant — this is the gate that makes
// the claim true). A bump of `AGENT_MONITOR_SCHEMA_VERSION` at the pinned
// revision fails here until the contract's mirror is re-read against the new
// shape, the golden regenerated and the contract's constant moved — the
// deliberate event, never a silent drift. A field rename WITHOUT a generation
// bump is not caught here: the mirror is a passthrough by law, and drift in
// the fields fieldd reads surfaces as `fieldd.agents.monitor_shape_drift`.

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../contracts/fixtures/agent-monitor-state.valid.json",
);

describe("the monitor schema pin against the pinned puppeteer", () => {
  it("the contract's generation IS puppeteer's, and the golden is of that generation", () => {
    expect(AGENT_MONITOR_SCHEMA_VERSION).toBe(UPSTREAM_MONITOR_SCHEMA_VERSION);
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as { schemaVersion: number };
    expect(golden.schemaVersion).toBe(UPSTREAM_MONITOR_SCHEMA_VERSION);
    expect(AgentMonitorMirror.safeParse(golden).success).toBe(true);
  });
});

// TU-1 (Q3) — This Mac's Agent Profile id is puppeteer's, mirrored in contracts so the browser-safe readers (Chat's @,
// the New spark sheet) and fieldd's rooms place a run by the same word. It is held here to both pinned packages that
// name it: the runtime's id and the monitor backend's (whose `resolveProfileSet` Godview's tabs read), so a pin that
// moves either is red at the EL8 event.
describe("This Mac's profile id against the pinned puppeteer", () => {
  it("the contract's id IS the runtime's and the monitor backend's", () => {
    expect(NATIVE_PROFILE_SET_ID).toBe(UPSTREAM_NATIVE_PROFILE_SET_ID);
    expect(NATIVE_PROFILE_SET_ID).toBe(MONITOR_NATIVE_PROFILE_SET);
  });
});

// A plan's tier label: its cap is puppeteer's, mirrored in contracts (and from there in the kit, which
// check-ios-fixtures pins to it). Since the EL8 to puppeteer 0.4.4 (2026-11-18) the pinned core names the cap and the
// tier's schema, so this holds the equality and reads the two patterns side by side. puppeteer writes a label that
// starts with a letter or a digit; the contract, the tolerant reader, reads any run of letters, digits, `.`, `+` and
// `-`. So every label puppeteer writes, the contract reads, and the row that tells them apart is a label puppeteer
// never writes.
describe("a plan's tier label against the pinned puppeteer", () => {
  it("the contract's cap IS the pinned puppeteer's", () => {
    expect(PLAN_TIER_LABEL_MAX).toBe(UPSTREAM_PLAN_TIER_LABEL_MAX);
    expect(PLAN_TIER_LABEL_MAX).toBe(8);
  });

  it.each(["20x", "200", "1.5x", "a+b"])("reads %s, a label puppeteer writes", (label) => {
    expect(PlanTierSchema.safeParse({ label }).success).toBe(true);
    expect(AgentPlanTier.safeParse({ label }).success).toBe(true);
  });

  it("reads '.x', which puppeteer never writes, as the tolerant reader it is", () => {
    expect(PlanTierSchema.safeParse({ label: ".x" }).success).toBe(false);
    expect(AgentPlanTier.safeParse({ label: ".x" }).success).toBe(true);
  });

  it("refuses what both refuse: past the cap, a space, an underscore", () => {
    for (const label of ["123456789", "20 x", "max_20x"]) {
      expect(PlanTierSchema.safeParse({ label }).success).toBe(false);
      expect(AgentPlanTier.safeParse({ label }).success).toBe(false);
    }
  });
});
