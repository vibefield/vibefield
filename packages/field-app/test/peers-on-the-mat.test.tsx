// @vitest-environment happy-dom
/**
 * DK-16 — PEERS ON THE MAT (DESIGN.md §8 "Peers on the mat"; MC-D10 = DK-D23, R22; UA-D17, §2.8 I-1, I-4; R17 as amended
 * 13:40Z; ICE I26). Another person's pointer on the desk is VibeField's own cursor, ICE's off: WHERE — each peer's
 * `PresenceCursor` world x/y through this window's camera, in a reflector, on every frame that moved either; WHEN NOT — the
 * layer under a cover, while the board is out, while the desk does not draw; a peer with no pointer, a pointer that left
 * its window (or whose view covers its canvas), a peer inside another canvas, an idle peer after 8 s; THE ARROW 18 × 22 with
 * its tip at 2,2; THE LABEL a chip, the face first, then the name. The peers here are REAL presence sessions — ICE's own
 * `attachPresence` on worlds of their own — whose bytes reach the host's session as a lane hands them (`wire.apply`), core's
 * recipe: Loro's throttle runs on the wasm clock, so a room converges by short real waits, deadline-polled.
 * DK-17b (desk.6, ICE I42): the away and the canvas are ICE's own words on the cursor — `PresenceCursor.away` (the pointer
 * left the desk's host with nowhere to go, or the host said so) and `.canvas` (`presenceCanvasOf`) — and VibeField says
 * only its cover, through ICE's `setAway("cover")` at the presence's attach; the interim `vibefield.PeerWhere` facet is gone.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attachPresence,
  Camera,
  type CanvasEngine,
  createWorld,
  defineQuery,
  type Entity,
  Local,
  NO_MODS,
  Not,
  PrefabId,
  PresenceCursor,
  PresencePeer,
  type PresenceSession,
  presenceCanvasOf,
  Viewport,
} from "@vibecook/ice";
import { MINIMAT_TYPE } from "@vibecook/ice/desk/objects";
import { EngineProvider } from "@vibecook/ice/react";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { PeersOnTheMat, peersRenders } from "../src/field/desk/peers/PeersOnTheMat";
import {
  arrowBoxAt,
  nextIdleAt,
  PEER_ARROW_PATH,
  PEERS,
  peerHidden,
  peerLabel,
  peersHidden,
} from "../src/field/desk/peers/peers-model";
import {
  canvasHere,
  createPeersController,
  peersRecord,
} from "../src/field/desk/peers/peers-reflector";
import { attachDocumentPresence, COVER_AWAY } from "../src/field/document-presence";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import { resetActiveViewForTest } from "../src/frame/view-state";
import { type FieldHost, type FieldUserProfile, setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const remotesQ = defineQuery([PresencePeer, Not(Local)]);

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.reverse()) fn();
  cleanups = [];
  resetActiveViewForTest();
});

/** A field engine with a live document and its presence attached, as the window has it. */
async function host(seeded = false): Promise<CanvasEngine> {
  const ce = createFieldEngine(buildRegistry());
  cleanups.push(() => ce.dispose());
  const session = ce.docs.create();
  if (seeded) await seedField(ce, session, createDeskBlobStore());
  ce.docs.attachPresence({ name: "🐙 Host", color: "#68686b" });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  return ce;
}

interface Peer {
  readonly session: PresenceSession;
  readonly bytes: Uint8Array[];
}

/** Another window's presence: a session on a world of its own, its outbound bytes kept for the pump. */
function peer(name: string): Peer {
  const session = attachPresence(createWorld(), { name, color: "#68686b" });
  cleanups.push(() => session.detach());
  const bytes: Uint8Array[] = [];
  session.onOutbound((b) => bytes.push(b));
  return { session, bytes };
}

let clock = 0;
/** One frame of an engine, 16 ms on. */
const tick = (ce: CanvasEngine): void => {
  clock += 16;
  ce.step(clock);
};
/** Pump every peer's bytes into the host's wire and step it until `done` holds (or 3 s pass). */
async function converge(
  ce: CanvasEngine,
  peers: readonly Peer[],
  done: () => boolean,
): Promise<void> {
  const wire = ce.docs.presence()?.wire;
  if (wire === undefined) throw new Error("no presence session");
  const t0 = Date.now();
  while (Date.now() - t0 < 3_000) {
    for (const p of peers) for (const b of p.bytes.splice(0)) wire.apply(b);
    clock += 16;
    ce.step(clock);
    if (done()) return;
    await sleep(5);
  }
  throw new Error("the room did not converge");
}

