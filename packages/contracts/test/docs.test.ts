// UA-D7 — sync intent on the doc catalog's wire shapes.
//
// The registry entry is the ONE place a doc's willingness to travel is written
// down, and the whole slice's zero-behavior-change promise rests on the field
// being optional: an entry that has never heard of UA-6 must still parse, and
// must stay distinguishable from one that answered "sync".
import { describe, expect, it } from "vitest";
import { DocRegistryEntry, DocSetSyncIntentParams, DocSyncIntent } from "../src/docs";
import { METHODS } from "../src/methods";

const entry = {
  docId: "1f0d7a2e-3c44-4b8a-9e51-6d2f8c0a7b19",
  name: "board",
  updatedAt: 1_753_142_400_000,
  baseEpoch: 0,
  engineSchema: 2,
  sizeBytes: 18_432,
};

describe("DocRegistryEntry.syncIntent", () => {
  it("is optional, and absence is not the same answer as sync", () => {
    const silent = DocRegistryEntry.parse(entry);
    expect(silent.syncIntent).toBeUndefined();
    expect(DocRegistryEntry.parse({ ...entry, syncIntent: "sync" }).syncIntent).toBe("sync");
    expect(DocRegistryEntry.parse({ ...entry, syncIntent: "local" }).syncIntent).toBe("local");
  });

  it("refuses an intent nobody has a rule for", () => {
    // Tolerant reader has limits: an unknown KEY rides through, an unknown
    // value in a field the sync gates read does not — a doc must never end up
    // gated by a word one side interprets and the other does not.
    expect(DocRegistryEntry.safeParse({ ...entry, syncIntent: "maybe" }).success).toBe(false);
    expect(DocRegistryEntry.parse({ ...entry, futureColumn: 42 })).toMatchObject({
      futureColumn: 42,
    });
  });

  it("has exactly two intents", () => {
    expect(DocSyncIntent.options).toEqual(["sync", "local"]);
  });
});

describe("doc.setSyncIntent", () => {
  it("takes a doc id and one of the two intents", () => {
    expect(DocSetSyncIntentParams.parse({ docId: entry.docId, intent: "local" })).toMatchObject({
      docId: entry.docId,
      intent: "local",
    });
    expect(DocSetSyncIntentParams.safeParse({ docId: "not-a-uuid", intent: "local" }).success).toBe(
      false,
    );
    expect(DocSetSyncIntentParams.safeParse({ docId: entry.docId }).success).toBe(false);
    expect(DocSetSyncIntentParams.safeParse({ docId: entry.docId, intent: "maybe" }).success).toBe(
      false,
    );
  });

  it("is declared as a local, idempotent doc.write method", () => {
    // `local` and not `sync`: the answer is this device's own and does not
    // replicate — the C6-4 doc-existence debt, stated in the registry rather
    // than papered over.
    expect(METHODS.find((m) => m.method === "doc.setSyncIntent")).toMatchObject({
      surface: "product",
      scope: "doc.write",
      idempotent: true,
      locality: "local",
    });
  });
});
