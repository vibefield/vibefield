import type { VitalsOwnV1 } from "@vibefield/contracts/vitals";

// VT-3, the query's fold (track VT, 2026-11-24) — what a process said of itself (`VitalsPointV1.own`), folded over
// one step of `vitals.query` (`VitalsSeriesV1.own`). Each figure keeps what a person looking for trouble needs from a
// wide view: the loop's busiest second (a held loop is never averaged away), the collections' pauses and the long
// frames summed with their longest, and the slowest request. A figure no second of the step said stays absent: left
// out is not measured, never zero. A field this build does not know is not folded, because its meaning over a span is
// not known here.

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const max = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

const sum = (a: number | undefined, b: number | undefined, places: number): number | undefined =>
  a === undefined ? b : b === undefined ? a : round(a + b, places);

/** One step's fold so far (`into`, null before any second said anything) with one more second's `said`. Answers null
 * while nothing known has been said. */
export function foldOwnStep(
  into: VitalsOwnV1 | null | undefined,
  said: VitalsOwnV1 | undefined,
): VitalsOwnV1 | null {
  const before = into ?? {};
  if (said === undefined) return into ?? null;
  const loopBusy = max(before.loopBusy, said.loopBusy);
  const gcMs = sum(before.gcMs, said.gcMs, 3);
  const gcMaxMs = max(before.gcMaxMs, said.gcMaxMs);
  const longFrames = sum(before.longFrames, said.longFrames, 0);
  const longFrameMaxMs = max(before.longFrameMaxMs, said.longFrameMaxMs);
  const slow =
    before.slow === undefined
      ? said.slow
      : said.slow === undefined || said.slow.ms <= before.slow.ms
        ? before.slow
        : said.slow;
  const folded: VitalsOwnV1 = {
    ...(loopBusy !== undefined ? { loopBusy } : {}),
    ...(gcMs !== undefined ? { gcMs } : {}),
    ...(gcMaxMs !== undefined ? { gcMaxMs } : {}),
    ...(slow !== undefined ? { slow: { method: slow.method, ms: slow.ms } } : {}),
    ...(longFrames !== undefined ? { longFrames } : {}),
    ...(longFrameMaxMs !== undefined ? { longFrameMaxMs } : {}),
  };
  return Object.keys(folded).length === 0 ? null : folded;
}
