// PT-5b (ruling 1) — THE STILL'S SIZE AND ITS ROWS (surfaces/live/still-taker.ts): the pure halves of the host's hand on a
// page's pixels — a still is at most 1600 px on its long side, its shape the texture's; a buffer's rows carry WebGPU's
// padding to 256 bytes, and the picture is its rows without it. (The read itself — a pass, a copy, a map — and the encoder
// are the platform's: the product smoke's STILL row witnesses them, by the fixture's hue in the still it lays back.)
import { describe, expect, it } from "vitest";
import { PAGE_STILL_MAX_PX } from "../src/surfaces/live/page-stills";
import {
  PAGE_STILL_ENCODING,
  PAGE_STILL_QUALITY,
  paddedRow,
  stillSize,
  tightRows,
} from "../src/surfaces/live/still-taker";

describe("PT-5b — a still's size and rows", () => {
  it("at most 1600 px on its long side, its shape kept; a texture within the bound is taken at its own size", () => {
    expect(PAGE_STILL_MAX_PX).toBe(1600);
    // a laptop page at 2×: 2560 × 1600 → 1600 × 1000
    expect(stillSize(2560, 1600)).toEqual([1600, 1000]);
    // a phone's, tall: 1206 × 2622 → 736 × 1600
    expect(stillSize(1206, 2622)).toEqual([736, 1600]);
    // a rest rung's texture, small: its own size — never scaled up
    expect(stillSize(640, 400)).toEqual([640, 400]);
    expect(stillSize(1600, 1600)).toEqual([1600, 1600]);
    // never an empty picture
    expect(stillSize(5000, 1)).toEqual([1600, 1]);
    expect(stillSize(0, 0)).toEqual([1, 1]);
    expect(stillSize(800, 600, 400)).toEqual([400, 300]);
  });

  it("a buffer's row is padded to 256 bytes; the picture is its rows without the padding, in order", () => {
    expect(paddedRow(1)).toBe(256);
    expect(paddedRow(64)).toBe(256);
    expect(paddedRow(65)).toBe(512);
    expect(paddedRow(1600)).toBe(6400);
    expect(paddedRow(736)).toBe(3072);
    // 3 texels wide, 2 rows: each row 12 bytes of picture in 256 of buffer
    const padded = new Uint8Array(2 * 256).fill(255);
    for (let i = 0; i < 12; i += 1) {
      padded[i] = i;
      padded[256 + i] = 100 + i;
    }
    expect([...tightRows(padded, 3, 2)]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      111,
    ]);
  });

  it("encoded as WebP at 0.82 — the format and the quality the note says", () => {
    expect(PAGE_STILL_ENCODING).toBe("image/webp");
    expect(PAGE_STILL_QUALITY).toBe(0.82);
  });
});
