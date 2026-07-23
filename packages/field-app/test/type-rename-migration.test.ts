import { decodeEnvelope, defineQuery, encodeEnvelope, PrefabId } from "@vibecook/ice";
import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { migrateTypeRenames } from "../src/plugin-host/migrate-type-renames";

// C2 — the durable-ID migration, proven against a hand-built PRE-RENAME board
// (the encoding-probe's empirically verified shapes: comp:PrefabId values,
// comp:<type>:<group> cell names, engine.pack markers, the ICE1 envelope's
// prefabVersions). The migrated bytes must open under the CURRENT schema —
// which registers only ratified names — with values and relations intact.

const OLD_NOTE = "note.card";
const OLD_FOLDER = "field.folder";

function oldShapeBoard(): Uint8Array {
  const doc = new LoroDoc();
  const entities = doc.getMap("entities");
  const folder = entities.setContainer("77001-0", new LoroMap());
  folder.set("exists", true);
  folder.set("comp:PrefabId", { id: OLD_FOLDER });
  folder.set(`comp:${OLD_FOLDER}:props`, { title: "Widgets", accent: "#6366F1" });
  const note = entities.setContainer("77001-1", new LoroMap());
  note.set("exists", true);
  note.set("comp:PrefabId", { id: OLD_NOTE });
  note.set(`comp:${OLD_NOTE}:props`, { text: "hello board", color: "#f6e7a9" });
  note.set("rel1:ChildOf", "77001-0"); // relations address entity KEYS — must survive verbatim
  const meta = doc.getMap("meta");
  meta.set("docId", "3f2c8a44-9c1d-4e59-9a51-1f2d3c4b5a69");
  meta.set("engine.schema.2", true);
  meta.set(`engine.pack.${OLD_NOTE}.1`, true);
  meta.set(`engine.pack.${OLD_FOLDER}.1`, true);
  doc.commit();
  return encodeEnvelope(
    { engineSchema: 2, prefabVersions: { [OLD_NOTE]: 1, [OLD_FOLDER]: 1 } },
    doc.export({ mode: "snapshot" }),
  );
}

function dumpJson(bytes: Uint8Array): string {
  const { payload } = decodeEnvelope(bytes);
  const doc = new LoroDoc();
  doc.import(payload);
  return JSON.stringify(doc.toJSON());
}

describe("migrateTypeRenames (C2)", () => {
  it("rewrites cells, markers, and the envelope — then opens under the ratified schema", () => {
    const migration = migrateTypeRenames(oldShapeBoard(), []);
    expect(migration.migrated).toBe(true);
    // 2 PrefabId values + 2 comp cells + 2 pack markers
    expect(migration.renamedCells).toBe(6);
    const json = dumpJson(migration.bytes);
    expect(json.includes(OLD_NOTE)).toBe(false);
    expect(json.includes(OLD_FOLDER)).toBe(false);
    expect(decodeEnvelope(migration.bytes).header.prefabVersions).toEqual({
      "vibefield.note": 1,
      "vibefield.field-tools.folder": 1,
    });

    const ce = createFieldEngine(buildRegistry());
    const res = ce.docs.open(migration.bytes);
    expect(res.ok, res.ok ? "" : `open failed: ${(res as { reason?: string }).reason}`).toBe(true);
    ce.world.sync();
    const idQ = defineQuery([PrefabId]);
    const types = new Set<string>();
    ce.world.query(idQ).each((b) => {
      for (const r of b) {
        const id = ce.world.get(b.entity(r), PrefabId)?.id;
        if (typeof id === "string") types.add(id);
      }
    });
    expect(types.has("vibefield.note")).toBe(true);
    expect(types.has("vibefield.field-tools.folder")).toBe(true);
    expect(types.has(OLD_NOTE)).toBe(false);
    ce.docs.close();
  });

  it("folds the journal BEFORE renaming — a stale update cannot resurrect old cells", () => {
    const base = oldShapeBoard();
    // fork the doc, edit the OLD-named cell, export just that op as an update
    const { payload } = decodeEnvelope(base);
    const fork = new LoroDoc();
    fork.import(payload);
    const from = fork.version();
    const note = fork.getMap("entities").get("77001-1");
    if (!(note instanceof LoroMap)) throw new Error("fixture entity missing");
    note.set(`comp:${OLD_NOTE}:props`, { text: "edited later", color: "#f6e7a9" });
    fork.commit();
    const update = fork.export({ mode: "update", from });

    const migration = migrateTypeRenames(base, [update]);
    expect(migration.migrated).toBe(true);
    const json = dumpJson(migration.bytes);
    expect(json.includes(OLD_NOTE)).toBe(false); // no zombie cell
    expect(json.includes("edited later")).toBe(true); // the journal's edit survived the fold
  });

  it("is idempotent and a no-op on ratified boards (bytes returned by reference)", () => {
    const once = migrateTypeRenames(oldShapeBoard(), []);
    const twice = migrateTypeRenames(once.bytes, []);
    expect(twice.migrated).toBe(false);
    expect(twice.bytes).toBe(once.bytes);
  });
});
