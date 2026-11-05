/**
 * What the desktop needs to find a render again (SD-2): the five baked places, one file name per sound, and a hash of
 * the score itself, so a file rendered by one build is never played by a build whose sound differs.
 */
import { hashOf } from "./dsp.ts";
import type { RenderOptions } from "./render.ts";
import { CUE_IDS, CUES, type CueId, PAN_POSITIONS, PROFILES, SPACES, STARLIGHT } from "./score.ts";

/**
 * Bumped when a render changes for a reason the score does not show (the engine's own code). The score's own changes
 * move ENGINE_HASH by themselves.
 */
export const ENGINE_REVISION = 1;

/** The score's fingerprint: 8 hex digits of FNV-1a over the voice, the spaces, the profiles and the family. */
export const ENGINE_HASH: string = hashOf(
  JSON.stringify({ revision: ENGINE_REVISION, STARLIGHT, SPACES, PROFILES, CUES }),
)
  .toString(16)
  .padStart(8, "0");

/** The family, in DESIGN.md §14's order, the mark left out: what Settings → Sound plays (§8; SD-D18). */
export const PREVIEW_CUES = CUE_IDS.filter((cue) => cue !== "mark") as readonly Exclude<
  CueId,
  "mark"
>[];

/** The baked place nearest `pan` (§14: the place is baked into the sound at five positions). */
export function nearestPlace(pan: number): number {
  if (!Number.isFinite(pan)) return 0;
  let best = PAN_POSITIONS[0] ?? 0;
  for (const p of PAN_POSITIONS) if (Math.abs(p - pan) < Math.abs(best - pan)) best = p;
  return best;
}

/** One render's name: the same for the same sound however its options are spelled, a file name of [a-z0-9.-]. A
 * negative number is spelled with `m` (minus), so `-` only ever joins a chord's places. */
export function renderKey(cue: CueId, opts: RenderOptions): string {
  const n = (x: number): string => (x < 0 ? `m${String(-x)}` : String(x));
  return [
    cue,
    opts.space ?? "day",
    opts.profile ?? "desktop",
    `c${n(opts.count ?? 1)}`,
    `p${n(opts.pan ?? 0)}`,
    `n${(opts.notePans ?? []).map(n).join("-")}`,
    `l${n(opts.level ?? 0)}`,
    `v${n(opts.variant ?? 0)}`,
    `s${n(opts.stretch ?? 1)}`,
    ...(opts.seed === undefined ? [] : [`r${n(opts.seed)}`]),
  ].join(".");
}
