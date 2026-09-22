import type { CanvasEngine } from "@vibecook/ice";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { faceOf } from "../account/faces";
import type { FieldUserProfile } from "../host";
import { getRendererLogger } from "../logging";

/** UA-D17 — a person has no colour, so a presence cursor is not tinted by who
 * it is: every peer's arrow and label are the one neutral `--vf-presence-ink`
 * (DESIGN.md §2.8), and the FACE in the label says whose it is. It must be a
 * real colour on the wire — ICE's remote-cursor reflector paints the SENDER'S
 * string at every receiver, whatever the receiver's theme, and draws white
 * label text on it — so the token is read at attach time, never sent as a
 * `var()`. A mid grey is what holds on both grounds and under white text. */
export const PRESENCE_INK_FALLBACK = "#636366";

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
 * written face yet wears the machine's deal, as everywhere else. */
export function presenceName(profile: FieldUserProfile): string {
  const name = profile.name.trim();
  if (name.length === 0) return "";
  return `${faceOf(profile, []).emoji} ${name}`;
}

/** Attach transport-free ICE presence to the already-authenticated doc lane.
 * The returned inverse deliberately detaches ICE first: its synchronous leave
 * must enter `onOutbound` before either transport subscription is removed. */
export function attachDocumentPresence(opts: {
  ce: CanvasEngine;
  lane: DocLaneClient;
  profile: FieldUserProfile;
  docId: string;
}): () => void {
  const { ce, lane, profile, docId } = opts;
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
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    detachPresence();
    stopOutbound();
    stopInbound();
  };
}
