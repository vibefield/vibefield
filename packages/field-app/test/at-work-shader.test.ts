// @vitest-environment node
/**
 * Item 550 (2026-11-18) — THE AT-WORK SHADER (DESIGN.md §5 "The at-work mark's shadows and its light", §8 "At work
 * on the mat"). Its GLSL spells no ink: every colour reaches it as a uniform read from a root token, an ink in the
 * rows or a printed star's palette. The only colour numbers it writes are light, not ink, its own numbers as the
 * press keeps its lamp (DESIGN.md §5): 0 and 1, and the printed star's warm night eye, `EYE_NIGHT`, allowed here by
 * its name alone and held to its one value. The rows the layer packs and the rows the shader reads are one table,
 * parsed back out of the GLSL here. Its floats are never bare integers. Its colour uniforms read from tokens.css as
 * the root holds it, by day and by night. Its pencil band is ICE's brackets at rest, and its context refuses a
 * software one. Red first: each row says what the shader must hold.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AT_WORK } from "../src/field/desk/at-work/at-work-model";
import {
  AT_WORK_CONTEXT,
  AT_WORK_FS,
  AT_WORK_NO_HAND,
  AT_WORK_PENCIL,
  AT_WORK_ROWS,
  AT_WORK_SHADER,
  AT_WORK_SHADER_TOKENS,
  AT_WORK_UNIFORMS,
  AT_WORK_VS,
  atWorkHandUniforms,
  atWorkPencilOf,
  atWorkShaderColours,
  glslFloat,
} from "../src/field/desk/at-work/at-work-shader";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const STAGES = { vertex: AT_WORK_VS, fragment: AT_WORK_FS } as const;
const BOTH = Object.entries(STAGES);

/** A GLSL source with its comments taken out, so a number in a comment is never read as code. */
const codeOf = (glsl: string): string =>
  glsl.replace(/\/\/[^\n]*/gu, "").replace(/\/\*[\s\S]*?\*\//gu, "");

/** Every `vec3(…)`/`vec4(…)` call's arguments, split at their own top-level commas. */
function vectorCalls(glsl: string): { readonly call: string; readonly args: readonly string[] }[] {
  const code = codeOf(glsl);
  const out: { call: string; args: string[] }[] = [];
  const opener = /\b(?:vec3|vec4)\s*\(/gu;
  for (let found = opener.exec(code); found !== null; found = opener.exec(code)) {
    let depth = 1;
    let at = found.index + found[0].length;
    let from = at;
    const args: string[] = [];
    while (depth > 0 && at < code.length) {
      const c = code[at];
      if (c === "(") depth += 1;
      if (c === ")") depth -= 1;
      if ((c === "," && depth === 1) || depth === 0) {
        args.push(code.slice(from, at).trim());
        from = at + 1;
      }
      at += 1;
    }
    out.push({ call: code.slice(found.index, at), args });
  }
  return out;
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/u;

function near(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [i, value] of expected.entries()) expect(actual[i]).toBeCloseTo(value, 9);
}

/** The one light the GLSL spells past 0 and 1, by its name: the printed star's eyes by night (DESIGN.md §5, light as
 * the press keeps its lamp; tokens.css keeps no token for it). Only its own declaration is passed over. */
const EYE_NIGHT_DECLARED = /const vec3 EYE_NIGHT = (vec3\([^)]*\));/u;
const EYE_NIGHT_LIGHT = "vec3(1.0, 0.99, 0.965)";

/** Every vec3/vec4 call that spells a number but 0 or 1, the night eye's own declaration passed over. */
function colourCallsOf(glsl: string): string[] {
  const offenders: string[] = [];
  for (const { call, args } of vectorCalls(glsl.replace(EYE_NIGHT_DECLARED, ""))) {
    if (args.some((arg) => NUMBER.test(arg) && Number(arg) !== 0 && Number(arg) !== 1))
      offenders.push(call);
  }
  return offenders;
}

/** A GLSL float literal: a fraction or an exponent, never a bare integer. */
const FLOAT = /^-?(?:\d+\.\d*|\.\d+|\d+(?:\.\d*)?[eE][-+]?\d+)$/u;

/** tokens.css as the root holds it: one theme's block, a `var()` followed to its own value. */
const TOKENS = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");
function block(theme: ":root" | ".dark"): string {
  const start = TOKENS.indexOf(`\n${theme} {`);
  return start < 0 ? "" : TOKENS.slice(start, TOKENS.indexOf("\n}", start));
}
function tokenOf(name: string, theme: ":root" | ".dark"): string {
  const pick = (from: ":root" | ".dark"): string | undefined =>
    new RegExp(`\\s${name}:\\s*([^;]+);`).exec(block(from))?.[1]?.trim();
  const value = (theme === ".dark" ? pick(".dark") : undefined) ?? pick(":root") ?? "";
  const alias = /^var\((--[\w-]+)\)$/u.exec(value)?.[1];
  return alias === undefined ? value : tokenOf(alias, theme);
}

describe("the shader spells no ink — its light is 0 and 1 and the one named eye, ink is a uniform (DESIGN.md §5)", () => {
  it.each(BOTH)("holds the %s stage's numbers to 0 and 1, the named eye aside", (_, glsl) => {
    expect(colourCallsOf(glsl)).toEqual([]);
  });

  it("finds the calls it holds — the reader is not blind", () => {
    const fragment = vectorCalls(AT_WORK_FS);
    expect(fragment.length).toBeGreaterThan(10);
    expect(fragment.some(({ call }) => call === "vec3(1.0)")).toBe(true);
    // a planted colour is caught, in either stage's spelling
    const planted = vectorCalls("void main() { vec3 a = mix(b, vec3(1.0, 0.99, 0.965), 0.5); }");
    expect(planted.flatMap(({ args }) => args.filter((arg) => NUMBER.test(arg)))).toEqual([
      "1.0",
      "0.99",
      "0.965",
    ]);
  });

  it("passes over the night eye by its name alone: its value under another name, or spelled inline, is caught", () => {
    expect(colourCallsOf(`const vec3 EYE_NIGHT = ${EYE_NIGHT_LIGHT};`)).toEqual([]);
    expect(colourCallsOf(`const vec3 EYE_DAY = ${EYE_NIGHT_LIGHT};`)).toEqual([EYE_NIGHT_LIGHT]);
    const inline = `vec3 a = mix(paper, ${EYE_NIGHT_LIGHT}, lit);`;
    expect(colourCallsOf(inline)).toEqual([EYE_NIGHT_LIGHT]);
    // a second declaration is no allowance: only the first is passed over
    const twice = `const vec3 EYE_NIGHT = ${EYE_NIGHT_LIGHT};\nconst vec3 EYE_NIGHT = vec3(0.5);`;
    expect(colourCallsOf(twice)).toEqual(["vec3(0.5)"]);
  });

  it("writes no hex and no colour function in its GLSL", () => {
    for (const glsl of Object.values(STAGES)) {
      expect(codeOf(glsl)).not.toMatch(/#[\da-f]{3,8}\b|\b0x[\da-f]+\b/iu);
      expect(codeOf(glsl)).not.toMatch(/\b(?:rgba?|hsla?|oklch|lab|lch)\(/iu);
    }
  });

  it("names the printed star's night eye, its one warm light, in one place", () => {
    expect(EYE_NIGHT_DECLARED.exec(AT_WORK_FS)?.[1]).toBe(EYE_NIGHT_LIGHT);
    // declared once and read once, in the fragment stage alone
    expect(codeOf(AT_WORK_FS).match(/\bEYE_NIGHT\b/gu)).toHaveLength(2);
    expect(AT_WORK_VS).not.toMatch(/\bEYE_NIGHT\b/u);
  });

  it("says its light's wide spread as a spill, never a halo", () => {
    expect(AT_WORK_FS).not.toMatch(/\bhalo\b/iu);
  });
});

describe("the rows: one table, the layer's and the shader's", () => {
  const ints: Readonly<Record<string, number>> = {
    ROW_TEXELS: AT_WORK_ROWS.texels,
    O_FRAME: AT_WORK_ROWS.object.frame,
    O_TURN: AT_WORK_ROWS.object.turn,
    O_STROKES: AT_WORK_ROWS.object.strokes,
    S_MOTION: AT_WORK_ROWS.stroke.motion,
    S_INK: AT_WORK_ROWS.stroke.ink,
    S_DEEP: AT_WORK_ROWS.stroke.deep,
    S_LEAN_A: AT_WORK_ROWS.stroke.leanA,
    S_LEAN_B: AT_WORK_ROWS.stroke.leanB,
    S_HAND: AT_WORK_ROWS.stroke.hand,
    S_WIDTH: AT_WORK_ROWS.stroke.width,
    E_PLACE: AT_WORK_ROWS.seat.place,
    E_INK: AT_WORK_ROWS.seat.ink,
    E_LEAN_A: AT_WORK_ROWS.seat.leanA,
    E_LEAN_B: AT_WORK_ROWS.seat.leanB,
    E_HAND: AT_WORK_ROWS.seat.hand,
    E_RING: AT_WORK_ROWS.seat.ring,
    E_CREW: AT_WORK_ROWS.seat.crew,
    E_CREW_INK: AT_WORK_ROWS.seat.crewInk,
    E_CREW_A: AT_WORK_ROWS.seat.crewLeanA,
    E_CREW_B: AT_WORK_ROWS.seat.crewLeanB,
    PIECES: AT_WORK_ROWS.pieces,
    MOST: AT_WORK_ROWS.strokes,
  };

  it.each(BOTH)("reads every row's texel in the %s stage where the layer writes it", (_, glsl) => {
    const declared = new Map(
      [...glsl.matchAll(/^const int (\w+) = (-?\d+);$/gmu)].map(
        (m) => [m[1] ?? "", Number(m[2])] as const,
      ),
    );
    expect(Object.fromEntries(declared)).toEqual(ints);
  });

  it("reads the forms and the reaches as floats of the same numbers", () => {
    const floats = new Map(
      [...AT_WORK_FS.matchAll(/^const float (\w+) = ([^;]+);$/gmu)].map(
        (m) => [m[1] ?? "", m[2] ?? ""] as const,
      ),
    );
    expect(Number(floats.get("FORM_STARLIGHT"))).toBe(AT_WORK_ROWS.form.starlight);
    expect(Number(floats.get("FORM_LINE"))).toBe(AT_WORK_ROWS.form.line);
    expect(Number(floats.get("SEAT_COUNT"))).toBe(AT_WORK_ROWS.seatForm.count);
    expect(Number(floats.get("SEAT_STAR"))).toBe(AT_WORK_ROWS.seatForm.star);
    expect(Number(floats.get("QUAD_REACH"))).toBe(AT_WORK_SHADER.quadReach);
    expect(Number(floats.get("SEAT_REACH"))).toBe(AT_WORK_SHADER.seatReach);
    expect(Number(floats.get("PENCIL_BAND"))).toBe(AT_WORK_SHADER.pencilBand);
    expect(Number(floats.get("IRID"))).toBe(AT_WORK_SHADER.irid);
    expect(Number(floats.get("SEAT_FIRST"))).toBe(AT_WORK.seat.first);
    expect(Number(floats.get("SEAT_APART"))).toBe(AT_WORK.seat.apart);
    // at most the model's three strokes an object
    expect(AT_WORK_ROWS.strokes).toBe(AT_WORK.stroke.most);
  });

  it("declares every uniform the layer looks up, and no other", () => {
    const declared = new Set(
      Object.values(STAGES).flatMap((glsl) =>
        [...glsl.matchAll(/^uniform \w+ (\w+);$/gmu)].map((m) => m[1] ?? ""),
      ),
    );
    expect([...declared].sort()).toEqual([...AT_WORK_UNIFORMS].sort());
  });
});

describe("its floats are never bare integers", () => {
  it("spells a whole number with its point, and any other as it is", () => {
    expect(glslFloat(0)).toBe("0.0");
    expect(glslFloat(1)).toBe("1.0");
    expect(glslFloat(-3)).toBe("-3.0");
    expect(glslFloat(0.6)).toBe("0.6");
    expect(glslFloat(-0.2891)).toBe("-0.2891");
    for (const n of [0, 1, 2, -3, 48, 0.5, 1e-7, 1e21, -0.10471975511965977])
      expect(glslFloat(n)).toMatch(FLOAT);
  });

  it("refuses a number no GLSL float spells", () => {
    expect(() => glslFloat(Number.NaN)).toThrow();
    expect(() => glslFloat(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("gives every float constant of both stages a fraction or an exponent", () => {
    for (const glsl of Object.values(STAGES)) {
      const values = [...glsl.matchAll(/^const float \w+ = ([^;]+);$/gmu)].map((m) => m[1] ?? "");
      expect(values.length).toBeGreaterThan(0);
      for (const value of values.filter((v) => NUMBER.test(v))) expect(value).toMatch(FLOAT);
    }
  });
});

describe("its colours, read from the root", () => {
  it.each([":root", ".dark"] as const)("reads each colour uniform from tokens.css %s", (theme) => {
    const colours = atWorkShaderColours((name) => tokenOf(name, theme));
    expect(colours).not.toBeNull();
    // the cut keeps its own alpha; the rest are opaque
    expect(colours?.cut.alpha).toBeGreaterThan(0);
    expect(colours?.cut.alpha).toBeLessThan(1);
  });

  it("gives the GL form nothing to draw with when a token is missing or not a colour", () => {
    for (const missing of Object.values(AT_WORK_SHADER_TOKENS)) {
      const read = (name: string): string => (name === missing ? "" : tokenOf(name, ":root"));
      expect(atWorkShaderColours(read), missing).toBeNull();
    }
    const translucent = (name: string): string =>
      name === AT_WORK_SHADER_TOKENS.print ? "rgb(22 23 27 / 50%)" : tokenOf(name, ":root");
    expect(atWorkShaderColours(translucent)).toBeNull();
  });
});

describe("the pencil band and the context", () => {
  it("keeps off ICE's brackets at rest: 6 out, their corner the frame's + 6, never past 10", () => {
    for (const r of [0, 2, 3, 4, 8, 20]) {
      const pencil = atWorkPencilOf({ cx: 50, cy: 40, hx: 30, hy: 20, angle: 0.3, r });
      expect(pencil.turn[2]).toBe(Math.min(r + 6, 10));
      expect(pencil.box).toEqual([50, 40, 30 + AT_WORK_PENCIL.gap, 20 + AT_WORK_PENCIL.gap]);
      expect(pencil.turn[3]).toBe(0);
    }
    expect(AT_WORK_PENCIL.gap).toBe(6);
    expect(AT_WORK_PENCIL.radiusMost).toBe(10);
  });

  it("covers the marks behind the object in hand by its silhouette, and only those its rows say lie under it (2026-11-24)", () => {
    // the hand's silhouette, as the pencil's box: centre and half extents, then its turn and its corner; none: z ≤ 0
    expect(atWorkHandUniforms(null)).toBe(AT_WORK_NO_HAND);
    expect(AT_WORK_NO_HAND.box[2]).toBeLessThanOrEqual(0);
    const hand = atWorkHandUniforms({ cx: 600, cy: 400, hx: 200, hy: 120, angle: 0.3, r: 16 });
    expect(hand.box).toEqual([600, 400, 200, 120]);
    near(hand.turn, [Math.cos(0.3), Math.sin(0.3), 16, 0]);
    expect(AT_WORK_UNIFORMS).toContain("uHandBox");
    expect(AT_WORK_UNIFORMS).toContain("uHandTurn");
    // the object's row says it lies under the hand (its strokes texel's w), and the fragment stage reads it for a band
    // piece and for a seat (through the seat's object row), masking the whole fragment out of the silhouette
    const code = codeOf(AT_WORK_FS);
    expect(code).toMatch(/float handMask\(/u);
    expect(code).toMatch(/row\(\w+, O_STROKES\)\.w/u);
    expect(code).toMatch(/\* handMask\(/u);
  });

  it("asks for a premultiplied canvas and refuses a context the browser would run in software", () => {
    expect(AT_WORK_CONTEXT.premultipliedAlpha).toBe(true);
    expect(AT_WORK_CONTEXT.failIfMajorPerformanceCaveat).toBe(true);
  });
});
