// @vitest-environment happy-dom
/**
 * Item 550 (2026-11-18) — THE AT-WORK MARK, placed (DESIGN.md §8 "At work on the mat", "Where"). Every marked object's
 * silhouette on screen, in the same pass as the desk's compose: its kind's frame over the geometry the desk drew (else
 * its rect, square to the mat), through the camera by OUR port of ICE 0.17.0's `frameOnScreen` (internal to ICE, so its
 * arithmetic is pinned here by fixture numbers, and its body read from ICE's own dist); the object in hand at the
 * hand's pose and every other one dimmed; the pencil the overlay keeps off — a sole selection's brackets round its own
 * frame, several's union round the anchor's box — the whole arrival wide while they lock on, and again when the
 * selection moves to another object. The reflector is registered from `subscribeDesk` — after the compose ICE
 * registered for that mount, again on every publish — `always: true`, only while a mark is on the board or still
 * leaving, and it places nothing while the layer stands hidden. Red first: each row says what placement must do.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Entity } from "@vibecook/ice";
import type { SelectionAnchor } from "@vibecook/ice/desk";
import type { ObjectsPresenceSnapshot } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { AtWorkLayer, AtWorkScene } from "../src/field/desk/at-work/at-work-layer";
import { screenFrameOf as modelScreenFrameOf } from "../src/field/desk/at-work/at-work-model";
import {
  AT_WORK_REFLECTOR,
  type AtWorkDeskReads,
  atWorkHandFrame,
  atWorkPencilFor,
  atWorkSelectionKey,
  atWorkWorldFrame,
  createAtWorkReflector,
  placeAtWork,
  screenFrameOf,
} from "../src/field/desk/at-work/at-work-reflector";
import {
  AT_WORK_NO_PENCIL,
  AT_WORK_PENCIL,
  atWorkPencilOf,
  atWorkPencilOfUnion,
} from "../src/field/desk/at-work/at-work-shader";
import { createAtWorkStore } from "../src/field/desk/at-work/at-work-store";
import type { MountedDesk } from "../src/field/desk/desk-door";

const e = (n: number): Entity => n as Entity;

describe("ICE's frameOnScreen, ported (ICE 0.17.0 keeps it internal)", () => {
  it("is (c − cam)·z, h·z, r·z with the same turn — pinned by fixture numbers", () => {
    expect(
      screenFrameOf(
        { cx: 640, cy: -120, hx: 150, hy: 90, angle: 0.25, r: 12 },
        { x: 400, y: -300, zoom: 0.5 },
      ),
    ).toEqual({ cx: 120, cy: 90, hx: 75, hy: 45, angle: 0.25, r: 6 });
    const near = screenFrameOf(
      { cx: 10.5, cy: 20.25, hx: 5, hy: 2.5, angle: -0.1, r: 1 },
      { x: -4.5, y: 0.25, zoom: 2.2 },
    );
    expect(near.cx).toBeCloseTo(33, 9);
    expect(near.cy).toBeCloseTo(44, 9);
    expect(near.hx).toBeCloseTo(11, 9);
    expect(near.hy).toBeCloseTo(5.5, 9);
    expect(near.r).toBeCloseTo(2.2, 9);
    expect(near.angle).toBe(-0.1);
    // a camera at the origin and zoom 1 is the world itself
    const world = { cx: 3, cy: 4, hx: 5, hy: 6, angle: 7, r: 8 };
    expect(screenFrameOf(world, { x: 0, y: 0, zoom: 1 })).toEqual(world);
  });

  it("is the model's own port (one copy), and ICE's body still reads as the port does", () => {
    expect(screenFrameOf).toBe(modelScreenFrameOf);
    // ICE's entry is resolved through its package's `default` export condition and its chunks scanned for the
    // function: an EL8 to a release that changes the three lines reddens this row
    const dist = dirname(createRequire(import.meta.url).resolve("@vibecook/ice"));
    const bodies = readdirSync(dist)
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(dist, name), "utf8"))
      .flatMap((text) => /function frameOnScreen\(f, cam\) \{([^}]*\})/u.exec(text)?.[1] ?? []);
    expect(bodies).toHaveLength(1);
    expect((bodies[0] ?? "").replace(/\s+/gu, " ").trim()).toBe(
      "const z = cam.zoom; return { cx: (f.cx - cam.x) * z, cy: (f.cy - cam.y) * z, hx: f.hx * z, hy: f.hy * z, angle: f.angle, r: f.r * z }",
    );
  });
});

describe("an object's silhouette, as the desk drew it", () => {
  it("is its kind's frame over the geometry when both exist", () => {
    const drawn = { cx: 1, cy: 2, hx: 3, hy: 4, angle: 0.5, r: 6 };
    const seen: unknown[] = [];
    const kind = {
      frame: (g: never) => {
        seen.push(g);
        return drawn;
      },
    };
    expect(atWorkWorldFrame(kind, { lifted: 1 }, { x: 0, y: 0 }, { w: 10, h: 10 })).toBe(drawn);
    expect(seen).toEqual([{ lifted: 1 }]);
  });

  it("is the rect, square to the mat, with no kind, a kind with no frame, or no geometry yet — never frame(undefined)", () => {
    const rect = { cx: 60, cy: 50, hx: 50, hy: 30, angle: 0, r: 0 };
    let called = 0;
    const kind = {
      frame: () => {
        called += 1;
        return rect;
      },
    };
    const pos = { x: 10, y: 20 };
    const size = { w: 100, h: 60 };
    expect(atWorkWorldFrame(undefined, { g: 1 }, pos, size)).toEqual(rect);
    expect(atWorkWorldFrame({}, { g: 1 }, pos, size)).toEqual(rect);
    expect(atWorkWorldFrame(kind, undefined, pos, size)).toEqual(rect);
    expect(called).toBe(0);
    expect(atWorkWorldFrame(undefined, undefined, undefined, size)).toBeNull();
  });
});

/** A desk as placement reads it: objects by key, frames by entity, a hand. */
function readsOf(over: Partial<AtWorkDeskReads> = {}): AtWorkDeskReads {
  const keys = new Map([
    ["k1", e(1)],
    ["k2", e(2)],
  ]);
  return {
    resolve: (key) => keys.get(key),
    worldFrame: (entity) =>
      entity === e(1)
        ? { cx: 100, cy: 100, hx: 40, hy: 20, angle: 0, r: 4 }
        : { cx: 300, cy: 100, hx: 30, hy: 30, angle: 0.1, r: 0 },
    heldFrame: () => null,
    handOn: () => false,
    inHand: () => undefined,
    // the object the hand draws is the one in hand unless a row says the hand still carries one home
    carried: over.carried ?? over.inHand ?? (() => undefined),
    selection: () => [],
    fade: () => 1,
    camera: () => ({ x: 50, y: 50, zoom: 2 }),
    ...over,
  };
}

