// @vitest-environment node
/**
 * Track OM, OM-2 (2026-11-25) — THE DESK'S HOLD (field/desk/desk-layer.ts `deskHold`, lent to kinds under the SDK's
 * `DESK_HOLD`), on a real field engine over the seeded first board: a kind's act picks one of the selected objects up
 * through ICE's own pick-up (`ops.open`, a double-click's), and the selection becomes it alone. Anything else is refused
 * with nothing changed — nothing opened, the selection as it was: an object that is not selected, one whose type does not
 * open (the note), and, core's own refusal, a pick-up while another object is in hand. desk-layer-services.test.ts holds
 * that the layer lends it.
 */
import { type CanvasEngine, type Entity, heldEntity, selectedEntities } from "@vibecook/ice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskObjects } from "../src/field/desk/desk-door";
import { deskHold } from "../src/field/desk/desk-layer";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

let ce: CanvasEngine;
/** The whiteboard: the seeded board's one object whose type opens (DESIGN.md §8 "Tools in hand", the specimens). */
let board: Entity;
/** A note: written in place, never picked up. */
let note: Entity;

beforeEach(async () => {
  ce = createFieldEngine(buildRegistry());
  await seedField(ce, ce.docs.create(), createDeskBlobStore(), undefined, { examples: true });
  ce.step(16);
  board = deskObjects(ce, "desk.board")[0]?.entity as Entity;
  note = deskObjects(ce, "desk.note")[0]?.entity as Entity;
});

afterEach(() => {
  ce.dispose();
  vi.restoreAllMocks();
});

/** The selection, as one ordered list (its order is the world's). */
const selection = (): number[] => selectedEntities(ce.world).map((e) => e as number);
const sorted = (entities: readonly Entity[]): number[] =>
  entities.map((e) => e as number).sort((a, b) => a - b);

describe("the desk's hold (track OM, OM-2)", () => {
  it("picks one of the selected up — ICE's pick-up — and the selection becomes it alone", () => {
    expect(ce.catalog.widget("desk.board")?.openable).toBe(true);
    ce.ops.setSelection([note, board]);
    const open = vi.spyOn(ce.ops, "open");
    expect(deskHold(ce).pickUp(board)).toBe(true);
    expect(open).toHaveBeenCalledWith(board);
    expect(heldEntity(ce.world)).toBe(board);
    expect(selection()).toEqual([board as number]);
  });

  it("refuses an object that is not among the selected: nothing opens, the selection stays — and with nothing selected", () => {
    const open = vi.spyOn(ce.ops, "open");
    ce.ops.setSelection([note]);
    expect(deskHold(ce).pickUp(board)).toBe(false);
    ce.ops.clearSelection();
    expect(deskHold(ce).pickUp(board)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(heldEntity(ce.world)).toBeUndefined();
    expect(selection()).toEqual([]);
  });

  it("refuses an object whose type does not open, the selection left as it was", () => {
    expect(ce.catalog.widget("desk.note")?.openable).not.toBe(true);
    ce.ops.setSelection([note, board]);
    expect(deskHold(ce).pickUp(note)).toBe(false);
    expect(heldEntity(ce.world)).toBeUndefined();
    expect(sorted(selectedEntities(ce.world))).toEqual(sorted([note, board]));
  });

  it("refuses another object while one is in hand (core's own refusal); the one in hand is taken again, alone", () => {
    ce.ops.setSelection([board]);
    const [copy] = ce.ops.duplicateSelection();
    if (copy === undefined) throw new Error("no copy of the whiteboard");
    ce.step(16);
    const hold = deskHold(ce);
    expect(hold.pickUp(copy)).toBe(true);
    // the first whiteboard selected beside the one in hand: refused, nothing put down, nothing narrowed
    ce.ops.setSelection([copy, board]);
    expect(hold.pickUp(board)).toBe(false);
    expect(heldEntity(ce.world)).toBe(copy);
    expect(sorted(selectedEntities(ce.world))).toEqual(sorted([copy, board]));
    // the one in hand asked for again: still in hand, and the selection becomes it alone
    expect(hold.pickUp(copy)).toBe(true);
    expect(heldEntity(ce.world)).toBe(copy);
    expect(selection()).toEqual([copy as number]);
  });
});
