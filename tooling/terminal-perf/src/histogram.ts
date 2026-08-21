// Stage histograms — the shape every §19 probe reports and the only shape a
// slice may publish (TP-L-G: "a slice that cannot publish its stage histograms
// does not ship").
//
// Deliberately NOT a streaming/approximate digest: a microbench run holds every
// sample anyway (tens of thousands of doubles is nothing), and an exact quantile
// removes one class of "is that the instrument or the code" question from every
// later comparison. The in-app sampler, which must be bounded, reuses `summarize`
// over ghosttea's own already-bounded sample arrays rather than growing a second
// estimator.

export interface Histogram {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  /** The mean is reported beside the quantiles because a mean that disagrees
   * with p50 is the fastest read on a skewed distribution. */
  readonly mean: number;
  /** Sum of all samples — lets a caller derive throughput without the raw array. */
  readonly total: number;
}

export const EMPTY_HISTOGRAM: Histogram = {
  count: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  max: 0,
  mean: 0,
  total: 0,
};

/**
 * Nearest-rank quantile over an ASCENDING sorted array.
 *
 * Nearest-rank rather than interpolated: every reported number is then a sample
 * that actually occurred, so "p99 = 4.1ms" names a frame that took 4.1ms rather
 * than a weighted average of two frames that never happened.
 */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}

/** Summarize samples. The input is not mutated. */
export function summarize(samples: readonly number[]): Histogram {
  if (samples.length === 0) return EMPTY_HISTOGRAM;
  const sorted = [...samples].sort((a, b) => a - b);
  let total = 0;
  for (const value of sorted) total += value;
  return {
    count: sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1] as number,
    mean: total / sorted.length,
    total,
  };
}

/**
 * The MEDIAN of per-run estimates — the loaded-host rule's estimator (TC §9,
 * spec §19.4).
 *
 * This host is never quiet, so the estimate of a run is not its mean: one
 * scheduling storm during run 3 of 7 moves a mean and does not move a median.
 * Repeated runs feed this; a single run has no defence and reports itself.
 */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Round for reporting without pretending to precision the clock lacks. */
export function round(value: number, decimals = 3): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** A histogram rounded for JSONL/markdown output. */
export function roundHistogram(histogram: Histogram, decimals = 3): Histogram {
  return {
    count: histogram.count,
    p50: round(histogram.p50, decimals),
    p95: round(histogram.p95, decimals),
    p99: round(histogram.p99, decimals),
    max: round(histogram.max, decimals),
    mean: round(histogram.mean, decimals),
    total: round(histogram.total, decimals),
  };
}