describe("placement, per frame", () => {
  it("places each key it can resolve through the camera, in order, and skips the rest", () => {
    const placed = placeAtWork(["k2", "gone", "k1"], readsOf());
    expect(placed.map((p) => p.key)).toEqual(["k2", "k1"]);
    expect(placed[1]?.frame).toEqual({ cx: 100, cy: 100, hx: 80, hy: 40, angle: 0, r: 8 });
    expect(placed.every((p) => !p.dimmed && !p.heldByYou && p.fade === 1)).toBe(true);
  });

  it("follows the object in hand at the hand's pose, and dims every other one's marks", () => {
    const placed = placeAtWork(
      ["k1", "k2"],
      readsOf({
        inHand: () => e(1),
        handOn: (entity) => entity === e(1),
        heldFrame: (_entity, world) => ({
          cx: 500,
          cy: 400,
          hx: 200,
          hy: 100,
          angle: 0,
          r: world.r * 2.5,
        }),
      }),
    );
    expect(placed[0]).toEqual({
      key: "k1",
      frame: { cx: 500, cy: 400, hx: 200, hy: 100, angle: 0, r: 10 },
      heldByYou: true,
      fade: 1,
      dimmed: false,
      held: true,
    });
    expect(placed[1]?.dimmed).toBe(true);
    expect(placed[1]?.heldByYou).toBe(false);
    expect(placed[1]?.held).toBe(false);
  });

  it("keeps the cover and the hand's place through the put-back, while the object flies home (2026-11-24)", () => {
    // Done pressed: the fact is gone (nothing in hand), but the hand still carries the pane home at its landing frame
    const landing = { cx: 420, cy: 330, hx: 150, hy: 75, angle: 0, r: 7 };
    const reads = readsOf({
      inHand: () => undefined,
      carried: () => e(1),
      heldFrame: (entity) => (entity === e(1) ? landing : null),
    });
    expect(atWorkHandFrame(reads)).toEqual(landing);
    const placed = placeAtWork(["k1", "k2"], reads);
    // its own mark flies with it; the one behind is no longer dimmed (the desk comes back) but still lies under it
    expect(placed[0]).toMatchObject({ key: "k1", frame: landing, held: true, dimmed: false });
    expect(placed[1]).toMatchObject({ key: "k2", held: false, dimmed: false });
  });

  it("says the object in hand's silhouette, marked or not, as the cover of every other one's marks (2026-11-24)", () => {
    // nothing in hand: no cover
    expect(atWorkHandFrame(readsOf())).toBeNull();
    // a third object, not marked, in hand at the hand's pose: its silhouette covers the marks behind it
    const hand = { cx: 500, cy: 400, hx: 200, hy: 100, angle: 0, r: 10 };
    const reads = readsOf({
      inHand: () => e(3),
      handOn: (entity) => entity === e(3),
      heldFrame: (entity) => (entity === e(3) ? hand : null),
    });
    expect(atWorkHandFrame(reads)).toEqual(hand);
    // a drag's hand (no pose): the object through the camera, as placement takes it
    const dragged = readsOf({ inHand: () => e(1), handOn: () => true });
    expect(atWorkHandFrame(dragged)).toEqual({ cx: 100, cy: 100, hx: 80, hy: 40, angle: 0, r: 8 });
  });

  it("takes a drag's hand (no pose) through the camera, paused, and clamps the desk's fade", () => {
    const placed = placeAtWork(
      ["k1"],
      readsOf({ handOn: () => true, fade: () => 1.4, inHand: () => e(1) }),
    );
    expect(placed[0]?.frame).toEqual({ cx: 100, cy: 100, hx: 80, hy: 40, angle: 0, r: 8 });
    expect(placed[0]?.heldByYou).toBe(true);
    expect(placed[0]?.fade).toBe(1);
  });
});

