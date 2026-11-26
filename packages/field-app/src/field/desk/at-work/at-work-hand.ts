import type { ScreenFrame } from "./at-work-model";

// THE AT-WORK MARK AND THE HAND (item 550, 2026-11-24; DESIGN.md §8 "At work on the mat", Where and When not; §6
// "Something in hand"). Two rules the pages room's second live run asked for, PURE geometry:
//  - IN HAND THE FRAME IS THE SILHOUETTE. ICE publishes the hand's pose as its OPEN EXTENT on screen (core's
//    `HeldScreenFrame`: the extent's centre, half extents and scale). A browser pane's extent is its page and head, which
//    leave out its border, so marks round the extent ran over the pane's own border. The kind's silhouette (its `frame`
//    over the geometry the hand drew) is carried by the same pose instead, its offset from the extent kept, as ICE's
//    `heldCamera` places the object: the rect's centre lands at P + R(angle)·(rect − extent)·s.
//  - THE OBJECT IN HAND COVERS WHAT LIES BEHIND IT. It stands over the whole desk, so every other object's marks are
//    masked out of its silhouette: by the pixel in the GL form (the shader's `handMask`), by an element's centre for a
//    seat, a star and a chip, and by the frame's reach for the DOM form's frame, which cannot be masked by the pixel.

/** The hand's pose as ICE publishes it: the shown extent's centre and half extents on screen, CSS px, and its scale. */
export interface AtWorkHeldPose {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly s: number;
}

/** A kind's open extent in its own desk units (ICE's `OpenBinding.extent`), centred as its rect is, unturned. */
export interface AtWorkExtent {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

/** How far the pose's half extents may stand from the whole extent's before the hand is read as showing part of it
 * (one page of a spread), CSS px. */
const WHOLE_EXTENT_PX = 0.5;

/** Item 550 (2026-11-24): an object's silhouette on screen while it is in hand (DESIGN.md §8, Where). `world` is its
 * kind's frame over the geometry the hand drew (its turn the pose's own), `rect` its rect's centre and `extent` its open
 * extent, both world units. The pose's own frame stands when no extent is read, or when the hand shows only part of it
 * (a spread's one page): then the shown page is the frame. PURE. */
export function atWorkHeldFrame(
  pose: AtWorkHeldPose,
  world: ScreenFrame,
  rect: { readonly cx: number; readonly cy: number } | null,
  extent: AtWorkExtent | null,
): ScreenFrame {
  const { s } = pose;
  const shown: ScreenFrame = {
    cx: pose.cx,
    cy: pose.cy,
    hx: pose.hx,
    hy: pose.hy,
    angle: 0,
    r: world.r * s,
  };
  // read for a `camera` pose (the browser pane's): an `eye` kind's hand draws its geometry grown at
  // min(desk zoom, pose.s), which `world × s` does not carry; no marked eye kind is held today (2026-11-24)
  if (rect === null || extent === null) return shown;
  const whole =
    Math.abs((extent.w / 2) * s - pose.hx) <= WHOLE_EXTENT_PX &&
    Math.abs((extent.h / 2) * s - pose.hy) <= WHOLE_EXTENT_PX;
  if (!whole) return shown;
  const c = Math.cos(world.angle);
  const n = Math.sin(world.angle);
  const ox = (rect.cx - extent.cx) * s;
  const oy = (rect.cy - extent.cy) * s;
  // the rect's centre on screen, as ICE's `heldCamera` places it, then the silhouette's own offset from the rect
  const rx = pose.cx + c * ox - n * oy;
  const ry = pose.cy + n * ox + c * oy;
  return {
    cx: rx + (world.cx - rect.cx) * s,
    cy: ry + (world.cy - rect.cy) * s,
    hx: world.hx * s,
    hy: world.hy * s,
    angle: world.angle,
    r: world.r * s,
  };
}

/** The part of the desk's hand build the marks read (ICE's `DeskLayerHandle.hand()`, its `HeldBuild`): the object the
 * hand draws, whether it is flying home, and its pose on screen. */
export interface AtWorkHandBuild<E> {
  readonly entity: E;
  readonly landing: boolean;
  readonly frame: AtWorkHeldPose;
}

/** Item 550 (2026-11-24): the object the hand draws — in hand, or flying home after Done (ICE clears the fact,
 * `heldEntity`, the moment the put-down starts, while its builder still flies the object home), else the fact's object
 * (a hand the builder has not drawn yet, a kind it does not hold). The cover and the held placement follow it, through
 * the pickup and the put-back (DESIGN.md §8 When not). PURE. */
export function atWorkCarriedOf<E>(
  build: AtWorkHandBuild<E> | undefined,
  inHand: E | undefined,
): E | undefined {
  return build?.entity ?? inHand;
}

/** Item 550 (2026-11-24): the hand's pose of `e` — the hand build's own frame while it draws `e`, landing included (the
 * pose seam answers none while it lands), else the seam's. PURE but for `seam`. */
export function atWorkPoseOf<E>(
  e: E,
  build: AtWorkHandBuild<E> | undefined,
  seam: () => AtWorkHeldPose | undefined,
): AtWorkHeldPose | undefined {
  return build !== undefined && build.entity === e ? build.frame : seam();
}

/** A point in a frame's own axes: across and down from its centre. */
function local(frame: ScreenFrame, x: number, y: number): readonly [number, number] {
  const dx = x - frame.cx;
  const dy = y - frame.cy;
  const c = Math.cos(frame.angle);
  const n = Math.sin(frame.angle);
  return [c * dx + n * dy, -n * dx + c * dy];
}

/** Item 550 (2026-11-24): whether the hand's silhouette covers the point (x, y), its corner rounded; never without a
 * hand. PURE. */
export function atWorkCovers(hand: ScreenFrame | null, x: number, y: number): boolean {
  if (hand === null) return false;
  const [u, v] = local(hand, x, y);
  const r = Math.min(Math.max(hand.r, 0), hand.hx, hand.hy);
  const qx = Math.abs(u) - hand.hx + r;
  const qy = Math.abs(v) - hand.hy + r;
  const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  return d <= 0;
}

/** The two half-axes of a frame grown by `grow` on each side, on screen. */
function axesOf(frame: ScreenFrame, grow: number): readonly [readonly [number, number], number][] {
  const c = Math.cos(frame.angle);
  const n = Math.sin(frame.angle);
  return [
    [[c, n], frame.hx + grow],
    [[-n, c], frame.hy + grow],
  ];
}

/** Item 550 (2026-11-24): whether a frame, grown by its marks' `reach` (screen px), meets the hand's silhouette — two
 * turned boxes tested along each one's own axes, the corners square (so a mark's reach round a corner errs toward
 * covered). Never without a hand. PURE. */
export function atWorkFramesMeet(
  frame: ScreenFrame,
  reach: number,
  hand: ScreenFrame | null,
): boolean {
  if (hand === null) return false;
  const a = axesOf(frame, reach);
  const b = axesOf(hand, 0);
  const dx = hand.cx - frame.cx;
  const dy = hand.cy - frame.cy;
  for (const [[ax, ay]] of [...a, ...b]) {
    const centre = Math.abs(dx * ax + dy * ay);
    let span = 0;
    for (const [[ux, uy], half] of [...a, ...b]) span += half * Math.abs(ux * ax + uy * ay);
    if (centre > span) return false;
  }
  return true;
}
