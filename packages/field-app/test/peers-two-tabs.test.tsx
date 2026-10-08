// @vitest-environment happy-dom
/**
 * DK-16 — PEERS ON THE MAT, TWO TABS OVER FIELDD. Two desktops' presence rooms — fieldd's own `PresenceRoomRouter`, each
 * over a fake mesh that carries a lossy lane's bytes to the other desktop as the mesh's lanes do (opened by one, announced
 * `peerOpened` to the other, its bytes delivered to the lane the other claimed) — and on each desktop a WINDOW: a real field
 * engine on the board, its presence attached by VibeField's own `attachDocumentPresence` over a lane that publishes into its
 * desktop's room and hears that room's pushes (fieldd's doc lane does exactly this over its socket, `doc-lane.ts`), its
 * pointer's whereabouts said by `attachPeerFacet`, and the peers it sees placed by the reflector. Fieldd never parses the
 * bytes; what crosses is ICE's presence and VibeField's facet. Window A sees window B's pointer: its arrow's tip ON the
 * pointer through A's camera, its chip "🐙 Ada" — and hidden when B idles 8 s, leaves its window, or enters a mini mat.
 */
import {
  Camera,
  type CanvasEngine,
  defineQuery,
  type Entity,
  Local,
  Not,
  PresenceCursor,
  PresencePeer,
} from "@vibecook/ice";
import { PresenceRoomRouter } from "@vibefield/fieldd";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { afterEach, describe, expect, it } from "vitest";
import { attachPeerFacet } from "../src/field/desk/peers/peer-facet";
import { arrowBoxAt } from "../src/field/desk/peers/peers-model";
import { createPeersController } from "../src/field/desk/peers/peers-reflector";
import { attachDocumentPresence } from "../src/field/document-presence";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import type { FieldUserProfile } from "../src/host";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DOC = "doc_two_tabs";

let cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.reverse()) await fn();
  cleanups = [];
});

type LaneEvent = (payload: unknown, kind: "snapshot" | "delta") => void;

/** One desktop's fieldd presence plane over a fake mesh to its other desktop. */
class Desktop {
  other: Desktop | null = null;
  readonly router: PresenceRoomRouter;
  #emit: LaneEvent | null = null;
  readonly #handlers = new Map<number, (payload: Uint8Array) => void>();
  /** this desktop's outbound lanes → the lane id the other desktop claimed for each */
  readonly #outbound = new Map<number, number>();
  #nextLane: number;

  constructor(
    readonly id: string,
    laneBase: number,
  ) {
    this.#nextLane = laneBase;
    this.router = new PresenceRoomRouter({
      control: {
        open: async (req) => {
          const other = this.other;
          if (other === null) throw new Error("no mesh");
          this.#outbound.set(req.laneId, other.announce(this.id, req.docId));
        },
        close: async (laneId) => {
          this.#outbound.delete(laneId);
        },
        subscribe: async (onEvent) => {
          this.#emit = onEvent;
          return { lanes: [] };
        },
      },
      bytes: {
        send: (laneId, payload) => {
          const remote = this.#outbound.get(laneId);
          if (remote === undefined || this.other === null) return false;
          this.other.deliver(remote, payload);
          return true;
        },
        flush: async () => undefined,
        onLane: (laneId, handler) => this.#handlers.set(laneId, handler),
        offLane: (laneId) => this.#handlers.delete(laneId),
      },
      peers: async () => (this.other === null ? [] : [{ id: this.other.id, online: true }]),
      isSelfPeer: () => true, // one account: both desktops are the person's own
      allocateLaneId: () => this.#nextLane++,
    });
  }

  /** A lane the other desktop opened toward this one: announced, as the mesh announces it. */
  announce(from: string, docId: string): number {
    const laneId = this.#nextLane++;
    this.#emit?.(
      {
        kind: "peerOpened",
        laneId,
        peer: from,
        docId,
        inbound: true,
        protocol: "presence",
        class: "lossy",
      },
      "delta",
    );
    return laneId;
  }

  deliver(laneId: number, payload: Uint8Array): void {
    this.#handlers.get(laneId)?.(payload);
  }
}

