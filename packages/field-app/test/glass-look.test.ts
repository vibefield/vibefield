/**
 * Track FG, FG-3b — the Setup Assistant's glass as the field reads it (glass-look.ts; FG-D24): its recipe off its CSS
 * layers' computed style, so DESIGN.md §5's tokens stay the one authority for both glasses, and its pose off the glass
 * each frame it moves. happy-dom computes no CSS, so the rows hand the reader the style a browser would. FG-4b: the
 * logo — its filter in the look, its fade in the pose, and its box, the field's mark (field-mark.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FIELD_MARK, FIELD_STILLS, logoBox } from "../src/boot/splash/field-mark";
import {
  GLASS_SHADOWS,
  type GlassPose,
  parseNumber,
  parsePx,
  parseRgba,
  parseShadows,
  readGlassLook,
  readGlassPose,
  samePose,
} from "../src/boot/splash/glass-look";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Chrome's serialization of `--vf-shadow-wizard-field` (DESIGN.md §5): the colour first, every length in px. */
const FIELD_SHADOW =
  "rgba(4, 5, 15, 0.55) 0px 40px 120px 0px, rgba(4, 5, 15, 0.28) 0px 12px 32px 0px";

describe("the computed values the field reads", () => {
  it("takes a colour only as the browser serializes it, else none", () => {
    expect(parseRgba("rgb(255, 255, 255)")).toEqual([1, 1, 1, 1]);
    expect(parseRgba("rgba(28, 28, 30, 0.55)")).toEqual([28 / 255, 28 / 255, 30 / 255, 0.55]);
    expect(parseRgba(" rgba(0, 0, 0, 0) ")).toEqual([0, 0, 0, 0]);
    // the token's own spelling, another colour space, nothing: never a colour misread
    expect(parseRgba("rgb(255 255 255 / 55%)")).toBeNull();
    expect(parseRgba("color(display-p3 1 1 1)")).toBeNull();
    expect(parseRgba("")).toBeNull();
  });

  it("takes a box-shadow's shadows in CSS's order, and nothing it can't draw", () => {
    expect(parseShadows(FIELD_SHADOW)).toEqual([
      { color: [4 / 255, 5 / 255, 15 / 255, 0.55], x: 0, y: 40, blur: 120, spread: 0 },
      { color: [4 / 255, 5 / 255, 15 / 255, 0.28], x: 0, y: 12, blur: 32, spread: 0 },
    ]);
    expect(parseShadows("rgba(0, 0, 0, 0.08) -2px 8.5px 30px -1px")).toEqual([
      { color: [0, 0, 0, 0.08], x: -2, y: 8.5, blur: 30, spread: -1 },
    ]);
    expect(parseShadows("none")).toEqual([]);
    // an inset shadow is the edge's, and the field draws no edge
    expect(parseShadows("rgba(255, 255, 255, 0.6) 0px 0px 0px 1px inset")).toBeNull();
    expect(parseShadows("0px 8px 30px black")).toBeNull();
  });

  it("takes a token's length in px and its plain numbers", () => {
    expect(parsePx("32px")).toBe(32);
    expect(parsePx(" 32px")).toBe(32);
    expect(parsePx("2rem")).toBeNull();
    expect(parseNumber("1.12")).toBe(1.12);
    expect(parseNumber(" 0.03 ")).toBe(0.03);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("1.12px")).toBeNull();
  });
});

/** A computed style as `getComputedStyle` returns one: properties, and custom properties by name. */
function computed(
  props: Partial<
    Record<"backgroundColor" | "borderTopLeftRadius" | "boxShadow" | "filter", string>
  >,
  custom: Record<string, string> = {},
): CSSStyleDeclaration {
  return {
    backgroundColor: "",
    borderTopLeftRadius: "",
    boxShadow: "",
    filter: "none",
    ...props,
    getPropertyValue: (name: string) => custom[name] ?? "",
  } as unknown as CSSStyleDeclaration;
}

/** The glass's layers as wizard-ui.tsx draws them, and the styles a browser computes for them by day. */
function stage(
  overrides: {
    tokens?: Record<string, string>;
    tint?: string;
    shadow?: string;
    radius?: string;
    filter?: string;
  } = {},
) {
  const glass = document.createElement("div");
  const shadow = document.createElement("div");
  const frost = document.createElement("div");
  const logo = document.createElement("div");
  glass.append(shadow, frost, logo);
  document.body.append(glass);
  const tokens = {
    "--vf-wizard-blur": "32px",
    "--vf-wizard-saturate": "1.12",
    "--vf-wizard-grain": "0.03",
    ...overrides.tokens,
  };
  const asked: [Element, string | null | undefined][] = [];
  const style = ((element: Element, pseudo?: string | null) => {
    asked.push([element, pseudo]);
    if (element === glass)
      return computed({ borderTopLeftRadius: overrides.radius ?? "32px" }, tokens);
    if (element === shadow) return computed({ boxShadow: overrides.shadow ?? FIELD_SHADOW });
    if (element === frost && pseudo === "::after")
      return computed({ backgroundColor: overrides.tint ?? "rgba(255, 255, 255, 0.55)" });
    if (element === logo)
      return computed({ filter: overrides.filter ?? "invert(1) hue-rotate(180deg)" });
    return computed({});
  }) as typeof getComputedStyle;
  return { layers: { glass, shadow, frost, logo }, style, asked };
}

