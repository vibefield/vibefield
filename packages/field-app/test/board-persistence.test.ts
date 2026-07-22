import { defineQuery, Position, PrefabId, WirePorts } from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

// B3 restart survival, headless: the demo scene is the persistence test payload
// (thinking-widgetlab-port §5 named it so). Seed → exportEnvelope → a FRESH
// engine docs.open()s the bytes → identical census. This is the renderer half
// of the P0 exit criterion; the daemon half (bytes at rest across bootstrap
// cycles) lives in packages/fieldd/test/doc-service.test.ts.

const widgetQ = defineQuery([Position, PrefabId]);
const wireQ = defineQuery([WirePorts]);

function census(ce: ReturnType<typeof createFieldEngine>) {
  const types = new Map<string, number>();
  let widgets = 0;
  ce.world.query(widgetQ).each((b) => {
    for (const r of b) {
      widgets += 1;
      const id = ce.world.get(b.entity(r), PrefabId)?.id ?? "?";
      types.set(id, (types.get(id) ?? 0) + 1);
    }
  });
  let wires = 0;
  ce.world.query(wireQ).each((b) => {
    for (const _ of b) wires += 1;
  });
  return { widgets, wires, types: Object.fromEntries([...types.entries()].sort()) };
}

describe("board persistence (headless)", () => {
  it("seedField produces the named census: 21 widgets, 2 wires", () => {
    const ce = createFieldEngine(buildRegistry());
    seedField(ce, ce.docs.create());
    const c = census(ce);
    expect(c.widgets).toBe(21);
    expect(c.wires).toBe(2);
    expect(c.types["field.folder"]).toBe(2);
    expect(c.types["note.card"]).toBe(1);
    ce.dispose();
  });

  it("an exported envelope reopens on a fresh engine with an identical census", () => {
    const seeder = createFieldEngine(buildRegistry());
    const session = seeder.docs.create();
    seedField(seeder, session);
    const before = census(seeder);
    const bytes = session.exportEnvelope(1_753_142_400_000);
    seeder.dispose();

    const joiner = createFieldEngine(buildRegistry());
    const res = joiner.docs.open(bytes);
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    joiner.world.sync();
    expect(census(joiner)).toEqual(before);
    joiner.dispose();
  });

  it("corrupt bytes quarantine — open reports, never throws (M5 law)", () => {
    const ce = createFieldEngine(buildRegistry());
    const res = ce.docs.open(new Uint8Array([1, 2, 3, 4, 5]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
    ce.dispose();
  });
});
