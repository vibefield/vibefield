// The :9411 doc-lane frame codec (design-03 §4.5 link 2, D5-shaped). Pure codec —
// no I/O, no sockets; the framing is a wire contract exactly like the zod shapes.
// Every WS binary message is ONE frame:
//
//   u8 kind · u64 laneId (big-endian) · payload bytes
//
// laneId is 0 throughout B3 (single doc per socket); multiplexing arrives with the
// DocumentHost upgrade. Control payloads (HELLO/HELLO_OK/PUT_META/PUT_OK/ERR) are
// UTF-8 JSON validated by the zod shapes in docs.ts; DOC/PUT payloads are raw ICE1
// envelopes and DOC_UPDATE/PUT update payloads are opaque Loro bytes fieldd never
// decodes. PRESENCE_PUBLISH/PRESENCE_PUSH are opaque ICE ephemeral snapshots;
// they share the authenticated document socket but are never persistence replies.
// Single-frame records in P0 — the 256KB
// chunker lands with new frame kinds when a board outgrows LANE_MAX_FRAME_BYTES.

export const LANE_FRAME = {
  HELLO: 1,
  HELLO_OK: 2,
  GET: 3,
  DOC: 4,
  PUT_META: 5,
  PUT: 6,
  PUT_OK: 7,
  ERR: 8,
  DOC_UPDATE: 9,
  /** renderer → fieldd: publish one opaque presence snapshot into this authenticated doc room. */
  PRESENCE_PUBLISH: 10,
  /** fieldd → renderer: unsolicited opaque presence snapshot from this doc room. */
  PRESENCE_PUSH: 11,
} as const;
export type LaneFrameKind = (typeof LANE_FRAME)[keyof typeof LANE_FRAME];

export const LANE_HEADER_BYTES = 9;

/** P0 single-frame ceiling. Boards are kept small by law (blobs → CAS, EL4);
 * a frame past this is refused loudly, never silently truncated. */
export const LANE_MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface LaneFrame {
  /** Tolerant reader: decode preserves unknown kinds — the receiver decides. */
  kind: number;
  laneId: number;
  payload: Uint8Array;
}

export function encodeLaneFrame(kind: number, laneId: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(kind) || kind < 0 || kind > 0xff)
    throw new Error(`lane frame kind out of u8 range: ${kind}`);
  if (!Number.isSafeInteger(laneId) || laneId < 0)
    throw new Error(`lane id must be a non-negative safe integer: ${laneId}`);
  const frame = new Uint8Array(LANE_HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, kind);
  view.setBigUint64(1, BigInt(laneId));
  frame.set(payload, LANE_HEADER_BYTES);
  return frame;
}

/** Throws only on structural garbage (short header / laneId past 2^53); an unknown
 * kind decodes fine so future kinds degrade to an explicit "unknown frame" path. */
export function decodeLaneFrame(data: Uint8Array): LaneFrame {
  if (data.byteLength < LANE_HEADER_BYTES)
    throw new Error(`lane frame shorter than header: ${data.byteLength} bytes`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const kind = view.getUint8(0);
  const laneIdBig = view.getBigUint64(1);
  if (laneIdBig > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`lane id past Number.MAX_SAFE_INTEGER: ${laneIdBig}`);
  return {
    kind,
    laneId: Number(laneIdBig),
    payload: data.subarray(LANE_HEADER_BYTES),
  };
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeJsonFrame(kind: number, laneId: number, value: unknown): Uint8Array {
  return encodeLaneFrame(kind, laneId, textEncoder.encode(JSON.stringify(value)));
}

/** JSON.parse of a control payload; the caller runs the zod shape (tolerant reader). */
export function decodeJsonPayload(payload: Uint8Array): unknown {
  return JSON.parse(textDecoder.decode(payload));
}
