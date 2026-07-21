import { describe, expect, it } from "vitest";
import {
  decodeJsonPayload,
  decodeLaneFrame,
  encodeJsonFrame,
  encodeLaneFrame,
  LANE_FRAME,
  LANE_HEADER_BYTES,
} from "../src/doclane";
import { LaneHelloOk } from "../src/docs";

describe(":9411 lane frame codec", () => {
  it("round-trips a binary payload", () => {
    const payload = new Uint8Array([0x49, 0x43, 0x45, 0x31, 0, 1, 2, 250]);
    const frame = decodeLaneFrame(encodeLaneFrame(LANE_FRAME.PUT, 0, payload));
    expect(frame.kind).toBe(LANE_FRAME.PUT);
    expect(frame.laneId).toBe(0);
    expect(Array.from(frame.payload)).toEqual(Array.from(payload));
  });

  it("round-trips a JSON control payload through the zod shape", () => {
    const hello = { docId: "1f0d7a2e-3c44-4b8a-9e51-6d2f8c0a7b19", hasDoc: false };
    const frame = decodeLaneFrame(encodeJsonFrame(LANE_FRAME.HELLO_OK, 0, hello));
    const parsed = LaneHelloOk.parse(decodeJsonPayload(frame.payload));
    expect(parsed.hasDoc).toBe(false);
    expect(parsed.docId).toBe(hello.docId);
  });

  it("carries large laneIds intact (u64 big-endian)", () => {
    const laneId = Number.MAX_SAFE_INTEGER;
    const frame = decodeLaneFrame(encodeLaneFrame(LANE_FRAME.GET, laneId, new Uint8Array()));
    expect(frame.laneId).toBe(laneId);
    expect(frame.payload.byteLength).toBe(0);
  });

  it("decodes frames at a non-zero buffer offset (WS libraries hand out views)", () => {
    const inner = encodeLaneFrame(LANE_FRAME.DOC, 7, new Uint8Array([9, 9]));
    const padded = new Uint8Array(4 + inner.byteLength);
    padded.set(inner, 4);
    const frame = decodeLaneFrame(padded.subarray(4));
    expect(frame.kind).toBe(LANE_FRAME.DOC);
    expect(frame.laneId).toBe(7);
    expect(Array.from(frame.payload)).toEqual([9, 9]);
  });

  it("tolerant reader: unknown kinds decode; short headers throw", () => {
    const future = decodeLaneFrame(encodeLaneFrame(200, 1, new Uint8Array([1])));
    expect(future.kind).toBe(200);
    expect(() => decodeLaneFrame(new Uint8Array(LANE_HEADER_BYTES - 1))).toThrow(/header/);
  });

  it("refuses out-of-range headers at encode time", () => {
    expect(() => encodeLaneFrame(256, 0, new Uint8Array())).toThrow(/u8/);
    expect(() => encodeLaneFrame(LANE_FRAME.PUT, -1, new Uint8Array())).toThrow(/non-negative/);
  });
});
