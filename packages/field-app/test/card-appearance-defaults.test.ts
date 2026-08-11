// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OVERLAP_FEEDBACK_DEFAULTS } from "@vibefield/design-kit/card-appearance";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokenCss = readFileSync(join(PACKAGE_ROOT, "..", "design-kit", "src", "tokens.css"), "utf8");
const darkStart = tokenCss.indexOf(".dark {");
const lightTokens = tokenCss.slice(0, darkStart);
const darkTokens = tokenCss.slice(darkStart);

const cssValue = (scope: string, name: string): string | undefined => {
  const declaration = scope
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${name}:`));
  return declaration?.slice(name.length + 1, -1).trim();
};

const rgbChannels = (hex: string): string => {
  const packed = Number.parseInt(hex.slice(1), 16);
  return `${(packed >> 16) & 0xff}, ${(packed >> 8) & 0xff}, ${packed & 0xff}`;
};

describe("CardShell appearance defaults", () => {
  it("keeps packaged light and dark tokens aligned with the product-owned tuning", () => {
    const defaults = OVERLAP_FEEDBACK_DEFAULTS;

    expect(cssValue(lightTokens, "--ic-glow-color")).toBe(rgbChannels(defaults.colors.glowLight));
    expect(cssValue(lightTokens, "--ic-rim-color")).toBe(rgbChannels(defaults.colors.rimLight));
    expect(cssValue(darkTokens, "--ic-glow-color")).toBe(rgbChannels(defaults.colors.glowDark));
    expect(cssValue(darkTokens, "--ic-rim-color")).toBe(rgbChannels(defaults.colors.rimDark));

    expect(cssValue(lightTokens, "--ic-glow-alpha-c")).toBe(String(defaults.glowAlpha[0]));
    expect(cssValue(lightTokens, "--ic-glow-alpha-t")).toBe(String(defaults.glowAlpha[1]));
    expect(cssValue(lightTokens, "--ic-glow-size-c")).toBe(`${defaults.glowSize[0]}px`);
    expect(cssValue(lightTokens, "--ic-glow-size-t")).toBe(`${defaults.glowSize[1]}px`);
    expect(cssValue(lightTokens, "--ic-rim-alpha-c")).toBe(String(defaults.rimAlpha[0]));
    expect(cssValue(lightTokens, "--ic-rim-alpha-t")).toBe(String(defaults.rimAlpha[1]));
    expect(cssValue(lightTokens, "--ic-rim-width")).toBe(`${defaults.rimWidth}px`);
    expect(cssValue(lightTokens, "--ic-rim-radius")).toBe(`${defaults.rimRadius}px`);
  });
});
