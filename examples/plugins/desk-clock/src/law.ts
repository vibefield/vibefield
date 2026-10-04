// PORTED VERBATIM from ICE's worked third-party kind (`infinite-canvas-engine/examples/desk-clock/src/law.ts`, design-016 K8b) — re-wrapped by this repo's formatter.

// The DESK CLOCK's law — pure: no GPU, no world. A round clock lying face up on the mat: its case (the bezel ring and the
// recessed face under a glass dome), its hands, and THE TIME IT SHOWS. The time is flux, never a fact: the document holds how
// the clock is set (its style, its rings, its seconds hand, its zone) and the host's wall clock supplies the hour — so two
// desks in a room agree on every prop and each reads its own clock. Every function here is the CPU mirror of clock.wgsl's
// arithmetic or the wake's (local.ts): what is picked is what is drawn, and a desk wakes exactly when a hand must move.

/** The clock's styles — a dial each: `classic` (ivory, Roman numerals, a brass case), `station` (the railway clock: bars and a red seconds disc), `graphite` (a dark dial whose lume glows by night). */
export const CLOCK_STYLES = ["classic", "station", "graphite"] as const;
export type ClockStyle = (typeof CLOCK_STYLES)[number];

/** The clock's numbers. Lengths in world units (CSS px at zoom 1) or fractions — `face` of the case's radius, the rest of the face's. */
export const CLOCK = {
  /** The case's diameter: a clock new on the desk. */
  size: 150,
  /** The face's radius, of the case's — the bezel is the rest. */
  face: 0.86,
  /** Heights off the desk (world units): the bezel's crown, the face (recessed under it), the three hands over the face. */
  height: { case: 7, face: 3.2, hour: 4.2, minute: 4.8, second: 5.4 },
  /** The hands (of the face's radius): length, tail, width at the arbor and at the tip. */
  hands: {
    hour: { len: 0.5, tail: 0.12, w0: 0.05, w1: 0.03 },
    minute: { len: 0.78, tail: 0.14, w0: 0.036, w1: 0.018 },
    second: { len: 0.86, tail: 0.22, w0: 0.009, w1: 0.009 },
  },
  /** The lift in a hand (held): how high it rises and how much bigger it reads. */
  lift: { height: 14, scale: 1.04 },
  /** Its shadow: σ at contact, alpha (resting, held), σ per unit of height, the slope's cap; the relief the bezel is shaded with. */
  shadow: { sigma: 1.1, alpha: 0.38, alphaHeld: 0.26, sigmaPerUnit: 0.32, slopeMax: 0.9 },
  relief: 1.0,
} as const;
export type ClockLaw = typeof CLOCK;

/** The specimen's time on the pegboard (a shop's display, 10:10:30) — a clock drawn with no wall clock and no pinned time. */
export const SHOP_TIME = 10 * 3600 + 10 * 60 + 30;

/** A day, seconds. */
const DAY = 86_400;

/**
 * A zone as the `zone` prop spells it: `local` (the host's own zone, whatever it is when the clock is read), or a UTC offset —
 * `Z`, `UTC`, `+09:00`, `-05:30`, `+0545`. Minutes east of UTC, or `undefined` for `local` and for anything unreadable (a clock
 * set to a zone it cannot read keeps the host's, never a wrong hour).
 */
export function zoneMinutes(zone: string): number | undefined {
  const z = zone.trim();
  if (z === "Z" || z === "UTC" || z === "GMT") return 0;
  const m = /^(?:UTC|GMT)?([+-])(\d{1,2}):?(\d{2})?$/.exec(z);
  if (m === null) return undefined;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  if (mins > 14 * 60) return undefined;
  return m[1] === "-" ? -mins : mins;
}

/** A UTC offset in minutes as the `zone` prop spells it (`+09:00`, `-05:30`, `+00:00`). */
export function zoneOf(minutes: number): string {
  const m = Math.round(Math.max(-14 * 60, Math.min(14 * 60, minutes)));
  const a = Math.abs(m);
  return `${m < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** The zone's offset at a moment, minutes east of UTC: the prop's own, or the host's at that moment for `local`. */
export function offsetAt(zone: string, at: number): number {
  return zoneMinutes(zone) ?? -new Date(at).getTimezoneOffset();
}

/** The time of day the clock shows at `at` (epoch ms) in `zone`: whole seconds since the zone's midnight — a clock shows a second at a time. */
export function timeOfDay(at: number, zone: string): number {
  const s = Math.floor(at / 1000) + offsetAt(zone, at) * 60;
  return ((s % DAY) + DAY) % DAY;
}

/** The three hands' angles, radians CLOCKWISE from twelve (the screen's y runs down). */
export interface HandAngles {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const TURN = Math.PI * 2;

/**
 * The hands for a time of day. With the seconds hand on the clock ticks once a second — the minute and hour hands creep with it;
 * off, the minute hand steps once a minute and the hour hand with it (the wake's cadence, local.ts: a minute clock needs a frame a
 * minute). The seconds hand is where it stands either way (drawn or not).
 */
export function handAngles(tod: number, seconds: boolean): HandAngles {
  const t = seconds ? Math.floor(tod) : Math.floor(tod / 60) * 60;
  return {
    hour: (((t / 3600) % 12) / 12) * TURN,
    minute: (((t / 60) % 60) / 60) * TURN,
    second: ((Math.floor(tod) % 60) / 60) * TURN,
  };
}

/** A clock's cadence: a frame a second with its seconds hand, a frame a minute without. */
export const stepOf = (seconds: boolean): number => (seconds ? 1000 : 60_000);

/**
 * A wake is taken a hair early (the loop's timer and the frame clock are not the wall clock to the millisecond): a clock read this
 * close before its boundary shows the time just turning — never a frame that finds nothing moved and another a millisecond later.
 */
export const EARLY_MS = 4;

/** The time key a clock shows at wall time `wall` (epoch ms) with cadence `step`: it changes exactly when a hand must move. */
export const keyAt = (wall: number, step: number): number => Math.floor((wall + EARLY_MS) / step);

/** When, on the wall clock, a clock showing key `key` at cadence `step` must next move (epoch ms). */
export const nextMoveAt = (key: number, step: number): number => (key + 1) * step - EARLY_MS;

/** The case's radius as drawn and its lift, for a rect's side and the hold's lift (0 … 1). */
export function caseOf(
  side: number,
  lift: number,
  law: ClockLaw = CLOCK,
): { readonly radius: number; readonly lift: number; readonly scale: number } {
  const scale = 1 + (law.lift.scale - 1) * lift;
  return { radius: (side / 2) * scale, lift: law.lift.height * lift, scale };
}

/** How far a clock's drawing reaches past its rect (world units): its shadow at full lift, blurred; the held scale. */
export function clockReach(law: ClockLaw = CLOCK): number {
  const hmax = law.height.case + law.lift.height;
  const shadow =
    law.shadow.slopeMax * hmax + 2.5 * (law.shadow.sigma + law.shadow.sigmaPerUnit * hmax);
  return shadow + (law.size / 2) * (law.lift.scale - 1);
}
