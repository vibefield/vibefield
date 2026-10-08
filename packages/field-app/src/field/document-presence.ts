import type { CanvasEngine } from "@vibecook/ice";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { faceOf } from "../account/faces";
import type { FieldUserProfile } from "../host";
import { getRendererLogger } from "../logging";

/** UA-D17 — a person has no colour, so a presence cursor is not tinted by who
 * it is: the FACE in its label says whose it is (DESIGN.md §2.8). ICE's
 * presence still asks a real colour of every peer, so the one neutral
 * `--vf-presence-ink` is sent, read at attach time, never as a `var()`. Since
 * DK-16 nobody draws it as sent: ICE's remote cursors are off on the desk
 * (`deskLayer({ cursors: false })`), and VibeField draws each peer itself —
 * the arrow in this ink, the label a chip on the line's glass in the
 * chrome's own text ink (§8 "Peers on the mat"). */
export const PRESENCE_INK_FALLBACK = "#68686b";

export function presenceColor(): string {
  if (typeof document !== "undefined") {
    const live = getComputedStyle(document.documentElement)
      .getPropertyValue("--vf-presence-ink")
      .trim();
    if (live.length > 0) return live;
  }
  return PRESENCE_INK_FALLBACK;
}

/** "🦊 James" — the label a peer's cursor carries: the face first, so whose
 * cursor it is reads at a glance, and the name after it (I-4). A user with no
 * written face is dealt against themselves alone — this has the profile, not
 * the roster — which differs from the corner's deal only in the moment before
 * main's silent deal lands; boot and switch both start it before this window
 * reads its profile, so in practice the face is written by then. */
export function presenceName(profile: FieldUserProfile): string {
  const name = profile.name.trim();
  if (name.length === 0) return "";
  return `${faceOf(profile, []).emoji} ${name}`;
}

/** The host's away reason while a view covers the canvas (ICE's `setAway`, I42). */
export const COVER_AWAY = "cover";

/** Whether this window's view covers its canvas — every view but the canvas (`frame/view-state.ts`) — and a listener for
 * its moves. */
export interface CoverSeam {
  readonly covered: () => boolean;
  readonly subscribe: (fn: () => void) => () => void;
}

/** Attach transport-free ICE presence to the already-authenticated doc lane.
 * The returned inverse deliberately detaches ICE first: its synchronous leave
 * must enter `onOutbound` before either transport subscription is removed.
 * With `cover`, a view that covers the canvas (Godview, History — the desk a
 * still under it) sends this window's pointer AWAY for the session's life:
 * ICE's door for a host whose own chrome covers the desk (petition I42,
 * `setAway("cover")`), said at the attach and at each move of the view, and
 * published between frames — so a peer hears it under the cover's parked
 * freeze, in either order with the freeze; the lowering says it back. The
 * pointer leaving the desk's host is ICE's own (its adapter's `leave`). */
export function attachDocumentPresence(opts: {
  ce: CanvasEngine;
  lane: DocLaneClient;
  profile: FieldUserProfile;
  docId: string;
  cover?: CoverSeam;
}): () => void {
  const { ce, lane, profile, docId, cover } = opts;
  const name = presenceName(profile);
  if (name.length === 0) {
    getRendererLogger()
      .child({ component: "presence", docId })
      .warn(
        "renderer.presence.profile_unusable",
        "Presence stayed off because the current profile has no display name",
      );
    return () => {};
  }
  const log = getRendererLogger().child({ component: "presence", docId });
  const detachPresence = ce.docs.attachPresence({
    name,
    color: presenceColor(),
    onFault: (where, error) => {
      log.warn("renderer.presence.ice_fault", "ICE contained a presence transport fault", {
        where,
        error: String(error),
      });
    },
  });
  const presence = ce.docs.presence();
  if (presence === undefined) {
    detachPresence();
    throw new Error("ICE did not expose the presence session it attached");
  }
  const stopInbound = lane.onPresence((payload) => {
    try {
      presence.wire.apply(payload);
    } catch (error) {
      log.warn("renderer.presence.inbound_rejected", "An inbound presence snapshot was rejected", {
        error: String(error),
      });
    }
  });
  const stopOutbound = presence.onOutbound((payload) => lane.sendPresence(payload));
  const sayCover = (): void => presence.setAway(cover?.covered() === true ? COVER_AWAY : null);
  sayCover();
  const stopCover = cover?.subscribe(sayCover) ?? (() => {});
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    stopCover();
    detachPresence();
    stopOutbound();
    stopInbound();
  };
}
