/**
 * DK-13 — THE PEGBOARD'S FOOT (field/desk/desk-layer.ts; DESIGN.md §8 "The pegboard"; ICE I21): the field's layer hands
 * the desk a narrow bottom strip: 16 px of fade above a 4 px border. ICE's `deskLayer` is watched: what the field asks of it is the row.
 */
import type { CanvasEngine } from "@vibecook/ice";
import { describe, expect, it, vi } from "vitest";

const asked: unknown[] = [];
vi.mock("@vibecook/ice/desk", async (original) => ({
  ...(await original<typeof import("@vibecook/ice/desk")>()),
  deskLayer: (opts: unknown) => {
    asked.push(opts);
    return () => ({});
  },
}));

describe("the field's desk layer (I21)", () => {
  it("keeps the bottom fade and border within 20 px", async () => {
    const { DESK_TRAY, fieldDeskLayer } = await import("../src/field/desk/desk-layer");
    expect(DESK_TRAY).toEqual({ foot: 4, footFade: 16 });
    fieldDeskLayer({ engine: { docs: {} } as unknown as CanvasEngine, theme: "light" });
    expect(asked).toHaveLength(1);
    expect((asked[0] as { tray?: unknown }).tray).toEqual({ foot: 4, footFade: 16 });
  });
});
