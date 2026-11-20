import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isMadeSimulator,
  MADE_SIMULATOR_TYPE_CHARS,
  madeSimulatorName,
  readSimulatorsMadeRemoveResult,
  readSimulatorsMadeStatus,
} from "../src/live-surfaces";

// Item 568's C (2026-11-20) — Settings' "Remove VibeField's simulators": the name rule and the
// door's two answers.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const golden = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
const TAG = "0123456789abcdef";

describe("item 568's C — a device is VibeField's by its name, checked against its own type", () => {
  it("is the name VibeField gives a pane's own device, of that device's type", () => {
    const name = madeSimulatorName("iPhone 17 Pro", TAG);
    expect(name).toBe("VibeField iPhone 17 Pro [0123456789abcdef]");
    expect(isMadeSimulator(name, "iPhone 17 Pro")).toBe(true);
    // a look-alike of another type is never VibeField's
    expect(isMadeSimulator(name, "iPhone 16e")).toBe(false);
  });

  it("never takes the person's own names, nor a tag of another shape", () => {
    for (const name of ["iPhone 17 Pro", "iPhone 17 Pro (2)", "iPhone 17 Pro (VibeField)"])
      expect(isMadeSimulator(name, "iPhone 17 Pro"), name).toBe(false);
    for (const tag of ["0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0"])
      expect(isMadeSimulator(`VibeField iPhone 17 Pro [${tag}]`, "iPhone 17 Pro"), tag).toBe(false);
  });

  it("names a long type by its first 88 characters, as the name was made", () => {
    expect(MADE_SIMULATOR_TYPE_CHARS).toBe(88);
    const long = "iPad Pro ".repeat(12);
    expect(isMadeSimulator(madeSimulatorName(long, TAG), long)).toBe(true);
    expect(isMadeSimulator(`VibeField ${long} [${TAG}]`, long)).toBe(false);
  });
});

describe("item 568's C — the row's read and its remove, counts only", () => {
  it("reads the goldens as they say", () => {
    expect(readSimulatorsMadeStatus(golden("simulators-made-status.ready"))).toMatchObject({
      state: "ready",
      devices: 3,
      bytes: 4_831_838_208,
      inUse: 1,
      elsewhere: 0,
    });
    const unknown = readSimulatorsMadeStatus(golden("simulators-made-status.size-unknown"));
    expect(unknown.state === "ready" && unknown.bytes).toBeNull();
    expect(readSimulatorsMadeStatus(golden("simulators-made-status.unavailable")).state).toBe(
      "unavailable",
    );
    expect(
      readSimulatorsMadeRemoveResult(golden("simulators-made-remove-result.partial")),
    ).toMatchObject({
      state: "ready",
      removed: 2,
      freedBytes: 3_221_225_472,
      kept: { inUse: 1, elsewhere: 0 },
      failed: 0,
    });
    expect(
      readSimulatorsMadeRemoveResult(golden("simulators-made-remove-result.unavailable")).state,
    ).toBe("unavailable");
  });

  it("reads what it cannot read as unavailable, never as none", () => {
    const ready = golden("simulators-made-status.ready");
    for (const answer of [
      { ...ready, state: "draining" },
      { ...ready, devices: -1 },
      { ...ready, bytes: undefined },
      "ready",
      null,
    ])
      expect(readSimulatorsMadeStatus(answer), JSON.stringify(answer)).toEqual({
        state: "unavailable",
      });
    const partial = golden("simulators-made-remove-result.partial");
    expect(readSimulatorsMadeRemoveResult({ ...partial, kept: { inUse: 1 } })).toEqual({
      state: "unavailable",
    });
  });

  it("lets a newer main's own facts ride through", () => {
    const ready = golden("simulators-made-status.ready");
    const read = readSimulatorsMadeStatus({ ...ready, runtimes: 2 });
    expect((read as Record<string, unknown>)["runtimes"]).toBe(2);
  });
});
