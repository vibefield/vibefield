// The MeshData bridge frame codec (design-02 §2.5, D5). Pure codec — no I/O,
// no sockets; the framing is a wire contract exactly like the zod shapes.
//
//   u32 len (big-endian) · u8 kind · u64 laneId (big-endian) · payload
//
// WHY A LENGTH PREFIX, when doclane.ts has none: that lane rides WebSocket,
// which delimits messages for us. This one rides a raw UDS byte stream, where a
// read returns whatever the kernel had — half a frame, three frames, a header
// split across two chunks. `len` is what makes the stream self-delimiting, and
// MeshDataFrameReader below is what makes partial reads a non-event.
//
// `len` counts everything AFTER itself (kind + laneId + payload), so a reader
// takes 4 bytes and then waits for exactly that many more.
//
// WHAT RIDES THIS: opaque bytes and nothing else (EL2). Doc-sync lanes carry
// Loro update records and snapshots that fieldd never decodes — the B3 custody
// shape, preserved across the mesh. Lane LIFECYCLE is not here at all: it rides
// the management channel (native.mesh.lane.*), because control belongs on a
// contract surface and bytes belong on their own plane.
//
// ORDERING HAZARD, stated because the codec cannot solve it: an inbound lane is
// announced by an mgmt notification (`lane.peerOpened`) while its DATA arrives
// on this socket. The two are different transports, so DATA for a lane fieldd
// has not yet learned about is NORMAL, not corruption. The receiver buffers by
// laneId until the announcement lands, and drops the buffer if it never does.

export const MESHDATA_FRAME = {
  /** fieldd → bridge: the per-boot token (§4.1). First frame or the socket dies. */
  HELLO: 1,
  /** bridge → fieldd: authenticated; lanes may now be used. */
  HELLO_OK: 2,
  /** either direction: opaque lane payload. The only frame that carries product bytes. */
  DATA: 3,
  /** bridge → fieldd: a lane-scoped or socket-scoped failure, JSON payload. */
  ERR: 4,
  /** fieldd → bridge: acknowledge only after every earlier DATA on this socket reached transport. */
  BARRIER: 5,
  /** bridge → fieldd: the matching lane's ordered DATA has reached transport. */
  BARRIER_OK: 6,
} as const;
export type MeshDataFrameKind = (typeof MESHDATA_FRAME)[keyof typeof MESHDATA_FRAME];

/** u32 len + u8 kind + u64 laneId. */
export const MESHDATA_HEADER_BYTES = 13;
/** The bytes a reader needs before it can know a frame's length. */
export const MESHDATA_LENGTH_PREFIX_BYTES = 4;

/** Socket-level ceiling. A frame past this is refused loudly rather than
 * silently truncated — and rather than letting a malformed length allocate
 * arbitrary memory, which is the actual attack this bounds. */
export const MESHDATA_MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Lane ids below this are minted by fieldd (lanes it opens); ids at or above
 * it are minted by field-native for lanes a PEER opened toward us. One table,
 * two minting authorities — this is what keeps them from colliding without
 * either having to know about the other, and `native.mesh.lane.open` refuses an
 * id from the reserved half.
 *
 * 2^32, deliberately not the high bit: a laneId crosses JSON-RPC as a
 * JavaScript number, and past 2^53 it stops round-tripping. */
export const MESHDATA_INBOUND_LANE_ID_BASE = 2 ** 32;

/** D5's physical lossy ceiling: every UDP fragment, including its transport
 * header, fits one tailnet datagram. Logical presence snapshots are fragmented
 * and reassembled beneath MeshData; callers still send one complete snapshot. */
export const MESHDATA_LOSSY_MAX_PAYLOAD_BYTES = 1150;

/** PRC4-E22's bounded core-presence message ceiling. This is a TRANSPORT bound,
 * not plugin admission: plugin ephemeral facets remain refused until ICE
 * exposes an enforceable producer budget that can be summed below this cap. */
export const MESHDATA_LOSSY_MAX_LOGICAL_BYTES = 64 * 1024;

export interface MeshDataFrame {
  /** Tolerant reader: an unknown kind decodes fine and the receiver decides. */
  kind: number;
  laneId: number;
  payload: Uint8Array;
}