const remotes = (ce: CanvasEngine): Entity[] => {
  const out: Entity[] = [];
  ce.world.query(remotesQ).each((b) => {
    for (const r of b) out.push(b.entity(r));
  });
  return out;
};
const cursorOf = (ce: CanvasEngine, e: Entity) => ce.world.get(e, PresenceCursor);

describe("the model — where a peer stands, and when it does not", () => {
  it("draws the arrow 18 × 22 with its tip at 2,2 — the page's drawing — and the label 14 right of, 18 below its box", () => {
    expect(PEERS.arrow).toEqual({ width: 18, height: 22, tipX: 2, tipY: 2 });
    expect(PEERS.label).toEqual({ left: 14, top: 18 });
    expect(PEER_ARROW_PATH).toBe("M2 2l13.5 11.2-6.4.6 3.7 6.9-2.6 1.3-3.7-7L2 19.6z");
    expect(PEERS.idleMs).toBe(8_000);
  });

  it("puts the arrow's tip on the pointer through this window's camera", () => {
    // world (100, 50) under a camera at (20, 10), zoom 2 → screen (160, 80): the box 2 up and left of it
    expect(arrowBoxAt({ x: 100, y: 50 }, { x: 20, y: 10, zoom: 2 })).toEqual({ x: 158, y: 78 });
    expect(arrowBoxAt({ x: 0, y: 0 }, { x: 0, y: 0, zoom: 1 })).toEqual({ x: -2, y: -2 });
  });

  it("hides the layer while the desk does not draw, then under a cover, then while the board is out — in that order", () => {
    expect(peersHidden({ drawing: true, covered: false, boardOut: false })).toBeNull();
    expect(peersHidden({ drawing: false, covered: true, boardOut: true })).toBe("desk");
    expect(peersHidden({ drawing: true, covered: true, boardOut: true })).toBe("cover");
    expect(peersHidden({ drawing: true, covered: false, boardOut: true })).toBe("board");
  });

  it("hides a peer with no pointer, one away, one in another canvas, and one idle 8 s — never sooner", () => {
    const here = { canvas: "", now: 10_000 };
    const at = { x: 1, y: 2, away: false, canvas: "" };
    expect(peerHidden({ cursor: null, movedAt: 9_000 }, here)).toBe("no-pointer");
    expect(peerHidden({ cursor: { ...at, away: true }, movedAt: 9_000 }, here)).toBe("away");
    expect(peerHidden({ cursor: { ...at, canvas: "k1" }, movedAt: 9_000 }, here)).toBe("canvas");
    // a peer whose build sends neither field reads as ICE's defaults — in its window, on the root: drawn on the root,
    // hidden inside a container
    expect(peerHidden({ cursor: at, movedAt: 9_000 }, here)).toBeNull();
    expect(peerHidden({ cursor: at, movedAt: 9_000 }, { ...here, canvas: "k1" })).toBe("canvas");
    // a peer in a keyless container of its own is never in this window's canvas, even this window's own keyless one
    expect(
      peerHidden(
        { cursor: { ...at, canvas: "~them/12" }, movedAt: 9_000 },
        { ...here, canvas: "~me/12" },
      ),
    ).toBe("canvas");
    expect(peerHidden({ cursor: at, movedAt: 2_001 }, here)).toBeNull(); // 7999 ms
    expect(peerHidden({ cursor: at, movedAt: 2_000 }, here)).toBe("idle"); // 8000 ms
  });

  it("reads the label as the presence name has it — the face first, then the name", () => {
    expect(peerLabel("🦊 James")).toBe("🦊 James");
    expect(peerLabel("  🦊 James  ")).toBe("🦊 James");
    expect(peerLabel(null)).toBe("");
  });

  it("falls the next idle verdict due at the earliest move + 8 s still to come", () => {
    expect(nextIdleAt([1_000, 4_000], 5_000)).toBe(9_000);
    expect(nextIdleAt([1_000, 4_000], 12_000)).toBeNull();
    expect(nextIdleAt([], 0)).toBeNull();
  });
});