/** A selection anchor as ICE hands one: its box, its count, the view. */
const anchor = (count: number, box: SelectionAnchor["box"]): SelectionAnchor => ({
  box,
  count,
  locked: false,
  gesturing: false,
  editing: false,
  view: { width: 800, height: 600 },
  rulers: null,
});

describe("the pencil the overlay keeps off (DESIGN.md §7: the mark never covers the pencil)", () => {
  const box = { x0: 10, y0: 20, x1: 110, y1: 80 };
  const sole = { cx: 60, cy: 50, hx: 44, hy: 24, angle: 0.2, r: 3 };
  const arriving = AT_WORK_PENCIL.arrive * Math.SQRT2;

  it("keeps off nothing with nothing selected", () => {
    expect(atWorkPencilFor(null, null, 0, 0)).toBe(AT_WORK_NO_PENCIL);
    expect(atWorkPencilFor(anchor(0, null), sole, 0, 0)).toBe(AT_WORK_NO_PENCIL);
  });

  it("keeps off a sole selection's brackets round its own frame, the whole arrival wide while they lock on (180 ms)", () => {
    expect(atWorkPencilFor(anchor(1, box), sole, 1_000, 1_000)).toEqual(
      atWorkPencilOf(sole, arriving),
    );
    expect(atWorkPencilFor(anchor(1, box), sole, 1_000, 1_179)).toEqual(
      atWorkPencilOf(sole, arriving),
    );
    expect(atWorkPencilFor(anchor(1, box), sole, 1_000, 1_180)).toEqual(atWorkPencilOf(sole, 0));
    // at rest the brackets stand 6 out, their corner the frame's + 6 (ICE's `selectionGeometry`)
    const rest = atWorkPencilOf(sole, 0);
    expect(rest.box).toEqual([60, 50, 50, 30]);
    expect(rest.turn[2]).toBe(9);
    expect(rest.turn[0]).toBeCloseTo(Math.cos(0.2), 12);
  });

  it("keeps off several's union round the anchor's box, over the union's own 220 ms", () => {
    expect(atWorkPencilFor(anchor(3, box), sole, 0, 219).turn[3]).toBeCloseTo(arriving, 12);
    expect(atWorkPencilFor(anchor(3, box), sole, 0, 220)).toEqual(atWorkPencilOfUnion(box));
  });

  it("keeps off a sole selection it cannot frame along its box", () => {
    expect(atWorkPencilFor(anchor(1, box), null, 0, 500)).toEqual(atWorkPencilOfUnion(box));
  });

  it("tells one selection from another by its objects as well as its count, in any order", () => {
    expect(atWorkSelectionKey(null, [e(1)])).toBe("");
    expect(atWorkSelectionKey(anchor(1, null), [e(1)])).toBe("");
    const one = atWorkSelectionKey(anchor(1, box), [e(1)]);
    expect(atWorkSelectionKey(anchor(1, box), [e(2)])).not.toBe(one);
    expect(atWorkSelectionKey(anchor(2, box), [e(2), e(1)])).toBe(
      atWorkSelectionKey(anchor(2, box), [e(1), e(2)]),
    );
  });
});

