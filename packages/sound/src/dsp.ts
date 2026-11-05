/**
 * The signal helpers every layer shares. Everything here is deterministic: the only randomness is seeded (`rng`), so a
 * render is a pure function of its score, its options and its seed.
 */

/** The sample rate every sound is rendered at. */
export const SR = 48000;

/** Decibels → a linear gain. */
export const dB = (x: number): number => 10 ** (x / 20);

/** A stereo pair of gains for a place −1 (left) … 1 (right), equal power. */
export function equalPower(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  const a = ((p + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** A seeded xorshift32 generator in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 0x2545f491;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** FNV-1a over a string: a seed from a name. */
export function hashOf(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Butterworth's Q as every master was measured with it: 0.7071, not √½ to the last digit, because the renders stay
 * sample for sample the ones the record measured (DESIGN.md §14; the lab engine and this package are bit-identical).
 */
// biome-ignore lint/suspicious/noApproximativeNumericConstant: the measured renders use 0.7071 exactly (above)
export const BUTTERWORTH_Q = 0.7071;

/** An RBJ biquad, in place: a low-pass, a high-pass, or a high shelf of `gainDb`. */
export function biquadInPlace(
  x: Float32Array,
  type: "lp" | "hp" | "hs",
  f0: number,
  q = BUTTERWORTH_Q,
  gainDb = 0,
): Float32Array {
  const w = (2 * Math.PI * f0) / SR;
  const cs = Math.cos(w);
  const sn = Math.sin(w);
  const alpha = sn / (2 * q);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  if (type === "lp") {
    b0 = (1 - cs) / 2;
    b1 = 1 - cs;
    b2 = (1 - cs) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cs;
    a2 = 1 - alpha;
  } else if (type === "hp") {
    b0 = (1 + cs) / 2;
    b1 = -(1 + cs);
    b2 = (1 + cs) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cs;
    a2 = 1 - alpha;
  } else {
    const A = 10 ** (gainDb / 40);
    const s2 = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cs + s2);
    b1 = -2 * A * (A - 1 + (A + 1) * cs);
    b2 = A * (A + 1 + (A - 1) * cs - s2);
    a0 = A + 1 - (A - 1) * cs + s2;
    a1 = 2 * (A - 1 - (A + 1) * cs);
    a2 = A + 1 - (A - 1) * cs - s2;
  }
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  a1 /= a0;
  a2 /= a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i]!;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

/** A pitch curve over time (seconds from the strike) → a frequency ratio. */
export type Glide = (t: number) => number;

/** A bend after the strike: `cents`, starting `at` seconds after it, smoothstepped over `ms`. */
export interface Bend {
  readonly cents: number;
  readonly at: number;
  readonly ms: number;
}

/** A scoop into pitch at the onset (cents, over `ms`). */
export interface Scoop {
  readonly cents: number;
  readonly ms: number;
}

/** A glide: a bend after the strike and/or a scoop into pitch at the onset; null when the pitch stays put. */
export function makeGlide(bend: Bend | undefined, scoop: Scoop | undefined): Glide | null {
  if (!bend && !scoop) return null;
  return (t) => {
    let c = 0;
    if (bend && t > bend.at) {
      const u = Math.min(1, (t - bend.at) / (bend.ms / 1000));
      c += bend.cents * u * u * (3 - 2 * u);
    }
    if (scoop && t < scoop.ms / 1000) {
      const u = t / (scoop.ms / 1000);
      c += scoop.cents * (1 - u) * (1 - u);
    }
    return 2 ** (c / 1200);
  };
}

/**
 * Add a damped sinusoid: a raised-cosine attack, an optional hold (a sung note), then an exponential fall (t60, the
 * seconds to fall 60 dB), ending 84 dB down. A recurrence oscillator when the pitch is fixed; phase accumulation when
 * it glides.
 */
export function addPartial(
  out: Float32Array,
  at: number,
  f: number,
  amp: number,
  attack: number,
  t60: number,
  glide: Glide | null,
  hold = 0,
): void {
  const len = out.length - at;
  if (len <= 0 || amp < 1e-6 || f <= 0) return;
  const n = Math.min(len, Math.ceil((attack + hold + t60 * 1.4 + 0.02) * SR));
  const att = Math.max(1, Math.round(attack * SR));
  const still = att + Math.round(hold * SR); // the fall starts after the attack and the hold
  const dec = Math.exp(-Math.log(1000) / Math.max(t60, 0.005) / SR);
  let e = amp;
  if (!glide) {
    const w = (2 * Math.PI * f) / SR;
    const c2 = 2 * Math.cos(w);
    let s1 = Math.sin(-w);
    let s2 = Math.sin(-2 * w);
    for (let i = 0; i < n; i++) {
      const s = c2 * s1 - s2;
      s2 = s1;
      s1 = s;
      const a = i < att ? 0.5 - 0.5 * Math.cos((Math.PI * i) / att) : 1;
      out[at + i]! += e * a * s;
      if (i >= still) e *= dec;
    }
  } else {
    let ph = 0;
    const w0 = (2 * Math.PI * f) / SR;
    for (let i = 0; i < n; i++) {
      ph += w0 * glide(i / SR);
      const a = i < att ? 0.5 - 0.5 * Math.cos((Math.PI * i) / att) : 1;
      out[at + i]! += e * a * Math.sin(ph);
      if (i >= still) e *= dec;
    }
  }
}

/** A slow chorus's settings: a delay of `base` ms wandering ± `depth` ms at `rate` Hz. */
export interface Chorus {
  readonly base: number;
  readonly depth: number;
  readonly rate: number;
}

/**
 * A slow chorus in place: the signal read through a delay that wanders. Its pitch drift is 1200·log2(1 + 2π·rate·depth)
 * cents: an ensemble of singers drifting, not two oscillators.
 */
export function chorusInPlace(x: Float32Array, { base, depth, rate }: Chorus): void {
  const n = x.length;
  const src = Float32Array.from(x);
  for (let i = 0; i < n; i++) {
    const d = ((base + depth * Math.sin((2 * Math.PI * rate * i) / SR)) / 1000) * SR;
    const p = i - d;
    if (p < 0) {
      x[i] = 0;
      continue;
    }
    const i0 = Math.floor(p);
    const fr = p - i0;
    x[i] = src[i0]! * (1 - fr) + (i0 + 1 < n ? src[i0 + 1]! : 0) * fr;
  }
}

/** Mix `src` into `dst` from sample `at`, scaled by `g`. */
export function mixInto(dst: Float32Array, src: Float32Array, at: number, g: number): void {
  const n = Math.min(src.length, dst.length - at);
  for (let i = Math.max(0, -at); i < n; i++) dst[at + i]! += src[i]! * g;
}

/** The mean energy per channel of one or more channels. */
export function energy(...cs: readonly Float32Array[]): number {
  let e = 0;
  for (const c of cs) for (let i = 0; i < c.length; i++) e += c[i]! * c[i]!;
  return e / cs.length;
}

/**
 * A look-ahead peak limiter that never steps: the gain needed at each sample is held as the minimum over the next
 * `lookMs`, then averaged over the previous `lookMs` (so the gain ramps down across the look-ahead and has reached its
 * floor when the peak arrives), and recovers over `releaseMs`.
 */
export function limit(
  channels: readonly Float32Array[],
  ceiling: number,
  lookMs = 4,
  releaseMs = 80,
): void {
  const n = channels[0]!.length;
  const look = Math.max(2, Math.round((lookMs / 1000) * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of channels) p = Math.max(p, Math.abs(c[i]!));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  const hold = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1;
    for (let k = i; k < Math.min(n, i + look); k++) if (need[k]! < m) m = need[k]!;
    hold[i] = m;
  }
  const rel = Math.exp(-1 / ((releaseMs / 1000) * SR));
  const gain = new Float32Array(n);
  const ring = new Float32Array(look).fill(hold[0]!);
  let sum = hold[0]! * look;
  let g = hold[0]!;
  for (let i = 0; i < n; i++) {
    const slot = i % look;
    sum += hold[i]! - ring[slot]!;
    ring[slot] = hold[i]!;
    const target = Math.min(1, sum / look);
    g = target < g ? target : target - (target - g) * rel;
    gain[i] = g;
  }
  for (const c of channels) for (let i = 0; i < n; i++) c[i]! *= gain[i]!;
}
