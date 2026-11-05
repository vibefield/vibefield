/**
 * The layers of a sound (DESIGN.md §14 S5): the core, an excitation of the field, and the field's answer around it.
 */
import {
  addPartial,
  type Bend,
  biquadInPlace,
  chorusInPlace,
  equalPower,
  makeGlide,
  rng,
  SR,
} from "./dsp.ts";
import { FUNDAMENTAL } from "./field.ts";
import type { AshSpec, BloomSpec, CoreSpec, StarsSpec, SubSpec, ThumpSpec } from "./score.ts";

/** How one strike is played: damp (a hand on the bar), hard (< 1: a knock), soften (the space's mallet), bend, seed. */
export interface StrikeOptions {
  readonly damp?: number | undefined;
  readonly hard?: number | undefined;
  readonly soften?: number | undefined;
  readonly bend?: Bend | undefined;
  readonly seed?: number | undefined;
}

/** One strike of a voice's core at f Hz, velocity v → mono samples from the strike on. */
export function coreTone(
  core: CoreSpec,
  f: number,
  v: number,
  opts: StrikeOptions = {},
): Float32Array {
  const damp = opts.damp ?? 1;
  const hard = opts.hard ?? 1;
  // the night's and the far space's softer mallet softens a knock only half as much: a knock stays a knock
  const soften = hard < 1 ? Math.sqrt(opts.soften ?? 1) : (opts.soften ?? 1);
  // harder hits are shorter contacts: a real mallet brightens as you play louder
  const contact = (core.mallet.contact * soften * hard * (1.2 - 0.35 * v)) / 1000;
  const attack = Math.max(0.0004, (core.mallet.attack * soften * hard) / 1000);
  const fc = 0.62 / Math.max(contact, 1e-5);
  const pitchScale = (880 / f) ** core.pitchDecay;
  let longest = 0;
  for (const m of core.modes) longest = Math.max(longest, m.t60 * pitchScale * damp);
  const out = new Float32Array(Math.ceil((attack + longest * 1.4 + 0.06) * SR));
  const glide = makeGlide(opts.bend, undefined);
  for (const mode of core.modes) {
    const fm = f * mode.r;
    if (fm > SR * 0.42) continue;
    // the mallet's contact acts as a smooth low-pass on what it can excite
    const excite = 1 / Math.sqrt(1 + (fm / fc) ** 4);
    const amp = mode.a * excite * (0.25 + 0.75 * v);
    if (amp < 1e-4) continue;
    const t60 = mode.t60 * pitchScale * damp;
    if (core.doublet) {
      const split = 2 ** (core.doublet / 1200 / 2);
      addPartial(out, 0, fm / split, amp / 2, attack, t60, glide);
      // the second of a doublet rings a touch longer: life, not a chorus
      addPartial(out, 0, fm * split, amp / 2, attack, t60 / 0.93, glide);
    } else {
      addPartial(out, 0, fm, amp, attack, t60, glide);
    }
  }
  const nz = core.noise;
  if (nz.level > 0) {
    const r = rng((opts.seed ?? 1) * 2654435761 + Math.round(f));
    const nlen = Math.min(out.length, Math.round(((nz.ms * soften * 4) / 1000) * SR));
    const tick = new Float32Array(nlen);
    const kn = Math.log(1000) / ((nz.ms * soften) / 1000);
    for (let i = 0; i < nlen; i++) tick[i] = (r() * 2 - 1) * Math.exp(-kn * (i / SR));
    biquadInPlace(tick, "hp", nz.hp, 0.7);
    biquadInPlace(tick, "lp", nz.lp / soften, 0.7);
    const g = nz.level * (0.3 + 0.7 * v) * v;
    for (let i = 0; i < nlen; i++) out[i]! += g * tick[i]!;
  }
  return out;
}

/**
 * A sung chord tone: an organ's fixed harmonics, two voices a few cents apart placed a little apart, a slow attack, a
 * long fall; the second voice drifts (a slow chorus). → [L, R] from its start.
 */
export function bloomTone(
  spec: BloomSpec,
  f: number,
  amp: number,
  soften = 1,
): [Float32Array, Float32Array] {
  const attack = (spec.attack / 1000) * soften;
  const hold = 0;
  const len = Math.ceil((attack * 1.15 + hold + spec.t60 * 1.45 + 0.05) * SR);
  const A = new Float32Array(len);
  const B = new Float32Array(len);
  const split = 2 ** (spec.detune / 1200 / 2);
  spec.harmonics.forEach((a, k) => {
    const fk = f * (k + 1);
    if (fk > 9000 || a < 1e-3) return;
    const t60 = spec.t60 / (1 + 0.45 * k);
    addPartial(A, 0, fk / split, (a * amp) / 2, attack, t60, null, hold);
    addPartial(B, 0, fk * split, (a * amp) / 2, attack * 1.15, t60 * 1.05, null, hold);
  });
  chorusInPlace(B, spec.chorus);
  const w = spec.width;
  const [al, ar] = equalPower(-w);
  const [bl, br] = equalPower(w);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    L[i] = A[i]! * al + B[i]! * bl;
    R[i] = A[i]! * ar + B[i]! * br;
  }
  return [L, R];
}

