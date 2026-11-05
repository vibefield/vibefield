/** Loudness the BS.1770 way (DESIGN.md §14 "The masters"): K-weighting and the momentary maximum. */
import { SR } from "./dsp.ts";

/** K-weighting at 48 kHz: the pre-filter (a high shelf, ~+4 dB above 1.7 kHz) and the RLB high-pass. */
function kWeighted(x: Float32Array): Float32Array {
  const y = Float32Array.from(x);
  const stages: readonly (readonly [number, number, number, number, number])[] = [
    [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
    [1, -2, 1, -1.99004745483398, 0.99007225036621],
  ];
  for (const [b0, b1, b2, a1, a2] of stages) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = y[i]!;
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
  }
  return y;
}

/** The loudest 400 ms of a sound, in LUFS (BS.1770's momentary loudness, read every 10 ms). */
export function momentaryMax(channels: readonly Float32Array[]): number {
  const pad = Math.round(SR * 0.4);
  const ws = channels.map((c) => {
    const x = new Float32Array(c.length + pad);
    x.set(c);
    return kWeighted(x);
  });
  const n = ws[0]!.length;
  const win = Math.round(SR * 0.4);
  const hop = Math.round(SR * 0.01);
  const pre = ws.map((w) => {
    const p = new Float64Array(w.length + 1);
    for (let i = 0; i < w.length; i++) p[i + 1] = p[i]! + w[i]! * w[i]!;
    return p;
  });
  let best = Number.NEGATIVE_INFINITY;
  for (let s = 0; s + win <= n; s += hop) {
    let z = 0;
    for (const p of pre) z += (p[s + win]! - p[s]!) / win;
    const l = -0.691 + 10 * Math.log10(z || 1e-30);
    if (l > best) best = l;
  }
  return best;
}