describe("the glass's look, read off its layers", () => {
  it("is §5's recipe as the layers compute it: the tint off the frost's ::after, the tokens, the corner and the shadows", () => {
    const { layers, style, asked } = stage();
    expect(readGlassLook(layers, style)).toEqual({
      tint: [1, 1, 1, 0.55],
      blur: 32,
      saturate: 1.12,
      grain: 0.03,
      radius: 32,
      shadows: [
        { color: [4 / 255, 5 / 255, 15 / 255, 0.55], x: 0, y: 40, blur: 120, spread: 0 },
        { color: [4 / 255, 5 / 255, 15 / 255, 0.28], x: 0, y: 12, blur: 32, spread: 0 },
      ],
      logoInvert: true,
    });
    // the tint is the frost's ::after, never the frost itself
    expect(
      asked.some(([element, pseudo]) => element === layers.frost && pseudo === "::after"),
    ).toBe(true);
  });

  it("follows the theme's tint: smoke by night", () => {
    const { layers, style } = stage({ tint: "rgba(28, 28, 30, 0.55)" });
    expect(readGlassLook(layers, style)?.tint).toEqual([28 / 255, 28 / 255, 30 / 255, 0.55]);
  });

  it("inverts the logo where its filter does: on milk, never on smoke (FG-4b; §5's logo filter)", () => {
    const night = stage({ filter: "none" });
    expect(readGlassLook(night.layers, night.style)?.logoInvert).toBe(false);
    const unset = stage({ filter: "" });
    expect(readGlassLook(unset.layers, unset.style)?.logoInvert).toBe(false);
    const day = stage();
    expect(readGlassLook(day.layers, day.style)?.logoInvert).toBe(true);
    // the token is the one filter by day and none by night, so any filter read is milk's
    const tokens = readFileSync(join(process.cwd(), "../design-kit/src/tokens.css"), "utf8");
    expect(tokens.match(/--vf-wizard-logo-filter: [^;]+;/gu)).toEqual([
      "--vf-wizard-logo-filter: invert(1) hue-rotate(180deg);",
      "--vf-wizard-logo-filter: none;",
    ]);
  });

  it("is none when any of it can't be read, so the browser keeps the glass", () => {
    const missing = stage({ tokens: { "--vf-wizard-blur": "" } });
    expect(readGlassLook(missing.layers, missing.style)).toBeNull();
    const unit = stage({ tokens: { "--vf-wizard-blur": "2rem" } });
    expect(readGlassLook(unit.layers, unit.style)).toBeNull();
    const space = stage({ tint: "color(display-p3 1 1 1 / 0.55)" });
    expect(readGlassLook(space.layers, space.style)).toBeNull();
    const corner = stage({ radius: "50%" });
    expect(readGlassLook(corner.layers, corner.style)).toBeNull();
    // the field's pass draws at most two shadows (§5's field shadow has two)
    expect(GLASS_SHADOWS).toBe(2);
    const three = stage({ shadow: `${FIELD_SHADOW}, rgba(0, 0, 0, 0.1) 0px 1px 2px 0px` });
    expect(readGlassLook(three.layers, three.style)).toBeNull();
  });

  it("draws no shadow where the layer casts none", () => {
    const { layers, style } = stage({ shadow: "none" });
    expect(readGlassLook(layers, style)?.shadows).toEqual([]);
  });
});

