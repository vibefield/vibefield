/** A cue, rendered: the score laid out for its moment, then every layer, the space, and the master. */
import {
  type Bend,
  BUTTERWORTH_Q,
  biquadInPlace,
  dB,
  energy,
  equalPower,
  hashOf,
  limit,
  mixInto,
  rng,
  SR,
} from "./dsp.ts";
import { above, tuned } from "./field.ts";
import { addStars, ashTone, bloomTone, coreTone, subTone, thumpTone } from "./layers.ts";
import { momentaryMax } from "./loudness.ts";
import {
  CLEAR_AFTER_S,
  CUES,
  type CueId,
  type CueSpec,
  PAN_LIMIT,
  PROFILES,
  type ProfileId,
  SPACES,
  type SpaceId,
  type SpaceSpec,
  STARLIGHT,
  TAIL_FLOOR_DB,
  type VoiceSpec,
} from "./score.ts";
import { fdn, octaveUp, swellTone } from "./space.ts";

export interface RenderOptions {
  /** Where it rings (default day). */
  readonly space?: SpaceId;
  /** Where it is played (default desktop). */
  readonly profile?: ProfileId;
  /** Agents coalesced into it: a Done of several lands as a chord. */
  readonly count?: number;
  /** Where its agent is, −1 (left) … 1 (right); placed no further than PAN_LIMIT. */
  readonly pan?: number;
  /** Each note's own place, in score order (a Done chord's agents each from their own side). */
  readonly notePans?: readonly number[];
  /** dB from the cue's target (a reminder is −6). */
  readonly level?: number;
  /** 0 is the canonical take; 1… seeded detail (force, timing, pitch, the stars), never the notes or the contour. */
  readonly variant?: number;
  /** Time (a reminder is 1.25: a quarter slower). */
  readonly stretch?: number;
  /** The first strike's seed for its contact noise. */
  readonly seed?: number;
}

export interface RenderMeta {
  readonly cue: CueId;
  readonly space: SpaceId;
  readonly profile: ProfileId;
  /** The loudness it was mastered to, LUFS. */
  readonly target: number;
  readonly seconds: number;
  /** When the next sound may start, seconds from this one's start (SD-D10). */
  readonly clear: number;
  /** Seconds of space before the first strike. */
  readonly lead: number;
  /** Every strike's time, seconds, ascending. */
  readonly strikes: readonly number[];
  /** The master gain the loudness target asked for. */
  readonly gain: number;
}

export interface Render {
  readonly sampleRate: number;
  readonly channels: readonly [Float32Array, Float32Array];
  readonly meta: RenderMeta;
}

/** A note as this moment strikes it. */
interface Struck {
  t: number;
  n: string;
  v: number;
  land?: boolean;
  damp?: number;
  hard?: number;
  bend?: Bend;
  cents?: number;
  pan?: number;
}

/** A cue's score laid out for its moment: its notes struck, its lead, its strikes. */
export interface Layout {
  readonly notes: readonly Struck[];
  readonly lead: number;
  readonly strikes: readonly number[];
  /** Semitones the master asked it up (the phone's All quiet). */
  readonly shift: number;
}

const clampPan = (p: number): number => Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, p));

/** A cue's notes for a given count of agents: a coalesced Done lands as a chord climbing the field. */
function scoreFor(cue: CueSpec, opts: RenderOptions): Struck[] {
  const notes: Struck[] = cue.notes.map((x) => ({ ...x }));
  // Pickups ring shorter than the note they lead to (one hand stops the first bar as the other strikes the next), so
  // the contour reads, not a held chord.
  const lastT = Math.max(...notes.map((x) => x.t));
  for (const x of notes) if (x.t < lastT && x.damp === undefined) x.damp = cue.pickupDamp ?? 0.5;
  const count = Math.max(1, opts.count || 1);
  if (count > 1) {
    // Each extra agent adds the next harmonic above the landing (its fifth, ninth, twelfth), strummed 22 ms apart:
    // one agent is a note, two an open fifth, four the field's own chord.
    const base = notes.find((x) => x.land) || notes[notes.length - 1]!;
    const extra = [7, 14, 19].slice(0, Math.min(3, count - 1));
    for (const [i, s] of extra.entries()) {
      notes.push({ t: base.t + 0.022 * (i + 1), n: above(base.n, s), v: base.v * (0.7 - 0.1 * i) });
    }
  }
  const pans = opts.notePans;
  if (pans) for (const [i, x] of notes.entries()) x.pan = pans[i % pans.length]!;
  return notes;
}