/**
 * The field's fundamental an octave or two down: a sine settling into pitch from a little above (a soft boom), with
 * its second and third harmonics, which is what a laptop's speaker can actually play of it.
 */
export function subTone(f: number, v: number, spec: SubSpec): Float32Array {
  const attack = 0.022;
  const len = Math.ceil((attack + spec.t60 * 1.25 + 0.05) * SR);
  const out = new Float32Array(len);
  const k = Math.log(1000) / spec.t60;
  const att = Math.round(attack * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * f * 2 ** ((spec.drop * Math.exp(-t / 0.06)) / 1200)) / SR;
    const a = i < att ? 0.5 - 0.5 * Math.cos((Math.PI * i) / att) : 1;
    out[i] =
      v *
      a *
      Math.exp(-k * t) *
      (Math.sin(ph) + spec.h2 * Math.sin(2 * ph) + spec.h3 * Math.sin(3 * ph));
  }
  return out;
}

/** A low knock with weight: a sine falling into its pitch from above (a stone settling) and a puff of dark noise. */
export function thumpTone(f: number, v: number, spec: ThumpSpec, seed: number): Float32Array {
  const t60 = spec.t60;
  const len = Math.ceil((t60 * 1.3 + 0.03) * SR);
  const out = new Float32Array(len);
  const k = Math.log(1000) / t60;
  const r = rng(seed);
  const a1 = Math.exp((-2 * Math.PI * spec.noiseLp) / SR);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * f * (1 + spec.fall * Math.exp(-t / 0.018))) / SR;
    const a = Math.min(1, i / (0.0015 * SR));
    lp = (r() * 2 - 1) * (1 - a1) + lp * a1;
    out[i] = v * a * (Math.exp(-k * t) * Math.sin(ph) + spec.noise * 4 * lp * Math.exp(-t / 0.012));
  }
  return out;
}

/**
 * The ash: the tone drained out of a strike (SD-D4), a puff of noise where the chord would be, its band falling from
 * `hi` to `lo` as it dies (a candle going out, not static). Peak-normalised; the voice's level sets it.
 */
export function ashTone(spec: AshSpec, v: number, seed: number): Float32Array {
  const tau = spec.ms / 1000;
  const len = Math.ceil((tau * 7 + 0.02) * SR);
  const out = new Float32Array(len);
  const r = rng(seed);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const x = (r() * 2 - 1) * Math.min(1, t / 0.003) * Math.exp(-t / tau);
    // two one-pole low-passes whose corner glides down over the puff
    const fc = spec.hi * (spec.lo / spec.hi) ** Math.min(1, t / (tau * 2.5));
    const a = Math.exp((-2 * Math.PI * fc) / SR);
    y1 = x * (1 - a) + y1 * a;
    y2 = y1 * (1 - a) + y2 * a;
    out[i] = y2;
  }
  biquadInPlace(out, "hp", spec.lo * 0.5, 0.7);
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(out[i]!));
  for (let i = 0; i < len; i++) out[i]! *= v / (pk || 1);
  return out;
}

/** The field's harmonics the stars glint at: A♭6 C7 D♭7 E♭7 F7 A♭7 C8 D♭8 (1.7–4.4 kHz), above every melody note. */
export const STAR_HARMONICS: readonly number[] = [48, 60, 64, 72, 80, 96, 120, 128];

/**
 * Stars (SD-D7): grains of the field's high harmonics scattered after a landing, thick at first and then fewer, each a
 * tiny glint anywhere across the stereo field. None in the first 120 ms, so the landing is heard alone, and each rises
 * over 15 ms: a glint, never a strike.
 */
export function addStars(
  L: Float32Array,
  R: Float32Array,
  send: Float32Array,
  at: number,
  spec: StarsSpec,
  count: number,
  amp: number,
  rnd: () => number,
): void {
  for (let i = 0; i < count; i++) {
    const u = rnd();
    const dt = 0.12 + (spec.spread * -Math.log(1 - u * (1 - Math.exp(-3)))) / 3;
    const f = FUNDAMENTAL * STAR_HARMONICS[Math.floor(rnd() * STAR_HARMONICS.length)]!;
    const a = amp * (0.35 + 0.65 * rnd()) * (1 - (0.5 * dt) / spec.spread);
    const tau = (spec.ms * (0.7 + 0.6 * rnd())) / 1000;
    const pan = (rnd() * 2 - 1) * 0.8;
    const [gl, gr] = equalPower(pan);
    const c = Math.round((at + dt) * SR);
    const rise = Math.max(1, Math.round(0.015 * SR));
    const n = Math.round(tau * 7 * SR);
    for (let j = 0; j < n; j++) {
      const idx = c + j;
      if (idx >= L.length) break;
      const env = (j < rise ? j / rise : 1) * Math.exp(-j / SR / tau);
      const ph = (2 * Math.PI * f * j) / SR;
      const s = a * env * Math.sin(ph);
      L[idx]! += s * gl;
      R[idx]! += s * gr;
      send[idx]! += s;
    }
  }
}
