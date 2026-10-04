// @vitest-environment node
// THE PRODUCT'S FIRST BOARD (DK-8): ICE's six and VibeField's comment pad, laid as the product's composition — a
// working column and the desk calendar BESIDE it, one object among the six, never the ground under them — and the
// example clock a DEV/SMOKE SWITCH (ruling 1: never a user's first board): a dev build or `?deskSeedExamples=1`.
import { defineQuery, Not, Position, PrefabId, Size, Specimen } from "@vibecook/ice";
import { CALENDAR_TYPE } from "@vibecook/ice/desk/objects";
import { COMMENT_PAD_TYPE } from "@vibefield/plugin-comment-pad";
import { describe, expect, it } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskCensus } from "../src/field/desk/desk-door";
import {
  SEED_CLOCK,
  SEED_EXAMPLES,
  SEED_PAD,
  SEED_TYPES,
  seedObjects,
  seedsExamples,
} from "../src/field/desk/desk-seed";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);
const NOW = new Date(2026, 9, 4);

describe("the product's first board (DK-8)", () => {
  it("lays ICE's six and the comment pad — the pad named by the plugin's own type — and no example", () => {
    expect(SEED_PAD.type).toBe(COMMENT_PAD_TYPE);
    expect(seedObjects(NOW).map((s) => s.type)).not.toContain(SEED_CLOCK.type);
    expect(seedObjects(NOW, { examples: true }).map((s) => s.type)).toContain(SEED_CLOCK.type);
    expect([...SEED_TYPES].sort()).toEqual(
      [
        "desk.board",
        "desk.calendar",
        "desk.minimat",
        "desk.note",
        "desk.notebook",
        "desk.photo",
        COMMENT_PAD_TYPE,
      ].sort(),
    );
  });

  it("THE CALENDAR IS ONE OBJECT AMONG THE SIX, NOT THE GROUND: its sheet lies beside the others and touches none of them", async () => {
    const ce = createFieldEngine(buildRegistry());
    await seedField(ce, ce.docs.create(), createDeskBlobStore(), NOW, { examples: true });
    expect(deskCensus(ce)).toEqual({
      ...Object.fromEntries(SEED_TYPES.map((t) => [t, 1])),
      // the example clock's plugin is not in the dev-bundled set: passed by
    });
    const rects: { type: string; x0: number; y0: number; x1: number; y1: number }[] = [];
    ce.world.query(objectsQ).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        const at = ce.world.get(e, Position);
        const size = ce.world.get(e, Size);
        const type = ce.world.get(e, PrefabId)?.id;
        if (at === undefined || size === undefined || typeof type !== "string") continue;
        rects.push({ type, x0: at.x, y0: at.y, x1: at.x + size.w, y1: at.y + size.h });
      }
    });
    const calendar = rects.find((r) => r.type === CALENDAR_TYPE);
    if (calendar === undefined) throw new Error("no calendar laid");
    const column = rects.filter((r) => r.type !== CALENDAR_TYPE);
    expect(column).toHaveLength(SEED_TYPES.length - 1);
    for (const r of column) {
      const overlaps =
        r.x0 < calendar.x1 && r.x1 > calendar.x0 && r.y0 < calendar.y1 && r.y1 > calendar.y0;
      expect(overlaps, `${r.type} lies on the calendar`).toBe(false);
      expect(r.x1, `${r.type} beside the calendar, on its left`).toBeLessThan(calendar.x0);
    }
    // the working column centred on the calendar's height: an arrival that cannot hold the calendar trims it first
    const top = Math.min(...column.map((r) => r.y0));
    const foot = Math.max(...column.map((r) => r.y1));
    expect(top).toBeGreaterThan(calendar.y0);
    expect(foot).toBeLessThan(calendar.y1);
    expect(Math.abs((top + foot) / 2 - (calendar.y0 + calendar.y1) / 2)).toBeLessThan(40);
    ce.dispose();
  });

  it("the example switch: a dev build, or a load that asks — never otherwise", () => {
    expect(SEED_EXAMPLES).toBe("deskSeedExamples");
    expect(seedsExamples(true, "")).toBe(true);
    expect(seedsExamples(false, "")).toBe(false);
    expect(seedsExamples(false, "?deskSeedExamples=1")).toBe(true);
    expect(seedsExamples(false, "?deskSeedExamples=0&x=1")).toBe(false);
  });
});
