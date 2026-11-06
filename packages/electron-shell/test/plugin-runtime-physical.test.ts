import { describe, expect, it } from "vitest";
import { FIELDD_RECOVERY_INTENSITY } from "../src/main/fieldd-handle-coordinator";
import {
  countVector,
  pluginRuntimeSoakConfig,
  pluginRuntimeSoakRecoveryIntensity,
  vectorMismatches,
} from "../src/testing/plugin-runtime-physical";

describe("physical plugin runtime soak configuration", () => {
  it("keeps ordinary restart smoke outside the duration claim", () => {
    expect(pluginRuntimeSoakConfig({})).toEqual({
      enabled: false,
      cycles: 1,
      durationMs: null,
      cycleDelayMs: 0,
      warmupSamples: 0,
      minimumGradedSamples: 1,
      footprint: false,
      injection: "none",
      claim: "smoke",
    });
  });

  it("reserves the 24h claim for the literal maximum duration", () => {
    const near = pluginRuntimeSoakConfig({
      VF_PLUGIN_RUNTIME_SOAK: "1",
      VF_PLUGIN_RUNTIME_SOAK_DURATION_MS: String(24 * 60 * 60 * 1_000 - 1),
    });
    const literal = pluginRuntimeSoakConfig({
      VF_PLUGIN_RUNTIME_SOAK: "1",
      VF_PLUGIN_RUNTIME_SOAK_DURATION_MS: String(24 * 60 * 60 * 1_000),
    });

    expect(near.claim).toBe("calibration");
    expect(literal.claim).toBe("24h");
    expect(literal).toMatchObject({
      cycles: null,
      warmupSamples: 8,
      minimumGradedSamples: 24,
      cycleDelayMs: 45_000,
    });
  });

  it("rejects ambiguous or unbounded run configurations", () => {
    expect(() =>
      pluginRuntimeSoakConfig({
        VF_PLUGIN_RUNTIME_SOAK: "1",
        VF_PLUGIN_RUNTIME_SOAK_CYCLES: "2",
        VF_PLUGIN_RUNTIME_SOAK_DURATION_MS: "1000",
      }),
    ).toThrow(/cycles or duration/u);
    expect(() =>
      pluginRuntimeSoakConfig({
        VF_PLUGIN_RUNTIME_SOAK: "1",
        VF_PLUGIN_RUNTIME_SOAK_CYCLES: "10001",
      }),
    ).toThrow(/1 through 10000/u);
  });

  it("names the soak's own fieldd recovery intensity, and none for the restart smoke (item 212, RV #29)", () => {
    // every cycle SIGKILLs the owned fieldd on purpose and waits for main's automatic replacement:
    // one attempt per cycle the run may make, past the house's own allowance, in one window as long
    // as the longest run
    expect(pluginRuntimeSoakRecoveryIntensity(pluginRuntimeSoakConfig({}))).toBeNull();
    const cycles = pluginRuntimeSoakConfig({
      VF_PLUGIN_RUNTIME_SOAK: "1",
      VF_PLUGIN_RUNTIME_SOAK_CYCLES: "5",
    });
    expect(pluginRuntimeSoakRecoveryIntensity(cycles)).toEqual({
      max: 5 + FIELDD_RECOVERY_INTENSITY.max,
      windowMs: 24 * 60 * 60 * 1_000,
    });
    const day = pluginRuntimeSoakConfig({
      VF_PLUGIN_RUNTIME_SOAK: "1",
      VF_PLUGIN_RUNTIME_SOAK_DURATION_MS: String(24 * 60 * 60 * 1_000),
    });
    expect(pluginRuntimeSoakRecoveryIntensity(day)).toEqual({
      max: 10_000 + FIELDD_RECOVERY_INTENSITY.max,
      windowMs: 24 * 60 * 60 * 1_000,
    });
  });
});

describe("physical plugin runtime count vectors", () => {
  it("accepts only counts-only plain data and compares the complete shape", () => {
    const expected = countVector(
      { controller: { active: true, entries: 1 }, listeners: 0 },
      "expected",
    );
    expect(expected).toEqual({
      "controller.active": 1,
      "controller.entries": 1,
      listeners: 0,
    });
    expect(vectorMismatches(expected, { ...expected, extra: 0 })).toBe(1);
    expect(() => countVector({ retained: Promise.resolve() }, "unsafe")).toThrow(
      /counts-only plain data/u,
    );
    expect(() => countVector({ negative: -1 }, "unsafe")).toThrow(/non-negative count/u);
  });
});