/** Lay out a cue for its moment (the same layout `render` plays, so spacing never needs the samples). */
export function layout(cueId: CueId, opts: RenderOptions = {}): Layout {
  const cue = CUES[cueId];
  const pf = PROFILES[opts.profile || "desktop"];
  const stretch = opts.stretch || 1;
  const lead = (cue.lead || 0) * stretch;
  // where nothing low survives the speaker (the phone), a cue may ask to be played an octave up
  const shift = (pf.hp >= 300 && cue.phoneShift) || 0;
  const notes = scoreFor(cue, opts);
  for (const x of notes) {
    x.t *= stretch;
    if (shift) x.n = above(x.n, shift);
  }
  // Variants: a sound heard all day should not be a photocopy. Variant 0 is the canonical take; variants 1… nudge
  // each strike by at most ±6% in force, ±4 ms in time (never the first strike) and ±2 cents in pitch, and the
  // stars scatter anew; the notes and the contour never change (THX's lesson: fix the identity, vary the detail).
  const variant = opts.variant || 0;
  if (variant) {
    const jr = rng(0x5eed + variant * 7919);
    // notes struck together (a chord, a doubling) move together: the timing nudge is per strike
    const nudge = new Map<number, number>();
    for (const x of notes) {
      x.v = Math.min(1, x.v * (1 + (jr() * 2 - 1) * 0.06));
      if (!nudge.has(x.t)) nudge.set(x.t, x.t > 0 ? (jr() * 2 - 1) * 0.004 : 0);
      x.cents = (jr() * 2 - 1) * 2;
    }
    for (const x of notes) x.t = Math.max(x.t > 0 ? 0.001 : 0, x.t + nudge.get(x.t)!);
  }
  const strikes = [...new Set(notes.map((x) => +(lead + x.t).toFixed(3)))].sort((a, b) => a - b);
  return { notes, lead, strikes, shift };
}

/**
 * When the next sound may start after this one, seconds from its start: its last strike plus 450 ms (SD-D10). The
 * tails may overlap: every tail is a partial of the same chord.
 */
export function clearOf(cueId: CueId, opts: RenderOptions = {}): number {
  const { strikes } = layout(cueId, opts);
  return strikes[strikes.length - 1]! + CLEAR_AFTER_S;
}

/** The voice and the space as this master hears them. */
function prepare(
  cue: CueSpec,
  space0: SpaceSpec,
  opts: RenderOptions,
): { voice: VoiceSpec; sp: SpaceSpec } {
  const pf = PROFILES[opts.profile || "desktop"];
  let voice = STARLIGHT;
  if (pf.ring !== 1) {
    // a shorter ring where the file's length is a cost (the phone)
    voice = {
      ...voice,
      core: { ...voice.core, modes: voice.core.modes.map((m) => ({ ...m, t60: m.t60 * pf.ring })) },
      bloom: { ...voice.bloom, t60: voice.bloom.t60 * pf.ring },
    };
  }
  const adj = cue.layers.space || {};
  const sp: SpaceSpec = {
    ...space0,
    rt60: space0.rt60 * pf.rt,
    damp: Math.min(0.92, space0.damp + (adj.damp || 0)),
    wet: space0.wet + (adj.wet || 0) + pf.wet,
    shimmer: space0.shimmer + (adj.shimmer || 0),
    stars: space0.stars * (adj.stars ?? 1) * pf.stars,
  };
  return { voice, sp };
}

