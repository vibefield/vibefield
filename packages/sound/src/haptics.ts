/** The phone's touch (DESIGN.md §14 "The phone's touch", SD-D16): each sound's haptic keeps its rhythm. */
import { hz } from "./field.ts";
import { CUES, type CueId, type Note } from "./score.ts";

/** One transient: when (s), how strong and how sharp (0–1), as Core Haptics takes them. */
export interface Tap {
  readonly t: number;
  readonly intensity: number;
  readonly sharpness: number;
}

/**
 * The taps for a cue: one transient per strike time. Intensity from the strongest note struck then; sharpness from
 * the LOWEST note struck then (a low strike is felt dull), +0.25 for a knock, −0.2 for a muted strike. Approval's
 * knocks are the sharpest taps in the family and Failed's single low muted strike the dullest: what the sound says,
 * felt.
 */
export function haptics(cueId: CueId): Tap[] {
  const cue = CUES[cueId];
  const lo = hz("Db3");
  const hi = hz("Eb6");
  const lead = cue.lead || 0;
  const byTime = new Map<number, Note[]>();
  for (const n of cue.notes) {
    const list = byTime.get(n.t) || [];
    list.push(n);
    byTime.set(n.t, list);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, ns]) => {
      const low = ns.reduce((a, b) => (hz(b.n) < hz(a.n) ? b : a));
      const v = Math.max(...ns.map((n) => n.v));
      const pitch = Math.max(0, Math.min(1, Math.log(hz(low.n) / lo) / Math.log(hi / lo)));
      const hard = ns.some((n) => n.hard !== undefined && n.hard < 0.7);
      const muted = ns.every((n) => n.damp !== undefined && n.damp < 0.45) && !hard;
      const sharp = Math.max(
        0.05,
        Math.min(1, 0.15 + 0.55 * pitch + (hard ? 0.25 : 0) - (muted ? 0.2 : 0)),
      );
      return {
        t: +(lead + t).toFixed(3),
        intensity: +Math.min(1, 0.35 + 0.6 * v).toFixed(2),
        sharpness: +sharp.toFixed(2),
      };
    });
}
