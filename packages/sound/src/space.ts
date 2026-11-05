/**
 * The space a sound rings in (DESIGN.md §14 "The spaces"): a modulated feedback delay network, its tail raised an
 * octave for the shimmer, and the space breathing in before the mark (a reversed reverb).
 */
import { SR } from "./dsp.ts";
import { coreTone } from "./layers.ts";
import type { CoreSpec } from "./score.ts";

/** What the network reads of a space. */
export interface Reverb {
  readonly rt60: number;
  readonly size: number;
  readonly damp: number;
  readonly pre: number;
  readonly mod: number;
}

const FDN_LEN: readonly number[] = [1129, 1451, 1733, 1999, 2371, 2753, 3061, 3457];
const DIFFUSE: readonly number[] = [142, 107, 379, 277];
const MOD_HZ: readonly number[] = [0.11, 0.17, 0.23, 0.29, 0.37, 0.43, 0.53, 0.61];
// The input enters each line a little later than the last (OFFSET, samples × size), and the input and output taps are
// sign vectors that are not rows of the Hadamard the loop mixes with (a row feeds one eigenvector and leaves the tail
// nearly mono). Chosen by search over every pair of tap vectors: across day, night and far, early, middle and late,
// the tail's L/R correlation stays between −0.08 and +0.72, never out of phase on a phone's single speaker.
const INJECT: readonly number[] = [-1, -1, 1, 1, -1, -1, 1, 1];
const TAP_L: readonly number[] = [-1, -1, -1, -1, -1, 1, 1, 1];
const TAP_R: readonly number[] = [-1, 1, -1, 1, 1, 1, -1, 1];
const OFFSET: readonly number[] = [0, 61, 137, 211, 293, 389, 467, 557];

/**
 * A space: four allpasses smear the input into a wash, eight delay lines (lengths × size) mix through a Hadamard,
 * each line's read point wanders slowly (mod) and its highs are lost (damp). → the wet [L, R], unscaled (the caller
 * calibrates it).
 */
export function fdn(
  monoIn: Float32Array,
  sp: Reverb,
  outLen?: number,
): [Float32Array, Float32Array] {
  const n = outLen || monoIn.length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const size = sp.size;
  const lens = FDN_LEN.map((d) => Math.max(64, Math.round(d * size)));
  const depth = sp.mod * 9;
  const B = lens.map((d) => d + Math.ceil(depth) + 4);
  const bufs = B.map((b) => new Float32Array(b));
  const w = new Int32Array(8); // each line's write index
  const g = lens.map((d) => 10 ** ((-3 * d) / (sp.rt60 * SR)));
  const damp = sp.damp;
  const keep = 1 - damp;
  const lp = new Float64Array(8);
  const o = new Float64Array(8);
  const mod = new Float64Array(8);
  const norm = 1 / Math.sqrt(8);
  const HIST = 4096;
  const hist = new Float32Array(HIST);
  const offs = OFFSET.map((x) => Math.round(x * size));
  const inj = INJECT.map((x) => x * 0.35);
  const pre = Math.round((sp.pre / 1000) * SR);
  const apLen = DIFFUSE.map((d) => Math.max(8, Math.round(d * Math.sqrt(size))));
  const ap = apLen.map((d) => new Float32Array(d));
  const api = new Int32Array(4);
  const inLen = monoIn.length;
  let h = 0;
  for (let s = 0; s < n; s++) {
    let x = s >= pre && s - pre < inLen ? monoIn[s - pre]! : 0;
    // input diffusion: four allpasses in series
    for (let a = 0; a < 4; a++) {
      const buf = ap[a]!;
      const i = api[a]!;
      const d = buf[i]!;
      const v = x + 0.6 * d;
      buf[i] = v;
      api[a] = i + 1 === apLen[a] ? 0 : i + 1;
      x = d - 0.6 * v;
    }
    if (depth && (s & 15) === 0) {
      for (let j = 0; j < 8; j++)
        mod[j] = depth * 0.5 * (1 + Math.sin((2 * Math.PI * MOD_HZ[j]! * s) / SR + j * 0.9));
    }
    let l = 0;
    let r = 0;
    for (let j = 0; j < 8; j++) {
      const b = bufs[j]!;
      const Bj = B[j]!;
      let p = w[j]! - lens[j]! + mod[j]!;
      if (p < 0) p += Bj;
      const i0 = p | 0;
      const fr = p - i0;
      const i1 = i0 + 1 === Bj ? 0 : i0 + 1;
      const v = b[i0]! + (b[i1]! - b[i0]!) * fr;
      // one-pole damping in the loop: highs die first, as they do in a real hall
      const y = v * keep + lp[j]! * damp;
      lp[j] = y;
      l += TAP_L[j]! * y;
      r += TAP_R[j]! * y;
      o[j] = y * g[j]!;
    }
    // an 8-point fast Hadamard, unrolled: every line feeds every other, losslessly (the gains decay it)
    const a0 = o[0]! + o[1]!;
    const a1 = o[0]! - o[1]!;
    const a2 = o[2]! + o[3]!;
    const a3 = o[2]! - o[3]!;
    const a4 = o[4]! + o[5]!;
    const a5 = o[4]! - o[5]!;
    const a6 = o[6]! + o[7]!;
    const a7 = o[6]! - o[7]!;
    const b0 = a0 + a2;
    const b2 = a0 - a2;
    const b1 = a1 + a3;
    const b3 = a1 - a3;
    const b4 = a4 + a6;
    const b6 = a4 - a6;
    const b5 = a5 + a7;
    const b7 = a5 - a7;
    o[0] = b0 + b4;
    o[4] = b0 - b4;
    o[1] = b1 + b5;
    o[5] = b1 - b5;
    o[2] = b2 + b6;
    o[6] = b2 - b6;
    o[3] = b3 + b7;
    o[7] = b3 - b7;
    hist[h] = x;
    for (let j = 0; j < 8; j++) {
      let hi = h - offs[j]!;
      if (hi < 0) hi += HIST;
      const wj = w[j]!;
      bufs[j]![wj] = o[j]! * norm + hist[hi]! * inj[j]!;
      w[j] = wj + 1 === B[j] ? 0 : wj + 1;
    }
    h = h + 1 === HIST ? 0 : h + 1;
    L[s] = l;
    R[s] = r;
  }
  return [L, R];
}

