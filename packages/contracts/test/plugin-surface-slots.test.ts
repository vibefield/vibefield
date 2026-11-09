// FL-2c — the slots a plugin's surface may name. `hud.side-panel` was the Artifact Hub's alone; the
// Hub moved into field-app (FL-2, 2026-11-09), and a dead slot is not kept.
import { describe, expect, it } from "vitest";
import { SurfaceContribution } from "../src/plugins";

const row = (slot: string) => ({ id: "com.example.x.panel", title: "X", slot });

describe("FL-2c — the surface slots a manifest may name", () => {
  it("admits the live slots and the forward ones", () => {
    for (const slot of ["hud.attention", "hud.panel", "godview.row", "godview.lens"]) {
      expect(SurfaceContribution.safeParse(row(slot)).success, slot).toBe(true);
    }
  });

  it("refuses the retired side panel", () => {
    expect(SurfaceContribution.safeParse(row("hud.side-panel")).success).toBe(false);
  });
});