describe("this window's word — ICE's cursor says away and canvas (I42); VibeField says only its cover", () => {
  /** This window's own cursor as its presence last wrote it (ICE's publish: change-only, between steps). */
  const saidOf = (ce: CanvasEngine) => {
    const local = ce.docs.presence()?.localPeer;
    return local === undefined ? undefined : ce.world.get(local, PresenceCursor);
  };
  /** The desk adapter's facts, as it enqueues them: a mouse move at a view point, or the pointer's `leave`. */
  const pointer = (ce: CanvasEngine, kind: "move" | "leave", x = 300, y = 200): void => {
    ce.stack.queue.enqueue({
      kind,
      pointerId: "mouse",
      device: "mouse",
      screenX: x,
      screenY: y,
      buttons: 0,
      mods: NO_MODS,
    });
  };
  /** A doc lane that carries nothing — the presence's own bytes are read at its session. */
  const quietLane = {
    onPresence: () => () => {},
    sendPresence: () => {},
  } as unknown as DocLaneClient;
  const who = {
    userId: "usr_host",
    fuid: 1,
    name: "Host",
    face: { emoji: "🐙" },
    resident: true,
    onboarded: true,
  } as FieldUserProfile;
  /** A window's engine with its presence attached by VibeField's own `attachDocumentPresence`, covered as the seam says. */
  function windowWith(cover: {
    covered: () => boolean;
    subscribe: (fn: () => void) => () => void;
  }) {
    const ce = createFieldEngine(buildRegistry());
    cleanups.push(() => ce.dispose());
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    cleanups.push(
      attachDocumentPresence({ ce, lane: quietLane, profile: who, docId: "doc_said", cover }),
    );
    return ce;
  }
  const never = { covered: () => false, subscribe: () => () => {} };

  it("says nothing of its own beside ICE's cursor: the pointer's x/y, in its window, on the root — written once", async () => {
    const ce = windowWith(never);
    pointer(ce, "move");
    tick(ce);
    tick(ce); // the pointer's world point lands the tick after it spawns (ICE's own)
    expect(saidOf(ce)).toMatchObject({ x: 300, y: 200, away: false, canvas: "" });
    expect(ce.docs.presence()?.away()).toBeNull();
    // ICE's facet alone rides the local peer — no facet of VibeField's (the interim `vibefield.PeerWhere` is gone)
    const local = ce.docs.presence()?.localPeer as Entity;
    expect(
      ce.world
        .componentsOf(local)
        .map((c) => c.name)
        .filter((n) => n.startsWith("vibefield.")),
    ).toEqual([]);
  });

  it("leaves the pointer's leave to ICE: its adapter's `leave` sends it away in one step, the next move back — and a document's pointerout says nothing", async () => {
    const ce = windowWith(never);
    pointer(ce, "move");
    tick(ce);
    // what DK-16's facet listened for — a pointerout with nowhere to go — moves nothing now: the desk adapter's leave is the one
    document.body.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: null }),
    );
    tick(ce);
    expect(saidOf(ce)).toMatchObject({ away: false });
    pointer(ce, "leave");
    tick(ce);
    expect(saidOf(ce)).toMatchObject({ away: true, x: 300, y: 200 });
    expect(ce.docs.presence()?.away()).toBeNull(); // the pointer's own, not the host's word
    pointer(ce, "move", 310, 200);
    tick(ce);
    expect(saidOf(ce)).toMatchObject({ away: false, x: 310 });
  });

  it("says AWAY while the window's view covers its canvas — ICE's `setAway(\"cover\")`, between frames — and back as it lowers", async () => {
    let covered = false;
    const listeners = new Set<() => void>();
    const ce = windowWith({
      covered: () => covered,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    });
    pointer(ce, "move");
    tick(ce);
    expect(saidOf(ce)).toMatchObject({ away: false });
    covered = true;
    for (const fn of listeners) fn();
    expect(ce.docs.presence()?.away()).toBe(COVER_AWAY);
    // no frame asked for: ICE publishes the host's away a microtask after the call, so a parked desk says it too
    await Promise.resolve();
    expect(saidOf(ce)).toMatchObject({ away: true });
    covered = false;
    for (const fn of listeners) fn();
    await Promise.resolve();
    expect(ce.docs.presence()?.away()).toBeNull();
    expect(saidOf(ce)).toMatchObject({ away: false });
  });

  it("says AWAY at once for a presence attached under a standing cover — the reason is said at the attach", () => {
    const ce = windowWith({ covered: () => true, subscribe: () => () => {} });
    expect(ce.docs.presence()?.away()).toBe(COVER_AWAY);
    pointer(ce, "move");
    tick(ce);
    expect(saidOf(ce)).toMatchObject({ away: true });
  });

  it("names its canvas as ICE names a peer's — an entered mini mat's durable key, a keyless container never \"\" — and the root again on the way out", async () => {
    const ce = await host(true);
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
    let minimat: Entity | undefined;
    ce.world.query(defineQuery([PrefabId])).each((b) => {
      for (const r of b)
        if (ce.world.get(b.entity(r), PrefabId)?.id === MINIMAT_TYPE) minimat = b.entity(r);
    });
    if (minimat === undefined) throw new Error("the seed laid no mini mat");
    // the container's capability lands at the equip flush, a frame after it projects
    for (let i = 0; i < 3; i++) tick(ce);
    pointer(ce, "move");
    tick(ce);
    expect(canvasHere(ce)).toBe("");
    const key = ce.docs.current()?.store.keyOf(minimat);
    expect(typeof key).toBe("string");
    ce.nav.enterContainer(minimat, { transition: "none" });
    tick(ce);
    // this window's canvas and the canvas its own cursor says are ONE name — what a peer's is compared with
    expect(canvasHere(ce)).toBe(key);
    expect(saidOf(ce)).toMatchObject({ canvas: key });
    // a container no document keys is named `~<peerId>/<entity>` — never "", never another peer's (VibeField's own
    // `runtime:<frame>` retired with the facet: both sides must name a canvas the same way, and this is ICE's)
    const peerId = ce.docs.presence()?.peerId as string;
    expect(presenceCanvasOf(ce.world, peerId, () => undefined)).toBe(`~${peerId}/${minimat}`);
    ce.nav.exitContainer({ transition: "none" });
    tick(ce);
    expect(canvasHere(ce)).toBe("");
    expect(saidOf(ce)).toMatchObject({ canvas: "" });
  });

  it("rides the presence wire: another window reads this window's cover on its cursor", async () => {
    const ce = windowWith({ covered: () => true, subscribe: () => () => {} });
    const out: Uint8Array[] = [];
    cleanups.push(ce.docs.presence()?.onOutbound((b) => out.push(b)) ?? (() => {}));
    pointer(ce, "move");
    tick(ce);
    const other = createFieldEngine(buildRegistry());
    cleanups.push(() => other.dispose());
    other.docs.create();
    other.docs.attachPresence({ name: "🦊 Peer", color: "#68686b" });
    const wire = other.docs.presence()?.wire;
    const t0 = Date.now();
    let seen: { away: boolean; canvas: string | null } | undefined;
    while (seen === undefined && Date.now() - t0 < 3_000) {
      for (const b of out.splice(0)) wire?.apply(b);
      tick(ce);
      other.step(clock);
      const [them] = remotes(other);
      seen = them === undefined ? undefined : other.world.get(them, PresenceCursor);
      await sleep(5);
    }
    expect(seen).toMatchObject({ away: true, canvas: "" });
  });
});

