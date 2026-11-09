// OB-2 — the example clock's agent half: what a kit author reads as the model for declaring one.
import { agentToolHarness, runKindConformance } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { deskClockManifest } from "../src/manifest";
import { clock, clockAgent } from "../src/object";

const row = deskClockManifest.contributes?.objects?.[0];
if (row === undefined) throw new Error("no object row");

describe("the clock's agent half", () => {
  it("passes conformance", async () => {
    const report = await runKindConformance({ binding: clock, row });
    expect(report.verdicts.filter((v) => v.status === "refused")).toEqual([]);
  });

  it("reads its settings and flips its seconds hand, one change with its undo", () => {
    const harness = agentToolHarness(clockAgent, row, {});
    expect(harness.read("read_settings")).toMatchObject({ seconds: true, zone: "local" });
    const { value, changed, inverse } = harness.act("set_seconds", { on: false });
    expect([value, changed]).toEqual([{ seconds: false }, "Hid the seconds hand"]);
    expect(harness.props()["seconds"]).toBe(false);
    expect(inverse && harness.undo(inverse)).toBe(true);
    expect(harness.props()["seconds"]).toBe(true);
  });
});
