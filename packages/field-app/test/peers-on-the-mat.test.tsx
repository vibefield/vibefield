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
  Not,
  PrefabId,
  PresenceCursor,
  PresencePeer,
  type PresenceSession,
} from "@vibecook/ice";
import { MINIMAT_TYPE } from "@vibecook/ice/desk/objects";
import { EngineProvider } from "@vibecook/ice/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { PeersOnTheMat, peersRenders } from "../src/field/desk/peers/PeersOnTheMat";
import {
  attachPeerFacet,
  canvasKey,
  PeerWhere,
  peerFacetSent,
  resetPeerFacetForTest,
} from "../src/field/desk/peers/peer-facet";
import {
  arrowBoxAt,
  nextIdleAt,
  PEER_ARROW_PATH,
  PEERS,
  peerHidden,
  peerLabel,
  peersHidden,
} from "../src/field/desk/peers/peers-model";
import { createPeersController, peersRecord } from "../src/field/desk/peers/peers-reflector";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import { resetActiveViewForTest } from "../src/frame/view-state";
import { type FieldHost, setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const remotesQ = defineQuery([PresencePeer, Not(Local)]);

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.reverse()) fn();
  cleanups = [];
  resetPeerFacetForTest();
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
    const at = { x: 1, y: 2 };
    expect(peerHidden({ cursor: null, where: null, movedAt: 9_000 }, here)).toBe("no-pointer");
    expect(
      peerHidden({ cursor: at, where: { away: true, canvas: "" }, movedAt: 9_000 }, here),
    ).toBe("away");
    expect(
      peerHidden({ cursor: at, where: { away: false, canvas: "k1" }, movedAt: 9_000 }, here),
    ).toBe("canvas");
    // a peer whose build sends no facet: in its window, on the root — drawn on the root, hidden inside a container
    expect(peerHidden({ cursor: at, where: null, movedAt: 9_000 }, here)).toBeNull();
    expect(peerHidden({ cursor: at, where: null, movedAt: 9_000 }, { ...here, canvas: "k1" })).toBe(
      "canvas",
    );
    expect(peerHidden({ cursor: at, where: null, movedAt: 2_001 }, here)).toBeNull(); // 7999 ms
    expect(peerHidden({ cursor: at, where: null, movedAt: 2_000 }, here)).toBe("idle"); // 8000 ms
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

