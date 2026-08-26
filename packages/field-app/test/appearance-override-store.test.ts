import { describe, expect, it, vi } from "vitest";
import {
  createAppearanceOverrideStore,
  effectiveProductAppearance,
} from "../src/appearance/appearance-override-store";
import {
  defaultProductAppearance,
  type ProductAppearance,
  productAppearanceCssVariables,
} from "../src/appearance/product-appearance";
import { serializeVisualTweaks } from "../src/appearance/product-appearance-document";
import { canvasGridConfig } from "../src/field/canvas-appearance";

function appearanceWithReach(reach: number): ProductAppearance {
  const appearance = defaultProductAppearance();
  appearance.magnetGrid.reach = reach;
  return appearance;
}

describe("appearance override store", () => {
  it("applies one complete document atomically and notifies subscribers", () => {
    const store = createAppearanceOverrideStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const appearance = appearanceWithReach(420);

    expect(store.apply(1, serializeVisualTweaks(appearance))).toEqual({
      status: "applied",
      revision: 1,
    });
    expect(store.snapshot()).toEqual({ revision: 1, appearance });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.clear(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects stale revisions without disturbing the active appearance", () => {
    const store = createAppearanceOverrideStore();
    const active = appearanceWithReach(360);
    store.apply(4, serializeVisualTweaks(active));

    expect(store.apply(4, serializeVisualTweaks(appearanceWithReach(999)))).toEqual({
      status: "rejected",
      revision: 4,
      code: "stale-revision",
    });
    expect(store.clear(3)).toEqual({
      status: "rejected",
      revision: 3,
      code: "stale-revision",
    });
    expect(store.snapshot()).toEqual({ revision: 4, appearance: active });
  });

  it("fences an invalid newer revision while retaining the last good value", () => {
    const store = createAppearanceOverrideStore();
    const listener = vi.fn();
    const active = appearanceWithReach(240);
    store.apply(1, serializeVisualTweaks(active));
    store.subscribe(listener);

    expect(store.apply(2, "not json")).toEqual({
      status: "rejected",
      revision: 2,
      code: "invalid-document",
    });
    expect(store.snapshot()).toEqual({ revision: 2, appearance: active });
    expect(listener).not.toHaveBeenCalled();
    expect(store.apply(2, serializeVisualTweaks(appearanceWithReach(500)))).toMatchObject({
      status: "rejected",
      code: "stale-revision",
    });
  });

  it("clears the override with a newer revision", () => {
    const store = createAppearanceOverrideStore();
    store.apply(1, serializeVisualTweaks(appearanceWithReach(280)));

    expect(store.clear(2)).toEqual({ status: "applied", revision: 2 });
    expect(store.snapshot()).toEqual({ revision: 2, appearance: null });
  });

  it("uses the persisted glyph only when no complete Studio override exists", () => {
    expect(effectiveProductAppearance(null, "needle").magnetGrid.glyph).toBe("needle");

    const override = defaultProductAppearance();
    override.magnetGrid.glyph = "dot";
    expect(effectiveProductAppearance(override, "needle")).toBe(override);
    expect(effectiveProductAppearance(override, "needle").magnetGrid.glyph).toBe("dot");
  });

  it("projects grid and product CSS from the same effective snapshot", () => {
    const override = appearanceWithReach(480);
    override.canvasPalette.bgDark = "#123456";
    override.overlapFeedback.rimRadius = 720;
    const effective = effectiveProductAppearance(override, "needle");

    expect(canvasGridConfig(effective, true).magnet).toMatchObject({ reach: 480, glyph: "dot" });
    expect(productAppearanceCssVariables(effective, true)).toMatchObject({
      "--vf-canvas-bg": "#123456",
      "--ic-rim-radius": "720px",
    });
  });
});
