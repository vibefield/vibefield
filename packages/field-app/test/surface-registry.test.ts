// @vitest-environment node
/**
 * The spine's surface registry (§8.4): the fixed slots a plugin's surface may bind. The side panel,
 * which held the Artifact Hub, retired with it at FL-2 (DESIGN.md §8 "Artifacts — the Artifacts
 * shelf's contents").
 */
import { describe, expect, it } from "vitest";
import { register } from "../src/plugin-host/surface-registry";

describe("the retired side-panel slot (FL-2c)", () => {
  it("is refused as an unknown slot, as any slot the spine does not draw", () => {
    expect(() =>
      register("vibefield.panel", "vibefield.panel.artifacts", "hud.side-panel", () => null),
    ).toThrow(/unknown slot hud\.side-panel/);
  });
});
