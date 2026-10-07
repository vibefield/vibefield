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

// DK-17: an appearance is its plain ground alone (v4) — the documents differ by their light ground.
function appearanceWithGround(bgLight: string): ProductAppearance {
  const appearance = defaultProductAppearance();
  appearance.canvasPalette.bgLight = bgLight;
  return appearance;
}

describe("appearance override store", () => {
  it("applies one complete document atomically and notifies subscribers", () => {
    const store = createAppearanceOverrideStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const appearance = appearanceWithGround("#F4F1E8");

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
    const active = appearanceWithGround("#F2EAD3");
    store.apply(4, serializeVisualTweaks(active));

    expect(store.apply(4, serializeVisualTweaks(appearanceWithGround("#999999")))).toEqual({
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
    const active = appearanceWithGround("#EDEDED");
    store.apply(1, serializeVisualTweaks(active));
    store.subscribe(listener);

    expect(store.apply(2, "not json")).toEqual({
      status: "rejected",
      revision: 2,
      code: "invalid-document",
    });
    expect(store.snapshot()).toEqual({ revision: 2, appearance: active });
    expect(listener).not.toHaveBeenCalled();
    expect(store.apply(2, serializeVisualTweaks(appearanceWithGround("#505050")))).toMatchObject({
      status: "rejected",
      code: "stale-revision",
    });
  });

  it("clears the override with a newer revision", () => {
    const store = createAppearanceOverrideStore();
    store.apply(1, serializeVisualTweaks(appearanceWithGround("#E0E0E0")));

    expect(store.clear(2)).toEqual({ status: "applied", revision: 2 });
    expect(store.snapshot()).toEqual({ revision: 2, appearance: null });
  });

  it("is the reviewed appearance unless a complete Studio override stands", () => {
    expect(effectiveProductAppearance(null)).toEqual(defaultProductAppearance());

    const override = appearanceWithGround("#F2EAD3");
    expect(effectiveProductAppearance(override)).toBe(override);
  });

  it("projects the plain ground — and only it — from the effective snapshot (DK-17)", () => {
    const override = appearanceWithGround("#F2EAD3");
    override.canvasPalette.bgDark = "#123456";
    const effective = effectiveProductAppearance(override);

    expect(productAppearanceCssVariables(effective, true)).toEqual({ "--vf-canvas-bg": "#123456" });
    expect(productAppearanceCssVariables(effective, false)).toEqual({
      "--vf-canvas-bg": "#F2EAD3",
    });
  });
});
