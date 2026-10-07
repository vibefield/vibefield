import type { ReactElement } from "react";
import { PeerCursorView, PeersLayerView } from "../field/desk/peers/PeersView";
import { arrowBoxAt, peerLabel } from "../field/desk/peers/peers-model";

// PEERS ON THE MAT IN THE CATALOG (DK-16; DESIGN.md §8 "Peers on the mat"; UI_SYSTEM's catalog fidelity): the shipping
// views (`PeersLayerView`, `PeerCursorView`) over fixture peers, placed by the product's own model — `arrowBoxAt` through a
// fixture camera, `peerLabel` for the chip's words — on a stand-in for the LIT MAT (the sage as the theme lights it,
// `--vf-mat-ground`): the desk draws the mat on the GPU, so the plate lays its ground where it lies, as the pegboard's and
// the bar's plates stand theirs in.

export const PEERS_STATES = ["A peer", "Two peers — one at the mat's edge"] as const;
export type PeersState = (typeof PEERS_STATES)[number];

/** The fixture camera: a world unit is a CSS px. */
const CAMERA = { x: 0, y: 0, zoom: 1 } as const;

const FIXTURES: Record<PeersState, readonly { name: string; x: number; y: number }[]> = {
  "A peer": [{ name: "🦊 James", x: 150, y: 70 }],
  "Two peers — one at the mat's edge": [
    { name: "🦊 James", x: 150, y: 70 },
    { name: "🐙 Ada · work", x: 470, y: 120 },
  ],
};

/** One plate: the room's other people over the lit mat. */
export function PeersPlate({ state }: { state: PeersState }): ReactElement {
  return (
    <div className="vf-ds-peers-plate" data-state={state} style={{ width: 560, height: 200 }}>
      <PeersLayerView hidden={null}>
        {FIXTURES[state].map((peer) => (
          <PeerCursorView
            key={peer.name}
            label={peerLabel(peer.name)}
            at={arrowBoxAt({ x: peer.x, y: peer.y }, CAMERA)}
          />
        ))}
      </PeersLayerView>
      <span className="vf-ds-board-caption">{state}</span>
    </div>
  );
}
