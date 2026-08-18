export const PHYSICAL_SOAK_MAX_SAMPLES = 100_000;

export interface PhysicalSoakSample {
  readonly cycle: number;
  readonly elapsedMs: number;
  readonly exact: Readonly<Record<string, number>>;
  readonly series: Readonly<Record<string, number | null>>;
}

export interface PhysicalSoakMetricBudget {
  readonly required?: boolean;
  readonly maximumAboveBaseline: number;
  readonly maximumGrowth: number;
  readonly maximumSlopePerHour: number;
}

export interface PhysicalSoakTrendBudget {
  readonly required?: boolean;
  readonly maximumGrowth: number;
  readonly maximumSlopePerHour: number;
}

export interface PhysicalSoakOptions {
  readonly warmupSamples: number;
  readonly minimumGradedSamples: number;
  readonly minimumDurationMs?: number;
  readonly exactZero?: readonly string[];
  readonly plateau?: Readonly<Record<string, PhysicalSoakMetricBudget>>;
  readonly trend?: Readonly<Record<string, PhysicalSoakTrendBudget>>;
  readonly ceiling?: Readonly<
    Record<string, { readonly required?: boolean; readonly maximum: number }>
  >;
}

export interface PhysicalSoakFailure {
  readonly kind:
    | "insufficient-duration"
    | "structural-residue"
    | "missing-series"
    | "plateau-growth"
    | "sustained-growth"
    | "ceiling-exceeded";
  readonly metric: string;
  readonly message: string;
  readonly sample?: number;
  readonly actual?: unknown;
  readonly maximum?: number;
  readonly budget?: unknown;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function linearSlopePerHour(points: ReadonlyArray<{ elapsedMs: number; value: number }>): number {
  if (points.length < 2) return 0;
  const hours = points.map((point) => point.elapsedMs / 3_600_000);
  const meanX = hours.reduce((total, value) => total + value, 0) / hours.length;
  const meanY = points.reduce((total, point) => total + point.value, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < points.length; index += 1) {
    const x = hours[index]! - meanX;
    numerator += x * (points[index]!.value - meanY);
    denominator += x * x;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function windows(values: readonly number[]): {
  width: number;
  firstMedian: number;
  lastMedian: number;
} {
  // A physical counter can jitter for one observation even after the owners
  // are quiescent (Chromium's main-process descriptors are one example). Use
  // at least three readings when they exist so one low or high observation
  // cannot become the run's entire baseline. Long soaks still compare their
  // first and last quarters.
  const width = Math.min(values.length, Math.max(3, Math.floor(values.length / 4)));
  return {
    width,
    firstMedian: median(values.slice(0, width)),
    lastMedian: median(values.slice(-width)),
  };
}

function numericSeries(
  samples: readonly PhysicalSoakSample[],
  metric: string,
  required: boolean,
  failures: PhysicalSoakFailure[],
): Array<{ elapsedMs: number; value: number }> {
  const values: Array<{ elapsedMs: number; value: number }> = [];
  for (const [index, sample] of samples.entries()) {
    const value = sample.series[metric];
    if (value === undefined || value === null) {
      if (required) {
        failures.push({
          kind: "missing-series",
          metric,
          sample: sample.cycle,
          message: `${metric} is required for every graded sample`,
        });
      }
      continue;
    }
    values.push({
      elapsedMs: finite(sample.elapsedMs, `samples[${index}].elapsedMs`),
      value: finite(value, `samples[${index}].series.${metric}`),
    });
  }
  return values;
}

/** Deterministic physical-soak oracle. Exact residue is graded from cycle one;
 * allocator trends use wall time so changing the sampling cadence cannot make
 * the same retained bytes look safer or worse. */
export function evaluatePhysicalSoak(
  samples: readonly PhysicalSoakSample[],
  options: PhysicalSoakOptions,
): Readonly<{
  version: 1;
  verdict: "pass" | "fail";
  sampleCount: number;
  warmupSamples: number;
  gradedSamples: number;
  durationMs: number;
  exactMaxima: Readonly<Record<string, number>>;
  plateaus: Readonly<Record<string, unknown>>;
  trends: Readonly<Record<string, unknown>>;
  ceilings: Readonly<Record<string, unknown>>;
  failures: readonly PhysicalSoakFailure[];
}> {
  if (samples.length === 0 || samples.length > PHYSICAL_SOAK_MAX_SAMPLES) {
    throw new RangeError(
      `physical soak requires between 1 and ${PHYSICAL_SOAK_MAX_SAMPLES} samples`,
    );
  }
  const warmupSamples = nonNegativeInteger(options.warmupSamples, "warmupSamples");
  const minimumGradedSamples = nonNegativeInteger(
    options.minimumGradedSamples,
    "minimumGradedSamples",
  );
  if (samples.length - warmupSamples < minimumGradedSamples) {
    throw new RangeError("physical soak does not contain enough post-warmup samples");
  }
  let previousElapsed = -1;
  for (const [index, sample] of samples.entries()) {
    nonNegativeInteger(sample.cycle, `samples[${index}].cycle`);
    const elapsed = finite(sample.elapsedMs, `samples[${index}].elapsedMs`);
    if (elapsed < 0 || elapsed < previousElapsed) {
      throw new TypeError("physical soak elapsedMs must be non-negative and monotonic");
    }
    previousElapsed = elapsed;
  }

  // elapsedMs is measured from the start of the physical run, not from its
  // first completed cycle. Keeping that origin makes a terminal sample at the
  // literal deadline sufficient even when cycle one itself took time.
  const durationMs = samples.at(-1)!.elapsedMs;
  const failures: PhysicalSoakFailure[] = [];
  const minimumDurationMs = options.minimumDurationMs ?? 0;
  if (durationMs < minimumDurationMs) {
    failures.push({
      kind: "insufficient-duration",
      metric: "durationMs",
      actual: durationMs,
      maximum: minimumDurationMs,
      message: `physical soak covered ${durationMs}ms, below the required ${minimumDurationMs}ms`,
    });
  }

  const exactMaxima: Record<string, number> = {};
  for (const key of options.exactZero ?? []) {
    let maximum = 0;
    for (const [index, sample] of samples.entries()) {
      const value = nonNegativeInteger(sample.exact[key]!, `samples[${index}].exact.${key}`);
      maximum = Math.max(maximum, value);
      if (value !== 0) {
        failures.push({
          kind: "structural-residue",
          metric: key,
          sample: sample.cycle,
          actual: value,
          maximum: 0,
          message: `${key} retained ${value} after a quiescent cycle`,
        });
      }
    }
    exactMaxima[key] = maximum;
  }

  const graded = samples.slice(warmupSamples);
  const plateaus: Record<string, unknown> = {};
  for (const [metric, budget] of Object.entries(options.plateau ?? {})) {
    const points = numericSeries(graded, metric, budget.required ?? true, failures);
    if (points.length === 0) continue;
    const values = points.map((point) => point.value);
    const { width, firstMedian, lastMedian } = windows(values);
    const maximum = Math.max(...values);
    const result = {
      samples: values.length,
      window: width,
      firstMedian,
      lastMedian,
      growth: lastMedian - firstMedian,
      slopePerHour: linearSlopePerHour(points),
      minimum: Math.min(...values),
      maximum,
      maximumAboveBaseline: maximum - firstMedian,
    };
    plateaus[metric] = result;
    if (
      result.maximumAboveBaseline > budget.maximumAboveBaseline ||
      result.growth > budget.maximumGrowth ||
      result.slopePerHour > budget.maximumSlopePerHour
    ) {
      failures.push({
        kind: "plateau-growth",
        metric,
        actual: result,
        budget,
        message: `${metric} did not return to its post-warmup plateau`,
      });
    }
  }

  const trends: Record<string, unknown> = {};
  for (const [metric, budget] of Object.entries(options.trend ?? {})) {
    const points = numericSeries(graded, metric, budget.required ?? true, failures);
    if (points.length === 0) continue;
    const values = points.map((point) => point.value);
    const { width, firstMedian, lastMedian } = windows(values);
    const result = {
      samples: values.length,
      window: width,
      firstMedian,
      lastMedian,
      growth: lastMedian - firstMedian,
      slopePerHour: linearSlopePerHour(points),
      minimum: Math.min(...values),
      maximum: Math.max(...values),
    };
    trends[metric] = result;
    if (result.growth > budget.maximumGrowth && result.slopePerHour > budget.maximumSlopePerHour) {
      failures.push({
        kind: "sustained-growth",
        metric,
        actual: result,
        budget,
        message: `${metric} shows material post-warmup retained growth`,
      });
    }
  }

  const ceilings: Record<string, unknown> = {};
  for (const [metric, budget] of Object.entries(options.ceiling ?? {})) {
    const points = numericSeries(samples, metric, budget.required ?? true, failures);
    if (points.length === 0) continue;
    const maximum = Math.max(...points.map((point) => point.value));
    ceilings[metric] = { samples: points.length, maximum };
    if (maximum > budget.maximum) {
      failures.push({
        kind: "ceiling-exceeded",
        metric,
        actual: maximum,
        maximum: budget.maximum,
        message: `${metric} exceeded its absolute soak ceiling`,
      });
    }
  }

  return Object.freeze({
    version: 1,
    verdict: failures.length === 0 ? "pass" : "fail",
    sampleCount: samples.length,
    warmupSamples,
    gradedSamples: graded.length,
    durationMs,
    exactMaxima: Object.freeze(exactMaxima),
    plateaus: Object.freeze(plateaus),
    trends: Object.freeze(trends),
    ceilings: Object.freeze(ceilings),
    failures: Object.freeze(failures),
  });
}
