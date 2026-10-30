import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRegistryEntry, DocSyncIntent } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { SetupLedgerStore } from "../src/setup-ledger";
import { oweSyncQuestion } from "../src/sync-question";

// TS-6 (TS-D13) — the keep at a new link's landing, at its seam: the doc
// service's three calls and the ledger store. The daemon's wiring is
// `sync-question.integration.test.ts`'s.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ledger(): SetupLedgerStore {
  const dir = mkdtempSync(join(tmpdir(), "vf-ts6-ledger-"));
  dirs.push(dir);
  return new SetupLedgerStore({ path: join(dir, "fieldd", "setup.json") });
}

/** the doc service's catalog, as the keep reads and writes it */
function catalog(intents: Record<string, DocSyncIntent | undefined>, failing: string[] = []) {
  const held = new Map(Object.entries(intents));
  const entry = (docId: string): DocRegistryEntry => ({
    docId,
    name: docId,
    updatedAt: 0,
    baseEpoch: 0,
    engineSchema: null,
    sizeBytes: 0,
  });
  return {
    held,
    list: () => [...held.keys()].map(entry),
    syncIntentOf: (docId: string) => (docId === "settings" ? "sync" : held.get(docId)),
    setSyncIntent: async (docId: string, intent: DocSyncIntent) => {
      if (failing.includes(docId)) throw new Error("the registry could not be written");
      held.set(docId, intent);
      return entry(docId);
    },
  };
}

const logger = createNoopLogger();

describe("TS-6 — the fields a new link keeps (TS-D13)", () => {
  it("keeps every field with no answer of its own, leaves the rest, and owes the question", async () => {
    const store = ledger();
    const docs = catalog({
      sketches: undefined,
      shared: "sync",
      home: "local",
      settings: undefined,
    });
    expect(await oweSyncQuestion({ ledger: store, docs, logger })).toBe(1);
    expect(Object.fromEntries(docs.held)).toEqual({
      sketches: "local",
      shared: "sync",
      home: "local",
      // a system document answers "sync" by law: never kept
      settings: undefined,
    });
    expect(store.snapshot().moments?.["sync-question"]).toMatchObject({ state: "owed" });
  });

  it("keeps a field made while it is still owed, at the next new link", async () => {
    const store = ledger();
    store.owe("sync-question");
    const docs = catalog({ before: "local", between: undefined });
    expect(await oweSyncQuestion({ ledger: store, docs, logger })).toBe(1);
    expect(docs.held.get("between")).toBe("local");
  });

  it("keeps nothing once the question is answered: the posture decides", async () => {
    const answered = ledger();
    answered.moment("sync-question", "retired");
    const docs = catalog({ sketches: undefined });
    expect(await oweSyncQuestion({ ledger: answered, docs, logger })).toBe(0);
    expect(docs.held.get("sketches")).toBeUndefined();
    expect(answered.snapshot().moments?.["sync-question"]).toMatchObject({ state: "retired" });
  });

  it("owes the question first, and keeps the others when one field cannot be kept", async () => {
    const store = ledger();
    const docs = catalog({ broken: undefined, sketches: undefined }, ["broken"]);
    expect(await oweSyncQuestion({ ledger: store, docs, logger })).toBe(1);
    expect(docs.held.get("broken")).toBeUndefined();
    expect(docs.held.get("sketches")).toBe("local");
    expect(store.snapshot().moments?.["sync-question"]).toMatchObject({ state: "owed" });
  });
});
