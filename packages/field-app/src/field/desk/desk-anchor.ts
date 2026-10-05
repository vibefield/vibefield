import type { SelectionAnchor } from "@vibecook/ice/desk";
import { currentDesk, type MountedDesk, subscribeDesk } from "./desk-door";

// THE DESK'S SELECTION ANCHOR, followed across mounts (DK-11; DESIGN.md §8 "The doors"): ICE gives the
// chrome data, never pixels — `handle.selection` offers `anchor()` and `subscribe()` only, and its
// subscription fires after each frame that moved what the anchor says (never at rest: no frame, no call).
// The chrome over the desk lives outside the stage (ChromeLayer), so it reads the anchor of the desk
// MOUNTED NOW: a Reload, a kinds remount or a new document generation makes a new handle, and every
// reader is re-subscribed to it here, once, rather than each tracking the stage's mounts.

/** The mounted desk's selection door — absent on a handle without one (a test's double). */
const selectionOf = (desk: MountedDesk | null) =>
  (desk?.handle as { selection?: MountedDesk["handle"]["selection"] } | undefined)?.selection;

/** The anchor as the mounted desk last published it, or null with no desk. */
export function deskAnchor(): SelectionAnchor | null {
  return selectionOf(currentDesk())?.anchor() ?? null;
}

/**
 * Told after each frame that moved the mounted desk's anchor, and once whenever the mounted desk changes
 * (a remount's new anchor, or none). Returns the unsubscribe.
 */
export function subscribeDeskAnchor(fn: () => void): () => void {
  let off: (() => void) | null = null;
  const follow = (): void => {
    off?.();
    off = selectionOf(currentDesk())?.subscribe(fn) ?? null;
  };
  follow();
  const offDesk = subscribeDesk(() => {
    follow();
    fn();
  });
  return () => {
    offDesk();
    off?.();
    off = null;
  };
}

/** An object is IN HAND (not flying home): the anchor's `held` (design-015 §8, D4b). */
export const inHand = (anchor: SelectionAnchor | null): boolean =>
  anchor?.held !== undefined && !anchor.held.landing;
