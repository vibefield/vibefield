// @vitest-environment node
/**
 * IK (2026-11-25; ICE I59) — THE HAND'S BAKE (scripts/gen-desk-hands.mjs, `pnpm gen:hands`; `pnpm gen:check` holds it): the
 * desk's faces baked by ICE's baker at its defaults are the committed files, byte for byte, and the freshness check names a
 * file whose bytes moved by one, or that is gone. One face is baked here (Caveat 500, about a second and a half unloaded);
 * `gen:check` bakes all three.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bakeDeskFace,
  type DeskFaceBake,
  HANDS_DIR,
  staleFiles,
} from "../../../scripts/gen-desk-hands.mjs";

/** A heavy row (a whole face's bake) under load: ICE's 30 s. */
const BAKE_MS = 30_000;

let caveat: DeskFaceBake;
beforeAll(async () => {
  caveat = await bakeDeskFace("caveat");
}, BAKE_MS);

const committed = (file: string): Uint8Array | undefined => readFileSync(join(HANDS_DIR, file));

describe("the desk's hand, baked (IK)", () => {
  it("bakes the face the table names at ICE's defaults: every glyph of the set, its corrections, nothing refused", () => {
    expect(caveat.file).toBe("Caveat-500.ttf");
    expect(caveat.files).toEqual({ json: "caveat-500.hand.json", bin: "caveat-500.hand.bin" });
    const { json, missing, refused } = caveat.baked;
    expect([json.format, json.family, json.weight, json.em]).toEqual([
      "ice-hand/1",
      "Caveat",
      500,
      64,
    ]);
    expect(Object.keys(json.glyphs)).toHaveLength(203);
    expect(json.corrections).toEqual(["caveat-500-N-flip-0"]);
    expect(json.source).toEqual({
      file: "Caveat-500.ttf",
      sha256: "7062df7fee2e131cf42c6175f12078e14b6b880df7b301299abdc4a92e4674fb",
    });
    expect([missing, refused]).toEqual([[], []]);
    expect(caveat.baked.bin.length).toBe(json.width * json.height * 2);
  });

  it("is the committed pair, byte for byte: the check finds nothing stale", () => {
    expect(staleFiles(caveat, committed)).toEqual([]);
  });

  it("names a file one byte off as stale, and a file gone as missing", () => {
    const flipped = (name: string, at: number) => (file: string) => {
      const bytes = new Uint8Array(readFileSync(join(HANDS_DIR, file)));
      if (file === name) bytes[at] = (bytes[at] ?? 0) ^ 1;
      return bytes;
    };
    // a texel deep in the atlas, and a digit of the json's first line
    expect(staleFiles(caveat, flipped("caveat-500.hand.bin", 500_001))).toEqual([
      "caveat-500.hand.bin is stale",
    ]);
    expect(staleFiles(caveat, flipped("caveat-500.hand.json", 70))).toEqual([
      "caveat-500.hand.json is stale",
    ]);
    expect(
      staleFiles(caveat, (file) => (file.endsWith(".bin") ? undefined : committed(file))),
    ).toEqual(["caveat-500.hand.bin is missing"]);
    expect(staleFiles(caveat, () => undefined)).toEqual([
      "caveat-500.hand.json is missing",
      "caveat-500.hand.bin is missing",
    ]);
  });
});
