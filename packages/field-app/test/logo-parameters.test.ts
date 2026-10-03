import {
  DEFAULT_LOGO,
  LOGO_PRESETS,
  logoSvg,
  normalizeLogo,
  parseLogo,
  serializeLogo,
} from "@vibefield/design-kit/logo";
import { describe, expect, it } from "vitest";

describe("logo preset input boundary", () => {
  it("keeps untrusted data finite and within GPU-safe limits", () => {
    const p = normalizeLogo({
      scale: Infinity,
      thickness: -20,
      density: 1e9,
      speed: "fast",
      twist: Number.NaN,
      colorA: "red",
      ink: '#fff"/><script/>',
      colorB: "#aBcD09",
      field: 0.3,
    });
    expect(p.scale).toBe(DEFAULT_LOGO.scale);
    expect(p.thickness).toBe(0.015);
    expect(p.density).toBe(480);
    expect(p.speed).toBe(DEFAULT_LOGO.speed);
    expect(p.twist).toBe(DEFAULT_LOGO.twist);
    expect(p.colorA).toBe(DEFAULT_LOGO.colorA);
    expect(p.ink).toBe(DEFAULT_LOGO.ink);
    expect(p.colorB).toBe("#aBcD09");
    expect(p.field).toBe(0.3);
  });

  it.each(LOGO_PRESETS)("round-trips every parameter in $name", ({ parameters }) => {
    expect(parseLogo(serializeLogo(parameters))).toEqual(parameters);
  });

  it("upgrades existing presets with the new 3D and edge-flow defaults", () => {
    const {
      rollAngle,
      twistFocus,
      rollSpeed,
      depth,
      perspective,
      edgeFlow,
      edgeSpeed,
      edgeLength,
      edgePulses,
      ...original
    } = DEFAULT_LOGO;
    expect(parseLogo(JSON.stringify({ version: 1, parameters: original }))).toEqual(DEFAULT_LOGO);
  });

  it("allows reverse motion, stationary poses, and an integral pulse count", () => {
    const p = normalizeLogo({
      rollSpeed: -1,
      edgeSpeed: -2,
      rollAngle: 90,
      edgePulses: 3.6,
      depth: 200,
      perspective: -1,
      edgeFlow: 0,
    });
    expect(p.rollSpeed).toBe(-1);
    expect(p.edgeSpeed).toBe(-2);
    expect(p.rollAngle).toBe(30);
    expect(p.edgePulses).toBe(4);
    expect(p.depth).toBe(0.6);
    expect(p.perspective).toBe(0);
    expect(p.edgeFlow).toBe(0);
    expect(normalizeLogo({ rollSpeed: 0, edgeSpeed: 0 }).rollSpeed).toBe(0);
  });

  it("makes previously saved full-turn poses readable without discarding their palette", () => {
    const restored = parseLogo(
      JSON.stringify({ version: 1, parameters: { rollAngle: -180, colorA: "#facade" } }),
    );
    expect(restored.rollAngle).toBe(-30);
    expect(restored.twistFocus).toBe(DEFAULT_LOGO.twistFocus);
    expect(restored.colorA).toBe("#facade");
  });

  it("migrates the old rocking range into twist focus and honors new explicit values", () => {
    expect(normalizeLogo({ rollRange: 20 }).twistFocus).toBe(0.5);
    expect(normalizeLogo({ rollRange: 40, twistFocus: 0.2 }).twistFocus).toBe(0.2);
    expect(normalizeLogo({ rollRange: Infinity }).twistFocus).toBe(DEFAULT_LOGO.twistFocus);
    expect(normalizeLogo({ rollRange: 400 }).twistFocus).toBe(1);
  });

  it.each([
    "{",
    "null",
    "[]",
    '{"version":2,"parameters":{}}',
    '{"version":1,"parameters":[]}',
    '{"version":1,"parameters":null}',
  ])("rejects a malformed or unsupported preset: %s", (source) => {
    expect(() => parseLogo(source)).toThrow();
  });

  it("exports self-contained flat geometry with safe color attributes", () => {
    const svg = logoSvg({ ...DEFAULT_LOGO, ink: '#fff" onload="alert(1)' });
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain("onload");
    expect(svg).not.toMatch(/NaN|Infinity|<script|<image|url\(/);
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
  });
});
