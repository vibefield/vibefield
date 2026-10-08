import { type CameraState, worldToScreen } from "@vibecook/ice/kernel";

// PEERS ON THE MAT — the pure part (DK-16; DESIGN.md §8 "Peers on the mat"; MC-D10 = DK-D23, R22; UA-D17, §2.8 I-1, I-4;
// R17 as amended 13:40Z). Another person's pointer on the desk is VibeField's own cursor — ICE's are off
// (`deskLayer({ cursors: false })`, I26) so nobody is drawn twice. WHERE: each peer's `PresenceCursor` world x/y through
// this window's camera. WHEN NOT — the whole layer: under a cover (the desk is a still), while the pegboard is out (the
// desk is inert under it — plan addenda (58), (68)) and while the desk does not draw; one peer: a peer with no pointer
// yet, a pointer that left its window (or whose view covers its canvas), a peer inside another canvas (its x/y lie in a
// container's frame, not this one's), and an idle peer after 8 s — the away and the canvas are ICE's own words on the
// cursor (`PresenceCursor.away` / `.canvas`, petition I42, desk.6; DK-17b retired VibeField's interim facet). THE ARROW,
// 18 × 22, its tip at 2,2 in its box; THE LABEL a chip whose box's top-left stands 14 right of and 18 below the arrow box's
// top-left. Pure: no ECS, no DOM.

/** The canon's numbers (DESIGN.md §8 "Peers on the mat", R17). */
export const PEERS = {
  /** An idle peer hides after this long without a move of its pointer — this window's clock. */
  idleMs: 8_000,
  /** The arrow's box (CSS px) and its tip in it. */
  arrow: { width: 18, height: 22, tipX: 2, tipY: 2 },
  /** The label's box's top-left, from the arrow box's top-left. */
  label: { left: 14, top: 18 },
} as const;

/** The pointer's arrow — Chrome on the Mat's drawing (`draft/mat-chrome`), 18 × 22, its tip at 2,2: §13's one inline
 * exception on the desk besides the bar's path renderer (R17). Filled in the presence ink, edged in paper white. */
export const PEER_ARROW_PATH = "M2 2l13.5 11.2-6.4.6 3.7 6.9-2.6 1.3-3.7-7L2 19.6z";

/** Why the whole layer stands hidden, or null while it draws. */
export type PeersHidden = "desk" | "cover" | "board" | null;

/** Why one peer is not drawn, or null while it is. */
export type PeerHidden = "no-pointer" | "away" | "canvas" | "idle" | null;

/** A peer's pointer as its `PresenceCursor` says it (ICE, I42): its world x/y, whether it is AWAY (it left its window, or
 * its host says a view covers its canvas) and the CANVAS its x/y lie in (`presenceCanvasOf`: "" the board's root, the
 * entered container's durable key, a keyless one `~<peerId>/<entity>`). A build that sends neither field reads as ICE's
 * defaults: present, on the root. */
export interface PeerCursor {
  readonly x: number;
  readonly y: number;
  readonly away: boolean;
  readonly canvas: string;
}

export interface PeerFacts {
  /** Its `PresenceCursor`, or null — no pointer published yet. */
  readonly cursor: PeerCursor | null;
  /** This window's clock when the pointer last moved (first seen counts as a move). */
  readonly movedAt: number;
}

/** The layer's verdict: the desk not drawing first, then a cover, then the board. */
export function peersHidden(s: {
  readonly drawing: boolean;
  readonly covered: boolean;
  readonly boardOut: boolean;
}): PeersHidden {
  if (!s.drawing) return "desk";
  if (s.covered) return "cover";
  if (s.boardOut) return "board";
  return null;
}

/** One peer's verdict against this window's canvas (named as ICE names a peer's) and clock. */
export function peerHidden(
  peer: PeerFacts,
  here: { readonly canvas: string; readonly now: number },
): PeerHidden {
  if (peer.cursor === null) return "no-pointer";
  if (peer.cursor.away) return "away";
  if (peer.cursor.canvas !== here.canvas) return "canvas";
  if (here.now - peer.movedAt >= PEERS.idleMs) return "idle";
  return null;
}

/** Where the arrow's box stands (CSS px of the view): its tip at the pointer's screen point. */
export function arrowBoxAt(
  cursor: { readonly x: number; readonly y: number },
  camera: CameraState,
): { readonly x: number; readonly y: number } {
  const tip = worldToScreen(cursor.x, cursor.y, camera);
  return { x: tip.x - PEERS.arrow.tipX, y: tip.y - PEERS.arrow.tipY };
}

/** The chip's words: the face first, then the name ("🦊 James", §2.8 I-4) — the presence name already leads with the
 * face (`presenceName`); a name of nothing says nothing. */
export function peerLabel(name: string | null | undefined): string {
  return (name ?? "").trim();
}

/** When the next idle verdict falls due among peers drawn now (`movedAt` + 8 s), or null when none can. */
export function nextIdleAt(movedAts: Iterable<number>, now: number): number | null {
  let next: number | null = null;
  for (const at of movedAts) {
    const due = at + PEERS.idleMs;
    if (due > now && (next === null || due < next)) next = due;
  }
  return next;
}
