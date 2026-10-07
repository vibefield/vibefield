import { type CanvasEngine, currentNavFrame, defineComponent, type Entity } from "@vibecook/ice";
import type { PeerWhereFacts } from "./peers-model";

// THIS WINDOW'S POINTER AS ITS PEERS NEED IT (DK-16; DESIGN.md §8 "Peers on the mat", R17's "when not"). ICE's presence
// publishes the pointer's world x/y alone (`PresenceCursor`), and keeps the last one when the pointer leaves the desk
// (core `presence/publish.ts`: no local mouse ⇒ the facet stays as last published). Two of R17's rules need more:
//   AWAY   — the pointer LEFT its window, or the window's view covers its canvas (it is over Godview or History, not on
//            the desk);
//   CANVAS — the canvas its x/y lie in: the entered container's durable key, "" the board's root. A desk's coordinates
//            are frame-local (design-001 §5.1), so a pointer inside a mini mat means nothing on the board's root.
// VibeField says both in a facet of its own on the same presence peer — INTERIM, until ICE carries them (ask I42) — and
// a peer whose build sends none is read as in its window, on the root. It is written CHANGE-ONLY through the session's
// own writer (`presence().eph`): at each publish step (a nav move lands in a step) and at once when the pointer leaves or
// comes back or the view moves. A local ephemeral write is legal outside a query walk and an emit (strata's Option-A
// timing), and the presence binding sends it on its own timers — while the desk sleeps, and under a cover's freeze.

/** The facet: whether the pointer is away from the desk, and the canvas its x/y lie in. */
export const PeerWhere = defineComponent("vibefield.PeerWhere", { away: "bool", canvas: "string" });

/** The canvas this window's x/y lie in: the entered container's durable key, "" on the board's root. */
export function canvasKey(ce: Pick<CanvasEngine, "world" | "docs">): string {
  const frame = currentNavFrame(ce.world);
  if (frame === undefined) return "";
  const key = ce.docs.current()?.store.keyOf(frame);
  // a container with no durable key cannot be the same canvas on another desktop: never ""
  return key === undefined ? `runtime:${frame}` : String(key);
}

/** A peer's facet as this window reads it, or null — its build sends none. */
export function peerWhereOf(world: CanvasEngine["world"], peer: Entity): PeerWhereFacts | null {
  const facet = world.get(peer, PeerWhere);
  if (facet === undefined) return null;
  return { away: facet.away === true, canvas: facet.canvas ?? "" };
}

export interface PeerFacetSeams {
  readonly ce: Pick<CanvasEngine, "world" | "docs" | "engine">;
  /** The window's view covers its canvas (every view but the canvas). */
  readonly covered: () => boolean;
  /** Told when the window's view moves. Returns the unsubscribe. */
  readonly subscribeCovered: (fn: () => void) => () => void;
  /** The document whose pointer leaves and comes back. */
  readonly doc: Document;
}

/** The facet as last written, for the door and the tests. */
export interface PeerFacetSent {
  readonly away: boolean;
  readonly canvas: string;
  /** the pointer left the window (`away` also counts a covered view) */
  readonly left: boolean;
  readonly writes: number;
}

let lastSent: PeerFacetSent | null = null;

/** What this window last said of its pointer, or null. */
export function peerFacetSent(): PeerFacetSent | null {
  return lastSent;
}

/** Test seam. */
export function resetPeerFacetForTest(): void {
  lastSent = null;
}

/** Say this window's pointer's whereabouts on its presence peer, change-only, for as long as the returned undo is not
 * called. */
export function attachPeerFacet(seams: PeerFacetSeams): () => void {
  const { ce, doc } = seams;
  /** the pointer left the window (a `pointerout` with nowhere to go), until it is over the page again */
  let left = false;
  let writes = 0;
  let sent: { peer: Entity; away: boolean; canvas: string } | null = null;

  const sync = (): void => {
    const session = ce.docs.presence();
    if (session === undefined) return;
    const peer = session.localPeer;
    if (!ce.world.isAlive(peer)) return;
    const next = { away: left || seams.covered(), canvas: canvasKey(ce) };
    const has = ce.world.has(peer, PeerWhere);
    if (
      has &&
      sent !== null &&
      sent.peer === peer &&
      sent.away === next.away &&
      sent.canvas === next.canvas
    )
      return;
    // a re-minted local peer (a world reset) carries no facet: added again, never edited
    if (has) session.eph.edit(peer).set(PeerWhere, next);
    else session.eph.addComponent(peer, PeerWhere, next);
    sent = { peer, ...next };
    writes += 1;
    lastSent = { ...next, left, writes };
  };

  const onOut = (event: Event): void => {
    if ((event as PointerEvent).relatedTarget !== null || left) return;
    left = true;
    sync();
  };
  const onOver = (): void => {
    if (!left) return;
    left = false;
    sync();
  };
  doc.addEventListener("pointerout", onOut);
  doc.addEventListener("pointerover", onOver);
  const offPublish = ce.engine.onPublish(sync);
  const offView = seams.subscribeCovered(sync);
  sync();
  return () => {
    doc.removeEventListener("pointerout", onOut);
    doc.removeEventListener("pointerover", onOver);
    offPublish();
    offView();
  };
}
