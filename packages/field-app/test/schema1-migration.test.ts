import { decodeEnvelope, defineQuery, encodeEnvelope, PrefabId } from "@vibecook/ice";
import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine } from "../src/field-engine";

// design-03 §6.1's verify-item, discharged (2026-07-25, ice 0.2.0): a board
// written at ENGINE_SCHEMA_VERSION 1 must OPEN under 2, not quarantine.
//
// ice 0.2.0 made ChildOf an ORDERED relation — document schema 2 — and migrates
// schema-1 docs at open: `runSchemaMigrations` walks `engine.schema.<n>` meta
// markers and, for a doc at 1, mints a board root and re-links every durable
// entity in (StackZ.z asc, entityKey asc) order inside one {undoable:false}
// transaction. This suite pins OUR side of that contract — that the renderer's
// open path actually reaches it and that no data is lost crossing the version.
//
// WHERE THE VERIFY-ITEM LANDED: the design asked whether fieldd's HEADLESS
// DocumentHost tolerates behind-version component data. It does so trivially,
// because it never sees components at all — the shipped DocumentService is
// opaque byte custody (doc-service.ts "fieldd owns the board's at-rest bytes and
// NOTHING about their meaning"), and fieldd's package.json links neither
// @vibecook/ice nor @vibecook/strata-ecs. That opacity is already pinned by
// fieldd/test/doc-service.test.ts, which round-trips `engineSchema: 11` — a
// value ice will never emit — byte-identically. So migration is renderer-only,
// which is what this file covers.
//
// Fixture shapes follow type-rename-migration.test.ts's empirically verified
// encoding (comp:PrefabId values, comp:<type>:<group> cells, engine.pack
// markers, the ICE1 envelope), differing only where schema 1 differs: the meta
// marker is engine.schema.1, paint order rides comp:StackZ, and no ordered
// relation exists yet.

const NOTE = "vibefield.note";
const DOC_ID = "6b1f0e2a-5c3d-4a7b-8e91-0d2c4f6a8b13";

/** z values deliberately DISAGREE with key order, so a migration that ignored
 * StackZ and just took insertion order would produce a different result. */
const SEEDS: readonly { key: string; z: number; text: string }[] = [
  { key: "90001-a", z: 30, text: "front" },
  { key: "90001-b", z: 10, text: "back" },
  { key: "90001-c", z: 20, text: "middle" },
];

function schema1Board(): Uint8Array {
  const doc = new LoroDoc();
  const entities = doc.getMap("entities");
  for (const { key, z, text } of SEEDS) {
    const e = entities.setContainer(key, new LoroMap());
    e.set("exists", true);
    e.set("comp:PrefabId", { id: NOTE });
    e.set("comp:Position", { x: z * 10, y: 0 });
    // schema 1's paint order: a scalar z per entity, no ordered relation.
    e.set("comp:StackZ", { z });
    e.set(`comp:${NOTE}:props`, { text, color: "#f6e7a9" });
  }
  const meta = doc.getMap("meta");
  meta.set("docId", DOC_ID);
  meta.set("engine.schema.1", true); // ← the doc says schema 1; 2 is absent
  meta.set(`engine.pack.${NOTE}.1`, true);
  doc.commit();
  return encodeEnvelope(
    { engineSchema: 1, prefabVersions: { [NOTE]: 1 } },
    doc.export({ mode: "snapshot" }),
  );
}

function metaKeys(bytes: Uint8Array): string[] {
  const { payload } = decodeEnvelope(bytes);
  const doc = new LoroDoc();
  doc.import(payload);
  return doc.getMap("meta").keys();
}

const noteQ = defineQuery([PrefabId]);

/** open-or-fail, so the session is narrowed for the callers that need to export.
 * A failure here IS the verify-item failing, so it throws rather than returns. */
function openOrThrow(ce: ReturnType<typeof createFieldEngine>, bytes: Uint8Array) {
  const res = ce.docs.open(bytes);
  if (!res.ok) throw new Error(`open failed (quarantined): ${res.reason}`);
  ce.world.sync();
  return res.session;
}

function texts(ce: ReturnType<typeof createFieldEngine>): string[] {
  const found: string[] = [];
  ce.world.query(noteQ).each((b) => {
    for (const r of b) {
      const id = ce.world.get(b.entity(r), PrefabId)?.id;
      if (id === NOTE) found.push(id);
    }
  });
  return found;
}

describe("schema-1 boards under ice 0.2.0", () => {
  it("the fixture really is schema 1 — otherwise this suite proves nothing", () => {
    const keys = metaKeys(schema1Board());
    expect(keys).toContain("engine.schema.1");
    expect(keys).not.toContain("engine.schema.2");
    expect(decodeEnvelope(schema1Board()).header.engineSchema).toBe(1);
  });

  it("opens instead of quarantining — the design-03 §6.1 question, answered", () => {
    const ce = createFieldEngine(buildRegistry());
    const res = ce.docs.open(schema1Board());
    expect(res.ok, res.ok ? "" : `open failed: ${(res as { reason?: string }).reason}`).toBe(true);
    ce.dispose();
  });

  it("carries every entity across the version boundary", () => {
    const ce = createFieldEngine(buildRegistry());
    const res = ce.docs.open(schema1Board());
    expect(res.ok).toBe(true);
    ce.world.sync();
    expect(texts(ce)).toHaveLength(SEEDS.length);
    ce.dispose();
  });

  it("opens WRITABLE — a migrated board the user cannot edit would be a silent regression", () => {
    const ce = createFieldEngine(buildRegistry());
    const session = openOrThrow(ce, schema1Board());
    expect(session.readOnly).toBe(false);
    ce.dispose();
  });

  it("stamps the doc schema 2, so the migration is recorded and not re-run forever", () => {
    const ce = createFieldEngine(buildRegistry());
    const migrated = openOrThrow(ce, schema1Board()).exportEnvelope(1_753_142_400_000);
    expect(metaKeys(migrated)).toContain("engine.schema.2");
    expect(decodeEnvelope(migrated).header.engineSchema).toBe(2);
    ce.dispose();
  });

  it("reopens the migrated bytes with the census intact (idempotent, not lossy)", () => {
    const first = createFieldEngine(buildRegistry());
    const before = openOrThrow(first, schema1Board());
    const migrated = before.exportEnvelope(1_753_142_400_000);
    const count = texts(first).length;
    first.dispose();

    const second = createFieldEngine(buildRegistry());
    openOrThrow(second, migrated);
    expect(texts(second)).toHaveLength(count);
    second.dispose();
  });
});
