import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAYOUT } from "../src/registries";
import {
  CONNECT_ASK,
  connectAskMoment,
  connectAskOpen,
  emptySetupLedger,
  SETUP_STEPS,
  SetupAnswerParams,
  SetupLedger,
  SetupMomentParams,
  setupMomentRecord,
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
    // TS-4 — said, and it may be said again
    expect(
      SetupMomentParams.safeParse({ moment: "connect-ask:away", state: "asked" }).success,
    ).toBe(true);
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

describe("asking again after Not now (TS-4; TS-D7)", () => {
  const NOW = Date.parse("2026-11-20T12:00:00.000Z");
  const ago = (ms: number): string => new Date(NOW - ms).toISOString();
  const putOff = (moments: Record<string, unknown> = {}): SetupLedger => ({
    ...emptySetupLedger(),
    steps: { devices: { state: "later", at: "2026-10-28T09:00:00.000Z" } },
    moments,
  });

  it("reads the golden ledger: each place keeps its own month, and the day is shared", () => {
    const ledger = SetupLedger.parse(fixture("setup-ledger-connect-ask.valid"));
    expect(setupMomentRecord(ledger, "connect-ask:away")).toEqual({
      state: "asked",
      at: "2026-10-28T22:40:05.000Z",
    });
    // the next day: away is in its month, and its saying spent the day
    const next = Date.parse("2026-10-29T12:00:00.000Z");
    expect(connectAskOpen(ledger, "away", next)).toBe(false);
    expect(connectAskOpen(ledger, "approval-wait", next)).toBe(false);
    // a month on: the approval's month (from 10-27) is out, away's (from 10-28) is not
    const monthOn = Date.parse("2026-11-27T00:00:00.000Z");
    expect(connectAskOpen(ledger, "approval-wait", monthOn)).toBe(true);
    expect(connectAskOpen(ledger, "away", monthOn)).toBe(false);
    expect(SetupMomentParams.parse(fixture("setup-moment-params.asked"))).toEqual({
      moment: "connect-ask:away",
      state: "asked",
    });
  });

  it("reads an asked moment's time beside its state", () => {
    const ledger = putOff({ "connect-ask:away": { state: "asked", at: ago(1_000) } });
    expect(setupMomentState(ledger, "connect-ask:away")).toBe("asked");
    expect(setupMomentRecord(ledger, "connect-ask:away")).toEqual({
      state: "asked",
      at: ago(1_000),
    });
    expect(setupMomentRecord(ledger, "connect-ask:approval-wait")).toBeUndefined();
    expect(connectAskMoment("approval-wait")).toBe("connect-ask:approval-wait");
  });

  it("asks only someone who put Devices off", () => {
    expect(connectAskOpen(putOff(), "away", NOW)).toBe(true);
    // never asked (AO-D12, or mid-wizard), and a step answered elsewhere
    expect(connectAskOpen(emptySetupLedger(), "away", NOW)).toBe(false);
    expect(
      connectAskOpen(
        { ...emptySetupLedger(), steps: { devices: { state: "answered", at: ago(1_000) } } },
        "away",
        NOW,
      ),
    ).toBe(false);
  });

  it("says each place once in 30 days, and one place a day across them", () => {
    const away = (at: string) => putOff({ "connect-ask:away": { state: "asked", at } });
    expect(connectAskOpen(away(ago(CONNECT_ASK.PLACE_QUIET_MS - 1)), "away", NOW)).toBe(false);
    expect(connectAskOpen(away(ago(CONNECT_ASK.PLACE_QUIET_MS)), "away", NOW)).toBe(true);
    // another place waits out the day, not the month
    expect(connectAskOpen(away(ago(CONNECT_ASK.DAY_MS - 1)), "approval-wait", NOW)).toBe(false);
    expect(connectAskOpen(away(ago(CONNECT_ASK.DAY_MS)), "approval-wait", NOW)).toBe(true);
  });

  it("reads only its own moments, and keeps the quiet over a time it cannot read", () => {
    const others = putOff({
      limit: { state: "retired", at: ago(1_000) },
      "renewal-notice:2026-11-21": { state: "retired", at: ago(1_000) },
    });
    expect(connectAskOpen(others, "away", NOW)).toBe(true);
    const unreadable = putOff({ "connect-ask:approval-wait": { state: "asked", at: "soon" } });
    expect(connectAskOpen(unreadable, "away", NOW)).toBe(false);
    // a newer build's row it cannot read is carried, never counted
    const newer = putOff({ "connect-ask:away": { state: "snoozed", at: ago(1_000) } });
    expect(connectAskOpen(newer, "away", NOW)).toBe(true);
  });

  it("keeps a retired place quiet for good, and counts no other place's retiring as a saying", () => {
    const year = 365 * CONNECT_ASK.DAY_MS;
    const retired = putOff({ "connect-ask:away": { state: "retired", at: ago(year) } });
    expect(connectAskOpen(retired, "away", NOW)).toBe(false);
    const retiredNow = putOff({
      "connect-ask:approval-wait": { state: "retired", at: ago(1_000) },
    });
    expect(connectAskOpen(retiredNow, "away", NOW)).toBe(true);
  });
});
