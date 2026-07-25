import { describe, expect, it } from "vitest";
import {
  DOC_SYNC_HEADER_BYTES,
  DOC_SYNC_RECORD,
  decodeDocSyncRecord,
  encodeDocSyncRecord,
} from "../src/docsync";

const meta = { baseEpoch: 0, engineSchema: 11, savedAt: 1_700_000_000_000 };

describe("the doc-sync record codec (C6-3f)", () => {
  it("round-trips opaque binary, NULs and all", () => {
    // A Loro update record is not text. A string-shaped path through this would
    // corrupt it silently, which is the one failure a doc plane cannot have.
    const payload = new Uint8Array([0, 1, 2, 0, 255, 128, 0, 42]);
    const back = decodeDocSyncRecord(encodeDocSyncRecord(DOC_SYNC_RECORD.UPDATE, meta, payload));
    expect(back.kind).toBe(DOC_SYNC_RECORD.UPDATE);
    expect(back.meta).toMatchObject(meta);
    expect([...back.payload]).toEqual([...payload]);
  });

  it("carries an empty payload without confusing it for a truncated record", () => {
    const back = decodeDocSyncRecord(
      encodeDocSyncRecord(DOC_SYNC_RECORD.SNAPSHOT, meta, new Uint8Array()),
    );
    expect(back.payload.byteLength).toBe(0);
    expect(back.kind).toBe(DOC_SYNC_RECORD.SNAPSHOT);
  });

  it("hands back a payload that owns its bytes", () => {
    // The caller parks these in a journal write. A view would retain the whole
    // lane read for the life of the record — the C6-3e watermark finding, one
    // layer up.
    const payload = new Uint8Array([1, 2, 3, 4]);
    const back = decodeDocSyncRecord(encodeDocSyncRecord(DOC_SYNC_RECORD.UPDATE, meta, payload));
    expect(back.payload.buffer.byteLength).toBe(4);
  });

  it("refuses a meta length that runs past the record", () => {
    // The same rule as the MeshData reader: a peer must not be able to make us
    // read past what it actually sent, on its own say-so.
    const frame = encodeDocSyncRecord(DOC_SYNC_RECORD.UPDATE, meta, new Uint8Array([9]));
    new DataView(frame.buffer).setUint32(1, 0xffff);
    expect(() => decodeDocSyncRecord(frame)).toThrow(/past the record/);
  });

  it("refuses a buffer shorter than the header", () => {
    expect(() => decodeDocSyncRecord(new Uint8Array(DOC_SYNC_HEADER_BYTES - 1))).toThrow(
      /shorter than header/,
    );
  });

  it("refuses meta that is missing the epoch it exists to carry", () => {
    const metaBytes = new TextEncoder().encode(JSON.stringify({ engineSchema: 11, savedAt: 1 }));
    const frame = new Uint8Array(DOC_SYNC_HEADER_BYTES + metaBytes.byteLength);
    const view = new DataView(frame.buffer);
    view.setUint8(0, DOC_SYNC_RECORD.UPDATE);
    view.setUint32(1, metaBytes.byteLength);
    frame.set(metaBytes, DOC_SYNC_HEADER_BYTES);
    expect(() => decodeDocSyncRecord(frame)).toThrow();
  });

  it("keeps unknown meta fields rather than dropping them (tolerant reader)", () => {
    const frame = encodeDocSyncRecord(
      DOC_SYNC_RECORD.UPDATE,
      { ...meta, futureField: "from a newer peer" } as never,
      new Uint8Array([1]),
    );
    expect(decodeDocSyncRecord(frame).meta).toMatchObject({ futureField: "from a newer peer" });
  });
});
