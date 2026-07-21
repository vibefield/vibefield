// The ICE store-layer swap contract, pinned (doc-kit: "Switching docs =
// close() then create/open the next"): ONE engine, seed A → close → create B
// (empty) → close → reopen A — censuses hold at every step. The APP deliberately
// does NOT use this path: FieldView remounts the engine per doc generation
// (field report 2026-07-21 — retained GL/WebGPU frames survive an in-place
// world reset; six onReady-wired layers would each need reset handling). This
// test is the canary that tells us the day the in-place path becomes viable.
import { defineQuery, Position, PrefabId, WirePorts } from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine, seedField } from "../renderer/src/field-engine";

const widgetQ = defineQuery([Position, PrefabId]);
const wireQ = defineQuery([WirePorts]);

function census(ce: ReturnType<typeof createFieldEngine>) {
  let widgets = 0;
  let wires = 0;
  ce.world.query(widgetQ).each((b) => {
    for (const _ of b) widgets += 1;
  });
  ce.world.query(wireQ).each((b) => {
    for (const _ of b) wires += 1;
  });
  return { widgets, wires };
}

describe("in-place doc swap on one engine", () => {
  it("close → create empties the world; close → open restores", () => {
    const ce = createFieldEngine(buildRegistry());
    const a = ce.docs.create();
    seedField(ce, a);
    expect(census(ce)).toEqual({ widgets: 21, wires: 2 });
    const bytesA = a.exportEnvelope(Date.now());

    ce.docs.close();
    ce.docs.create();
    ce.world.sync();
    console.log("after create B:", JSON.stringify(census(ce)));
    expect(census(ce)).toEqual({ widgets: 0, wires: 0 });

    ce.docs.close();
    const res = ce.docs.open(bytesA);
    console.log("open A ok:", res.ok, res.ok ? "" : res.reason);
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    ce.world.sync();
    console.log("after reopen A:", JSON.stringify(census(ce)));
    expect(census(ce)).toEqual({ widgets: 21, wires: 2 });
    ce.dispose();
  });
});