export function encodeMeshDataFrame(kind: number, laneId: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(kind) || kind < 0 || kind > 0xff) {
    throw new Error(`meshdata frame kind out of u8 range: ${kind}`);
  }
  if (!Number.isSafeInteger(laneId) || laneId < 0) {
    throw new Error(`lane id must be a non-negative safe integer: ${laneId}`);
  }
  const body = 1 + 8 + payload.byteLength;
  if (body + MESHDATA_LENGTH_PREFIX_BYTES > MESHDATA_MAX_FRAME_BYTES) {
    throw new Error(`meshdata frame exceeds ${MESHDATA_MAX_FRAME_BYTES} bytes: ${body}`);
  }
  const frame = new Uint8Array(MESHDATA_HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, body);
  view.setUint8(4, kind);
  view.setBigUint64(5, BigInt(laneId));
  frame.set(payload, MESHDATA_HEADER_BYTES);
  return frame;
}

/** Decode ONE complete frame. Callers reading a stream want the reader below —
 * this is for tests, fixtures, and anywhere a whole frame is already in hand. */
export function decodeMeshDataFrame(data: Uint8Array): MeshDataFrame {
  if (data.byteLength < MESHDATA_HEADER_BYTES) {
    throw new Error(`meshdata frame shorter than header: ${data.byteLength} bytes`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const body = view.getUint32(0);
  // The same floor the streaming reader enforces. Without it a hand-built frame
  // declaring body = 5 decodes "successfully": the laneId is read from bytes
  // past the declared body and the payload comes out empty. The reader never
  // produces such a frame, but this function is the fixture and test path, so
  // the one place a malformed frame can be introduced is the one place that was
  // not checking.
  if (body < 1 + 8) {
    throw new Error(`meshdata frame declares ${body} bytes, shorter than its own header`);
  }
  if (body + MESHDATA_LENGTH_PREFIX_BYTES > data.byteLength) {
    throw new Error(`meshdata frame truncated: declared ${body}, have ${data.byteLength - 4}`);
  }
  const laneIdBig = view.getBigUint64(5);
  if (laneIdBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`lane id past Number.MAX_SAFE_INTEGER: ${laneIdBig}`);
  }
  return {
    kind: view.getUint8(4),
    laneId: Number(laneIdBig),
    payload: data.subarray(MESHDATA_HEADER_BYTES, MESHDATA_LENGTH_PREFIX_BYTES + body),
  };
}

/** Streaming frame reader for a byte stream that respects no message boundary.
 *
 * Feed it whatever a socket read produced; take back whole frames. It holds at
 * most one partial frame, and a declared length past the ceiling throws
 * immediately — before any allocation — so a hostile or corrupt peer cannot
 * make the daemon reserve memory on its say-so. */
export class MeshDataFrameReader {
  #buffer: Uint8Array = new Uint8Array(0);

  /** Bytes currently held back waiting for the rest of their frame. */
  get pending(): number {
    return this.#buffer.byteLength;
  }

  push(chunk: Uint8Array): MeshDataFrame[] {
    this.#buffer = this.#buffer.byteLength === 0 ? chunk.slice() : concat(this.#buffer, chunk);

    const frames: MeshDataFrame[] = [];
    for (;;) {
      if (this.#buffer.byteLength < MESHDATA_LENGTH_PREFIX_BYTES) break;
      const view = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset,
        this.#buffer.byteLength,
      );
      const body = view.getUint32(0);
      // Refuse BEFORE waiting for the bytes: an absurd length must not become an
      // absurd buffer just because the sender said so.
      if (body + MESHDATA_LENGTH_PREFIX_BYTES > MESHDATA_MAX_FRAME_BYTES) {
        throw new Error(`meshdata frame declares ${body} bytes, past the ceiling`);
      }
      if (body < 1 + 8) {
        throw new Error(`meshdata frame declares ${body} bytes, shorter than its own header`);
      }
      const total = MESHDATA_LENGTH_PREFIX_BYTES + body;
      if (this.#buffer.byteLength < total) break; // wait for the rest
      frames.push(decodeMeshDataFrame(this.#buffer.subarray(0, total)));
      this.#buffer = this.#buffer.subarray(total);
    }
    // Re-anchor so the retained partial does not pin the whole original chunk.
    if (this.#buffer.byteLength > 0 && this.#buffer.byteOffset > 0) {
      this.#buffer = this.#buffer.slice();
    }
    return frames;
  }

  /** Drop any partial frame — used when a lane or socket dies mid-frame, where
   * D5's law is that a torn frame tears the LANE, never the daemon. */
  reset(): void {
    this.#buffer = new Uint8Array(0);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeMeshDataJsonFrame(kind: number, laneId: number, value: unknown): Uint8Array {
  return encodeMeshDataFrame(kind, laneId, textEncoder.encode(JSON.stringify(value)));
}

/** JSON.parse of a control payload; the caller runs the zod shape (tolerant reader). */
export function decodeMeshDataJsonPayload(payload: Uint8Array): unknown {
  return JSON.parse(textDecoder.decode(payload));
}
