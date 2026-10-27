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
