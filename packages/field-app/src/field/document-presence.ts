import type { CanvasEngine } from "@vibecook/ice";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import type { FieldUserProfile } from "../host";
import { getRendererLogger } from "../logging";

const ACCENT_HEX: Readonly<Record<string, string>> = Object.freeze({
  "accent-1": "#6366f1",
  "accent-2": "#ec4899",
  "accent-3": "#22c55e",
  "accent-4": "#f59e0b",
  "accent-5": "#06b6d4",
  "accent-6": "#8b5cf6",
  "accent-7": "#ef4444",
  "accent-8": "#3b82f6",
});

/** Resolve the supervisor-owned accent into a portable wire color. CSS custom
 * property names are local UI vocabulary; remote peers need the actual color. */
export function presenceColor(profile: FieldUserProfile): string {
  const declared = profile.color;
  if (declared !== undefined && ACCENT_HEX[declared] === undefined) return declared;
  const slot = declared ?? `accent-${(Math.abs(profile.fuid) % 8) + 1}`;
  if (typeof document !== "undefined") {
    const live = getComputedStyle(document.documentElement).getPropertyValue(`--vf-${slot}`).trim();
    if (live.length > 0) return live;
  }
  return ACCENT_HEX[slot] ?? ACCENT_HEX["accent-1"]!;
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
  const name = profile.name.trim();
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
    color: presenceColor(profile),
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
