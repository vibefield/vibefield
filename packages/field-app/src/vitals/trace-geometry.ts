// VT-2 (track VT, 2026-11-24; DESIGN.md §8 "Vitals", the chart rules) — A TRACE'S GEOMETRY, PURE: a series of
// readings over time as an SVG path in a box. No DOM and no colour.
//
// The rules it holds:
//  - one scale a lane, linear from zero, so two traces in a lane compare by eye and a height means an amount;
//  - a reading is drawn where it was taken: x is its time, never its index, so a missed second is a wider step;
//  - what was not measured is a gap: the path lifts its pen over a null and never crosses it, at zero or anywhere;
//  - a peak is never smoothed: points are joined by straight lines.

export interface TraceBox {
  /** the left edge and the width, in the SVG's units */
  x: number;
  width: number;
  /** the top (the scale's `max`) and the bottom (zero) */
  top: number;
  bottom: number;
}

export interface TraceScale {
  /** the times at the box's left and right edges, unix ms */
  from: number;
  to: number;
  /** the value at the box's top; zero is its bottom */
  max: number;
}

const fixed = (value: number): string => (Math.round(value * 10) / 10).toString();

export function xOf(time: number, box: TraceBox, scale: TraceScale): number {
  const span = scale.to - scale.from;
  if (span <= 0) return box.x + box.width;
  return box.x + ((time - scale.from) / span) * box.width;
}

export function yOf(value: number, box: TraceBox, scale: TraceScale): number {
  if (scale.max <= 0) return box.bottom;
  const share = Math.min(1, Math.max(0, value / scale.max));
  return box.bottom - share * (box.bottom - box.top);
}

/** The time under an x inside the box, clamped to the scale's span. */
export function timeAt(x: number, box: TraceBox, scale: TraceScale): number {
  if (box.width <= 0) return scale.to;
  const share = Math.min(1, Math.max(0, (x - box.x) / box.width));
  return scale.from + share * (scale.to - scale.from);
}

/** The path of a series: `M` begins each measured run, `L` joins readings inside it. A run of one reading is drawn
 * as a hair's width of line, so a lone reading between two gaps is still seen. Readings outside the scale's span are
 * left out. Empty when nothing was measured. */
export function tracePath(
  times: readonly number[],
  values: readonly (number | null)[],
  box: TraceBox,
  scale: TraceScale,
): string {
  let path = "";
  let run = 0;
  let last = "";
  const closeRun = (): void => {
    if (run === 1) path += `h0.1`;
    run = 0;
  };
  for (let index = 0; index < times.length; index++) {
    const time = times[index];
    const value = values[index];
    if (time === undefined || value === null || value === undefined) {
      closeRun();
      continue;
    }
    if (time < scale.from || time > scale.to) {
      closeRun();
      continue;
    }
    const at = `${fixed(xOf(time, box, scale))} ${fixed(yOf(value, box, scale))}`;
    if (run > 0 && at === last) continue;
    path += `${run === 0 ? "M" : "L"}${at}`;
    last = at;
    run += 1;
  }
  closeRun();
  return path;
}

/** A scale's top that reads as a round figure: the smallest of 1, 2, 2.5 and 5 times a power of ten that holds
 * `peak`. A lane says this number at its top, so it has to be one a person can read. */
export function niceMax(peak: number): number {
  if (!(peak > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * power;
    if (candidate >= peak * (1 - 1e-9)) return candidate;
  }
  return 10 * power;
}

/** A byte scale's top: the smallest of 1, 2, 4 and 8 times a power of 1024 that holds `peak`, so the figure a lane
 * says is whole in KiB, MiB or GiB. */
export function niceBytesMax(peak: number): number {
  if (!(peak > 0)) return 1024 * 1024;
  let unit = 1;
  while (unit * 1024 <= peak) unit *= 1024;
  for (const step of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]) {
    const candidate = step * unit;
    if (candidate >= peak) return candidate;
  }
  return 1024 * unit;
}
