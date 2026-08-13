import { describe, expect, it } from "vitest";
import { Wire, WireFrom, WirePorts, WirePrefab, WireTo, widgetSpawnInits } from "../src/canvas";

// W1 (the mind map pack): the wire vocabulary is a deliberate door addition —
// without it a plugin can neither create nor read an edge. This pins the door's
// shape at runtime: a rename or dropped re-export on the ice side reds here
// instead of at a plugin's first import. Values only — semantics live in the
// engine and are exercised by the pack's own tx-shape tests.

describe("the W1 wire door", () => {
  it("exports the complete wire vocabulary as live values", () => {
    for (const [name, value] of Object.entries({
      Wire,
      WireFrom,
      WirePorts,
      WirePrefab,
      WireTo,
    })) {
      expect(value, `${name} must be a live engine symbol`).toBeDefined();
    }
  });

  it("exports spawnWidget's own init builder for composite spawns", () => {
    expect(typeof widgetSpawnInits).toBe("function");
  });
});

describe("the S3 undo door", () => {
  it("useUndo is exported — claiming widgets must be able to forward mod-Z", async () => {
    const { useUndo } = await import("../src/canvas");
    expect(typeof useUndo).toBe("function");
  });
});