describe("the facet — this window's pointer, said to its peers (the interim of ICE ask I42)", () => {
  const facetOf = (ce: CanvasEngine) => {
    const local = ce.docs.presence()?.localPeer;
    return local === undefined ? undefined : ce.world.get(local, PeerWhere);
  };

  it("says in its window, on the root, ONCE — and nothing more while nothing moves", async () => {
    const ce = await host();
    cleanups.push(
      attachPeerFacet({
        ce,
        covered: () => false,
        subscribeCovered: () => () => {},
        doc: document,
      }),
    );
    expect(facetOf(ce)).toMatchObject({ away: false, canvas: "" });
    for (let i = 0; i < 5; i++) tick(ce);
    expect(peerFacetSent()).toMatchObject({ away: false, canvas: "", left: false, writes: 1 });
  });

  it("says AWAY at once when the pointer leaves the window, and back when it is over the page again", async () => {
    const ce = await host();
    cleanups.push(
      attachPeerFacet({
        ce,
        covered: () => false,
        subscribeCovered: () => () => {},
        doc: document,
      }),
    );
    // a pointerout with nowhere to go (relatedTarget null): the pointer left the window — no frame asked for
    document.body.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: null }),
    );
    expect(facetOf(ce)).toMatchObject({ away: true });
    expect(peerFacetSent()).toMatchObject({ away: true, left: true, writes: 2 });
    // a pointerout to another element of the page is not leaving
    document.body.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: null }),
    );
    expect(peerFacetSent()?.writes).toBe(2);
    document.body.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(facetOf(ce)).toMatchObject({ away: false });
    expect(peerFacetSent()).toMatchObject({ left: false, writes: 3 });
  });

  it("says AWAY while the window's view covers its canvas — the pointer is over Godview, not the desk", async () => {
    const ce = await host();
    let covered = false;
    const listeners = new Set<() => void>();
    cleanups.push(
      attachPeerFacet({
        ce,
        covered: () => covered,
        subscribeCovered: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        doc: document,
      }),
    );
    covered = true;
    for (const fn of listeners) fn();
    expect(facetOf(ce)).toMatchObject({ away: true });
    expect(peerFacetSent()).toMatchObject({ away: true, left: false });
    covered = false;
    for (const fn of listeners) fn();
    expect(facetOf(ce)).toMatchObject({ away: false });
  });

  it("says the CANVAS its x/y lie in — an entered mini mat's durable key, and the root again on the way out", async () => {
    const ce = await host(true);
    cleanups.push(
      attachPeerFacet({
        ce,
        covered: () => false,
        subscribeCovered: () => () => {},
        doc: document,
      }),
    );
    let minimat: Entity | undefined;
    ce.world.query(defineQuery([PrefabId])).each((b) => {
      for (const r of b)
        if (ce.world.get(b.entity(r), PrefabId)?.id === MINIMAT_TYPE) minimat = b.entity(r);
    });
    if (minimat === undefined) throw new Error("the seed laid no mini mat");
    // the container's capability lands at the equip flush, a frame after it projects
    for (let i = 0; i < 3; i++) tick(ce);
    const key = String(ce.docs.current()?.store.keyOf(minimat));
    ce.nav.enterContainer(minimat, { transition: "none" });
    tick(ce);
    expect(canvasKey(ce)).toBe(key);
    expect(facetOf(ce)).toMatchObject({ canvas: key });
    ce.nav.exitContainer({ transition: "none" });
    tick(ce);
    expect(facetOf(ce)).toMatchObject({ canvas: "" });
  });

  it("rides the presence wire: another window's session reads it on this window's peer", async () => {
    const ce = await host();
    cleanups.push(
      attachPeerFacet({ ce, covered: () => true, subscribeCovered: () => () => {}, doc: document }),
    );
    const out: Uint8Array[] = [];
    cleanups.push(ce.docs.presence()?.onOutbound((b) => out.push(b)) ?? (() => {}));
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
      seen = them === undefined ? undefined : other.world.get(them, PeerWhere);
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
    // a flush that moves nothing OF THIS PEER (its facet arrives, saying what was assumed) writes nothing to it
    ada.session.eph.addComponent(ada.session.localPeer, PeerWhere, { away: false, canvas: "" });
    await converge(ce, [ada], () => ce.world.get(them as Entity, PeerWhere) !== undefined);
    expect(ctl.record().flushes).toBeGreaterThan(flushes);
    expect(ctl.record().writes).toBe(writes);
    // the peer moves: placed where it went
    ada.session.eph
      .edit(ada.session.localPeer)
      .set(PresenceCursor, { x: 310, y: 205, device: "mouse" });
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
      .set(PresenceCursor, { x: 41, y: 60, device: "mouse" });
    await converge(ce, [bo], () => cursorOf(ce, them as Entity)?.x === 41);
    expect(el.dataset["hidden"]).toBeUndefined();
  });

  it("hides a peer whose pointer left its window, and one inside another canvas — by their own facet", async () => {
    const ce = await host();
    const cy = peer("🐼 Cy");
    cy.session.eph.addComponent(cy.session.localPeer, PresenceCursor, {
      x: 5,
      y: 5,
      device: "mouse",
    });
    cy.session.eph.addComponent(cy.session.localPeer, PeerWhere, { away: true, canvas: "" });
    await converge(ce, [cy], () =>
      remotes(ce).some((e) => ce.world.get(e, PeerWhere)?.away === true),
    );
    const { ctl } = controllerOn(ce);
    const [them] = remotes(ce);
    const el = document.createElement("div");
    cleanups.push(ctl.bind(them as Entity, el));
    expect(el.dataset["hidden"]).toBe("away");
    cy.session.eph.edit(cy.session.localPeer).set(PeerWhere, { away: false, canvas: "a-mini-mat" });
    await converge(ce, [cy], () => ce.world.get(them as Entity, PeerWhere)?.away === false);
    expect(el.dataset["hidden"]).toBe("canvas");
    cy.session.eph.edit(cy.session.localPeer).set(PeerWhere, { away: false, canvas: "" });
    await converge(ce, [cy], () => ce.world.get(them as Entity, PeerWhere)?.canvas === "");
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
    // …and this window's own pointer is said to be away from the desk while its view covers it
    expect(peerFacetSent()).toMatchObject({ away: true, left: false });
    await act(async () => sayView?.({ view: "canvas" }));
    expect(layer()?.hasAttribute("data-hidden")).toBe(false);
    expect(peerFacetSent()).toMatchObject({ away: false });
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