describe("the controller — each peer placed through the camera in a reflector, its verdict written, never a render", () => {
  /** A controller on the host with a fake clock, and its timers kept for the test to fire. */
  function controllerOn(ce: CanvasEngine) {
    let now = 1_000;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let next = 0;
    const ctl = createPeersController({
      ce,
      now: () => now,
      setTimer: (fn, ms) => {
        next += 1;
        timers.set(next, { fn, at: now + ms });
        return next;
      },
      clearTimer: (t) => timers.delete(t as number),
    });
    cleanups.push(ctl.attach());
    return {
      ctl,
      advance(ms: number) {
        now += ms;
        for (const [id, t] of [...timers]) {
          if (t.at <= now) {
            timers.delete(id);
            t.fn();
          }
        }
      },
      timers,
    };
  }

  it("places a peer's arrow tip on its pointer through the host's camera, and again when the camera moves", async () => {
    const ce = await host();
    const ada = peer("🦊 Ada");
    ada.session.eph.addComponent(ada.session.localPeer, PresenceCursor, {
      x: 300,
      y: 200,
      device: "mouse",
      away: false,
      canvas: "",
    });
    await converge(ce, [ada], () => remotes(ce).some((e) => cursorOf(ce, e) !== undefined));
    const { ctl } = controllerOn(ce);
    const [them] = remotes(ce);
    const el = document.createElement("div");
    cleanups.push(ctl.bind(them as Entity, el));
    expect(el.style.transform).toBe("translate(298px, 198px)");
    expect(el.dataset["hidden"]).toBeUndefined();
    expect(peersRecord()?.peers[0]).toMatchObject({ hidden: null, box: { x: 298, y: 198 } });
    tick(ce); // the reflector's first flush paints whatever it observes: spent here, so the next is the camera's own
    const before = ctl.record().flushes;
    // the camera pans and zooms: the reflector hears the camera and places it again — world (300,200) at (−100, 50) × 2
    ce.world.setResource(Camera, { x: -100, y: 50, zoom: 2, gesturing: false });
    tick(ce);
    expect(ctl.record().flushes).toBe(before + 1);
    expect(el.style.transform).toBe("translate(798px, 298px)");
    const { writes, flushes } = ctl.record();
    // a frame that moved nothing flushes nothing and writes nothing
    tick(ce);
    expect(ctl.record()).toMatchObject({ writes, flushes });
    // a flush that moves nothing OF THIS PEER (another peer's pointer arrives, unbound here) writes nothing to it
    const eve = peer("🦉 Eve");
    eve.session.eph.addComponent(eve.session.localPeer, PresenceCursor, {
      x: 9,
      y: 9,
      device: "mouse",
      away: false,
      canvas: "",
    });
    await converge(
      ce,
      [ada, eve],
      () => remotes(ce).length === 2 && remotes(ce).every((e) => cursorOf(ce, e) !== undefined),
    );
    expect(ctl.record().flushes).toBeGreaterThan(flushes);
    expect(ctl.record().writes).toBe(writes);
    // the peer moves: placed where it went
    ada.session.eph
      .edit(ada.session.localPeer)
      .set(PresenceCursor, { x: 310, y: 205, device: "mouse", away: false, canvas: "" });
    await converge(ce, [ada], () => cursorOf(ce, them as Entity)?.x === 310);
    expect(el.style.transform).toBe("translate(818px, 308px)");
  });

  it("hides an idle peer 8 s after its last move — by its timer, with no frame — and draws it again when it moves", async () => {
    const ce = await host();
    const bo = peer("🐻 Bo");
    bo.session.eph.addComponent(bo.session.localPeer, PresenceCursor, {
      x: 40,
      y: 60,
      device: "mouse",
      away: false,
      canvas: "",
    });
    await converge(ce, [bo], () => remotes(ce).some((e) => cursorOf(ce, e) !== undefined));
    const { ctl, advance } = controllerOn(ce);
    const [them] = remotes(ce);
    const el = document.createElement("div");
    cleanups.push(ctl.bind(them as Entity, el));
    advance(7_999);
    expect(el.dataset["hidden"]).toBeUndefined();
    advance(1);
    expect(el.dataset["hidden"]).toBe("idle");
    expect(ctl.record().idles).toBe(1);
    bo.session.eph
      .edit(bo.session.localPeer)
      .set(PresenceCursor, { x: 41, y: 60, device: "mouse", away: false, canvas: "" });
    await converge(ce, [bo], () => cursorOf(ce, them as Entity)?.x === 41);
    expect(el.dataset["hidden"]).toBeUndefined();
  });

  it("hides a peer whose pointer left its window, and one inside another canvas — by ICE's own words on its cursor", async () => {
    const ce = await host();
    const cy = peer("🐼 Cy");
    // Cy's cursor as Cy's own publish writes it (I42): away — its pointer out of its desk's host, or its view covered
    cy.session.eph.addComponent(cy.session.localPeer, PresenceCursor, {
      x: 5,
      y: 5,
      device: "mouse",
      away: true,
      canvas: "",
    });
    await converge(ce, [cy], () => remotes(ce).some((e) => cursorOf(ce, e)?.away === true));
    const { ctl } = controllerOn(ce);
    const [them] = remotes(ce);
    const el = document.createElement("div");
    cleanups.push(ctl.bind(them as Entity, el));
    expect(el.dataset["hidden"]).toBe("away");
    // back, but inside a mini mat this window does not show: its x/y lie in that container's frame
    cy.session.eph
      .edit(cy.session.localPeer)
      .set(PresenceCursor, { x: 5, y: 5, device: "mouse", away: false, canvas: "a-mini-mat" });
    await converge(ce, [cy], () => cursorOf(ce, them as Entity)?.away === false);
    expect(el.dataset["hidden"]).toBe("canvas");
    expect(peersRecord()?.peers[0]?.cursor).toMatchObject({ away: false, canvas: "a-mini-mat" });
    cy.session.eph
      .edit(cy.session.localPeer)
      .set(PresenceCursor, { x: 5, y: 5, device: "mouse", away: false, canvas: "" });
    await converge(ce, [cy], () => cursorOf(ce, them as Entity)?.canvas === "");
    expect(el.dataset["hidden"]).toBeUndefined();
  });

  it("says a peer with no pointer yet is not drawn, and keeps a peer's idle clock when React hands it a new element", async () => {
    const ce = await host();
    const dee = peer("🐸 Dee");
    await converge(ce, [dee], () => remotes(ce).length === 1);
    const { ctl, advance } = controllerOn(ce);
    const [them] = remotes(ce);
    const first = document.createElement("div");
    const unbind = ctl.bind(them as Entity, first);
    expect(first.dataset["hidden"]).toBe("no-pointer");
    dee.session.eph.addComponent(dee.session.localPeer, PresenceCursor, {
      x: 9,
      y: 9,
      device: "mouse",
      away: false,
      canvas: "",
    });
    await converge(ce, [dee], () => cursorOf(ce, them as Entity) !== undefined);
    expect(first.dataset["hidden"]).toBeUndefined();
    advance(5_000);
    // a new element for the same peer: written afresh, its 8 s still counted from the last move
    const second = document.createElement("div");
    cleanups.push(ctl.bind(them as Entity, second));
    unbind();
    expect(second.style.transform).toBe("translate(7px, 7px)");
    advance(3_000);
    expect(second.dataset["hidden"]).toBe("idle");
  });
});

