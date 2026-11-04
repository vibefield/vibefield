/**
 * PG-8 — THE RAIN GOLDEN'S STILL RECORD IS THE RAIN'S ALONE (`perf/lib/phone-goldens-rain.ts`; F2, 2026-11-04). The
 * still mounts the rain with Math.random = mulberry32(1) and counts the draws the rain makes. It once also counted the
 * draws other code made during the mount (`otherDraws`). The one such draw is React's `enqueueTask`, which calls
 * Math.random ONCE PER PROCESS, the first time `act` queues a task (react.development.js:529). So the count said
 * which golden ran first in the process, not what the rain drew: 1 with the rain alone, 0 after the list's golden.
 * These rows compute the rain's golden first in this file's own worker, then the list's, then the rain's again, and
 * hold the two still records equal. A golden must not count a process-global, one-time effect.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  computePhoneGoldens,
  PHONE_BODY_NOW_MS,
  type PhoneViewInput,
  readWitnessInputs,
} from "../perf/lib/phone-goldens";
import { golden as listGolden } from "../perf/lib/phone-goldens-list";
import {
  type RainStep,
  type RainStillRecord,
  golden as rainGolden,
} from "../perf/lib/phone-goldens-rain";

const stillOf = (steps: unknown): RainStillRecord => {
  const still = (steps as RainStep[]).find((step) => step.still !== undefined)?.still;
  if (still === undefined) throw new Error("the rain's golden recorded no still");
  return still;
};

let alone: RainStillRecord;
let afterList: RainStillRecord;
beforeAll(async () => {
  const goldens = await computePhoneGoldens(readWitnessInputs());
  const input = (): PhoneViewInput => ({
    steps: structuredClone(goldens.windowRows),
    nowMs: PHONE_BODY_NOW_MS,
  });
  // the rain first: no golden has run `act` in this worker yet, so React's one-time draw would fall in its still
  alone = stillOf(await rainGolden.compute(input()));
  await listGolden.compute(input());
  afterList = stillOf(await rainGolden.compute(input()));
});

describe("PG-8 — the rain golden's still record is the rain's own, whatever ran before it in the process", () => {
  it("RS1 — the still record has no count of other code's draws: it is not the phone's to replay", () => {
    expect(Object.keys(alone)).not.toContain("otherDraws");
    expect(Object.keys(afterList)).not.toContain("otherDraws");
  });

  it("RS2 — the still record is the same with the rain alone and after the list's golden in one process", () => {
    expect(afterList).toEqual(alone);
    // the rain's own draws: one row and one speed per drop, the sequence's first (the phone replays them)
    expect(alone.rainDraws).toBe(44);
  });
});
