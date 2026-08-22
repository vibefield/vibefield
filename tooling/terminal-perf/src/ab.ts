// INTERLEAVED A/B WITH A NULL ARM — TP-S0c, §19.4 / TC §9's discipline, pure.
//
// The rule this file encodes, stated once: on a loaded host the MEDIAN is the
// estimate and a TAIL is a claim that has to be earned. It is earned by the
// null arm — a second arm that changes nothing — moving less than the
// difference being claimed. If the null arm moves as much as the treatment
// arm, the run measured the host, and saying "p99 improved 12%" from it is a
// confident number about nothing.
//
// Nothing here touches a clock, a process or a file, so the suite can pin the
// arithmetic against hand-computed cases rather than against a run.

/** Nearest-rank, so every quantile reported is an observation that occurred. */
export function quantile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] as number;
}

export const median = (samples: readonly number[]): number => quantile(samples, 0.5);

export interface ArmSummary {
  readonly arm: string;
  /** One value per rotation — the per-rotation estimate, never pooled samples:
   * the unit of the A/B is the ROTATION, because that is what interleaving
   * randomises against drift. */
  readonly rotations: readonly number[];
  readonly median: number;
  readonly min: number;
  readonly max: number;
  /** max − min across rotations: how much this arm moved on its own. */
  readonly spread: number;
}

export function summarizeArm(arm: string, rotations: readonly number[]): ArmSummary {
  const usable = rotations.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return {
      arm,
      rotations: [],
      median: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
      spread: Number.NaN,
    };
  }
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  return { arm, rotations: usable, median: median(usable), min, max, spread: max - min };
}

export type Verdict = "below-noise" | "within-budget" | "over-budget" | "inconclusive" | "no-data";

export interface AbResult {
  readonly metric: string;
  readonly units: string;
  readonly treatment: ArmSummary;
  readonly control: ArmSummary;
  /** The null arm: two runs of the SAME condition, whose difference is the
   * run-to-run noise floor. Absent means no tail claim may be made and the
   * verdict says so rather than assuming zero. */
  readonly nullArm: ArmSummary | null;
  /** treatment.median − control.median, in `units`. */
  readonly deltaAbsolute: number;
  /** The same as a fraction of the control median; NaN when the control is 0. */
  readonly deltaRelative: number;
  /** The null arm's own median-to-median movement, as a fraction of control. */
  readonly noiseRelative: number | null;
  readonly budgetRelative: number | null;
  readonly verdict: Verdict;
  readonly reason: string;
}

/**
 * Grade one metric's A/B.
 *
 * `budgetRelative` is a fraction — TP-R18's "≤5%" is `0.05`. The verdict ladder:
 *
 *   no-data       an arm produced nothing.
 *   inconclusive  the noise floor is WIDER than the budget, so this run cannot
 *                 tell pass from fail. Checked FIRST, and checked before
 *                 below-noise, because a very noisy run that happens to measure
 *                 no effect must not read as having cleared a tight budget. The
 *                 most common honest outcome on a loaded machine, and the one a
 *                 rig must be willing to print.
 *   below-noise   |delta| is not larger than the null arm's own movement, AND
 *                 that movement is inside the budget. The honest verdict for a
 *                 real effect smaller than this host can resolve; it clears a
 *                 "below measurement noise" budget (TP-R18's `production` half)
 *                 outright, and clears a numeric one because a delta under a
 *                 floor that is itself under the budget is under the budget.
 *   within-budget delta is resolvable and inside the budget.
 *   over-budget   delta is resolvable and outside it.
 */