describe("<PeersOnTheMat> — the roster's names, placed by the reflector", () => {
  let mount: HTMLDivElement;
  let root: Root;
  /** The host's view, as main says it (the view store's one source). */
  let sayView: ((state: { view: "canvas" | "godview" | "history" }) => void) | null = null;
  beforeEach(() => {
    resetActiveViewForTest();
    setHost({
      platform: "darwin",
      view: {
        set: (view: "canvas" | "godview" | "history") => Promise.resolve({ view }),
        onState: (handler: (state: { view: "canvas" | "godview" | "history" }) => void) => {
          sayView = handler;
          return () => {
            sayView = null;
          };
        },
      },
    } as unknown as FieldHost);
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    mount.remove();
  });

  it("draws one arrow and chip per peer — the face first, then the name — and moves them without a render", async () => {
    const ce = await host();
    const ada = peer("🦊 Ada");
    ada.session.eph.addComponent(ada.session.localPeer, PresenceCursor, {
      x: 120,
      y: 80,
      device: "mouse",
      away: false,
      canvas: "",
    });
    await converge(ce, [ada], () => remotes(ce).some((e) => cursorOf(ce, e) !== undefined));
    await act(async () =>
      root.render(
        createElement(
          EngineProvider,
          { engine: ce },
          createElement(PeersOnTheMat, { drawing: true }),
        ),
      ),
    );
    const layer = mount.querySelector(".vf-peers");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.hasAttribute("data-hidden")).toBe(false);
    const cursors = mount.querySelectorAll(".vf-peer");
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.querySelector(".vf-peer__chip")?.textContent).toBe("🦊 Ada");
    expect(cursors[0]?.querySelectorAll("svg")).toHaveLength(1);
    expect(cursors[0]?.querySelector("path")?.getAttribute("d")).toBe(PEER_ARROW_PATH);
    expect((cursors[0] as HTMLElement).style.transform).toBe("translate(118px, 78px)");
    expect(ce.engine.reflectorNames()).toContain("vibefield.peers");
    expect(ce.world.isReactiveEnabled).toBe(true); // its observers arm the world: ICE draws no cursors to arm it
    const renders = peersRenders();
    for (let i = 1; i <= 10; i++) {
      ada.session.eph.edit(ada.session.localPeer).set(PresenceCursor, {
        x: 120 + i,
        y: 80,
        device: "mouse",
        away: false,
        canvas: "",
      });
      await converge(ce, [ada], () => remotes(ce).some((e) => cursorOf(ce, e)?.x === 120 + i));
    }
    expect((cursors[0] as HTMLElement).style.transform).toBe("translate(128px, 78px)");
    expect(peersRenders()).toBe(renders); // placed every move, rendered never
  });

  it("stands the whole layer hidden under a cover — the desk is a still — and draws it again on the canvas", async () => {
    const ce = await host();
    await act(async () =>
      root.render(
        createElement(
          EngineProvider,
          { engine: ce },
          createElement(PeersOnTheMat, { drawing: true }),
        ),
      ),
    );
    const layer = (): Element | null => mount.querySelector(".vf-peers");
    expect(layer()?.hasAttribute("data-hidden")).toBe(false);
    await act(async () => sayView?.({ view: "godview" }));
    expect(layer()?.getAttribute("data-hidden")).toBe("cover");
    expect(peersRecord()?.layer).toBe("cover");
    // (this window's own pointer is said away under the cover by its presence's attach — `document-presence.ts`)
    await act(async () => sayView?.({ view: "canvas" }));
    expect(layer()?.hasAttribute("data-hidden")).toBe(false);
  });

  it("stands the whole layer hidden while the desk does not draw", async () => {
    const ce = await host();
    await act(async () =>
      root.render(
        createElement(
          EngineProvider,
          { engine: ce },
          createElement(PeersOnTheMat, { drawing: false }),
        ),
      ),
    );
    expect(mount.querySelector(".vf-peers")?.getAttribute("data-hidden")).toBe("desk");
    expect(peersRecord()?.layer).toBe("desk");
  });
});

