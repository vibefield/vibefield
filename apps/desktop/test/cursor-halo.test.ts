/**
 * Cursor halo (2026-07-18): the pointerlab morph as an OS-cursor accent.
 * Drives the REAL demo engine (real picking, real ingest) plus the halo
 * install: ring (1) on empty canvas → MID over a card (`Targets` via l1-pick)
 * → DOT on a stamped `overInteractive` move → back. Touch pointers get no
 * halo; the overlay projects the dot state as the `.is-dot` class.
 */
import {
  defineQuery,
  type Entity,
  type InputEvent,
  NO_MODS,
  Viewport,
  type World,
} from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import { installCursorHalo } from "../renderer/src/cursor";
import { Cur, DOT_SCALE, MID_SCALE } from "../renderer/src/cursor/components";
import { buildRegistry, createFieldEngine } from "../renderer/src/field-engine";

const curQ = defineQuery([Cur]);

function halos(world: World): Entity[] {
  const out: Entity[] = [];
  world.query(curQ).each((b) => {
    for (const r of b) out.push(b.entity(r));
  });
  return out;
}

function ev(partial: Partial<InputEvent> & Pick<InputEvent, "kind">): InputEvent {
  return {
    pointerId: "mouse",
    device: "mouse",
    screenX: 0,
    screenY: 0,
    buttons: 0,
    mods: NO_MODS,
    ...partial,
  };
}

function setup() {
  const ce = createFieldEngine(buildRegistry());
  ce.world.setResource(Viewport, { w: 1900, h: 1100, dpr: 1 }); // identity camera — screen == world
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = installCursorHalo(ce, container);
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  step(3); // index warm-up (membership + spatial sync)
  return { ce, container, dispose, step };
}

describe("widgetlab cursor halo", () => {
  it("morphs ring → MID over a card → DOT over an internal interactive → back", () => {
    const { ce, container, dispose, step } = setup();

    // The halo IS the cursor: the OS cursor hides inside the canvas for the
    // whole install (2026-07-18, James — design-003 §7 app opt-in).
    expect(container.classList.contains("wl-no-cursor")).toBe(true);

    // Empty canvas (south-east of the fitness/photos columns): full ring.
    ce.stack.queue.enqueue(
      ev({ kind: "move", screenX: 600, screenY: 900, overInteractive: false }),
    );
    step(60);
    const halo = halos(ce.world);
    expect(halo).toHaveLength(1);
    const e = halo[0] as Entity;
    expect(ce.world.read(e, Cur).scale).toBeCloseTo(1, 1);

    // Over the clock card (real l1-pick sets Targets): zoomed-in MID ring.
    ce.stack.queue.enqueue(
      ev({ kind: "move", screenX: 127, screenY: 127, overInteractive: false }),
    );
    step(60);
    expect(ce.world.read(e, Cur).scale).toBeCloseTo(MID_SCALE, 1);

    // The adapter stamps an internal interactive under the pointer: solid dot.
    ce.stack.queue.enqueue(ev({ kind: "move", screenX: 127, screenY: 127, overInteractive: true }));
    step(60);
    expect(ce.world.read(e, Cur).scale).toBeCloseTo(DOT_SCALE, 1);
    const node = container.querySelector(".wl-halo");
    expect(node?.classList.contains("is-dot")).toBe(true);

    // Off the interactive, still on the card: back to MID, dot class drops.
    ce.stack.queue.enqueue(
      ev({ kind: "move", screenX: 127, screenY: 127, overInteractive: false }),
    );
    step(60);
    expect(ce.world.read(e, Cur).scale).toBeCloseTo(MID_SCALE, 1);
    expect(node?.classList.contains("is-dot")).toBe(false);

    dispose();
    expect(container.querySelector(".wl-halo")).toBeNull();
    expect(container.classList.contains("wl-no-cursor")).toBe(false); // OS cursor restored
  });

  it("touch pointers get no halo (nothing to augment)", () => {
    const { ce, dispose, step } = setup();
    ce.stack.queue.enqueue(ev({ kind: "move", screenX: 600, screenY: 900 }));
    step(2);
    expect(halos(ce.world)).toHaveLength(1);

    ce.stack.queue.enqueue(
      ev({
        kind: "down",
        pointerId: "touch:1",
        device: "touch",
        screenX: 300,
        screenY: 300,
        buttons: 1,
      }),
    );
    step(2);
    expect(halos(ce.world)).toHaveLength(1); // still just the mouse halo
    dispose();
  });
});