describe("the glass's pose, read off the glass", () => {
  /** The glass laid out at 880 × 640 and drawn at `rect` (its fit is an ancestor's scale). */
  function placed(rect: { left: number; top: number; width: number; height: number }) {
    const glass = document.createElement("div");
    Object.defineProperty(glass, "offsetWidth", { value: 880 });
    Object.defineProperty(glass, "offsetHeight", { value: 640 });
    glass.getBoundingClientRect = () => new DOMRect(rect.left, rect.top, rect.width, rect.height);
    return glass;
  }
  const forming = (frost: string, rise: string, logo = "0") =>
    (() =>
      computed(
        {},
        { "--vf-glass-frost": frost, "--vf-glass-rise": rise, "--vf-glass-logo": logo },
      )) as typeof getComputedStyle;
  const field = new DOMRect(0, 28, 1200, 800);

  it("stands at the glass's centre on the field's canvas, its fit read off its box", () => {
    // fitted at 0.75: 660 × 480 on the page, centred in a field that starts 28 down
    const glass = placed({ left: 270, top: 188, width: 660, height: 480 });
    expect(readGlassPose(glass, field, forming("0.4", "0.99", "0.5"))).toEqual({
      x: 600,
      y: 400,
      w: 880,
      h: 640,
      fit: 0.75,
      frost: 0.4,
      rise: 0.99,
      logo: 0.5,
    });
  });

  it("is whole when the forming says nothing, with no logo, and its frost and its logo never leave 0 … 1", () => {
    const glass = placed({ left: 160, top: 108, width: 880, height: 640 });
    const still = (() => computed({})) as typeof getComputedStyle;
    expect(readGlassPose(glass, field, still)).toMatchObject({
      fit: 1,
      frost: 1,
      rise: 1,
      logo: 0,
    });
    expect(readGlassPose(glass, field, forming("1.2", "1")).frost).toBe(1);
    expect(readGlassPose(glass, field, forming("-0.1", "1")).frost).toBe(0);
    expect(readGlassPose(glass, field, forming("1", "1", "1.3")).logo).toBe(1);
    expect(readGlassPose(glass, field, forming("1", "1", "-0.2")).logo).toBe(0);
  });

  it("is the same pose only when every part of it is", () => {
    const pose: GlassPose = {
      x: 600,
      y: 400,
      w: 880,
      h: 640,
      fit: 0.75,
      frost: 0.4,
      rise: 0.99,
      logo: 0.5,
    };
    expect(samePose(pose, { ...pose })).toBe(true);
    for (const key of Object.keys(pose) as (keyof GlassPose)[]) {
      expect(samePose(pose, { ...pose, [key]: pose[key] + 0.001 }), key).toBe(false);
    }
  });
});

describe("the logo's box (FG-4b, field-mark.ts)", () => {
  const splash = (file: string): string => join(process.cwd(), "src/boot/splash", file);

  it("is the field's own mark: the vendored splash's BAKED.logo", () => {
    const source = readFileSync(splash("vibefield-splash.js"), "utf8");
    const baked = source.match(/"logo":\{"w":(\d+),"h":(\d+)/u);
    expect(baked?.slice(1).map(Number)).toEqual([FIELD_MARK.width, FIELD_MARK.height]);
  });

  it("knows each still's own size, read off the picture (its AVIF's `ispe`)", () => {
    const size = (file: string): [number, number] => {
      const bytes = readFileSync(splash(`assets/${file}`));
      const at = bytes.indexOf("ispe");
      return [bytes.readUInt32BE(at + 8), bytes.readUInt32BE(at + 12)];
    };
    expect(size("splash-still-wide.avif")).toEqual([
      FIELD_STILLS.wide.width,
      FIELD_STILLS.wide.height,
    ]);
    expect(size("splash-still-tall.avif")).toEqual([
      FIELD_STILLS.tall.width,
      FIELD_STILLS.tall.height,
    ]);
    // boot.css draws the tall still from an aspect of 1:1 down, as logoBox reads it
    const boot = readFileSync(join(process.cwd(), "src/boot/boot.css"), "utf8");
    expect(boot).toMatch(
      /@media \(max-aspect-ratio: 1 \/ 1\) \{\s*\.vf-field\[data-field="still"\] \{\s*background-image: url\("\.\/splash\/assets\/splash-still-tall\.avif"\);/u,
    );
  });

  it("is the field's mark where the field draws it, and the still's own mark, cover-fitted, over the still", () => {
    expect(logoBox(1440, 900, false)).toEqual(FIELD_MARK);
    // the wide still at its own size: its mark at 1×
    expect(logoBox(1440, 900, true)).toEqual({ width: 128, height: 77 });
    // a wider window covers by width: 1.25×
    expect(logoBox(1800, 900, true)).toEqual({ width: 160, height: 96.25 });
    // a taller window covers by height
    expect(logoBox(1200, 1000, true)).toEqual({
      width: 128 * (1000 / 900),
      height: 77 * (1000 / 900),
    });
    // the tall still, 2 picture px a CSS px: at half its size its mark is the field's
    expect(logoBox(390, 844, true)).toEqual({ width: 128, height: 77 });
    // a window not laid out yet keeps the field's mark
    expect(logoBox(0, 0, true)).toEqual(FIELD_MARK);
  });
});
