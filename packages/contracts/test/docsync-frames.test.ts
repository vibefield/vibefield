// DS-5 (2026-09-30) — the doc-sync record kinds the Loro-level host adds, pinned
// to BYTES (fixtures/docsync-frames.vector.json). Two readers are held to it:
//   · the DS-5 reader, `decodeDocSyncFrame`, reads every kind — including one
//     newer than itself — and leaves each meta to its kind's own schema;
//   · the pre-DS-5 reader, `decodeDocSyncRecord`, is the function an older peer
//     still runs, UNCHANGED: it reads the legacy kinds and refuses the new ones
//     by its own meta law (no engineSchema/savedAt), which its caller logs as
//     `record_undecodable` and survives — never a torn lane.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chunkDocSyncRecord,
  DOC_SYNC_CHUNK_BYTES,
  DOC_SYNC_MAX_RECORD_BYTES,
  DOC_SYNC_RECORD,
  DocSyncChunkMeta,
  DocSyncMeta,
  DocSyncVersionMeta,
  decodeDocSyncFrame,
  decodeDocSyncRecord,
  encodeDocSyncRecord,
  encodeDocSyncVersion,
} from "../src/docsync";
import { MESHDATA_HEADER_BYTES, MESHDATA_MAX_FRAME_BYTES } from "../src/meshdata";

const vector = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "docsync-frames.vector.json"),
    "utf8",
  ),
) as {
  update: { kind: number; meta: DocSyncMeta; payloadHex: string; frameHex: string };
  version: { kind: number; meta: DocSyncVersionMeta; payloadHex: string; frameHex: string };
  chunks: { chunkBytes: number; frameHex: string[] };
  future: { kind: number; frameHex: string };
};
const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describe("DS-5 doc-sync kinds — the wire, pinned to bytes", () => {
  it("the kinds are additive: the legacy three keep their numbers", () => {
    expect(DOC_SYNC_RECORD).toMatchObject({
      SNAPSHOT: 1,
      UPDATE: 2,
      HAVE: 3,
      VERSION: 4,
      CHUNK: 5,
    });
  });

  it("encodes a VERSION and a legacy UPDATE to exactly the vector's bytes", () => {
    expect(hex(encodeDocSyncVersion(vector.version.meta, bytes(vector.version.payloadHex)))).toBe(
      vector.version.frameHex,
    );
    expect(
      hex(
        encodeDocSyncRecord(
          DOC_SYNC_RECORD.UPDATE,
          vector.update.meta,
          bytes(vector.update.payloadHex),
        ),
      ),
    ).toBe(vector.update.frameHex);
  });

  it("chunks the encoded inner record to exactly the vector's slices, and they reassemble whole", () => {
    const inner = bytes(vector.update.frameHex);
    const chunks = chunkDocSyncRecord(inner, "t-1", vector.chunks.chunkBytes);
    expect(chunks.map(hex)).toEqual(vector.chunks.frameHex);
    const slices = chunks.map((c) => decodeDocSyncFrame(c));
    const metas = slices.map((s) => DocSyncChunkMeta.parse(s.meta));
    expect(metas.map((m) => m.index)).toEqual([0, 1]);
    expect(new Set(metas.map((m) => m.byteLength))).toEqual(new Set([inner.byteLength]));
    const whole = Buffer.concat(slices.map((s) => Buffer.from(s.payload)));
    expect(hex(whole)).toBe(vector.update.frameHex);
    expect(decodeDocSyncRecord(new Uint8Array(whole)).kind).toBe(DOC_SYNC_RECORD.UPDATE);
  });

  it("the DS-5 reader reads every frame — a kind newer than itself included", () => {
    const version = decodeDocSyncFrame(bytes(vector.version.frameHex));
    expect(version.kind).toBe(DOC_SYNC_RECORD.VERSION);
    expect(DocSyncVersionMeta.parse(version.meta)).toMatchObject(vector.version.meta);
    expect(hex(version.payload)).toBe(vector.version.payloadHex);
    const update = decodeDocSyncFrame(bytes(vector.update.frameHex));
    expect(DocSyncMeta.parse(update.meta)).toMatchObject(vector.update.meta);
    const future = decodeDocSyncFrame(bytes(vector.future.frameHex));
    expect(future.kind).toBe(vector.future.kind);
    expect(future.meta).toEqual({ anything: "a newer peer says" });
  });

  it("the pre-DS-5 reader keeps the legacy kind and refuses the new ones by its own meta law", () => {
    expect(decodeDocSyncRecord(bytes(vector.update.frameHex)).kind).toBe(DOC_SYNC_RECORD.UPDATE);
    for (const frame of [
      vector.version.frameHex,
      ...vector.chunks.frameHex,
      vector.future.frameHex,
    ]) {
      // A throw here is the OLD caller's `record_undecodable` log line and a
      // surviving lane (doc-sync.ts #receive) — the designed degradation.
      expect(() => decodeDocSyncRecord(bytes(frame))).toThrow();
    }
  });

  it("the DS-5 reader still refuses structural garbage, and only that", () => {
    const good = bytes(vector.version.frameHex);
    const overrun = good.slice();
    new DataView(overrun.buffer).setUint32(1, 0xffff);
    expect(() => decodeDocSyncFrame(overrun)).toThrow(/past the record/);
    expect(() => decodeDocSyncFrame(good.subarray(0, 3))).toThrow(/shorter than header/);
    const notObject = new Uint8Array([4, 0, 0, 0, 2, 0x5b, 0x5d]); // meta "[]"
    expect(() => decodeDocSyncFrame(notObject)).toThrow(/not a JSON object/);
  });

  it("the record budget is a MeshData frame minus its header, and a chunk fits it", () => {
    expect(DOC_SYNC_MAX_RECORD_BYTES).toBe(MESHDATA_MAX_FRAME_BYTES - MESHDATA_HEADER_BYTES);
    expect(DOC_SYNC_CHUNK_BYTES + 256).toBeLessThan(DOC_SYNC_MAX_RECORD_BYTES);
    expect(() => chunkDocSyncRecord(new Uint8Array(), "t")).toThrow();
    expect(() => chunkDocSyncRecord(new Uint8Array(4), "t", 0)).toThrow();
  });
});
