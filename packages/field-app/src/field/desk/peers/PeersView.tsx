import type { ReactElement, ReactNode, Ref } from "react";
import { PEER_ARROW_PATH, PEERS, type PeerHidden, type PeersHidden } from "./peers-model";
import "./peers.css";

// PEERS ON THE MAT — the markup (DK-16; DESIGN.md §8 "Peers on the mat", R17). Controller-free, so the catalog mounts
// this exact markup on fixture peers: the layer over the desk (above the mat, below the bar and the line — it lies in the
// desk's own box, inside the scene) and one peer — THE ARROW, the pointer's, 18 × 22 with its tip at 2,2, drawn inline
// (§13's named exception, R17: this file's one inline svg) in the presence ink on a 1.4 paper-white edge with a `0 1px 2px`
// black/25 drop; THE LABEL a chip on the line's glass, its box's top-left 14 right of and 18 below the arrow box's — the
// face first, then the name, never the peer's own colour (I-1). In the product the controller writes each peer's place
// (`transform`) and verdict (`data-hidden`) imperatively; a fixture passes them here.

export function PeersLayerView({
  hidden,
  children,
}: {
  /** Why the whole layer stands hidden (the desk not drawing, a cover, the board), or null. */
  hidden: PeersHidden;
  children?: ReactNode;
}): ReactElement {
  return (
    <div
      className="vf-peers"
      aria-hidden="true"
      data-peers=""
      {...(hidden === null ? {} : { "data-hidden": hidden })}
    >
      {children}
    </div>
  );
}

export function PeerCursorView({
  label,
  ref,
  at,
  hidden = null,
}: {
  /** The chip's words: the face first, then the name ("🦊 James"). */
  label: string;
  ref?: Ref<HTMLDivElement>;
  /** A fixture's place for the arrow's box (CSS px); the product's controller writes it. */
  at?: { readonly x: number; readonly y: number };
  /** A fixture's verdict; the product's controller writes it. */
  hidden?: PeerHidden;
}): ReactElement {
  return (
    <div
      ref={ref}
      className="vf-peer"
      data-peer=""
      {...(at === undefined ? {} : { style: { transform: `translate(${at.x}px, ${at.y}px)` } })}
      {...(hidden === null ? {} : { "data-hidden": hidden })}
    >
      <svg
        className="vf-peer__arrow"
        width={PEERS.arrow.width}
        height={PEERS.arrow.height}
        viewBox={`0 0 ${PEERS.arrow.width} ${PEERS.arrow.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <path d={PEER_ARROW_PATH} />
      </svg>
      {label === "" ? null : <span className="vf-peer__chip">{label}</span>}
    </div>
  );
}
