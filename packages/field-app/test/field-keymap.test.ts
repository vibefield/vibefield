// @vitest-environment node
// DK-8 — THE FIELD'S `c`: field-tools retired with its comment command, so `c` no longer wraps a selection, and it
// still never connects (DK-D24): the engine's own `c` is the connect tool's shortcut, which the desk's canvas does
// not allow (ICE throws for an illegal tool) — the override REFUSES it, the tool in hand unchanged, never a throw out
// of the keymap. ⇧C is no longer bound (no engine default ever was).
import { ActiveTool } from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import { buildFieldKeymapOverrides } from "../src/field/field-keymap";
import { buildRegistry, createFieldEngine } from "../src/field-engine";

describe("the field's keymap overrides (DK-8)", () => {
  it("binds `c` alone — no ⇧C — and `c` refuses the connect tool on the desk, never throwing", () => {
    const entries = buildFieldKeymapOverrides();
    expect(entries.map((e) => [e.key, e.shift === true])).toEqual([["c", false]]);
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    const before = ce.world.getResource(ActiveTool);
    expect(() => entries[0]?.run(ce)).not.toThrow();
    expect(ce.world.getResource(ActiveTool)).toEqual(before);
    ce.dispose();
  });
});
