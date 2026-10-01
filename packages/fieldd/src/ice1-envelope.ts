// DS-5 (DS-D18) — the ICE1 checkpoint envelope, by its FIXED FRAME RULE and
// nothing more. ICE 0.11.0's writer (`core/src/doc/envelope.ts`, read in its
// dist; proven against renderer-written checkpoints by
// test/probes/ice1-envelope, 2026-09-30):
//
//   [0..4)      "ICE1"
//   [4]         envelope version — 1
//   [5..9)      header length n, u32 LITTLE-endian
//   [9..9+n)    header, UTF-8 JSON  (engineSchema, prefabVersions, savedAt)
//   [9+n..end)  payload — a FULL Loro snapshot, nothing after it
//
// *Corrected 2026-10-01 (DS-5d):* "a FULL Loro snapshot" holds only for a
// canvas never compacted. A compacted canvas's base is a Loro SHALLOW snapshot
// (the host's compaction writes it under this same frame), loro-crdt 1.13.8
// exports nothing else from a doc holding a shallow history, and ICE 0.11.0
// opens such an envelope and, once its doc came from one, writes them too —
// test/probes/ice1-envelope/ice1-compacted.test.ts, from fixtures ICE wrote
// (generate-compacted.mjs). The frame rule is unchanged; the payload is a
// snapshot of either species.
//
// fieldd reads the FRAME and never the header's meaning: the header rides
// along as opaque bytes, and the payload is handed to Loro. A frame this rule
// does not describe — another envelope version, a truncated header — is not an
// error. It is a checkpoint fieldd cannot merge, and it stays in opaque custody
// (B3 shape A), which is exactly what an engine upgrade must still be able to
// do to the daemon without breaking it.

export const ICE1_MAGIC = [0x49, 0x43, 0x45, 0x31] as const; // "ICE1"
/** The one envelope version this rule describes. */
export const ICE1_ENVELOPE_VERSION = 1;
/** magic + version + u32 header length */
export const ICE1_FRAME_BYTES = 9;
/** ICE's own bound (MAX_ENVELOPE_HEADER_BYTES) — a header past it is garbage. */
export const ICE1_MAX_HEADER_BYTES = 1024 * 1024;

export type Ice1Lift =
  | { ok: true; header: Uint8Array; payload: Uint8Array }
  | { ok: false; reason: "magic" | "version" | "truncated" | "header-overrun" };

export function hasIce1Magic(bytes: Uint8Array): boolean {
  return bytes.byteLength >= ICE1_MAGIC.length && ICE1_MAGIC.every((b, i) => bytes[i] === b);
}

/** Split an envelope into its opaque header and its Loro payload — views, not
 * copies; the caller decides what to keep. */
export function liftIce1(bytes: Uint8Array): Ice1Lift {
  if (!hasIce1Magic(bytes)) return { ok: false, reason: "magic" };
  if (bytes.byteLength < ICE1_FRAME_BYTES) return { ok: false, reason: "truncated" };
  if (bytes[4] !== ICE1_ENVELOPE_VERSION) return { ok: false, reason: "version" };
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    5,
    true,
  );
  if (headerLength > ICE1_MAX_HEADER_BYTES || ICE1_FRAME_BYTES + headerLength > bytes.byteLength) {
    return { ok: false, reason: "header-overrun" };
  }
  return {
    ok: true,
    header: bytes.subarray(ICE1_FRAME_BYTES, ICE1_FRAME_BYTES + headerLength),
    payload: bytes.subarray(ICE1_FRAME_BYTES + headerLength),
  };
}

/** The inverse, byte for byte (the probe proves wrap(lift(x)) === x on real
 * checkpoints). Exported for tests and for a future host-side compaction; no
 * product path writes an envelope in DS-5.
 * *Corrected 2026-10-01 (DS-5d):* the host-side compaction is that product
 * path now — a compacted base is its shallow snapshot wrapped here under the
 * newest checkpoint's header (doc-service.ts `compactNow`). */
export function wrapIce1(header: Uint8Array, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(ICE1_FRAME_BYTES + header.byteLength + payload.byteLength);
  out.set(ICE1_MAGIC, 0);
  out[4] = ICE1_ENVELOPE_VERSION;
  new DataView(out.buffer).setUint32(5, header.byteLength, true);
  out.set(header, ICE1_FRAME_BYTES);
  out.set(payload, ICE1_FRAME_BYTES + header.byteLength);
  return out;
}