/** Render a cue to stereo, mastered to its target. Deterministic: the same cue and options give the same samples. */
export function render(cueId: CueId, opts: RenderOptions = {}): Render {
  const cue = CUES[cueId];
  const spaceId = opts.space || "day";
  const profileId = opts.profile || "desktop";
  const pf = PROFILES[profileId];
  const { voice, sp } = prepare(cue, SPACES[spaceId], opts);
  const L0 = cue.layers;
  const soften = sp.soften || 1;
  const stretch = opts.stretch || 1;
  const { notes, lead, strikes, shift } = layout(cueId, opts);
  const T = (t: number): number => lead + t * stretch;
  const up = (name: string): string => (shift ? above(name, shift) : name);
  const variant = opts.variant || 0;
  const lastT = Math.max(...notes.map((x) => x.t));
  const tail = Math.min(9, sp.rt60 * 1.3 + 1.2);
  const n = Math.ceil((lead + lastT + tail) * SR);
  const dryL = new Float32Array(n);
  const dryR = new Float32Array(n);
  const send = new Float32Array(n);
  // the sub, the knocks and the swell are not sent to the space
  const lowL = new Float32Array(n);
  const lowR = new Float32Array(n);
  const rnd = rng(hashOf(`${cue.label}|${voice.label}`) + variant * 104729);
  let seed = opts.seed ?? 7;

  // 1. the core: every strike, placed where its agent is (equal power, dry only; the space stays wide)
  let corePeakAmp = 0;
  for (const note of notes) {
    const f = tuned(note.n) * 2 ** ((note.cents || 0) / 1200);
    const one = coreTone(voice.core, f, note.v, {
      damp: note.damp,
      bend: note.bend,
      hard: note.hard,
      soften,
      seed: seed++,
    });
    const at = Math.round((lead + note.t) * SR);
    const [gl, gr] = equalPower(clampPan((note.pan ?? 0) + (opts.pan ?? 0)));
    mixInto(dryL, one, at, gl);
    mixInto(dryR, one, at, gr);
    mixInto(send, one, at, 1);
    corePeakAmp = Math.max(corePeakAmp, 0.25 + 0.75 * note.v);
  }
  const pan0 = clampPan(opts.pan ?? 0);

  // 2. the bloom: chord tones sung softly under the landing
  if (L0.bloom) {
    const b = L0.bloom;
    const at = Math.round(T(b.at) * SR);
    const wsum = Math.sqrt(b.notes.reduce((s, [, w]) => s + w * w, 0)) || 1;
    b.notes.forEach(([name, w], i) => {
      const amp = (dB(voice.bloom.level) * b.v * w) / wsum;
      const [bl, br] = bloomTone(voice.bloom, tuned(up(name)), amp, soften);
      // low chord tones sit in the middle; higher ones open out to alternate sides
      const spread = Math.min(0.5, 0.12 * i) * (i % 2 ? 1 : -1);
      const [gl, gr] = equalPower(clampPan(pan0 * 0.5 + spread));
      const k = Math.SQRT2;
      mixInto(dryL, bl, at, gl * k);
      mixInto(dryR, br, at, gr * k);
      const s = voice.bloom.send;
      for (let j = 0; j < bl.length && at + j < n; j++)
        send[at + j]! += ((bl[j]! + br[j]!) / 2) * s;
    });
  }

  // 3. the stars: the field's high harmonics glinting after the landing
  if (L0.stars && sp.stars > 0) {
    const count = Math.round(voice.stars.count * sp.stars * L0.stars.v);
    const amp = dB(voice.stars.level) * Math.min(1.2, L0.stars.v);
    addStars(dryL, dryR, send, T(L0.stars.from), voice.stars, count, amp, rnd);
  }

  // 4. the sub: the fundamental's octave under the landing, felt (not sent: a sub in a reverb is mud)
  if (L0.sub) {
    const s = subTone(tuned(up(L0.sub.n)), dB(voice.sub.level) * L0.sub.v, voice.sub);
    const at = Math.round(T(L0.sub.at) * SR);
    mixInto(lowL, s, at, Math.SQRT1_2);
    mixInto(lowR, s, at, Math.SQRT1_2);
  }

  // 5. the knocks: a low knock with weight under a knock or a failure
  if (L0.thump) {
    for (const t of L0.thump.at) {
      const s = thumpTone(
        tuned(up(L0.thump.n)),
        dB(voice.thump.level) * L0.thump.v,
        voice.thump,
        seed++,
      );
      const at = Math.round(T(t) * SR);
      mixInto(lowL, s, at, Math.SQRT1_2);
      mixInto(lowR, s, at, Math.SQRT1_2);
      mixInto(send, s, at, 0.25);
    }
  }

  // 6. the ash: the tone drained out of a failure, a puff where the chord would be
  if (L0.ash) {
    const s = ashTone(voice.ash, dB(voice.ash.level) * L0.ash.v * corePeakAmp, seed++);
    const at = Math.round(T(L0.ash.at) * SR);
    mixInto(dryL, s, at, Math.SQRT1_2);
    mixInto(dryR, s, at, Math.SQRT1_2);
    mixInto(send, s, at, 0.5);
  }

  // 7. the space and its shimmer (the tail raised an octave and sent round the space again, once), calibrated
  // TOGETHER: `wet` is the whole tail's energy against the dry sound's, so a brighter shimmer never makes the strike
  // stand less clear of its tail.
  const [wl, wr] = fdn(send, sp, n);
  const shimDb = voice.shimmer + sp.shimmer;
  if (shimDb > -50) {
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (wl[i]! + wr[i]!) / 2;
    // band-limited before the octave (nothing the octave pushes past Nyquist aliases) and after
    biquadInPlace(mono, "lp", 9000, 0.7);
    const upOct = octaveUp(mono);
    biquadInPlace(upOct, "lp", 9000, 0.7);
    const [shL, shR] = fdn(
      upOct,
      { ...sp, pre: 0, rt60: sp.rt60 * 1.3, damp: Math.max(0.15, sp.damp - 0.15) },
      n,
    );
    const eW = energy(wl, wr);
    const eS = energy(shL, shR);
    const k = eS > 0 ? Math.sqrt(eW / eS) * dB(shimDb) : 0;
    for (let i = 0; i < n; i++) {
      wl[i]! += shL[i]! * k;
      wr[i]! += shR[i]! * k;
    }
  }
  {
    const eDry = energy(dryL, dryR);
    const eWet = energy(wl, wr);
    const k = eWet > 0 && sp.wet > -60 ? Math.sqrt(eDry / eWet) * dB(sp.wet) : 0;
    for (let i = 0; i < n; i++) {
      wl[i]! *= k;
      wr[i]! *= k;
    }
  }

  // 8. the swell: the space breathing in before the mark's first note
  if (L0.swell) {
    for (const w of L0.swell) {
      const ms = (w.ms || voice.swell.ms) * stretch;
      const [sl, sr] = swellTone(voice.core, sp, tuned(up(w.n)), ms, seed++);
      const end = Math.round(T(w.into) * SR);
      const g = dB(voice.swell.level) * w.v * corePeakAmp;
      mixInto(lowL, sl, end - sl.length, g);
      mixInto(lowR, sr, end - sr.length, g);
    }
  }

  // the far space: what crosses the field arrives dim
  if (sp.lp) {
    biquadInPlace(dryL, "lp", sp.lp, 0.6);
    biquadInPlace(dryR, "lp", sp.lp, 0.6);
    biquadInPlace(lowL, "lp", sp.lp * 1.5, 0.6);
    biquadInPlace(lowR, "lp", sp.lp * 1.5, 0.6);
  }
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = dryL[i]! + wl[i]! + lowL[i]!;
    R[i] = dryR[i]! + wr[i]! + lowR[i]!;
  }

  // The master: below the profile's high-pass is rumble the speaker cannot play; the night tilts darker; the phone
  // lifts its top.
  for (const c of [L, R]) {
    biquadInPlace(c, "hp", pf.hp, BUTTERWORTH_Q);
    if (sp.tilt) biquadInPlace(c, "hs", 3000, BUTTERWORTH_Q, sp.tilt);
    if (pf.shelf) biquadInPlace(c, "hs", 2500, BUTTERWORTH_Q, pf.shelf);
  }
  // Loudness: the cue's target, the space's gain, the profile's offset, the caller's level.
  const target = cue.target + (sp.gain || 0) + pf.offset + (opts.level || 0);
  const m = momentaryMax([L, R]);
  const g = Number.isFinite(m) ? dB(target - m) : 1;
  let peak = 0;
  for (const c of [L, R]) {
    for (let i = 0; i < n; i++) {
      c[i]! *= g;
      peak = Math.max(peak, Math.abs(c[i]!));
    }
  }
  // The ceiling: on the desktop a guard never reached; on the phone a real limiter, then made up to the target again
  // (up to five passes) so a peaky sound keeps its place.
  if (peak > pf.ceiling) {
    limit([L, R], pf.ceiling);
    for (let pass = 0; pass < 5; pass++) {
      const short = target - momentaryMax([L, R]);
      if (short < 0.25) break;
      const makeUp = dB(short);
      for (const c of [L, R]) for (let i = 0; i < n; i++) c[i]! *= makeUp;
      limit([L, R], pf.ceiling);
    }
  }
  // The tail is trimmed where it has fallen `trim` dB under the peak (never above −72 dBFS on the desktop's quiet
  // masters), and its last 80 ms fade.
  let last = 0;
  let pkAll = 0;
  for (let i = 0; i < n; i++) pkAll = Math.max(pkAll, Math.abs(L[i]!), Math.abs(R[i]!));
  const floor = Math.max(dB(TAIL_FLOOR_DB), pkAll * dB(pf.trim));
  for (let i = 0; i < n; i++) if (Math.abs(L[i]!) > floor || Math.abs(R[i]!) > floor) last = i;
  const fade = Math.round(0.08 * SR);
  const len = Math.min(n, last + fade);
  const outL = L.slice(0, len);
  const outR = R.slice(0, len);
  for (let i = 0; i < fade && i < len; i++) {
    const w = 0.5 + 0.5 * Math.cos((Math.PI * i) / fade);
    outL[len - fade + i]! *= w;
    outR[len - fade + i]! *= w;
  }
  return {
    sampleRate: SR,
    channels: [outL, outR],
    meta: {
      cue: cueId,
      space: spaceId,
      profile: profileId,
      target,
      seconds: len / SR,
      clear: strikes[strikes.length - 1]! + CLEAR_AFTER_S,
      lead,
      strikes,
      gain: g,
    },
  };
}