// ———————————————————————————————————————————————————————————————— registration

interface Entry {
  readonly name: string;
  readonly always: boolean;
  readonly flush: () => void;
  live: boolean;
}

/** The engine's reflector registry as ICE 0.17.0 keeps it (`registerReflector`): registration order, flushed in it. */
function registry() {
  const entries: Entry[] = [];
  return {
    register(def: { name: string; always?: boolean; flush: () => void }): () => void {
      const entry: Entry = {
        name: def.name,
        always: def.always === true,
        flush: def.flush,
        live: true,
      };
      entries.push(entry);
      return () => {
        entry.live = false;
      };
    },
    names: () => entries.filter((entry) => entry.live).map((entry) => entry.name),
    always: (name: string) => entries.find((entry) => entry.live && entry.name === name)?.always,
    flushAll: () => {
      for (const entry of entries.filter((one) => one.live)) entry.flush();
    },
  };
}

/** The layer as placement sees it, and what it was told. */
type FakeLayer = AtWorkLayer & { shown: AtWorkScene[]; dropped: number; leaving: boolean };

/** A layer that says what it was shown, busy while a test says so: only the four doors placement uses. */
function fakeLayer(): FakeLayer {
  const layer = {
    shown: [] as AtWorkScene[],
    dropped: 0,
    leaving: false,
    show(scene: AtWorkScene) {
      layer.shown.push(scene);
    },
    drawing: (): readonly string[] => [],
    busy: (): boolean => layer.leaving,
    drop() {
      layer.dropped += 1;
    },
  } satisfies Partial<AtWorkLayer> & Omit<FakeLayer, keyof AtWorkLayer>;
  return layer as unknown as FakeLayer;
}

const agent = (run: string): Record<string, unknown> => ({
  run,
  handle: `${run} in vibe-field`,
  agent: "agent",
  state: "reading",
  since: 1,
});

const marked = (...keys: string[]): ObjectsPresenceSnapshot => ({
  objects: keys.map((key) => ({
    ref: `vf:obj/${key.padEnd(8, "0").slice(0, 8)}`,
    docId: "doc-1",
    key,
    agents: [agent(`run-${key}`)] as ObjectsPresenceSnapshot["objects"][number]["agents"],
  })),
});

/** A stage that mounts desks as the product does: ICE's compose first, then `onReady`'s publish. */
function stage(over: Partial<AtWorkDeskReads> = {}) {
  const reg = registry();
  let asleep = false;
  let clock = 0;
  let hidden = false;
  let chosen: readonly Entity[] = [];
  let anchorNow: SelectionAnchor | null = null;
  const engine = {
    engine: {
      registerReflector: reg.register,
      frame: { sleepStats: () => ({ asleep }) },
    },
  };
  let desk: MountedDesk | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: MountedDesk | null): void => {
    desk = next;
    for (const fn of [...listeners]) fn();
  };
  const store = createAtWorkStore();
  const layer = fakeLayer();
  const later: (() => void)[] = [];
  const reflector = createAtWorkReflector({
    layer,
    now: () => clock,
    store,
    current: () => desk,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    readsOf: () => readsOf({ selection: () => chosen, ...over }),
    later: (fn) => {
      later.push(fn);
    },
    hidden: () => hidden,
  });
  let composes = 0;
  /** ICE's `<Desk>` makes a mount: its compose reflector, then the stage's `onReady` publishes it */
  const mount = (): (() => void) => {
    composes += 1;
    const off = reg.register({ name: `desk.compose#${composes}`, always: true, flush: () => {} });
    const handle = { selection: { anchor: () => anchorNow } };
    publish({ engine, handle, docId: "doc-1", theme: "light" } as unknown as MountedDesk);
    return () => {
      publish(null);
      off();
    };
  };
  return {
    reg,
    store,
    layer,
    reflector,
    mount,
    later,
    sleep: (now: boolean) => {
      asleep = now;
    },
    at: (ms: number) => {
      clock = ms;
    },
    hide: (now: boolean) => {
      hidden = now;
    },
    select: (entities: readonly Entity[], next: SelectionAnchor | null) => {
      chosen = entities;
      anchorNow = next;
    },
  };
}

