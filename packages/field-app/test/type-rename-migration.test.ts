import { decodeEnvelope, defineQuery, encodeEnvelope, PrefabId } from "@vibecook/ice";
import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { buildGhostWidgetTypes } from "../src/plugin-host/ghost-stubs";

// C2 renames, folded IN-BAND (ice 0.4.0 design-008 — petition I5 consumed):
// the host's TYPE_RENAMES history projects into `renamedFrom` declarations
// (build-widget), so a hand-built PRE-RENAME board — the encoding probe's
// empirically verified shapes: comp:PrefabId values, comp:<type>:<group> cell
// names, engine.pack markers, the envelope's prefabVersions — must open
// through the ENGINE's own rename runner: writable (the version gate resolves
// old ids as renames instead of bricking readOnly), ratified types projected,
// no offline surgery anywhere. The wrapper module this file used to pin
// (migrate-type-renames.ts) is deleted; these tests pin the WIRING that
// replaced it.

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

function collectTypes(ce: ReturnType<typeof createFieldEngine>): Set<string> {
  const idQ = defineQuery([PrefabId]);
  const types = new Set<string>();
  ce.world.query(idQ).each((b) => {
    for (const r of b) {
      const id = ce.world.get(b.entity(r), PrefabId)?.id;
      if (typeof id === "string") types.add(id);
    }
  });
  return types;
}

describe("type renames fold in-band (I5 consumed, ice 0.4.0)", () => {
  it("opens a pre-rename board WRITABLE with ratified types projected", () => {
    const ce = createFieldEngine(buildRegistry());
    const res = ce.docs.open(oldShapeBoard());
    expect(res.ok, res.ok ? "" : `open failed: ${(res as { reason?: string }).reason}`).toBe(true);
    if (!res.ok) return;
    // The 0.4.0 version gate resolves the old ids through the rename registry
    // ("migrate", never readOnly) — the assert that would have failed on 0.3.0
    // without the offline surgery.
    expect(res.session.readOnly).toBe(false);
    ce.world.sync();
    const types = collectTypes(ce);
    expect(types.has("vibefield.note")).toBe(true);
    expect(types.has("vibefield.field-tools.folder")).toBe(true);
    expect(types.has(OLD_NOTE)).toBe(false);
    expect(types.has(OLD_FOLDER)).toBe(false);
    ce.docs.close();
  });

  it("accepts a pre-rename journal entry arriving after open", () => {
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

    const ce = createFieldEngine(buildRegistry());
    const res = ce.docs.open(base);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The old-named delivery is the zombie sweep's case (design-008): it must
    // apply without throwing, and the ratified projection must stand.
    res.session.applyRemote(update);
    ce.world.sync();
    const types = collectTypes(ce);
    expect(types.has("vibefield.note")).toBe(true);
    ce.docs.close();
  });

  it("never ghost-stubs an old id whose successor is registered; truly absent ids still stub", () => {
    const registered = new Set(["vibefield.note"]);
    // A pre-rename envelope names note.card until it self-heals — the rename
    // runner owns it; a stub would collide with vibefield.note's renamedFrom.
    expect(buildGhostWidgetTypes({ [OLD_NOTE]: 1 }, registered)).toHaveLength(0);
    const stubs = buildGhostWidgetTypes({ "acme.vanished.widget": 1 }, registered);
    expect(stubs).toHaveLength(1);
  });
});
