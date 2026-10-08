/**
 * THE CAPTURE TOOL'S PIXEL DIFF (MV-3c; build-mv M30) — `scripts/capture-godview-diff.mjs`,
 * the pure half of `pnpm capture:godview`: a per-pixel tolerance, the share of
 * pixels that differ, a capture judged against a threshold and its own A/A
 * control, a blank refused, and the diff picture as a real PNG.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

interface Diff {
  differing: number;
  total: number;
  fraction: number;
  maxDelta: number;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  sizeMismatch: boolean;
}
interface CaptureDiff {
  diffBitmaps(a: Buffer, b: Buffer, width: number, height: number, tolerance: number): Diff;
  diffImage(a: Buffer, b: Buffer, width: number, height: number, tolerance: number): Buffer;
  encodePng(rgba: Buffer, width: number, height: number): Buffer;
  judgeCapture(input: {
    aa: Diff;
    ab?: Diff;
    threshold: number;
    contents: { colours: number; offModal: number }[];
  }): { verdict: string };
}

let tool: CaptureDiff;
beforeAll(async () => {
  const url = pathToFileURL(
    join(import.meta.dirname, "..", "..", "..", "scripts", "capture-godview-diff.mjs"),
  ).href;
  tool = (await import(/* @vite-ignore */ url)) as CaptureDiff;
});

const W = 10;
const H = 10;
/** A BGRA bitmap of one colour, with some pixels painted another. */
function bitmap(painted: [number, number, number][] = [], value = 200): Buffer {
  const out = Buffer.alloc(W * H * 4, 40);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  for (const [x, y, delta] of painted) {
    const at = (y * W + x) * 4;
    out[at] = Math.min(255, 40 + delta);
    out[at + 1] = value;
  }
  return out;
}

const RICH = { colours: 64, offModal: 0.4 };

describe("the pixel diff", () => {
  it("counts pixels past the tolerance, and bounds them", () => {
    const a = bitmap();
    const b = bitmap([
      [2, 3, 100],
      [7, 8, 100],
    ]);
    const diff = tool.diffBitmaps(a, b, W, H, 24);
    expect(diff.differing).toBe(2);
    expect(diff.fraction).toBe(0.02);
    expect(diff.box).toEqual({ x0: 2, y0: 3, x1: 7, y1: 8 });
    expect(tool.diffBitmaps(a, a, W, H, 24)).toMatchObject({ differing: 0, box: null });
  });

  it("lets the compositor's dithering stay under the tolerance", () => {
    const a = bitmap([[1, 1, 0]], 200);
    const b = bitmap([[1, 1, 0]], 210);
    expect(tool.diffBitmaps(a, b, W, H, 24).differing).toBe(0);
    expect(tool.diffBitmaps(a, b, W, H, 5).differing).toBe(1);
  });

  it("calls two sizes all-different rather than comparing them", () => {
    const diff = tool.diffBitmaps(bitmap(), Buffer.alloc(16), W, H, 24);
    expect(diff.sizeMismatch).toBe(true);
    expect(diff.fraction).toBe(1);
  });

  it("draws the difference as a real PNG", () => {
    const png = tool.encodePng(tool.diffImage(bitmap(), bitmap([[0, 0, 100]]), W, H, 24), W, H);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(W);
    expect(png.readUInt32BE(20)).toBe(H);
    const idat = png.indexOf("IDAT");
    const length = png.readUInt32BE(idat - 4);
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
    expect(raw.length).toBe((W * 4 + 1) * H);
    // the differing pixel (0,0) is red, a quiet one a grey ghost
    expect([...raw.subarray(1, 5)]).toEqual([255, 0, 0, 255]);
    expect(raw[5]).toBe(raw[6]);
  });
});

describe("a capture's verdict", () => {
  const diff = (fraction: number): Diff => ({
    differing: Math.round(fraction * 1_000),
    total: 1_000,
    fraction,
    maxDelta: 100,
    box: null,
    sizeMismatch: false,
  });

  it("an A/A-only run reads the control: stable or unstable", () => {
    expect(
      tool.judgeCapture({ aa: diff(0), threshold: 0.001, contents: [RICH, RICH] }).verdict,
    ).toBe("stable");
    expect(
      tool.judgeCapture({ aa: diff(0.02), threshold: 0.001, contents: [RICH, RICH] }).verdict,
    ).toBe("unstable");
  });

  it("a stable capture differs past the threshold", () => {
    const contents = [RICH, RICH, RICH];
    expect(
      tool.judgeCapture({ aa: diff(0), ab: diff(0.0005), threshold: 0.001, contents }).verdict,
    ).toBe("same");
    expect(
      tool.judgeCapture({ aa: diff(0), ab: diff(0.01), threshold: 0.001, contents }).verdict,
    ).toBe("differs");
  });

  it("an unstable capture differs only past twice its own A/A share", () => {
    const contents = [RICH, RICH, RICH];
    expect(
      tool.judgeCapture({ aa: diff(0.02), ab: diff(0.03), threshold: 0.001, contents }).verdict,
    ).toBe("same-within-aa");
    expect(
      tool.judgeCapture({ aa: diff(0.02), ab: diff(0.05), threshold: 0.001, contents }).verdict,
    ).toBe("differs");
  });

  it("refuses a blank capture: a blank compares equal to a blank", () => {
    expect(
      tool.judgeCapture({
        aa: diff(0),
        ab: diff(0),
        threshold: 0.001,
        contents: [RICH, { colours: 1, offModal: 0 }, RICH],
      }).verdict,
    ).toBe("blank");
  });
});
