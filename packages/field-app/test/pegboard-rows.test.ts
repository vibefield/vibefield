/**
 * ITEM 119 — ONE LAID LINE IS ONE ROW (field/desk/pegboard/pegboard-model.ts `boardSpecimens`; R14): a hook and a
 * shelf the kernel's own `layTray` hangs on one line read as one row on the board, in the lay's order — the order ← →
 * walk (ICE's `tray.focus`). The hangs are the comment pad's and the phone's as their manifests declare them, laid on
 * the widest drawer at its pitch (`DRAWER`). A row keyed on the hang's top split them: the shelf's top sits 2.52 px
 * below the hook's (132.52 against 130), so smoke:canvas's KEYS row read → onto the phone where the listbox's second
 * option was the note (run 12).
 */

import { DRAWER } from "@vibecook/ice/desk";
import { hangError, layTray, type TrayItem } from "@vibecook/ice/kernel";
import { commentPadManifest } from "@vibefield/plugin-comment-pad";
import { simulatorManifest } from "@vibefield/plugin-simulator";
import { describe, expect, it } from "vitest";
import { boardSpecimens, type LaidSpecimen } from "../src/field/desk/pegboard/pegboard-model";

const OBJECTS = [commentPadManifest, simulatorManifest].map((m) => m.contributes?.objects?.[0]);

const ITEMS: TrayItem[] = OBJECTS.flatMap((o) =>
  o?.tray === undefined
    ? []
    : [
        {
          type: o.type,
          category: o.tray.category,
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
