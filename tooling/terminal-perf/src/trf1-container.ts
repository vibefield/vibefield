// The TRF1 CAPTURE CONTAINER — a recording of one session's frame stream.
//
// TRF1 itself is a SINGLE frame, and its reader is EXACT-VERSION (`decodeFrame`
// asserts `FRAME_PROTOCOL_VERSION` equality — ghosttea-frame/dist/index.js:41),
// so a corpus file may not extend, wrap, or reinterpret a frame's bytes. This
// container therefore stores frames VERBATIM and puts everything it wants to say
// — cadence, provenance, geometry — OUTSIDE them, in its own header. Reading a
// frame back out is a `subarray`, not a parse: what the microbench decodes is
// byte-identical to what the cell emitted.
//
// The arrival offset is the container's other reason to exist. A corpus of
// frames with no time base can only be replayed "as fast as possible", which
// measures the decoder and nothing else; keeping each frame's arrival offset
// lets a replay reproduce the CADENCE the cell actually produced, which is what
// makes a flood trace different from an editing trace at the same byte count.

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

/** `VFTRF1C\0` — the container's own magic, deliberately NOT TRF1's. */
export const CONTAINER_MAGIC = "VFTRF1C\0";
export const CONTAINER_VERSION = 1;

/** TRF1's own magic, little-endian `TRF1`. A body starting with this is a frame;
 * anything else on the frames socket is a JSON control message. Duplicated from
 * `@vibecook/ghosttea-frame` (`FRAME_MAGIC = 826692180`) rather than imported so
 * the container can classify a body without pulling the decoder in. The
 * container test pins the two against each other. */
export const FRAME_MAGIC = 0x31465254;

/** What a recording knows about itself. Everything the manifest reports for a
 * trace is derived from here plus the frame records, never typed by hand. */
export interface Trf1CaptureHeader {
  /** Corpus name, e.g. `redraw-heavy`. Matches the manifest entry. */
  readonly name: string;
  /** Where the bytes that produced these frames came from. */
  readonly source: {
    /** `base1-port` (a TS port of the TC spike generator) | `recorded` (a real
     * program under a real PTY) | `generator` (rate-controlled synthetic). */
    readonly kind: "base1-port" | "recorded" | "generator";
    /** The generator name or the recorded command line. */
    readonly detail: string;
    /** Bytes in the source trace that were replayed into the cell. */
    readonly byteLength: number;
  };
  readonly cols: number;
  readonly rows: number;
  /** How the source bytes were fed to the PTY during capture. */
  readonly cadence: {
    /** `recorded` = a real program produced the bytes at its own speed;
     * `accelerated` = the fixture program paced them at a requested rate;
     * `asFastAsPossible` = no pacing, the pty's backpressure set the rate. */
    readonly mode: "recorded" | "accelerated" | "asFastAsPossible";
    /** The rate the fixture program was ASKED for, in bytes/second (0 = uncapped
     * or not applicable). The frames' arrival offsets record what actually
     * happened, so the two can be compared rather than conflated. */
    readonly bytesPerSecond: number;
    /** How long the replay was asked to run, in milliseconds (0 = one pass). */
    readonly targetMs: number;
  };
  /** Provenance of the capture itself — never quoted from memory (the repo's
   * errata rule): the daemon that produced the frames and the host that ran it. */
  readonly capturedAt: string;
  readonly ghostteaVersion: string;
  readonly sourceCommit: string;
  readonly host: {
    readonly platform: string;
    readonly arch: string;
    readonly loadAvg1: number;
  };
  /** Free-form notes that belong with the data, e.g. a known method gap. */
  readonly notes?: readonly string[];
}

export interface Trf1FrameRecord {
  /** Microseconds from the FIRST frame's arrival. The first record is 0. */
  readonly offsetUs: number;
  /** The frame body, verbatim — feed straight to `decodeFrame`. */
  readonly bytes: Uint8Array;
}

