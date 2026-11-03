// @vitest-environment node
import {
  Active,
  ChildOf,
  createCanvasEngine,
  gateVerdict,
  guardedTransaction,
  Specimen,
} from "@vibecook/ice";
import {
  addEvent,
  CALENDAR_TYPE,
  Calendar,
  CalendarEvent,
  DESK_ENGINE,
  EVENT_TYPE,
  NOTE_TYPE,
  NotePin,
  PIN_TYPE,
  PinsNote,
  pinNote,
} from "@vibecook/ice/desk/objects";
import { describe, expect, it } from "vitest";
import { capabilityTypes } from "../src/field/desk/desk-capabilities";
import { deskCensus, deskObjects } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine, fieldPackScope } from "../src/field-engine";
import { buildGhostWidgetTypes } from "../src/plugin-host/ghost-stubs";

describe("the calendar retired from VibeField", () => {
  it("does not register, seed capabilities for, or offer the calendar on a new board", () => {
    const registry = buildRegistry();
    const engine = createFieldEngine(registry);
    const session = engine.docs.create();
    engine.step(16);
    expect(engine.catalog.widget(CALENDAR_TYPE)).toBeUndefined();
    expect(capabilityTypes(registry, null)).not.toContain(CALENDAR_TYPE);
    expect(
      engine.catalog
        .widgetTypes()
        .filter((w) => w.tray)
        .map((w) => w.type),
    ).not.toContain(CALENDAR_TYPE);
    for (const type of [CALENDAR_TYPE, EVENT_TYPE, PIN_TYPE]) {
      expect(session.versionReport().docPacks[type]).toBeUndefined();
      expect(fieldPackScope(registry).has(type)).toBe(true);
    }
    expect(
      buildGhostWidgetTypes(
        { [CALENDAR_TYPE]: 1, [EVENT_TYPE]: 1, [PIN_TYPE]: 1 },
        fieldPackScope(registry),
      ),
    ).toEqual([]);
    engine.dispose();
  });

  it("opens existing calendars dormant, keeps the board writable, and preserves their entries and pins", () => {
    const legacy = createCanvasEngine(DESK_ENGINE);
    const old = legacy.docs.create();
    const pad = legacy.ops.spawnWidget(CALENDAR_TYPE, {
      x: 1620,
      y: 926,
      props: { month: "2026-11" },
    });
    const note = legacy.ops.spawnWidget(NOTE_TYPE, { x: 100, y: 330 });
    guardedTransaction(old.store, legacy.world, (tx) => {
      addEvent(tx, pad, { start: "2026-11-02", text: "keep this entry" });
      pinNote(tx, pad, note, "2026-11-02");
    });
    legacy.step(16);
    const key = old.store.keyOf(pad);
    if (key === undefined) throw new Error("no calendar key");
    const engine = createFieldEngine(buildRegistry());
    const result = engine.docs.open(old.exportEnvelope(1));
    if (!result.ok) throw new Error(result.reason);
    engine.step(16);
    const dormant = result.session.store.resolve(key);
    if (dormant === undefined) throw new Error("calendar data was deleted");
    expect(gateVerdict(result.session.versionReport())).toBe("ok");
    expect(engine.world.hasTag(dormant, Active)).toBe(false);
    expect(engine.world.hasTag(dormant, Specimen)).toBe(false);
    expect(deskObjects(engine, CALENDAR_TYPE)).toEqual([]);
    expect(deskCensus(engine)[CALENDAR_TYPE]).toBeUndefined();
    expect(engine.ops.spawnWidget(NOTE_TYPE, { x: 400, y: 330 })).toBeTypeOf("number");

    const supported = createCanvasEngine(DESK_ENGINE);
    const reopened = supported.docs.open(result.session.exportEnvelope(2));
    if (!reopened.ok) throw new Error(reopened.reason);
    supported.step(16);
    const restored = reopened.session.store.resolve(key);
    if (restored === undefined) throw new Error("lost saved calendar");
    expect(supported.world.hasTag(restored, Active)).toBe(true);
    const group = Calendar.groups[0];
    if (group === undefined) throw new Error("no calendar props");
    expect(supported.world.get(restored, group.component)).toMatchObject({ month: "2026-11" });
    const children = supported.world.getReverse(restored, ChildOf);
    expect(
      children.some((e) => supported.world.get(e, CalendarEvent)?.text === "keep this entry"),
    ).toBe(true);
    const pin = children.find((e) => supported.world.get(e, NotePin)?.day === "2026-11-02");
    expect(pin).toBeDefined();
    if (pin === undefined) throw new Error("lost saved pin");
    expect(supported.world.getRelation(pin, PinsNote)).toBeTypeOf("number");
    supported.dispose();
    engine.dispose();
    legacy.dispose();
  });
});
