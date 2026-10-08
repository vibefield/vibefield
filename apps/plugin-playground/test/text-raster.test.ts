// THE STILL'S TEXT RASTER (DK-17b; ICE petition I35): the desk's hand on a Node canvas — the product's own three faces
// (field-app's table, the shipped files), registered from disk under ICE's families and weights, measured as ICE's browser
// raster measures them (at 100 px, in em) and drawn by its recipe (each glyph in its frame, at its pressure, over the pen's
// bleed; the alpha as coverage). CPU only — no GPU — so it runs in `test`.
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { type HandLayout, PEN_FACES } from "@vibecook/ice/desk";
import { DESK_FACE_FILES } from "@vibefield/field-app/desk-faces";
import { describe, expect, it } from "vitest";
import { deskFacePaths, stillTextRaster } from "../src/text-raster";

/** A layout of `text` on one baseline, each glyph upright at full pressure — what the kit's `layoutText` hands a raster. */
function lineOf(text: string, em: number, advance: (ch: string) => number): HandLayout {
  let x = 4;
  const glyphs = [...text].map((ch, i) => {
    const g = { ch, i, x, y: em, rot: 0, scale: 1, press: 1, line: 0 };
    x += advance(ch) * em;
    return g;
  });
  return {
    glyphs,
    lines: [],
    positions: new Float32Array(2 * (text.length + 1)),
    overflow: false,
    em,
    ascent: 0.9,
    descent: 0.3,
  } as unknown as HandLayout;
}

describe("the faces — the product's own files, by the desk's names", () => {
  it("are field-app's table, on disk beside it: Caveat 500 and 600, Kalam 400", () => {
    const paths = deskFacePaths();
    expect(Object.keys(paths)).toEqual(["caveat", "caveat-bold", "kalam"]);
    for (const [name, path] of Object.entries(paths)) {
      expect(basename(path), name).toBe(DESK_FACE_FILES[name]);
      expect(existsSync(path), path).toBe(true);
    }
  });
});

describe("the raster — ICE's TextRaster, drawn by ICE's own recipe", () => {
  it("answers a face's metrics at once, in em — the shipped face's own box — and never moves its version", async () => {
    const raster = await stillTextRaster();
    const caveat = raster.metrics("caveat");
    expect(caveat?.ascent).toBeCloseTo(0.96, 2); // Caveat's ascent and descent, as its font file gives them
    expect(caveat?.descent).toBeCloseTo(0.3, 2);
    expect(caveat?.advance("x")).toBeGreaterThan(0.2);
    // the semibold is its own face (a heavier advance), Kalam its own family
    expect(raster.metrics("caveat-bold")?.advance("Hello") ?? 0).not.toBe(caveat?.advance("Hello"));
    expect(raster.metrics("kalam")?.ascent).toBeGreaterThan(1);
    expect(raster.version()).toBe(1);
    raster.metrics("kalam");
    expect(raster.version()).toBe(1);
  });

  it("names no face it has no file for — ICE's platform faces are drawable on no host here", async () => {
    const raster = await stillTextRaster();
    expect(PEN_FACES["marker"]).toBeDefined();
    expect(raster.metrics("marker")).toBeUndefined();
    expect(raster.metrics("no-such-face")).toBeUndefined();
  });

  it("draws a line's glyphs as coverage inside its box — the same bytes every time", async () => {
    const raster = await stillTextRaster();
    const m = raster.metrics("caveat");
    if (m === undefined) throw new Error("no caveat");
    const layout = lineOf("check the seed", 20, m.advance);
    const box = { w: 200, h: 32 };
    const first = raster.raster(layout, "caveat", box, 2, 0.25);
    expect([first.w, first.h]).toEqual([400, 64]);
    let inked = 0;
    for (const a of first.bytes) if (a > 0) inked += 1;
    expect(inked).toBeGreaterThan(1_000);
    expect(inked).toBeLessThan(first.bytes.length / 2);
    const again = raster.raster(layout, "caveat", box, 2, 0.25);
    expect(Buffer.from(again.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    // no bleed, less ink: the pen's spread is a faint stroke under each glyph
    const dry = raster.raster(layout, "caveat", box, 2, 0);
    let dryInk = 0;
    for (const a of dry.bytes) if (a > 0) dryInk += 1;
    expect(dryInk).toBeLessThan(inked);
  });
});
