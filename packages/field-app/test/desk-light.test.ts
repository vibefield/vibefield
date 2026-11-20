/**
 * Item 583 — THE DESK'S LIGHT (field/desk/desk-light.ts; DESIGN.md §2.1, §8 "Settings → Canvas"): a person's seven rows
 * as the numbers ICE reads, row by row; the gentler night in the dark theme; and the shade Settings' still is drawn in.
 * No GPU: what the engine draws from these numbers is ICE's own tests' (petition I56) and smoke:canvas's.
 */
import {
  DEFAULT_MAT_CONFIG,
  lightText,
  MAT_GRID,
  MAT_LIGHT,
  SOFT_LIGHT,
  softShade,
} from "@vibecook/ice/desk";
import { deskTheme } from "@vibecook/ice/desk/objects";
import { type DeskLightValues, deskLightValues } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  DESK_LIGHT_TEXT,
  DESK_NIGHT,
  deskLightLook,
  deskLightRefusal,
  deskNightTheme,
  deskShadeCss,
} from "../src/field/desk/desk-light";

const REST = deskLightValues(undefined);
const look = (rows: Partial<DeskLightValues> = {}) => deskLightLook({ ...REST, ...rows });

describe("the light's text (583)", () => {
  it("is the soft light's, chosen as the module loads, with no refusal", () => {
    expect(DESK_LIGHT_TEXT).toBe("soft");
    expect(lightText()).toBe("soft");
    expect(deskLightRefusal()).toBeNull();
  });
});

describe("a person's rows as the engine's numbers (583)", () => {
  it("at rest: soft light over the viewport, ICE's own layers, the plate's wind, the tuned shade", () => {
    const { gobo, ambient } = look();
    expect(gobo.model).toBe("soft");
    expect(gobo.space).toBe("viewport");
    expect(gobo.opacity).toBe(DEFAULT_MAT_CONFIG.gobo.opacity);
    expect(gobo.strength).toBe(MAT_GRID.gobo.plates.c.strength);
    expect(gobo.softLight).toEqual({ ...SOFT_LIGHT, shade: softShade(0.7, 0.2, 0.12) });
    // the engine's tuned shade is that same call: the rest of Shade and Tint draw ICE's own look
    for (const [i, share] of SOFT_LIGHT.shade.entries()) {
      expect(gobo.softLight?.shade[i]).toBeCloseTo(share, 12);
    }
    expect(ambient).toBe("idle");
  });

  it("Plant: None turns the gobo off and keeps every other number", () => {
    const none = look({ plant: "none" });
    expect(none.gobo.opacity).toBe(0);
    expect(none.gobo.softLight).toEqual(look().gobo.softLight);
    // a plant is its plate (the feed's), never a number here
    expect(look({ plant: "canopy" })).toEqual(look({ plant: "monstera" }));
  });

  it("Mirror flips both layers", () => {
    expect(look().gobo.softLight?.mirror).toBe(false);
    expect(look({ mirror: true }).gobo.softLight?.mirror).toBe(true);
  });

  it("Softness scales each layer's disc; Size scales each layer's side; neither moves the other", () => {
    const soft = look({ softness: 2 }).gobo.softLight;
    expect(soft?.near.disc).toBe(SOFT_LIGHT.near.disc * 2);
    expect(soft?.far.disc).toBe(SOFT_LIGHT.far.disc * 2);
    expect(soft?.near.span).toBe(SOFT_LIGHT.near.span);
    const large = look({ size: 1.6 }).gobo.softLight;
    expect(large?.near.span).toBeCloseTo(SOFT_LIGHT.near.span * 1.6, 12);
    expect(large?.far.span).toBeCloseTo(SOFT_LIGHT.far.span * 1.6, 12);
    expect(large?.near.disc).toBe(SOFT_LIGHT.near.disc);
    // where a layer lies, how it is turned and how faint it is are never a row's
    for (const key of ["at", "turn", "opacity", "parallax"] as const) {
      expect(large?.near[key], key).toEqual(SOFT_LIGHT.near[key]);
      expect(soft?.far[key], key).toEqual(SOFT_LIGHT.far[key]);
    }
  });

  it("Shade and Tint are the shade's depth and its pull toward the sky", () => {
    expect(look({ shade: 0.55 }).gobo.softLight?.shade).toEqual(softShade(0.55, 0.2, 0.12));
    expect(look({ tint: 1 }).gobo.softLight?.shade).toEqual(softShade(0.7, 1, 0.12));
    // deeper is darker in every channel; cooler keeps more blue than red
    const deep = look({ shade: 0.55 }).gobo.softLight?.shade ?? [0, 0, 0];
    const rest = look().gobo.softLight?.shade ?? [0, 0, 0];
    for (const i of [0, 1, 2]) expect(deep[i]).toBeLessThan(rest[i] ?? 0);
    const cool = look({ tint: 1 }).gobo.softLight?.shade ?? [0, 0, 0];
    expect((cool[2] ?? 0) / (cool[0] ?? 1)).toBeGreaterThan((rest[2] ?? 0) / (rest[0] ?? 1));
  });

  it("Wind scales the silhouette's wind and the layers' sway, and at Still the ambient never blows", () => {
    const breezy = look({ wind: 1.5 });
    expect(breezy.gobo.strength).toBeCloseTo(MAT_GRID.gobo.plates.c.strength * 1.5, 12);
    expect(breezy.gobo.softLight?.sway).toBeCloseTo(SOFT_LIGHT.sway * 1.5, 12);
    expect(breezy.ambient).toBe("idle");
    const still = look({ wind: 0 });
    expect(still.gobo.strength).toBe(0);
    expect(still.gobo.softLight?.sway).toBe(0);
    expect(still.ambient).toBe("still");
  });
});

describe("the gentler night (583)", () => {
  it("is the dark theme's mat light, with a contrast taken from what the day shows; the day is ICE's own", () => {
    const day = deskTheme("light");
    expect(deskNightTheme(day)).toBe(day);
    const night = deskNightTheme(deskTheme("dark"));
    expect(night.name).toBe("dark");
    expect(night.matLight.contrast).toBe(0.855);
    expect(night.matLight.fromDay).toBe(1);
    expect(night.matLight.fill).toBe(DESK_NIGHT.fill);
    // ICE's own night states neither: this is the desk's, not the engine's default
    expect(MAT_LIGHT.dark.contrast).toBeUndefined();
    expect(night.matLight).not.toEqual(MAT_LIGHT.dark);
    // one light per page: asked twice, the same object, so a theme set again re-dresses nothing
    expect(deskNightTheme(deskTheme("dark")).matLight).toBe(night.matLight);
  });
});

describe("the shade Settings' still is drawn in (583)", () => {
  it("by day follows Shade and Tint, as the display shows the engine's shade", () => {
    const rest = softShade(0.7, 0.2, 0.12).map((v) => Math.round(v ** (1 / 2.2) * 1000) / 10);
    expect(deskShadeCss(REST, "light")).toBe(`rgb(${rest[0]}% ${rest[1]}% ${rest[2]}%)`);
    expect(deskShadeCss({ ...REST, shade: 0.55 }, "light")).not.toBe(deskShadeCss(REST, "light"));
    expect(deskShadeCss({ ...REST, tint: 1 }, "light")).not.toBe(deskShadeCss(REST, "light"));
  });

  it("by night is the Moon's own, whatever the rows say", () => {
    const moon = deskShadeCss(REST, "dark");
    expect(moon).toBe("rgb(78.8% 76.8% 81.9%)");
    expect(deskShadeCss({ ...REST, shade: 0.55, tint: 1 }, "dark")).toBe(moon);
  });
});
