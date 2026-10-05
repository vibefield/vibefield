/**
 * DK-11 — THE BAR'S ACTS (field/desk/bar/bar-acts.ts; DESIGN.md §8 "The doors": the acts run through the engine's ops;
 * "The bar grown": Comment — the C key's wrap, DK-D24 — and Clean up, DK-D29). Each act is one engine op on the
 * selection, on a real field engine over the first board: COMMENT lays a comment pad at the selection's right edge,
 * its top on the selection's top, ONE undo step, the pad selected; TAPE writes `Locked` and lifts it again; BRING TO
 * FRONT / SEND TO BACK reorder; CLEAN UP tidies two or more into rows, one undo step; OPEN picks the one object up.
 */
import {
  type CanvasEngine,
  type Entity,
  Held,
  Locked,
  Position,
  Size,
  selectedEntities,
} from "@vibecook/ice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMENT_GAP,
  COMMENT_PAD_TYPE,
  layComment,
  runBarAct,
  selectionWorldBox,
} from "../src/field/desk/bar/bar-acts";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskCensus, deskObjects } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

let ce: CanvasEngine;
const first = (type: string): Entity => deskObjects(ce, type)[0]?.entity as Entity;
/** A frame of the engine: what an op's transaction wrote reaches the world (sync → tick). */
let clock = 0;
const step = (): void => {
  clock += 16;
  ce.step(clock);
};

beforeEach(async () => {
  ce = createFieldEngine(buildRegistry());
  await seedField(ce, ce.docs.create(), createDeskBlobStore());
});

afterEach(() => {
  ce.dispose();
  vi.restoreAllMocks();
});

describe("the bar's acts (DK-11)", () => {
  it("COMMENT lays a pad at the selection's right edge — its top on the selection's — selected, ONE undo step", () => {
    const note = first("desk.note");
    ce.ops.setSelection([note]);
    const box = selectionWorldBox(ce);
    if (box === null) throw new Error("the note has no box");
    const pads = deskCensus(ce)[COMMENT_PAD_TYPE] ?? 0;
    const pad = layComment(ce);
    if (pad === null) throw new Error("no pad laid");
    step();
    expect(deskCensus(ce)[COMMENT_PAD_TYPE]).toBe(pads + 1);
    expect(ce.world.get(pad, Position)).toEqual({ x: box.x1 + COMMENT_GAP, y: box.y0 });
    const size = ce.catalog.widget(COMMENT_PAD_TYPE)?.defaultSize;
    expect(ce.world.get(pad, Size)).toMatchObject({ w: size?.w, h: size?.h });
    expect(selectedEntities(ce.world)).toEqual([pad]);
    // one undo step takes it back off the board
    expect(ce.docs.undo()).toBe(true);
    step();
    expect(deskCensus(ce)[COMMENT_PAD_TYPE]).toBe(pads);
  });

  it("TAPE writes the tape on every selected object, and lifts it when every one is taped", () => {
    const note = first("desk.note");
    ce.ops.setSelection([note]);
    runBarAct(ce, "tape", false);
    step();
    expect(ce.world.hasTag(note, Locked)).toBe(true);
    runBarAct(ce, "tape", true);
    step();
    expect(ce.world.hasTag(note, Locked)).toBe(false);
  });

  it("BRING TO FRONT and SEND TO BACK reorder the selection; CLEAN UP runs `ops.arrange` (ICE's tidy, one undo step)", () => {
    const note = first("desk.note");
    const pad = first(COMMENT_PAD_TYPE);
    ce.ops.setSelection([note, pad]);
    const reorder = vi.spyOn(ce.ops, "reorder");
    runBarAct(ce, "front", false);
    runBarAct(ce, "back", false);
    expect(reorder.mock.calls.map((call) => call[1])).toEqual(["top", "bottom"]);
    const arrange = vi.spyOn(ce.ops, "arrange");
    runBarAct(ce, "cleanup", false);
    expect(arrange).toHaveBeenCalledTimes(1);
  });

  it("OPEN picks the one object up — a refusal (a type that does not open) changes nothing", () => {
    const notebook = first("desk.notebook");
    ce.ops.setSelection([notebook]);
    runBarAct(ce, "open", false);
    expect(ce.world.hasTag(notebook, Held)).toBe(true);
    ce.ops.putDown();
    const note = first("desk.note");
    ce.ops.setSelection([note]);
    expect(() => runBarAct(ce, "open", false)).not.toThrow();
    expect(ce.world.hasTag(note, Held)).toBe(false);
  });

  it("a kind's act runs through `ops.runMenuAction` — the type's own op", () => {
    const run = vi.spyOn(ce.ops, "runMenuAction");
    runBarAct(ce, "act:vinyl", false);
    expect(run).toHaveBeenCalledWith("vinyl");
  });
});