describe("the look — the canon's numbers, in the stylesheet (DESIGN.md §8 'Peers on the mat', §5 the line's glass)", () => {
  const css = readFileSync(join(process.cwd(), "src/field/desk/peers/peers.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const rule = (selector: string): string =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => (m[1] ?? "").trim() === selector)
      .map((m) => m[2] ?? "")
      .join("\n");

  it("dresses the label as a chip on the line's glass: 14 right, 18 below, 22 tall, full round, padded 0 9 0 7, 11.5/500", () => {
    const chip = rule(".vf-peer__chip");
    for (const decl of [
      "top: 18px;",
      "left: 14px;",
      "height: 22px;",
      "padding: 0 9px 0 7px;",
      "border-radius: 999px;",
      "color: var(--vf-text-primary);",
      "font: 500 11.5px / 1 var(--vf-font-sans);",
      "background: color-mix(in srgb, var(--vf-chrome-solid) 88%, transparent);",
      "backdrop-filter: blur(24px);",
    ])
      expect(chip).toContain(decl);
    expect(chip).toMatch(/0 0 0 1px var\(--vf-hairline\)/);
    // by night 94 %, the strong hairline, the 6 % top light
    const night = rule(".dark .vf-peer__chip");
    expect(night).toContain(
      "background: color-mix(in srgb, var(--vf-chrome-solid) 94%, transparent);",
    );
    expect(night).toMatch(/0 0 0 1px var\(--vf-hairline-strong\)/);
    expect(night).toContain("inset 0 1px 0 rgb(255 255 255 / 6%)");
    // never the peer's colour (I-1): the chip names no presence colour at all
    expect(chip + night).not.toMatch(/presence/);
  });

  it("draws the arrow in the presence ink on a 1.4 paper-white edge with a 0 1px 2px black/25 drop", () => {
    const path = rule(".vf-peer__arrow path");
    expect(path).toContain("fill: var(--vf-presence-ink);");
    expect(path).toContain("stroke: var(--vf-presence-edge);");
    expect(path).toContain("stroke-width: 1.4;");
    expect(rule(".vf-peer__arrow")).toContain("filter: drop-shadow(0 1px 2px rgb(0 0 0 / 25%));");
    const tokens = readFileSync(join(process.cwd(), "../design-kit/src/tokens.css"), "utf8");
    // one edge in both themes: paper white
    expect([...tokens.matchAll(/--vf-presence-edge:\s*([^;]+);/gu)].map((m) => m[1])).toEqual([
      "#ffffff",
    ]);
  });

  it("never takes a pointer, and stands hidden whole or one by one by its verdict", () => {
    expect(rule(".vf-peers")).toContain("pointer-events: none;");
    expect(rule(".vf-peers[data-hidden]")).toContain("visibility: hidden;");
    expect(rule(".vf-peer[data-hidden]")).toContain("visibility: hidden;");
  });
});