export function gradeAb(input: {
  metric: string;
  units: string;
  treatment: ArmSummary;
  control: ArmSummary;
  nullArm?: ArmSummary | null;
  budgetRelative?: number | null;
}): AbResult {
  const { treatment, control } = input;
  const nullArm = input.nullArm ?? null;
  const budgetRelative = input.budgetRelative ?? null;
  const base = {
    metric: input.metric,
    units: input.units,
    treatment,
    control,
    nullArm,
    budgetRelative,
  };

  if (!Number.isFinite(treatment.median) || !Number.isFinite(control.median)) {
    return {
      ...base,
      deltaAbsolute: Number.NaN,
      deltaRelative: Number.NaN,
      noiseRelative: null,
      verdict: "no-data",
      reason: "one arm produced no usable rotation",
    };
  }

  const deltaAbsolute = treatment.median - control.median;
  const deltaRelative = control.median === 0 ? Number.NaN : deltaAbsolute / control.median;
  // The null arm's movement, expressed the same way as the delta so the two are
  // directly comparable. Its SPREAD, not its median: the question is how much a
  // measurement of one unchanged condition wanders, which is the spread.
  const noiseRelative =
    nullArm === null || !Number.isFinite(nullArm.spread) || control.median === 0
      ? null
      : Math.abs(nullArm.spread) / control.median;

  const belowNoise = noiseRelative !== null && Math.abs(deltaRelative) <= noiseRelative;

  // ORDER MATTERS, and this ordering is the stricter one. A delta below the
  // noise floor is a real finding — "no effect this run could see" — but it does
  // NOT certify a budget when the floor itself is wider than the budget. Saying
  // `below-noise` there would let a 21%-noisy run appear to clear a 5% budget on
  // the strength of having measured nothing. So the budget-versus-noise check
  // comes first and the below-noise fact rides in its reason.
  if (noiseRelative !== null && budgetRelative !== null && noiseRelative > budgetRelative) {
    return {
      ...base,
      deltaAbsolute,
      deltaRelative,
      noiseRelative,
      verdict: "inconclusive",
      reason:
        `the null arm moved ${(noiseRelative * 100).toFixed(1)}%, wider than the ` +
        `${(budgetRelative * 100).toFixed(1)}% budget — the run cannot grade this row` +
        (belowNoise
          ? `; the measured delta (${(deltaRelative * 100).toFixed(1)}%) was itself below that floor, ` +
            "so the run found no effect it could see, and certifies nothing"
          : ""),
    };
  }

  if (belowNoise) {
    return {
      ...base,
      deltaAbsolute,
      deltaRelative,
      noiseRelative,
      verdict: "below-noise",
      reason:
        `|${(deltaRelative * 100).toFixed(1)}%| does not exceed the null arm's own ` +
        `${((noiseRelative as number) * 100).toFixed(1)}% movement — this host cannot resolve the difference` +
        (budgetRelative === null
          ? ""
          : `, and that floor is inside the ${(budgetRelative * 100).toFixed(1)}% budget`),
    };
  }

  if (budgetRelative === null) {
    return {
      ...base,
      deltaAbsolute,
      deltaRelative,
      noiseRelative,
      verdict: "inconclusive",
      reason: "no budget given; the delta is reported, not graded",
    };
  }

  return {
    ...base,
    deltaAbsolute,
    deltaRelative,
    noiseRelative,
    verdict: deltaRelative <= budgetRelative ? "within-budget" : "over-budget",
    reason:
      `${(deltaRelative * 100).toFixed(1)}% against a ${(budgetRelative * 100).toFixed(1)}% budget` +
      (noiseRelative === null
        ? " (NO null arm — the number is reported without a noise floor)"
        : ` (null arm moved ${(noiseRelative * 100).toFixed(1)}%)`),
  };
}

/** Group per-arm values by arm name, preserving rotation order. */
export function groupRotations(
  records: readonly { arm: string; rotation: number; value: number }[],
): Map<string, number[]> {
  const grouped = new Map<string, { rotation: number; value: number }[]>();
  for (const record of records) {
    const list = grouped.get(record.arm) ?? [];
    list.push({ rotation: record.rotation, value: record.value });
    grouped.set(record.arm, list);
  }
  const out = new Map<string, number[]>();
  for (const [arm, list] of grouped) {
    out.set(
      arm,
      [...list].sort((a, b) => a.rotation - b.rotation).map((entry) => entry.value),
    );
  }
  return out;
}

/**
 * The null arm derived from ONE arm's own rotations, by splitting them into
 * odd and even halves.
 *
 * This is the null arm a single-condition run can always have: the same
 * condition measured twice, alternating in time, so the difference between the
 * halves is drift and host contention and nothing else. It is weaker than a
 * dedicated third arm — it shares its samples with the arm it is grading — and
 * it is honest about that by being named `derived`.
 */
export function derivedNullArm(arm: ArmSummary): ArmSummary {
  const even = arm.rotations.filter((_, index) => index % 2 === 0);
  const odd = arm.rotations.filter((_, index) => index % 2 === 1);
  if (even.length === 0 || odd.length === 0) {
    return {
      arm: `${arm.arm}:derived-null`,
      rotations: [],
      median: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
      spread: Number.NaN,
    };
  }
  const halves = [median(even), median(odd)];
  return summarizeArm(`${arm.arm}:derived-null`, halves);
}
