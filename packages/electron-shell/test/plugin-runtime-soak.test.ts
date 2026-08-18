import { describe, expect, it } from "vitest";
import { evaluatePhysicalSoak, type PhysicalSoakSample } from "../src/testing/plugin-runtime-soak";

function samples(options?: { listenerAt?: number; fdGrowth?: boolean; memoryGrowth?: boolean }) {
  return Array.from(
    { length: 12 },
    (_, cycle): PhysicalSoakSample => ({
      cycle,
      elapsedMs: cycle * 3_600_000,
      exact: { listeners: cycle >= (options?.listenerAt ?? Number.POSITIVE_INFINITY) ? 1 : 0 },
      series: {
        fds: 20 + (options?.fdGrowth ? cycle : 0),
        footprint: 100 + (options?.memoryGrowth ? cycle * 10 : 0),
        logBytes: 1_000,
      },
    }),
  );
}

const options = {
  warmupSamples: 2,
  minimumGradedSamples: 8,
  minimumDurationMs: 10 * 3_600_000,
  exactZero: ["listeners"],
  plateau: {
    fds: { maximumAboveBaseline: 0, maximumGrowth: 0, maximumSlopePerHour: 0 },
  },
  trend: {
    footprint: { maximumGrowth: 20, maximumSlopePerHour: 2 },
  },
  ceiling: { logBytes: { maximum: 2_000 } },
} as const;

describe("physical plugin runtime soak oracle", () => {
  it("passes a clean plateau and reports wall-time-normalized trends", () => {
    const verdict = evaluatePhysicalSoak(samples(), options);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.durationMs).toBe(11 * 3_600_000);
    expect(verdict.exactMaxima).toEqual({ listeners: 0 });
  });

  it("rejects exact listener residue and fd growth", () => {
    const verdict = evaluatePhysicalSoak(samples({ listenerAt: 5, fdGrowth: true }), options);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.failures.some((failure) => failure.kind === "structural-residue")).toBe(true);
    expect(verdict.failures.some((failure) => failure.metric === "fds")).toBe(true);
  });

  it("requires both material memory growth and slope, and enforces literal duration", () => {
    const growing = evaluatePhysicalSoak(samples({ memoryGrowth: true }), options);
    expect(growing.failures.some((failure) => failure.metric === "footprint")).toBe(true);

    const tooShort = samples().map((sample) => ({ ...sample, elapsedMs: sample.cycle * 1_000 }));
    const short = evaluatePhysicalSoak(tooShort, options);
    expect(short.failures.some((failure) => failure.kind === "insufficient-duration")).toBe(true);
  });

  it("uses run-origin elapsed time and discounts one-sample endpoint jitter", () => {
    const jittered = [20, 18, 20, 22, 20].map(
      (fds, cycle): PhysicalSoakSample => ({
        cycle,
        elapsedMs: (cycle + 1) * 1_000,
        exact: { listeners: 0 },
        series: { fds },
      }),
    );
    const verdict = evaluatePhysicalSoak(jittered, {
      warmupSamples: 0,
      minimumGradedSamples: 5,
      minimumDurationMs: 5_000,
      exactZero: ["listeners"],
      plateau: {
        fds: {
          maximumAboveBaseline: 2,
          maximumGrowth: 0,
          maximumSlopePerHour: Number.MAX_SAFE_INTEGER,
        },
      },
    });

    expect(verdict.verdict).toBe("pass");
    expect(verdict.durationMs).toBe(5_000);
    expect(verdict.plateaus.fds).toMatchObject({
      window: 3,
      firstMedian: 20,
      lastMedian: 20,
    });
  });
});
