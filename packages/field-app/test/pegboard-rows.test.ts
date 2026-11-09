/**
 * ITEM 119 — ONE LAID LINE IS ONE ROW (field/desk/pegboard/pegboard-model.ts `boardSpecimens`; R14): a hook and a
 * shelf the kernel's own `layTray` hangs on one line read as one row on the board, in the lay's order — the order ← →
 * walk (ICE's `tray.focus`). The hangs are the Note's, read from the objects this app mounts, and the phone's as its
 * manifest declares it, laid on the widest drawer at its pitch (`DRAWER`). A row keyed on the hang's top split a hook
 * from a shelf: the phone's top sits 2.52 px below the hook's (132.52 against 130), so smoke:canvas's KEYS row read →
 * onto the phone where the listbox's second option was the note (run 12, beside the comment pad's hook, which no longer
 * hangs since the first launch's lineup). The phone is no first-launch object, and it has to be this one: the launch's
 * own hangs, the Note, the Mini mat and the Whiteboard, all sit on the pitch at one top, and equal tops cannot split.
 */

import { DRAWER } from "@vibecook/ice/desk";
import { hangError, layTray, type TrayItem } from "@vibecook/ice/kernel";
import { simulatorManifest } from "@vibefield/plugin-simulator";
import { describe, expect, it } from "vitest";
import { FIELD_DESK_OBJECTS } from "../src/field/desk/desk-objects";
import { boardSpecimens, type LaidSpecimen } from "../src/field/desk/pegboard/pegboard-model";

// The hook is the launch's own, read from what this app mounts: the file goes red if the lineup ever drops it.
const NOTE = FIELD_DESK_OBJECTS.find((object) => object.tray?.label === "Note");
const OBJECTS = [
  NOTE === undefined ? undefined : { type: NOTE.type, tray: NOTE.tray, size: NOTE.defaultSize },
  simulatorManifest.contributes?.objects?.[0],
];

const ITEMS: TrayItem[] = OBJECTS.flatMap((o) =>
  o?.tray === undefined
    ? []
    : [
        {
          type: o.type,
          category: o.tray.category ?? "",
          hang: o.tray.hang,
          ...(o.tray.order === undefined ? {} : { order: o.tray.order }),
        },
      ],
);

describe("item 119 — a hook and a shelf on one laid line", () => {
  const { placed } = layTray(ITEMS, DRAWER.maxWidth, DRAWER.pitch);
  const laid: LaidSpecimen[] = placed.map((p) => {
    const o = OBJECTS.find((q) => q?.type === p.type);
    return {
      type: p.type,
      label: o?.tray?.label ?? p.type,
      hang: { x: p.x, y: p.y, w: p.w, h: p.h },
      natural: o?.size ?? { w: p.w, h: p.h },
    };
  });

  it("is laid on one line by the kernel (the precondition)", () => {
    expect(ITEMS.map((i) => i.hang.accessory).sort()).toEqual(["hook", "shelf"]);
    for (const item of ITEMS) expect(hangError(item.hang)).toBeNull();
    expect(placed.map((p) => p.line)).toEqual([0, 0]);
    expect(placed[0]?.y).not.toBe(placed[1]?.y);
  });

  it("reads as one row, in the lay's order", () => {
    const specimens = boardSpecimens(
      laid,
      placed.map((p) => p.type),
      { x: 30, y: 419 },
      0,
    );
    expect(specimens.map((s) => s.row)).toEqual([0, 0]);
    expect(specimens.map((s) => s.type)).toEqual(placed.map((p) => p.type));
  });
});