describe("the reflector's registration", () => {
  it("is registered from the desk's publish, AFTER the compose ICE registered for that mount, and again on a remount", () => {
    const s = stage();
    const off = s.reflector.attach();
    s.store.publish("doc-1", marked("k1"));
    const unmount = s.mount();
    expect(s.reg.names()).toEqual(["desk.compose#1", AT_WORK_REFLECTOR]);
    expect(s.reg.always(AT_WORK_REFLECTOR)).toBe(true);
    // a Reload: the old mount goes, ICE registers the new compose, onReady publishes the new desk
    unmount();
    expect(s.layer.dropped).toBe(1);
    s.mount();
    expect(s.reg.names()).toEqual(["desk.compose#2", AT_WORK_REFLECTOR]);
    expect(s.reflector.record().registrations).toBe(2);
    off();
    expect(s.reg.names()).toEqual(["desk.compose#2"]);
  });

  it("flushes in the same pass after the compose, and hands the layer the board and the placements", () => {
    const s = stage();
    s.reflector.attach();
    s.mount();
    s.store.publish("doc-1", marked("k1", "gone"));
    s.layer.shown.length = 0;
    s.reg.flushAll();
    expect(s.layer.shown).toHaveLength(1);
    const scene = s.layer.shown[0];
    expect(scene?.board.docId).toBe("doc-1");
    expect(scene?.placed.map((p) => p.key)).toEqual(["k1"]);
    expect(scene?.zoom).toBe(2);
    expect(scene?.pencil).toBe(AT_WORK_NO_PENCIL);
    expect(scene?.theme).toBe("light");
    expect(s.reflector.record().flushes).toBe(1);
  });

  it("hands the layer the object in hand's silhouette as the cover, and none with nothing in hand (2026-11-24)", () => {
    const hand = { cx: 500, cy: 400, hx: 200, hy: 100, angle: 0, r: 10 };
    const s = stage({
      inHand: () => e(1),
      handOn: (entity) => entity === e(1),
      heldFrame: () => hand,
    });
    s.reflector.attach();
    s.mount();
    s.store.publish("doc-1", marked("k1", "k2"));
    s.layer.shown.length = 0;
    s.reg.flushAll();
    const scene = s.layer.shown[0];
    expect(scene?.hand).toEqual(hand);
    expect(scene?.placed.find((p) => p.key === "k2")?.dimmed).toBe(true);
    const bare = stage();
    bare.reflector.attach();
    bare.mount();
    bare.store.publish("doc-1", marked("k1"));
    bare.layer.shown.length = 0;
    bare.reg.flushAll();
    expect(bare.layer.shown[0]?.hand).toBeNull();
  });

  it("hands the layer the landing frame as the cover while the hand carries the object home (2026-11-24)", () => {
    const landing = { cx: 420, cy: 330, hx: 150, hy: 75, angle: 0, r: 7 };
    const s = stage({
      inHand: () => undefined,
      carried: () => e(1),
      heldFrame: (entity) => (entity === e(1) ? landing : null),
    });
    s.reflector.attach();
    s.mount();
    s.store.publish("doc-1", marked("k1", "k2"));
    s.layer.shown.length = 0;
    s.reg.flushAll();
    const scene = s.layer.shown[0];
    expect(scene?.hand).toEqual(landing);
    expect(scene?.placed.find((p) => p.key === "k1")?.held).toBe(true);
    expect(scene?.placed.find((p) => p.key === "k2")?.held).toBe(false);
  });

  it("is not registered at all with no mark on the board — nothing flushes at rest for the marks", () => {
    const s = stage();
    s.reflector.attach();
    s.mount();
    expect(s.reg.names()).toEqual(["desk.compose#1"]);
    s.store.publish("doc-1", marked("k1"));
    expect(s.reg.names()).toEqual(["desk.compose#1", AT_WORK_REFLECTOR]);
    s.store.clear();
    expect(s.reg.names()).toEqual(["desk.compose#1"]);
    expect(s.reflector.record().registered).toBe(false);
  });

  it("stays while a mark still leaves, and goes after the pass in which the last one left", () => {
    const s = stage();
    s.reflector.attach();
    s.mount();
    s.store.publish("doc-1", marked("k1"));
    s.layer.leaving = true;
    s.store.publish("doc-1", marked());
    expect(s.reg.names()).toEqual(["desk.compose#1", AT_WORK_REFLECTOR]);
    s.reg.flushAll();
    expect(s.later).toHaveLength(0);
    s.layer.leaving = false;
    s.reg.flushAll();
    // never inside the registry's own walk: after it
    expect(s.reg.names()).toEqual(["desk.compose#1", AT_WORK_REFLECTOR]);
    for (const fn of s.later.splice(0)) fn();
    expect(s.reg.names()).toEqual(["desk.compose#1"]);
  });

  it("places a board change at once while the desk sleeps, and never wakes it (M5)", () => {
    const s = stage();
    s.reflector.attach();
    s.mount();
    s.sleep(true);
    s.store.publish("doc-1", marked("k1"));
    expect(s.reflector.record().direct).toBe(1);
    expect(s.layer.shown.at(-1)?.placed.map((p) => p.key)).toEqual(["k1"]);
    // awake, the next flush places it instead
    s.sleep(false);
    s.store.publish("doc-1", marked("k1", "k2"));
    expect(s.reflector.record().direct).toBe(1);
  });

  it("restarts the lock-on band when the selection moves to another object, one for one", () => {
    const s = stage();
    s.reflector.attach();
    s.mount();
    s.store.publish("doc-1", marked("k1", "k2"));
    const travel = (): number | undefined => s.layer.shown.at(-1)?.pencil.turn[3];
    const arriving = AT_WORK_PENCIL.arrive * Math.SQRT2;
    s.select([e(1)], anchor(1, { x0: 10, y0: 20, x1: 110, y1: 80 }));
    s.at(1_000);
    s.reg.flushAll();
    expect(travel()).toBeCloseTo(arriving, 12);
    s.at(1_300);
    s.reg.flushAll();
    expect(travel()).toBe(0);
    // another object, still one: ICE's brackets lock on again, so the band is kept the whole arrival wide again
    s.select([e(2)], anchor(1, { x0: 200, y0: 20, x1: 300, y1: 80 }));
    s.at(1_400);
    s.reg.flushAll();
    expect(travel()).toBeCloseTo(arriving, 12);
    s.at(1_580);
    s.reg.flushAll();
    expect(travel()).toBe(0);
  });

  it("places nothing while the layer stands hidden, and the desk as it stands when the verdict lifts", () => {
    const s = stage();
    s.reflector.attach();
    s.mount();
    s.store.publish("doc-1", marked("k1"));
    s.hide(true);
    s.layer.shown.length = 0;
    s.reg.flushAll();
    expect(s.reflector.record().flushes).toBe(1);
    expect(s.layer.shown).toHaveLength(0);
    // a board change while hidden and asleep: still nothing placed
    s.sleep(true);
    s.store.publish("doc-1", marked("k1", "k2"));
    expect(s.layer.shown).toHaveLength(0);
    expect(s.reflector.record().direct).toBe(0);
    // lifted: placed at once, outside a step
    s.hide(false);
    s.reflector.refresh();
    expect(s.reflector.record().direct).toBe(1);
    expect(s.layer.shown.at(-1)?.placed.map((p) => p.key)).toEqual(["k1", "k2"]);
  });

  it("refreshes nothing while no mark stands on the board", () => {
    const s = stage();
    s.reflector.attach();
    s.mount();
    s.reflector.refresh();
    expect(s.layer.shown).toHaveLength(0);
    expect(s.reflector.record().direct).toBe(0);
  });
});