/** A window's doc lane as fieldd serves it: its presence published into the desktop's room, the room's pushes heard. */
function laneOn(desktop: Desktop): Pick<DocLaneClient, "onPresence" | "sendPresence"> {
  const listeners = new Set<(payload: Uint8Array) => void>();
  const room = desktop.router.attach(DOC, (payload) => {
    for (const fn of [...listeners]) fn(payload);
  });
  cleanups.push(() => room.close());
  return {
    onPresence(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    sendPresence(payload) {
      room.publish(payload);
    },
  };
}

const profile = (name: string, emoji: string): FieldUserProfile => ({
  userId: `usr_${name}`,
  fuid: 1,
  name,
  face: { emoji },
  resident: true,
  onboarded: true,
});

/** A window: the board, its presence over its desktop's lane, its pointer's facet on a document of its own. */
function windowOn(desktop: Desktop, who: FieldUserProfile) {
  const ce = createFieldEngine(buildRegistry());
  cleanups.push(() => ce.dispose());
  ce.docs.create();
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const lane = laneOn(desktop);
  const detach = attachDocumentPresence({
    ce,
    lane: lane as DocLaneClient,
    profile: who,
    docId: DOC,
  });
  cleanups.push(detach);
  const doc = document.implementation.createHTMLDocument(who.name);
  cleanups.push(
    attachPeerFacet({ ce, covered: () => false, subscribeCovered: () => () => {}, doc }),
  );
  return { ce, doc };
}

const remotesQ = defineQuery([PresencePeer, Not(Local)]);
const remotes = (ce: CanvasEngine): Entity[] => {
  const out: Entity[] = [];
  ce.world.query(remotesQ).each((b) => {
    for (const r of b) out.push(b.entity(r));
  });
  return out;
};

let clock = 0;
/** Step both windows (their publish hooks, their projections) until `done` (or 3 s): the rooms pump on their own. */
async function settle(windows: readonly CanvasEngine[], done: () => boolean): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < 3_000) {
    clock += 16;
    for (const ce of windows) ce.step(clock);
    if (done()) return;
    await sleep(5);
  }
  throw new Error("the two tabs did not converge");
}

describe("two tabs over fieldd — the peers on the mat, end to end (DK-16)", () => {
  it("draws B's pointer in A — the arrow's tip on it through A's camera, the chip its face and name — and hides it by B's word", async () => {
    const desktopA = new Desktop("desktop-a", 1_000);
    const desktopB = new Desktop("desktop-b", 2_000);
    desktopA.other = desktopB;
    desktopB.other = desktopA;
    await desktopA.router.start();
    await desktopB.router.start();
    cleanups.push(() => desktopA.router.stop());
    cleanups.push(() => desktopB.router.stop());

    const a = windowOn(desktopA, profile("James", "🦊"));
    const b = windowOn(desktopB, profile("Ada", "🐙"));
    // A places its peers on a camera of its own; B's pointer is at (420, 260) in the board's world
    a.ce.world.setResource(Camera, { x: 100, y: 40, zoom: 1.5, gesturing: false });
    let now = 5_000;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let ids = 0;
    const ctl = createPeersController({
      ce: a.ce,
      now: () => now,
      setTimer: (fn, ms) => {
        ids += 1;
        timers.set(ids, { fn, at: now + ms });
        return ids;
      },
      clearTimer: (t) => timers.delete(t as number),
    });
    cleanups.push(ctl.attach());
    const bSession = b.ce.docs.presence();
    if (bSession === undefined) throw new Error("B has no presence");
    bSession.eph.addComponent(bSession.localPeer, PresenceCursor, {
      x: 420,
      y: 260,
      device: "mouse",
      away: false,
      canvas: "",
    });

    // the room converges: B's presence crosses fieldd B's room → the mesh → fieldd A's room → A's lane
    await settle([a.ce, b.ce], () =>
      remotes(a.ce).some((e) => a.ce.world.get(e, PresenceCursor) !== undefined),
    );
    const [ada] = remotes(a.ce);
    expect(a.ce.world.get(ada as Entity, PresenceCursor)).toMatchObject({ x: 420, y: 260 });
    const el = document.createElement("div");
    cleanups.push(ctl.bind(ada as Entity, el));
    // AT THE RIGHT PLACE: world (420, 260) through A's camera (100, 40) × 1.5 → (480, 330), the box 2 up-left of the tip
    const box = arrowBoxAt({ x: 420, y: 260 }, { x: 100, y: 40, zoom: 1.5 });
    expect(box).toEqual({ x: 478, y: 328 });
    expect(el.style.transform).toBe(`translate(${box.x}px, ${box.y}px)`);
    expect(el.dataset["hidden"]).toBeUndefined();
    // and A is B's peer too: the room is both ways
    await settle([a.ce, b.ce], () => remotes(b.ce).length === 1);

    // IDLE: B's pointer stands still — at 8 s A hides it, by its own clock, with no frame
    const fire = (): void => {
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    };
    now += 7_999;
    fire();
    expect(el.dataset["hidden"]).toBeUndefined();
    now += 1;
    fire();
    expect(el.dataset["hidden"]).toBe("idle");
    // B moves: drawn again, where it went
    bSession.eph
      .edit(bSession.localPeer)
      .set(PresenceCursor, { x: 430, y: 260, device: "mouse", away: false, canvas: "" });
    await settle([a.ce, b.ce], () => a.ce.world.get(ada as Entity, PresenceCursor)?.x === 430);
    expect(el.dataset["hidden"]).toBeUndefined();
    expect(el.style.transform).toBe("translate(493px, 328px)");

    // AWAY: B's pointer leaves B's window — B's facet says so at once, and A hides it
    b.doc.body.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: null }),
    );
    await settle([a.ce, b.ce], () => el.dataset["hidden"] === "away");
    // back over B's page: drawn again
    b.doc.body.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await settle([a.ce, b.ce], () => el.dataset["hidden"] === undefined);
  });
});