/**
 * An octave up, time kept: grains of 43 ms read at twice the speed and overlapped (Hann, 4×). In a reverb's tail its
 * seams are washed away; what is left is the tail an octave higher.
 */
export function octaveUp(x: Float32Array, ratio = 2, grain = 2048): Float32Array {
  const n = x.length;
  const hop = grain / 4;
  const out = new Float32Array(n);
  const win = new Float32Array(grain);
  for (let i = 0; i < grain; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / grain);
  for (let s = 0; s < n; s += hop) {
    for (let i = 0; i < grain && s + i < n; i++) {
      const p = s + i * ratio;
      const i0 = Math.floor(p);
      if (i0 + 1 >= n) break;
      const fr = p - i0;
      out[s + i]! += 0.5 * win[i]! * (x[i0]! * (1 - fr) + x[i0 + 1]! * fr);
    }
  }
  return out;
}

/**
 * The space breathing in before a note: the note's own reverb, reversed, rising into the strike (the oldest studio
 * trick for "something is about to arrive"). → [L, R] of `ms`, ending at the strike. Peak-normalised.
 */
export function swellTone(
  core: CoreSpec,
  sp: Reverb,
  f: number,
  ms: number,
  seed: number,
): [Float32Array, Float32Array] {
  const n = Math.round((ms / 1000) * SR);
  const skip = Math.round(0.06 * SR);
  const src = coreTone(core, f, 0.8, { soften: 1.4, seed });
  const [wl, wr] = fdn(
    src.subarray(0, Math.min(src.length, n + skip)),
    { ...sp, pre: 0, rt60: Math.max(2.5, sp.rt60) },
    n + skip,
  );
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let pk = 0;
  for (let i = 0; i < n; i++) {
    L[i] = wl[skip + n - 1 - i]!;
    R[i] = wr[skip + n - 1 - i]!;
    pk = Math.max(pk, Math.abs(L[i]!), Math.abs(R[i]!));
  }
  const fin = Math.round(n * 0.35);
  const fout = Math.round(0.004 * SR);
  for (let i = 0; i < n; i++) {
    let w = i < fin ? 0.5 - 0.5 * Math.cos((Math.PI * i) / fin) : 1;
    if (i >= n - fout) w *= (n - i) / fout;
    L[i]! *= w / (pk || 1);
    R[i]! *= w / (pk || 1);
  }
  return [L, R];
}
