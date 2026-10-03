/**
 * Drop-to-consume ON THE DESK (DK-4; ICE design-015 §9, D-D18 — v1 RFC-004's drop, re-aimed): a desk
 * object let go with its CENTRE over a mini mat's face goes in. The mini mat takes what PROVIDES
 * `desk.containable` (`CONTAINABLE`) — the engine's typed placement decides (`placement.canIngress`,
 * the authority the drop system asks for a container), never the old `Accepts`/`Provides` cells the
 * folder and the widgetlab cards matched on (DK-D14: nothing of `vibefield.*`'s containment
 * survives). A ROOT object (the whiteboard, `interaction.drop: "never"`) let go the same way stays on
 * the desk where it was let go: the desk has no fly-back. The whole real pipeline on VibeField's own
 * engine: queue → picking → recognizers → the move → the drop candidate → the consume commit.
 */
import { Camera, ChildOf, type Entity, NO_MODS, Position, Size, Viewport } from "@vibecook/ice";
import { CONTAINABLE, DESK_OBJECT } from "@vibecook/ice/desk";
import { BOARD_TYPE, MINIMAT_TYPE, NOTE_TYPE } from "@vibecook/ice/desk/objects";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine } from "../src/field-engine";

/** VibeField's engine on a fresh board, a mini mat laid at (1000, 100), the camera at identity. */
function desk() {
  const ce = createFieldEngine(buildRegistry());
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 2000, h: 1200, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen = world
  const mat = ce.ops.spawnWidget(MINIMAT_TYPE, { x: 1000, y: 100, undoable: false });
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  step(5);
  const centreOf = (e: Entity): { x: number; y: number } => {
    const p = ce.world.get(e, Position);
    const s = ce.world.get(e, Size);
    if (p === undefined || s === undefined) throw new Error("no rect");
    return { x: p.x + s.w / 2, y: p.y + s.h / 2 };
  };
  const mouse = (kind: "down" | "move" | "up", at: { x: number; y: number }, buttons: number) => {
    ce.stack.queue.enqueue({
      kind,
      pointerId: "mouse",
      device: "mouse",
      screenX: at.x,
      screenY: at.y,
      buttons,
      mods: NO_MODS,
    });
  };
  /** Lay one `type` at (100, 100), drag it by its centre to `to` in eight moves, and let go. */
  const dropAt = (type: string, to: { x: number; y: number }): Entity => {
    const e = ce.ops.spawnWidget(type, { x: 100, y: 100, undoable: false });
    ce.world.sync();
    step(3);
    const from = centreOf(e);
    mouse("move", from, 0);
    step();
    mouse("down", from, 1);
    step();
    for (let i = 1; i <= 8; i++) {
      mouse(
        "move",
        { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 },
        1,
      );
      step();
    }
    mouse("up", to, 0);
    step(4);
    return e;
  };
  return { ce, mat, dropAt, centreOf };
}

describe("drop-to-consume on the desk — a mini mat takes a dropped note", () => {
  it("the engine's containment: the mini mat accepts CONTAINABLE, which a note provides and a whiteboard does not", () => {
    const { ce, mat } = desk();
    expect(ce.catalog.widget(MINIMAT_TYPE)?.container?.accepts).toContain(CONTAINABLE);
    expect(ce.catalog.widget(NOTE_TYPE)?.provides).toEqual(
      expect.arrayContaining([DESK_OBJECT, CONTAINABLE]),
    );
    expect(ce.catalog.widget(BOARD_TYPE)?.provides).not.toContain(CONTAINABLE);
    expect(ce.placement.canIngress(NOTE_TYPE, mat)).toMatchObject({ ok: true });
    expect(ce.placement.canIngress(BOARD_TYPE, mat)).toMatchObject({ ok: false });
    ce.dispose();
  });

  it("a note let go with its centre over the mini mat's face goes in (ChildOf)", () => {
    const { ce, mat, dropAt, centreOf } = desk();
    const note = dropAt(NOTE_TYPE, centreOf(mat));
    expect(ce.world.getRelation(note, ChildOf)).toBe(mat);
    ce.dispose();
  });

  it("a whiteboard let go the same way stays on the desk, where it was let go — no fly-back", () => {
    const { ce, mat, dropAt, centreOf } = desk();
    const board = dropAt(BOARD_TYPE, centreOf(mat));
    expect(ce.world.getRelation(board, ChildOf)).not.toBe(mat);
    // a plain move: it lies over the mat as a root object, never sent home to (100, 100)
    const landed = centreOf(board);
    const p = ce.world.get(mat, Position);
    const s = ce.world.get(mat, Size);
    if (p === undefined || s === undefined) throw new Error("no mat rect");
    expect(landed.x).toBeGreaterThan(p.x);
    expect(landed.x).toBeLessThan(p.x + s.w);
    expect(landed.y).toBeGreaterThan(p.y);
    expect(landed.y).toBeLessThan(p.y + s.h);
    ce.dispose();
  });
});
