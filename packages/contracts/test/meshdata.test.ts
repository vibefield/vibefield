import { describe, expect, it } from "vitest";
import {
  decodeMeshDataFrame,
  decodeMeshDataJsonPayload,
  encodeMeshDataFrame,
  encodeMeshDataJsonFrame,
  MESHDATA_FRAME,
  MESHDATA_HEADER_BYTES,
  MESHDATA_LOSSY_MAX_PAYLOAD_BYTES,
  MESHDATA_MAX_FRAME_BYTES,
  MeshDataFrameReader,
} from "../src/meshdata";

// The MeshData bridge codec (design-02 §2.5, D5). Unlike the :9411 doc lane,
// this rides a raw UDS byte stream — so the length prefix and the streaming
// reader are the contract, and chunk boundaries are the adversary.

const bytes = (...v: number[]) => new Uint8Array(v);

describe("encodeMeshDataFrame / decodeMeshDataFrame", () => {
  it("round-trips kind, laneId and payload", () => {
    const frame = encodeMeshDataFrame(MESHDATA_FRAME.DATA, 42, bytes(1, 2, 3));
    const back = decodeMeshDataFrame(frame);
    expect(back.kind).toBe(MESHDATA_FRAME.DATA);
    expect(back.laneId).toBe(42);
    expect([...back.payload]).toEqual([1, 2, 3]);
  });

  it("declares a length covering everything after the prefix, not the whole frame", () => {
    // The reader takes 4 bytes then waits for exactly `len` more; an off-by-four
    // here desynchronises the entire stream rather than failing one frame.
    const frame = encodeMeshDataFrame(MESHDATA_FRAME.DATA, 0, bytes(9, 9, 9, 9, 9));
    const len = new DataView(frame.buffer).getUint32(0);
    expect(len).toBe(1 + 8 + 5);
    expect(frame.byteLength).toBe(4 + len);
    expect(frame.byteLength).toBe(MESHDATA_HEADER_BYTES + 5);
  });

  it("carries an empty payload — a zero-byte lane write is legal", () => {
    const back = decodeMeshDataFrame(encodeMeshDataFrame(MESHDATA_FRAME.DATA, 1, bytes()));
    expect(back.payload.byteLength).toBe(0);
  });

  it("preserves an unknown kind (tolerant reader — the receiver decides)", () => {
    const back = decodeMeshDataFrame(encodeMeshDataFrame(200, 3, bytes(7)));
    expect(back.kind).toBe(200);
  });

  it("refuses a kind outside u8 and a negative lane id", () => {
    expect(() => encodeMeshDataFrame(256, 0, bytes())).toThrow(/u8 range/);
    expect(() => encodeMeshDataFrame(1, -1, bytes())).toThrow(/non-negative/);
  });

  it("refuses a truncated buffer rather than reading past it", () => {
    const frame = encodeMeshDataFrame(MESHDATA_FRAME.DATA, 0, bytes(1, 2, 3));
    expect(() => decodeMeshDataFrame(frame.subarray(0, 5))).toThrow(/shorter than header/);
    expect(() => decodeMeshDataFrame(frame.subarray(0, MESHDATA_HEADER_BYTES + 1))).toThrow(
      /truncated/,
    );
  });

  it("refuses a body shorter than its own header, as the reader does", () => {
    // The reader enforces this floor; this function did not, and it is the one
    // place a hand-built frame enters the system (fixtures, tests). A body of 5
    // used to "decode": the laneId came from bytes past the declared body and
    // the payload came out empty — a malformed frame answered with a plausible
    // one, which is the worst shape of wrong.
    const evil = new Uint8Array(MESHDATA_HEADER_BYTES);
    new DataView(evil.buffer).setUint32(0, 5);
    expect(() => decodeMeshDataFrame(evil)).toThrow(/shorter than its own header/);
  });

  it("round-trips a JSON control payload", () => {
    const frame = encodeMeshDataJsonFrame(MESHDATA_FRAME.ERR, 4, { reason: "torn-frame" });
    const back = decodeMeshDataFrame(frame);
    expect(decodeMeshDataJsonPayload(back.payload)).toEqual({ reason: "torn-frame" });
  });
});