export interface Trf1Capture {
  readonly header: Trf1CaptureHeader;
  readonly frames: readonly Trf1FrameRecord[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Serialize a capture.
 *
 * Layout: `magic(8) version(u32) frameCount(u32) headerLength(u32) header(json)`
 * then, per frame, `offsetUs(u32) byteLength(u32) bytes`. All integers are
 * little-endian, matching TRF1's own encoding so a reader never switches
 * endianness mid-file.
 */
export function encodeCapture(capture: Trf1Capture): Uint8Array {
  const headerJson = textEncoder.encode(JSON.stringify(capture.header));
  let total = 8 + 4 + 4 + 4 + headerJson.byteLength;
  for (const frame of capture.frames) total += 8 + frame.bytes.byteLength;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(textEncoder.encode(CONTAINER_MAGIC), 0);
  view.setUint32(8, CONTAINER_VERSION, true);
  view.setUint32(12, capture.frames.length, true);
  view.setUint32(16, headerJson.byteLength, true);
  out.set(headerJson, 20);

  let cursor = 20 + headerJson.byteLength;
  for (const frame of capture.frames) {
    view.setUint32(cursor, frame.offsetUs, true);
    view.setUint32(cursor + 4, frame.bytes.byteLength, true);
    out.set(frame.bytes, cursor + 8);
    cursor += 8 + frame.bytes.byteLength;
  }
  return out;
}

/**
 * Parse a capture.
 *
 * Frame bodies are returned as SUBARRAYS of the input, so decoding one costs no
 * copy and the microbench measures the decoder rather than the loader. The
 * caller must therefore keep `buffer` alive for as long as it holds frames —
 * which the bench does, and which `readCaptureFile` guarantees by construction.
 */
export function decodeCapture(buffer: Uint8Array): Trf1Capture {
  if (buffer.byteLength < 20) throw new Error("trf1 capture is truncated at the header");
  const magic = textDecoder.decode(buffer.subarray(0, 8));
  if (magic !== CONTAINER_MAGIC)
    throw new Error(`not a trf1 capture (magic ${JSON.stringify(magic)})`);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const version = view.getUint32(8, true);
  if (version !== CONTAINER_VERSION) {
    throw new Error(`trf1 capture version ${version} (this reader speaks ${CONTAINER_VERSION})`);
  }
  const frameCount = view.getUint32(12, true);
  const headerLength = view.getUint32(16, true);
  const header = JSON.parse(
    textDecoder.decode(buffer.subarray(20, 20 + headerLength)),
  ) as Trf1CaptureHeader;

  const frames: Trf1FrameRecord[] = [];
  let cursor = 20 + headerLength;
  for (let index = 0; index < frameCount; index += 1) {
    if (cursor + 8 > buffer.byteLength) {
      throw new Error(`trf1 capture is truncated at frame ${index} of ${frameCount}`);
    }
    const offsetUs = view.getUint32(cursor, true);
    const byteLength = view.getUint32(cursor + 4, true);
    if (cursor + 8 + byteLength > buffer.byteLength) {
      throw new Error(`trf1 capture frame ${index} claims ${byteLength} bytes past the end`);
    }
    frames.push({ offsetUs, bytes: buffer.subarray(cursor + 8, cursor + 8 + byteLength) });
    cursor += 8 + byteLength;
  }
  return { header, frames };
}

/** Whether a frames-socket packet body is a TRF1 frame (vs a JSON message). */
export function isFrameBody(body: Uint8Array): boolean {
  if (body.byteLength < 4) return false;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return view.getUint32(0, true) === FRAME_MAGIC;
}

/** Total frame bytes in a capture — the manifest's `bytes`. */
export function captureByteLength(capture: Trf1Capture): number {
  let total = 0;
  for (const frame of capture.frames) total += frame.bytes.byteLength;
  return total;
}

/** Wall duration the frames spanned, in milliseconds. */
export function captureDurationMs(capture: Trf1Capture): number {
  const last = capture.frames.at(-1);
  return last === undefined ? 0 : last.offsetUs / 1_000;
}

// ---------------------------------------------------------------------------
// FILE I/O — gzip on disk, verbatim in memory.
//
// The uncaptured corpus is ~93 MiB of TRF1, which is not a thing to put in a
// git history. Frames compress extraordinarily well (measured on this corpus:
// 4.7x for `softwrap`, 25.6x for `counter`, 69.7x for `yes-flood` — a flood
// repeats one row pattern, an editor does not), so the fixtures are stored
// gzipped and expanded at load. Compression is LOSSLESS and happens outside the
// container, so what the bench decodes is still byte-identical to what the cell
// emitted; the microbench decompresses during setup, never inside a timed
// region.
//
// The reader sniffs rather than trusting the extension: a `.trf1` written by an
// older run, or one someone gunzipped by hand, still loads.

/** gzip's magic — `1f 8b`. */
function isGzip(buffer: Uint8Array): boolean {
  return buffer.byteLength >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

/** Keep at most `maxFrames` frames and `maxBytes` of frame payload.
 *
 * A contiguous PREFIX, never a sample: frame classification is sequence- and
 * epoch-ordered (`classifyFrame` in the render worker decides stale/resync from
 * `frameSequence` and `sessionEpoch`), so a corpus with holes punched in it
 * would exercise the resync path on every gap and measure that instead of
 * apply. Truncation is honest — the trace simply ends earlier. */
export function capCapture(capture: Trf1Capture, maxFrames: number, maxBytes: number): Trf1Capture {
  const frames: Trf1FrameRecord[] = [];
  let bytes = 0;
  for (const frame of capture.frames) {
    if (frames.length >= maxFrames) break;
    if (bytes + frame.bytes.byteLength > maxBytes && frames.length > 0) break;
    frames.push(frame);
    bytes += frame.bytes.byteLength;
  }
  return { header: capture.header, frames };
}

/** Write a capture, gzipped. */
export function writeCaptureFile(path: string, capture: Trf1Capture): void {
  writeFileSync(path, gzipSync(encodeCapture(capture), { level: 9 }));
}

/**
 * Read a capture from disk.
 *
 * The returned frames are subarrays of ONE buffer that this function owns and
 * the capture keeps alive, so decoding a frame costs no copy and the bench
 * measures the decoder rather than the loader.
 */
export function readCaptureFile(path: string): Trf1Capture {
  const raw = readFileSync(path);
  const bytes = isGzip(raw) ? gunzipSync(raw) : raw;
  return decodeCapture(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}
