import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAYOUT } from "../src/registries";
import {
  emptySetupLedger,
  SETUP_STEPS,
  SetupAnswerParams,
  SetupLedger,
  SetupMomentParams,
  setupMomentState,
  setupStepState,
} from "../src/setup";

// AO-2 — the Setup Assistant's ledger (design-03 §4.3's `setup.*`). What it must
// never do is erase what a newer build wrote, or read a row it cannot read as an
// answer: either would send a person back into a question they already answered.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

describe("the setup ledger (AO-2)", () => {
  it("reads each step's answer, and a step with no row as unanswered", () => {
    const ledger = SetupLedger.parse(fixture("setup-ledger.valid"));
    expect(setupStepState(ledger, "agents")).toBe("answered");
    expect(setupStepState(ledger, "history")).toBe("later");
    expect(setupStepState(emptySetupLedger(), "history")).toBeUndefined();
    expect(emptySetupLedger()).toEqual({ format: 1, steps: {}, hidden: false });
  });

  it("carries a newer build's rows without reading them as answers", () => {
    const ledger = SetupLedger.parse(fixture("setup-ledger.newer"));
    // A state this build has never heard of is not an answer it can act on...
    expect(setupStepState(ledger, "devices")).toBeUndefined();
    expect(setupStepState(ledger, "history")).toBe("answered");
    // ...and nothing it cannot read is dropped on the way through.
    expect(ledger.steps.skills).toEqual({ state: "later", at: "2026-11-02T09:00:00.000Z" });
    expect(ledger.steps.devices).toMatchObject({ state: "dismissed", by: "a later build" });
    expect((ledger as Record<string, unknown>).moments).toEqual({ limit: { state: "retired" } });
  });

  it("answers only the steps it knows, in the two states it knows", () => {
    expect(SETUP_STEPS).toEqual(["agents", "profiles", "history", "devices"]);
    expect(SetupAnswerParams.safeParse({ step: "history", state: "later" }).success).toBe(true);
    expect(SetupAnswerParams.safeParse({ step: "skills", state: "later" }).success).toBe(false);
    expect(SetupAnswerParams.safeParse({ step: "history", state: "no" }).success).toBe(false);
  });

  it("lives in the user's fieldd directory, beside the other files fieldd owns", () => {
    expect(LAYOUT.SETUP_LEDGER_FILE).toEqual(["fieldd", "setup.json"]);
    // AO-5a (AO-D14) — the profiles no sign-in has kept yet, beside it
    expect(LAYOUT.AGENT_PROFILE_DRAFTS_FILE).toEqual(["fieldd", "profile-drafts.json"]);
  });
});

describe("the moments beside the steps (AO-6b; AO-D15)", () => {
  it("reads a moment's answer, and a ledger written before AO-6b as having none", () => {
    const ledger = SetupLedger.parse(fixture("setup-ledger-moments.valid"));
    expect(setupMomentState(ledger, "limit")).toBe("retired");
    expect(setupMomentState(ledger, "agent-past:codex")).toBe("retired");
    expect(setupMomentState(ledger, "agent-past:grok")).toBeUndefined();
    const before = SetupLedger.parse(fixture("setup-ledger.valid"));
    expect(before.moments).toBeUndefined();
    expect(setupMomentState(before, "limit")).toBeUndefined();
    expect(setupMomentState(emptySetupLedger(), "limit")).toBeUndefined();
  });

  it("carries a newer build's moment rows without reading them as answers", () => {
    const ledger = SetupLedger.parse({
      ...emptySetupLedger(),
      moments: { limit: { state: "snoozed", at: "2026-10-27T16:00:00.000Z", until: "later" } },
    });
    expect(setupMomentState(ledger, "limit")).toBeUndefined();
    expect(ledger.moments?.limit).toMatchObject({ state: "snoozed" });
  });

  it("answers only well-formed moments, in the state it knows", () => {
    expect(SetupMomentParams.safeParse(fixture("setup-moment-params.valid")).success).toBe(true);
    expect(SetupMomentParams.safeParse({ moment: "limit", state: "retired" }).success).toBe(true);
    expect(SetupMomentParams.safeParse({ moment: "Limit", state: "retired" }).success).toBe(false);
    expect(SetupMomentParams.safeParse({ moment: "agent-past:", state: "retired" }).success).toBe(
      false,
    );
    expect(SetupMomentParams.safeParse({ moment: "limit", state: "later" }).success).toBe(false);
  });

  it("keys a moment by anything a device id or a date is, up to a device id's bound (TS-D18)", () => {
    const answers = (moment: string): boolean =>
      SetupMomentParams.safeParse({ moment, state: "retired" }).success;
    // fieldd's own fallback id, the mesh's ULID, an expiry date
    expect(answers("device-joined:local-4f0c2a5e-8d1b-4c3e-9a7f-2b6d1e0c9a8b")).toBe(true);
    expect(answers("device-joined:01JB8ZQ4N7M2X5K9T3V6W8Y0RC")).toBe(true);
    expect(answers("renewal-notice:2026-10-30")).toBe(true);
    // the name ends at the first colon; the key may hold one
    expect(answers("device-joined:peer:7")).toBe(true);
    expect(answers(`device-joined:${"x".repeat(256)}`)).toBe(true);
    expect(answers(`device-joined:${"x".repeat(257)}`)).toBe(false);
    expect(answers("device-joined:two words")).toBe(false);
    expect(answers("device-joined:café")).toBe(false);
    expect(answers("Device-joined:01JB8ZQ4N7M2X5K9T3V6W8Y0RC")).toBe(false);
  });
});