describe("MeshDataFrameReader — the stream, where chunk boundaries are arbitrary", () => {
  const three = () => [
    encodeMeshDataFrame(MESHDATA_FRAME.HELLO, 0, bytes(1)),
    encodeMeshDataFrame(MESHDATA_FRAME.DATA, 7, bytes(2, 2, 2)),
    encodeMeshDataFrame(MESHDATA_FRAME.DATA, 9, bytes(3, 3)),
  ];
  const joined = (frames: Uint8Array[]) => {
    const out = new Uint8Array(frames.reduce((n, f) => n + f.byteLength, 0));
    let at = 0;
    for (const f of frames) {
      out.set(f, at);
      at += f.byteLength;
    }
    return out;
  };

  it("yields every frame when several arrive in ONE chunk", () => {
    const r = new MeshDataFrameReader();
    const got = r.push(joined(three()));
    expect(got.map((f) => f.laneId)).toEqual([0, 7, 9]);
    expect(r.pending).toBe(0);
  });

  it("holds a frame split across two chunks and yields it once complete", () => {
    const whole = encodeMeshDataFrame(MESHDATA_FRAME.DATA, 5, bytes(1, 2, 3, 4));
    const r = new MeshDataFrameReader();
    expect(r.push(whole.subarray(0, 6))).toEqual([]);
    expect(r.pending).toBe(6);
    const got = r.push(whole.subarray(6));
    expect(got).toHaveLength(1);
    expect([...(got[0]?.payload ?? [])]).toEqual([1, 2, 3, 4]);
    expect(r.pending).toBe(0);
  });

  it("survives a header split mid-length-prefix — the nastiest boundary", () => {
    // Two bytes of the u32 in one read is the case that a naive reader
    // misparses as a length of its own.
    const whole = encodeMeshDataFrame(MESHDATA_FRAME.DATA, 1, bytes(8, 8));
    const r = new MeshDataFrameReader();
    expect(r.push(whole.subarray(0, 2))).toEqual([]);
    expect(r.push(whole.subarray(2, 3))).toEqual([]);
    const got = r.push(whole.subarray(3));
    expect(got).toHaveLength(1);
    expect(got[0]?.laneId).toBe(1);
  });

  it("reassembles correctly when fed ONE BYTE at a time", () => {
    const stream = joined(three());
    const r = new MeshDataFrameReader();
    const got = [];
    for (const b of stream) got.push(...r.push(bytes(b)));
    expect(got.map((f) => f.laneId)).toEqual([0, 7, 9]);
    expect(r.pending).toBe(0);
  });

  it("keeps the trailing partial when a chunk ends mid-frame", () => {
    const frames = three();
    const stream = joined(frames);
    const cut = stream.byteLength - 2;
    const r = new MeshDataFrameReader();
    const got = r.push(stream.subarray(0, cut));
    expect(got.map((f) => f.laneId)).toEqual([0, 7]);
    expect(r.pending).toBeGreaterThan(0);
    expect(r.push(stream.subarray(cut)).map((f) => f.laneId)).toEqual([9]);
  });

  it("refuses an absurd declared length BEFORE allocating for it", () => {
    // The attack: a peer claims 4 GB so the daemon reserves 4 GB. The refusal
    // must happen on the 4-byte prefix alone, with no payload in hand.
    const evil = new Uint8Array(8);
    new DataView(evil.buffer).setUint32(0, MESHDATA_MAX_FRAME_BYTES + 1);
    const r = new MeshDataFrameReader();
    expect(() => r.push(evil)).toThrow(/past the ceiling/);
  });

  it("refuses a length shorter than the frame's own header", () => {
    const evil = new Uint8Array(8);
    new DataView(evil.buffer).setUint32(0, 3);
    expect(() => new MeshDataFrameReader().push(evil)).toThrow(/shorter than its own header/);
  });

  it("reset() drops a partial frame — a torn frame tears the LANE, not the daemon", () => {
    const whole = encodeMeshDataFrame(MESHDATA_FRAME.DATA, 2, bytes(1, 2, 3));
    const r = new MeshDataFrameReader();
    r.push(whole.subarray(0, 7));
    expect(r.pending).toBeGreaterThan(0);
    r.reset();
    expect(r.pending).toBe(0);
    // and it can be reused cleanly afterwards
    expect(r.push(whole)).toHaveLength(1);
  });

  it("does not retain the caller's chunk buffer across pushes", () => {
    // Mutating a chunk after handing it over must not corrupt a held partial —
    // the reader copies rather than aliasing whatever the socket handed it.
    const whole = encodeMeshDataFrame(MESHDATA_FRAME.DATA, 3, bytes(4, 5, 6));
    const first = whole.slice(0, 6);
    const r = new MeshDataFrameReader();
    r.push(first);
    first.fill(0xff);
    const got = r.push(whole.subarray(6));
    expect(got[0]?.laneId).toBe(3);
    expect([...(got[0]?.payload ?? [])]).toEqual([4, 5, 6]);
  });
});

describe("bounds", () => {
  it("states the lossy datagram ceiling D5 fixes at one unfragmented packet", () => {
    expect(MESHDATA_LOSSY_MAX_PAYLOAD_BYTES).toBe(1150);
  });

  it("refuses to ENCODE past the socket ceiling", () => {
    const tooBig = new Uint8Array(MESHDATA_MAX_FRAME_BYTES);
    expect(() => encodeMeshDataFrame(MESHDATA_FRAME.DATA, 0, tooBig)).toThrow(/exceeds/);
  });
});
