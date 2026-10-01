import { type ReactElement, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { subscribeTerminalPool, terminalPoolSnapshot } from "../terminal/pool";
import { describeRemoteRefusal, type RemotePaneFace } from "./pane-faces";

/**
 * DS-4e — the pane's HONEST STATE when its terminal lives on another desktop
 * and its ticket did not come (`pane-faces.ts` `describeRemoteRefusal` words
 * it; the routed host's refusal, as the pool holds it, decides it).
 *
 * In the pane the way QL-2's launch caption is (DESIGN.md §8): centred over the
 * terminal's own ground, in the terminal's ink — the state at 72%, the
 * refusing plane's words beneath at 42%, the next step under them fainter —
 * ink and nothing else, the caption's own colour rule. It enters on plain
 * `ease` (§6: opacity and a 6px rise, 240ms — the words' entrance in the
 * switch) as an entry transition, never a keyframe (Godview runs none); under
 * reduced motion the fade alone at 120ms (M6). It never takes a click: the pane under it
 * is still the pane the person focuses. It leaves when the ticket lands (the
 * first frame is the state then) or the pane lets the session go.
 */
export function RemotePaneStateView({ face }: { face: RemotePaneFace }): ReactElement {
  return (
    <div className="vf-godview-remote-state" role="status" data-remote-state={face.state}>
      <p className="vf-godview-remote-state-message">{face.message}</p>
      <p className="vf-godview-remote-state-detail">
        {face.detail}
        {face.next !== undefined ? <small>{face.next}</small> : null}
      </p>
    </div>
  );
}

/**
 * The controller: one pane's session, its refusal read from the pool (so only
 * this pane re-renders when it moves), portaled into ghosttea's pane element
 * beside the frame. `nameOf` turns the owner's roster id into the name the
 * person knows — undefined when the roster has not named it.
 */
export function RemotePaneState({
  pane,
  sessionId,
  nameOf,
}: {
  pane: HTMLElement;
  sessionId: string;
  nameOf: (device: string) => string | undefined;
}): ReactElement | null {
  const refusal = useSyncExternalStore(subscribeTerminalPool, () =>
    terminalPoolSnapshot().remoteRefusals.get(sessionId),
  );
  if (refusal === undefined) return null;
  return createPortal(
    <RemotePaneStateView face={describeRemoteRefusal(refusal, nameOf(refusal.device))} />,
    pane,
  );
}
