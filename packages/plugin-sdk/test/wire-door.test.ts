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

describe("the React face hooks (retired, DK-17)", () => {
  it("are gone from the door — the face reads, its commit and the claiming face's undo", async () => {
    // The retire table's SDK row: a canvas face is an object KIND (the `/desk` door), so the React
    // face's hooks — and S3's `useUndo` for a keyboard-claiming widget — left with the faces.
    const door: Record<string, unknown> = await import("../src/canvas");
    for (const hook of ["useWidgetProps", "useWorldComponent", "useCommit", "useOps", "useUndo"])
      expect(door[hook], `${hook} must not be on the /canvas door`).toBeUndefined();
    expect(typeof door["getWidgetType"]).toBe("function");
  });
});
