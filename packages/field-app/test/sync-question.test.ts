import type { DocRegistryEntry } from "@vibefield/contracts";
import { emptySetupLedger, type SetupLedger } from "@vibefield/contracts/setup";
import { describe, expect, it } from "vitest";
import { earlierFields, syncQuestionOwed } from "../src/account/sync-question";

// TS-6 (TS-D13) — what the head reads to ask the sync question: whether a link
// owes it, and which fields it lists.

const ledger = (moments: Record<string, unknown>): SetupLedger => ({
  ...emptySetupLedger(),
  moments,
});

const field = (docId: string, extra: Partial<DocRegistryEntry> = {}): DocRegistryEntry => ({
  docId,
  name: docId,
  updatedAt: 0,
  baseEpoch: 0,
  engineSchema: 2,
  sizeBytes: 0,
  ...extra,
});

describe("TS-6 — the sync question's readers (TS-D13)", () => {
  it("is owed only while the ledger says so, never on a guess", () => {
    const at = "2026-10-29T08:03:21.000Z";
    expect(syncQuestionOwed(ledger({ "sync-question": { state: "owed", at } }))).toBe(true);
    expect(syncQuestionOwed(ledger({ "sync-question": { state: "retired", at } }))).toBe(false);
    expect(syncQuestionOwed(ledger({}))).toBe(false);
    // a row a newer build wrote is carried and never read as owed
    expect(syncQuestionOwed(ledger({ "sync-question": { state: "snoozed", at } }))).toBe(false);
    // no ledger yet (read in flight, or an older daemon): never asked
    expect(syncQuestionOwed(null)).toBe(false);
  });

  it("lists the fields staying on this Mac, and no system document", () => {
    const listed = earlierFields([
      field("kept", { syncIntent: "local" }),
      field("sent", { syncIntent: "sync" }),
      field("unanswered"),
      field("settings", { syncIntent: "local", system: true }),
    ]);
    expect(listed.map((entry) => entry.docId)).toEqual(["kept"]);
  });
});
