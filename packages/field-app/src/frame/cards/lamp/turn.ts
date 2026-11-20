import { PRESS } from "../press/press-numbers";

/**
 * THE TURN (DESIGN.md §8 "Picking one up"; §6 "The hand", the turn; §5 "The lamp, live"; item 596, 2026-11-19): a card
 * picked up turns toward the pointer, as a card turns in your fingers, and the lamp lights it as it turns. This module is
 * the turn's pure half: its numbers, where the pointer asks the card to turn, the spring that takes it there, the card's
 * frame once it is turned, and how brightly the lamp lights a card turned so. No DOM and no clock of its own: the suite
 * pins the numbers. Lengths are a card's design units; directions are x right, y down, z toward you (the press's).
 */

export const TURN = {
  /** how far it turns, radians: about its level with the pointer at the window's top or foot, about its upright with
   * the pointer at the window's sides */
  reach: { x: 0.3, y: 0.42 },
  /** the spring it turns on: no curve of the table's, since it follows a hand */
  spring: { stiffness: 300, damping: 27 },
  /** the spring sleeps under these: radians, and radians a second */
  rest: { angle: 0.0004, speed: 0.004 },
  /** one frame moves the spring by at most this long, seconds, in steps no longer than the second */
  step: { most: 1 / 30, fine: 1 / 240 },
  /** seen from here, in the card's own units (§8 Flip it): the turn's perspective and the lamp's eye are one */
  eye: 1000,
} as const;

/** A turn, radians: `x` about the card's level (positive, its top edge goes from you, so it faces up), `y` about its
 * upright (positive, its right edge goes from you, so it faces right). CSS's `rotateY(y) rotateX(x)`. */
export interface Turn {
  readonly x: number;
  readonly y: number;
}

export const NO_TURN: Turn = { x: 0, y: 0 };

export interface Point {
  readonly x: number;
  readonly y: number;
}

const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n));

/** Where the pointer asks a held card to turn: toward it, by how far it stands from the card's middle across half the
 * window, whole at the window's edge. No pointer, no turn. PURE. */
export function turnToward(pointer: Point | null, middle: Point, half: Point): Turn {
  if (pointer === null || half.x <= 0 || half.y <= 0) return NO_TURN;
  const across = clamp((pointer.x - middle.x) / half.x, -1, 1);
  const down = clamp((pointer.y - middle.y) / half.y, -1, 1);
  // +0 where the pointer is on the middle, never the −0 a negated zero would be
  return { x: -down * TURN.reach.x + 0, y: across * TURN.reach.y + 0 };
}

/** The turn on its spring: where it stands, and how fast it moves (radians a second). */
export interface TurnSpring {
  readonly at: Turn;
  readonly speed: Turn;
}

export const TURN_STILL: TurnSpring = { at: NO_TURN, speed: NO_TURN };

/** The spring `dt` seconds on, toward `to`: stepped finely, and never more than a thirtieth of a second at once, so a
 * frame that came late cannot throw the card. PURE. */
export function stepTurn(spring: TurnSpring, to: Turn, dt: number): TurnSpring {
  const span = clamp(dt, 0, TURN.step.most);
  if (span === 0) return spring;
  const steps = Math.max(1, Math.ceil(span / TURN.step.fine));
  const h = span / steps;
  const { stiffness, damping } = TURN.spring;
  let { x, y } = spring.at;
  let vx = spring.speed.x;
  let vy = spring.speed.y;
  for (let i = 0; i < steps; i += 1) {
    vx += (stiffness * (to.x - x) - damping * vx) * h;
    vy += (stiffness * (to.y - y) - damping * vy) * h;
    x += vx * h;
    y += vy * h;
  }
  return { at: { x, y }, speed: { x: vx, y: vy } };
}

/** True once the spring stands at `to` and is still: the frames can stop. PURE. */
export function turnAtRest(spring: TurnSpring, to: Turn): boolean {
  const { angle, speed } = TURN.rest;
  return (
    Math.abs(spring.at.x - to.x) < angle &&
    Math.abs(spring.at.y - to.y) < angle &&
    Math.abs(spring.speed.x) < speed &&
    Math.abs(spring.speed.y) < speed
  );
}

/** A direction: x right, y down, z toward you. */
export type Vec3 = readonly [number, number, number];

/**
 * A side's frame once the card is turned: the turn, then the card about its own upright by `about` radians (Flip it:
 * the face stands at the flip's angle, the back half a turn further). Nine numbers, column by column as WebGL reads a
 * `mat3`: where the side's right, its down and its normal point. PURE.
 */
export function frameOf(turn: Turn, about = 0): readonly number[] {
  const cx = Math.cos(turn.x);
  const sx = Math.sin(turn.x);
  const cy = Math.cos(turn.y);
  const sy = Math.sin(turn.y);
  const ca = Math.cos(about);
  const sa = Math.sin(about);
  // Ry(turn.y) · Rx(turn.x) · Ry(about), each as CSS turns: Ry = [c 0 s; 0 1 0; −s 0 c], Rx = [1 0 0; 0 c −s; 0 s c]
  const right: Vec3 = [cy * ca - sy * cx * sa, sx * sa, -sy * ca - cy * cx * sa];
  const down: Vec3 = [sy * sx, cx, cy * sx];
  const normal: Vec3 = [cy * sa + sy * cx * ca, -sx * ca, -sy * sa + cy * cx * ca];
  return [...right, ...down, ...normal];
}

/** The way a side faces once the card is turned (`frameOf`'s third column). PURE. */
export function normalOf(turn: Turn, about = 0): Vec3 {
  const frame = frameOf(turn, about);
  return [frame[6] ?? 0, frame[7] ?? 0, frame[8] ?? 1];
}

const LAMP_LENGTH = Math.hypot(...PRESS.lamp);
const LAMP: Vec3 = [
  PRESS.lamp[0] / LAMP_LENGTH,
  PRESS.lamp[1] / LAMP_LENGTH,
  PRESS.lamp[2] / LAMP_LENGTH,
];

/**
 * How brightly the lamp lights a flat card facing `normal`: the press's own diffuse (`light-glsl.ts`, `lampDiffuse`),
 * so a card at rest reads 1, the print's light; turned from the lamp it falls to the room's ambient; turned to it, it
 * brightens softly and never past 1 + `PRESS.diffuse.over`. PURE.
 */
export function lampOn(normal: Vec3, night: boolean): number {
  const ambient = night ? PRESS.ambient.night : PRESS.ambient.day;
  const { low, knee, over } = PRESS.diffuse;
  const facing = Math.max(0, normal[0] * LAMP[0] + normal[1] * LAMP[1] + normal[2] * LAMP[2]);
  const lit = ambient + ((1 - ambient) / Math.max(LAMP[2], low)) * facing;
  return lit <= 1 ? lit : 1 + (1 - Math.exp(-(lit - 1) * knee)) * over;
}
