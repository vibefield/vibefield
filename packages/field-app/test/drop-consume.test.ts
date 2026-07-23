/**
 * Drop-to-consume (v1 RFC-004, ported from widgetlab test/drop-consume.test.ts
 * with the D3 type names): dragging a card onto a folder and releasing must
 * adopt it (ChildOf) — the whole real pipeline: queue → picking → recognizers
 * → dragRoute → drop candidate → moveBehavior consume commit. Coordinates are
 * the widgetlab SCENE grid verbatim (field-engine.ts keeps them).
 */
import {
  ChildOf,
  defineQuery,
  type Entity,
  type InputEvent,
  NO_MODS,
  OverlapCandidate,
  OverlapRejected,
  Position,
  PrefabId,
  Viewport,
} from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

const idQ = defineQuery([Position, PrefabId]);

function makeEngine() {
  // B3 split: the engine boots doc-less; this suite drives the seeded board.
  const ce = createFieldEngine(buildRegistry());
  seedField(ce, ce.docs.create());
  return ce;
}

function findByType(world: ReturnType<typeof makeEngine>["world"], type: string): Entity[] {
  const out: Entity[] = [];
  world.query(idQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (world.get(e, PrefabId)?.id === type) out.push(e);
    }
  });
  return out;
}

function ev(kind: InputEvent["kind"], x: number, y: number, buttons: number): InputEvent {
  return {
    kind,
    pointerId: "mouse",
    device: "mouse",
    screenX: x,
    screenY: y,
    buttons,
    mods: NO_MODS,
  };
}

describe("field drop-to-consume", () => {
  it("drag vibefield.widgetlab.clock onto the Widgets folder → adopted (ChildOf)", () => {
    const ce = makeEngine();
    ce.world.setResource(Viewport, { w: 1900, h: 1100, dpr: 1 });
    let now = 0;
    const step = (n = 1) => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    step(3); // index warm-up

    const clock = findByType(ce.world, "vibefield.widgetlab.clock")[0] as Entity;
    const folder = findByType(ce.world, "vibefield.field-tools.folder")[0] as Entity; // "Widgets" at (1153, 270)
    expect(clock).toBeDefined();
    expect(folder).toBeDefined();

    // clock center (127,127) → folder center (1317, 442); identity camera.
    // Cards drag on PRESS (2026-07-17, dragOn "press" across widgetlab):
    // move right after the down — an idle 500ms hold would hand the pointer
    // to the LongPress recognizer instead.
    ce.stack.queue.enqueue(ev("down", 127, 127, 1));
    step();
    ce.stack.queue.enqueue(ev("move", 160, 160, 1)); // past the dead zone → drag activates
    step();
    ce.stack.queue.enqueue(ev("move", 1317, 442, 1)); // over the folder
    step(2); // drop system marks candidate
    ce.stack.queue.enqueue(ev("up", 1317, 442, 0));
    step(3); // consume commit + doc round-trip

    expect(ce.world.getRelation(clock, ChildOf)).toBe(folder);
  });
});

describe("field card-on-card reject (v1 iOS contract)", () => {
  it("drop vibefield.widgetlab.clock onto vibefield.widgetlab.battery → OverlapRejected hover, then fly-back home", () => {
    const ce = makeEngine();
    ce.world.setResource(Viewport, { w: 1900, h: 1100, dpr: 1 });
    let now = 0;
    const step = (n = 1) => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    step(3);

    const clock = findByType(ce.world, "vibefield.widgetlab.clock")[0] as Entity;
    const battery = findByType(ce.world, "vibefield.widgetlab.battery")[0] as Entity;
    const home = { ...ce.world.read(clock, Position) };

    // clock center (127,127) → battery center (301,127). Press-drag: move
    // immediately after the down (see the consume test above).
    ce.stack.queue.enqueue(ev("down", 127, 127, 1));
    step();
    ce.stack.queue.enqueue(ev("move", 160, 140, 1)); // activate
    step();
    ce.stack.queue.enqueue(ev("move", 301, 127, 1)); // over battery (Solid, no Accepts)
    step(2);
    expect(ce.world.hasTag(battery, OverlapRejected)).toBe(true); // the weak "won't take it" glow signal
    expect(ce.world.hasTag(battery, OverlapCandidate)).toBe(false);

    ce.stack.queue.enqueue(ev("up", 301, 127, 0));
    step(2); // rejected drop → fly-back tween attached, no commit
    expect(ce.world.hasTag(battery, OverlapRejected)).toBe(false); // terminal cleanup
    step(30); // ~480ms — tween eases home and reaps itself
    const back = ce.world.read(clock, Position);
    expect(back.x).toBeCloseTo(home.x, 0);
    expect(back.y).toBeCloseTo(home.y, 0);
  });
});
