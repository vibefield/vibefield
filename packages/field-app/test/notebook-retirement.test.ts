// @vitest-environment node
import { Active, createCanvasEngine, gateVerdict, Specimen } from "@vibecook/ice";
import { DESK_ENGINE, NOTE_TYPE, NOTEBOOK_TYPE } from "@vibecook/ice/desk/objects";
import { describe, expect, it } from "vitest";
import { capabilityTypes } from "../src/field/desk/desk-capabilities";
import { deskCensus, deskObjects } from "../src/field/desk/desk-door";
import { SEED_TYPES, seedObjects } from "../src/field/desk/desk-seed";
import { buildRegistry, createFieldEngine, fieldPackScope } from "../src/field-engine";
import { buildGhostWidgetTypes } from "../src/plugin-host/ghost-stubs";

// The first launch's lineup (James, 2026-11-09): the notebook is retired the way the calendar was
// (calendar-retirement.test.ts) — not mounted, not offered, not seeded; a saved one stays dormant and whole.
describe("the notebook retired from VibeField", () => {
  it("does not register, seed capabilities for, offer or seed the notebook", () => {
    const registry = buildRegistry();
    const engine = createFieldEngine(registry);
    const session = engine.docs.create();
    engine.step(16);
    expect(engine.catalog.widget(NOTEBOOK_TYPE)).toBeUndefined();
    expect(capabilityTypes(registry, null)).not.toContain(NOTEBOOK_TYPE);
    expect(
      engine.catalog
        .widgetTypes()
        .filter((w) => w.tray)
        .map((w) => w.type),
    ).not.toContain(NOTEBOOK_TYPE);
    expect(session.versionReport().docPacks[NOTEBOOK_TYPE]).toBeUndefined();
    expect(fieldPackScope(registry).has(NOTEBOOK_TYPE)).toBe(true);
    expect(buildGhostWidgetTypes({ [NOTEBOOK_TYPE]: 1 }, fieldPackScope(registry))).toEqual([]);
    expect(SEED_TYPES).not.toContain(NOTEBOOK_TYPE);
    const seeded = seedObjects(new Date(), { examples: true }).map((s) => s.type);
    expect(seeded).not.toContain(NOTEBOOK_TYPE);
    engine.dispose();
  });

  it("opens a saved notebook dormant, keeps the board writable, and gives it back whole", () => {
    const legacy = createCanvasEngine(DESK_ENGINE);
    const old = legacy.docs.create();
    const book = legacy.ops.spawnWidget(NOTEBOOK_TYPE, { x: 570, y: 330, props: { seed: 3 } });
    legacy.step(16);
    const key = old.store.keyOf(book);
    if (key === undefined) throw new Error("no notebook key");
    const engine = createFieldEngine(buildRegistry());
    const result = engine.docs.open(old.exportEnvelope(1));
    if (!result.ok) throw new Error(result.reason);
    engine.step(16);
    const dormant = result.session.store.resolve(key);
    if (dormant === undefined) throw new Error("notebook data was deleted");
    expect(gateVerdict(result.session.versionReport())).toBe("ok");
    expect(engine.world.hasTag(dormant, Active)).toBe(false);
    expect(engine.world.hasTag(dormant, Specimen)).toBe(false);
    expect(deskObjects(engine, NOTEBOOK_TYPE)).toEqual([]);
    expect(deskCensus(engine)[NOTEBOOK_TYPE]).toBeUndefined();
    expect(engine.ops.spawnWidget(NOTE_TYPE, { x: 400, y: 330 })).toBeTypeOf("number");

    const supported = createCanvasEngine(DESK_ENGINE);
    const reopened = supported.docs.open(result.session.exportEnvelope(2));
    if (!reopened.ok) throw new Error(reopened.reason);
    supported.step(16);
    const restored = reopened.session.store.resolve(key);
    if (restored === undefined) throw new Error("lost saved notebook");
    expect(supported.world.hasTag(restored, Active)).toBe(true);
    supported.dispose();
    engine.dispose();
    legacy.dispose();
  });
});
