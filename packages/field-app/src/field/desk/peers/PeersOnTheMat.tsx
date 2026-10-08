import type { Entity } from "@vibecook/ice";
import { useCanvasEngine, usePresencePeers } from "@vibecook/ice/react";
import { type ReactElement, useEffect, useLayoutEffect, useMemo } from "react";
import { useCovered } from "../../../frame/view-state";
import { useBoardFacts } from "../pegboard/board-door";
import { PeerCursorView, PeersLayerView } from "./PeersView";
import { peerLabel, peersHidden } from "./peers-model";
import { createPeersController } from "./peers-reflector";

// PEERS ON THE MAT, in the desk (DK-16; DESIGN.md §8 "Peers on the mat"; MC-D10 = DK-D23, R17, R22). Mounted as `<Desk>`'s
// child — in the desk's own box, under ICE's engine context — beside the layer that draws no remote cursors of its own
// (`deskLayer({ cursors: false })`, I26), so nobody is drawn twice. `usePresencePeers` gives the roster's NAMES: one
// element per peer, its chip the face and the name. The controller places them every frame in a reflector
// (`peers-reflector.ts`); this window's own pointer is said to its peers by ICE's presence (I42: its cursor's away when
// the pointer leaves the desk's host with nowhere to go, its canvas the entered container's key) and its cover by the
// presence's attach (`document-presence.ts`, `setAway("cover")`). The layer stands hidden while the desk does not draw,
// under a cover and while the board is out (plan addenda (58), (68)). Renders only when the roster or a verdict of the
// layer moves — never per frame.

let renders = 0;

/** How often the layer has rendered — the door's witness that placement is never a render. */
export function peersRenders(): number {
  return renders;
}

export function PeersOnTheMat({ drawing }: { drawing: boolean }): ReactElement {
  const ce = useCanvasEngine();
  const roster = usePresencePeers();
  const covered = useCovered();
  const board = useBoardFacts();
  const hidden = peersHidden({ drawing, covered, boardOut: board?.open === true });
  const controller = useMemo(
    () =>
      createPeersController({
        ce,
        now: () => performance.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      }),
    [ce],
  );
  useEffect(() => controller.attach(), [controller]);
  useLayoutEffect(() => controller.setLayer(hidden), [controller, hidden]);
  // one ref per peer for the controller's life: a ref of a new identity each render would unbind and bind it again
  const refs = useMemo(() => new Map<Entity, (el: HTMLDivElement | null) => () => void>(), []);
  const refOf = (entity: Entity): ((el: HTMLDivElement | null) => () => void) => {
    let ref = refs.get(entity);
    if (ref === undefined) {
      ref = (el) => (el === null ? () => undefined : controller.bind(entity, el));
      refs.set(entity, ref);
    }
    return ref;
  };
  for (const entity of [...refs.keys()])
    if (!roster.some((peer) => peer.entity === entity)) refs.delete(entity);
  renders += 1;
  return (
    <PeersLayerView hidden={hidden}>
      {roster.map((peer) => (
        <PeerCursorView
          key={String(peer.entity)}
          label={peerLabel(peer.info?.name)}
          ref={refOf(peer.entity)}
        />
      ))}
    </PeersLayerView>
  );
}
