/**
 * Cursor-halo app vocabulary (2026-07-18, James: "get the cursor visual stuff
 * from the pointerlab demo … when user is on top of a card widget, the circle
 * zooms in … on an internal interactable element, zoom the circle to a solid
 * dot") — pointerlab's `Cur` kinematics, re-tuned for an AUGMENTATION role.
 *
 * Like pointerlab, widgetlab REPLACES the OS cursor (`cursor:none` via the
 * overlay's `.wl-no-cursor` class — design-003 §7's sanctioned app opt-in;
 * James chose full replacement 2026-07-18 after first shipping it as an
 * augmentation). The halo IS the pointer — a bare ring (pointerlab parity;
 * a center-point hotspot was tried and dropped the same day, James: it read
 * as a stray inner circle) with three morph stops that telegraph who owns it:
 *
 *   scale 1.0        free canvas — canvas gestures (pan/marquee) live here
 *   MID_SCALE        over a card — card gestures (drag/select/long-press)
 *   DOT_SCALE        over an internal interactive (todo row, button, claimed
 *                    GL mesh) — the widget owns the down; engine disengaged
 *
 * Halo entities carry `Cur` and NEVER Position/Size, so picking/spatial index
 * never see them (pointerlab rule).
 */
import { defineComponent, field } from "@vibecook/ice";

/** Halo kinematics: eased screen position + morph scale (pointerlab `Cur`). */
export const Cur = defineComponent("HaloCur", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  scale: field("f32", { default: 0 }),
});

/** Halo radius, screen px. DECORATIVE — widgetlab's mouse pick radius is 0
 *  (point pick), so unlike pointerlab's 45px ring this does NOT visualize a
 *  pick disc; it stays small enough to read as a cursor accent. */
export const HALO_RADIUS_PX = 18;

/** Over a card: the ring "zooms in" partway — card-scope gestures. */
export const MID_SCALE = 0.55;

/** Over an internal interactive: collapse to a solid dot (overlay swaps the
 *  ring border for a filled accent disc at this scale). */
export const DOT_SCALE = 0.18;

/** Follow spring time constant, ms — tighter than pointerlab's 55 so the halo
 *  trails the REAL cursor closely instead of wandering behind it. */
export const FOLLOW_TAU = 40;

/** Morph time constant, ms (pointerlab's scale ease). */
export const MORPH_TAU = 90;

/** Framerate-independent exponential ease (pointerlab expEase, verbatim). */
export const expEase = (cur: number, goal: number, dt: number, tau = 70): number =>
  cur + (goal - cur) * (1 - Math.exp(-dt / tau));

/**
 * Ease toward goal, `null` once settled (within eps) so callers can SKIP the
 * write — change-only discipline (pointerlab easeSettle, verbatim).
 */
export function easeSettle(
  cur: number,
  goal: number,
  dt: number,
  tau = 70,
  eps = 0.01,
): number | null {
  if (cur === goal) return null;
  const next = expEase(cur, goal, dt, tau);
  return Math.abs(next - goal) < eps ? goal : next;
}
