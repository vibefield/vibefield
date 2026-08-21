import { FRAME_MAGIC as FRAME_MAGIC_FROM_READER } from "@vibecook/ghosttea-frame";
import { describe, expect, it } from "vitest";
import {
  capCapture,
  captureByteLength,
  captureDurationMs,
  decodeCapture,
  encodeCapture,
  FRAME_MAGIC,
  isFrameBody,
  type Trf1Capture,
} from "../src/trf1-container";

const header: Trf1Capture["header"] = {
  name: "fixture",
  source: { kind: "generator", detail: "unit", byteLength: 3 },
  cols: 100,
  rows: 30,
  cadence: { mode: "accelerated", bytesPerSecond: 1_000, targetMs: 100 },
  capturedAt: "2026-08-21T00:00:00.000Z",
  ghostteaVersion: "0.10.1",
  sourceCommit: "deadbeef",
  host: { platform: "darwin", arch: "arm64", loadAvg1: 1.5 },
  notes: ["a note"],
};

function frameBytes(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  new DataView(bytes.buffer).setUint32(0, FRAME_MAGIC, true);
  for (let index = 4; index < length; index += 1) bytes[index] = (seed + index) % 256;
  return bytes;
}

describe("the trf1 capture container", () => {
  it("round-trips header and frames byte for byte", () => {
    const capture: Trf1Capture = {
      header,
      frames: [
        { offsetUs: 0, bytes: frameBytes(64, 1) },
        { offsetUs: 16_667, bytes: frameBytes(1_024, 2) },
        { offsetUs: 33_334, bytes: frameBytes(7, 3) },
      ],
    };
    const decoded = decodeCapture(encodeCapture(capture));
    expect(decoded.header).toEqual(header);
    expect(decoded.frames.length).toBe(3);
    for (const [index, frame] of decoded.frames.entries()) {
      const original = capture.frames[index]!;
      expect(frame.offsetUs).toBe(original.offsetUs);
      // Byte-for-byte: the whole point of the container is that a frame comes
      // out exactly as the cell emitted it, since TRF1's reader is exact-version.
      expect(Array.from(frame.bytes)).toEqual(Array.from(original.bytes));
    }
    expect(captureByteLength(decoded)).toBe(64 + 1_024 + 7);
    expect(captureDurationMs(decoded)).toBeCloseTo(33.334, 3);
  });

  it("refuses a file that is not a capture, and a version it does not speak", () => {
    expect(() => decodeCapture(new Uint8Array(64))).toThrow(/not a trf1 capture/);
    const bytes = encodeCapture({ header, frames: [] });
    new DataView(bytes.buffer).setUint32(8, 99, true);
    expect(() => decodeCapture(bytes)).toThrow(/version 99/);
  });

  it("refuses a truncated file rather than returning short frames", () => {
    const bytes = encodeCapture({ header, frames: [{ offsetUs: 0, bytes: frameBytes(64, 1) }] });
    expect(() => decodeCapture(bytes.subarray(0, bytes.byteLength - 8))).toThrow(/past the end/);
  });

  it("agrees with the shipped reader about what a frame looks like", () => {
    // The container classifies packet bodies without importing the decoder, so
    // its copy of the magic has to be pinned against the real one or a protocol
    // bump would silently make every frame look like a JSON message.
    expect(FRAME_MAGIC).toBe(FRAME_MAGIC_FROM_READER);
    expect(isFrameBody(frameBytes(64, 1))).toBe(true);
    expect(isFrameBody(new TextEncoder().encode('{"type":"subscription-ack"}'))).toBe(false);
    expect(isFrameBody(new Uint8Array(2))).toBe(false);
  });

  it("caps by frames and by bytes, keeping a contiguous prefix", () => {
    const capture: Trf1Capture = {
      header,
      frames: Array.from({ length: 10 }, (_, index) => ({
        offsetUs: index * 1_000,
        bytes: frameBytes(100, index),
      })),
    };
    expect(capCapture(capture, 4, 1_000_000).frames.map((f) => f.offsetUs)).toEqual([
      0, 1_000, 2_000, 3_000,
    ]);
    expect(capCapture(capture, 100, 250).frames.length).toBe(2);
    // A single frame over the byte cap still survives: an empty capture would
    // be worse than an over-budget one.
    expect(capCapture(capture, 100, 1).frames.length).toBe(1);
  });
});
