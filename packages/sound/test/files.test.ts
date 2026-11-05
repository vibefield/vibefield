import { describe, expect, it } from "vitest";
import {
  CUE_IDS,
  ENGINE_HASH,
  encodeWav,
  isQuiet,
  nearestPlace,
  PAN_POSITIONS,
  PREVIEW_CUES,
  QUIET,
  quietEnd,
  render,
  renderKey,
  SR,
} from "../src/index.ts";

// SD-2 — what the desktop needs from the package to play its sounds: a file the system can play (24-bit PCM WAV),
// Quiet's clock (DESIGN.md §14 "Quiet"), the five baked places (§14 "Where it plays") and one name per render, so a
// rendered file is found again and never outlives a change to the score.

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const ascii = (bytes: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...bytes.subarray(at, at + n));
const int24 = (dv: DataView, at: number) => {
  const v = dv.getUint8(at) | (dv.getUint8(at + 1) << 8) | (dv.getUint8(at + 2) << 16);
  return v & 0x800000 ? v - 0x1000000 : v;
};

describe("a WAV the system plays (24-bit PCM, little-endian, interleaved)", () => {
  it("writes the RIFF header the file needs, and nothing after its samples", () => {
    const left = Float32Array.from([0, 0.5, -0.5, 1]);
    const right = Float32Array.from([0.25, -1, 0, -0.25]);
    const wav = encodeWav([left, right], SR);
    const dv = view(wav);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(dv.getUint32(4, true)).toBe(wav.length - 8);
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(dv.getUint32(16, true)).toBe(16);
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(2);
    expect(dv.getUint32(24, true)).toBe(SR);
    expect(dv.getUint32(28, true)).toBe(SR * 2 * 3);
    expect(dv.getUint16(32, true)).toBe(6);
    expect(dv.getUint16(34, true)).toBe(24);
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(dv.getUint32(40, true)).toBe(4 * 2 * 3);
    expect(wav.length).toBe(44 + 4 * 2 * 3);
  });
  it("interleaves left then right, full scale at 2^23 − 1, and clamps what would clip", () => {
    const wav = encodeWav([Float32Array.from([0.5, 2]), Float32Array.from([-0.25, -3])], SR);
    const dv = view(wav);
    expect(int24(dv, 44)).toBe(Math.round(0.5 * 8388607));
    expect(int24(dv, 47)).toBe(Math.round(-0.25 * 8388607));
    expect(int24(dv, 50)).toBe(8388607);
    expect(int24(dv, 53)).toBe(-8388607);
  });
  it("carries a whole render, sample for sample within one step of 24 bits", () => {
    const r = render("done");
    const wav = encodeWav(r.channels, r.sampleRate);
    const dv = view(wav);
    expect(wav.length).toBe(44 + r.channels[0].length * 6);
    for (const i of [0, 1000, 20000, r.channels[0].length - 1]) {
      expect(Math.abs(int24(dv, 44 + i * 6) / 8388607 - r.channels[0][i]!)).toBeLessThan(
        2 / 8388607,
      );
      expect(Math.abs(int24(dv, 47 + i * 6) / 8388607 - r.channels[1][i]!)).toBeLessThan(
        2 / 8388607,
      );
    }
  });
});

describe("Quiet's clock (§14: for an hour, or until 8:00 the next morning, by this Mac's clock)", () => {
  it("an hour is an hour from now", () => {
    const now = new Date(2026, 10, 5, 15, 10, 30);
    expect(quietEnd("hour", now)).toBe(now.getTime() + QUIET.HOUR_MS);
    expect(QUIET.HOUR_MS).toBe(3_600_000);
  });
  it("tomorrow is 8:00 on the next calendar day, whatever the hour now", () => {
    expect(quietEnd("tomorrow", new Date(2026, 10, 5, 15, 10))).toBe(
      new Date(2026, 10, 6, 8, 0).getTime(),
    );
    expect(quietEnd("tomorrow", new Date(2026, 10, 5, 1, 30))).toBe(
      new Date(2026, 10, 6, 8, 0).getTime(),
    );
    expect(quietEnd("tomorrow", new Date(2026, 11, 31, 23, 59))).toBe(
      new Date(2027, 0, 1, 8, 0).getTime(),
    );
    expect(QUIET.MORNING_HOUR).toBe(8);
  });
  it("holds until its moment, and ends by itself at it", () => {
    const t = Date.UTC(2026, 10, 5, 16);
    expect(isQuiet(undefined, t)).toBe(false);
    expect(isQuiet(t + 1, t)).toBe(true);
    expect(isQuiet(t, t)).toBe(false);
    expect(isQuiet(t - 1, t)).toBe(false);
  });
});

describe("the five places, baked (§14 'Where it plays')", () => {
  it("snaps a place to the nearest of −60%, −30%, the centre, +30%, +60%", () => {
    expect(PAN_POSITIONS).toEqual([-0.6, -0.3, 0, 0.3, 0.6]);
    expect(nearestPlace(0.1)).toBe(0);
    expect(nearestPlace(-0.2)).toBe(-0.3);
    expect(nearestPlace(0.46)).toBe(0.6);
    expect(nearestPlace(-1)).toBe(-0.6);
    expect(nearestPlace(Number.NaN)).toBe(0);
  });
});

describe("one name per render", () => {
  it("is a file name, and the same for the same sound however its options are spelled", () => {
    const k = renderKey("done", { space: "night", pan: 0.3, variant: 2 });
    expect(k).toMatch(/^[a-z0-9.-]+$/);
    expect(renderKey("done", {})).toBe(
      renderKey("done", {
        space: "day",
        profile: "desktop",
        count: 1,
        pan: 0,
        level: 0,
        variant: 0,
        stretch: 1,
      }),
    );
  });
  it("differs wherever the sound differs", () => {
    const keys = new Set([
      renderKey("done", {}),
      renderKey("question", {}),
      renderKey("done", { space: "far" }),
      renderKey("done", { pan: -0.6 }),
      renderKey("done", { count: 3, notePans: [0, -0.3, 0.3] }),
      renderKey("done", { count: 3, notePans: [0.3, -0.3, 0] }),
      renderKey("done", { variant: 4 }),
      renderKey("question", { level: -6, stretch: 1.25 }),
      renderKey("done", { profile: "phone" }),
    ]);
    expect(keys.size).toBe(9);
  });
  it("is versioned by the score itself, so a file never outlives a change to the sound", () => {
    expect(ENGINE_HASH).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("what Settings → Sound plays (§8)", () => {
  it("is the family in §14's order, the mark left out (SD-D18)", () => {
    expect(PREVIEW_CUES).toEqual(["failed", "done", "question", "approval", "settle"]);
    expect(CUE_IDS.filter((c) => c !== "mark")).toEqual(PREVIEW_CUES);
  });
});
