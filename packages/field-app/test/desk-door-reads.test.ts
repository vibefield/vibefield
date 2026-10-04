// @vitest-environment node
// DK-8 — THE DESK DOOR'S TWO NEW READS (`window.__vfDesk`, what smoke:canvas's pad row reads): an object type's
// props — the cells of its groups, merged, never the pegboard's specimens — and the board's persistence row. Reads
// only: the door still writes no document.
import { COMMENT_PAD_TYPE } from "@vibefield/plugin-comment-pad";
import { afterEach, describe, expect, it } from "vitest";
import { setBoardStatus } from "../src/board-status";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskObjects, installDeskDoor, type VfDeskDoor } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

afterEach(() => {
  setBoardStatus({ state: "booting" });
});

describe("the desk door's reads (DK-8)", () => {
  it("reads each object of a type with its props merged across its groups — the pad's ink and its dress together", async () => {
    const ce = createFieldEngine(buildRegistry());
    await seedField(ce, ce.docs.create(), createDeskBlobStore());
    const pads = deskObjects(ce, COMMENT_PAD_TYPE);
    expect(pads).toHaveLength(1);
    expect(pads[0]?.props).toEqual({ text: "", seeds: "", pen: "ball", accent: "indigo", seed: 0 });
    expect(deskObjects(ce, "no.such.type")).toEqual([]);
    ce.dispose();
  });

  it("installed, it answers the same reads, and the board's persistence row as its status names it", () => {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const undo = installDeskDoor(
      { engine: ce, handle: {} as never, generation: 1, mount: 0, theme: "light" },
      () => false,
    );
    const door = (globalThis as { __vfDesk?: VfDeskDoor }).__vfDesk;
    expect(door?.objects(COMMENT_PAD_TYPE)).toEqual([]);
    setBoardStatus({ state: "live", lastSavedAt: 1234 });
    expect(door?.board()).toEqual({ state: "live", lastSavedAt: 1234 });
    setBoardStatus({ state: "saving" });
    expect(door?.board()).toEqual({ state: "saving", lastSavedAt: null });
    undo();
    ce.dispose();
  });
});
