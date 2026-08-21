// The corpus manifest — what §19.2 requires a fixture set to declare about
// itself ("cols x rows, frames, bytes, duration, cadence"), plus the provenance
// this repo's errata rule requires ("never quoted from memory").
//
// Every field is DERIVED from the captured file, never typed by hand: the
// manifest is written by the capture from the container it just wrote, so a
// manifest that disagrees with its fixtures is not reachable.
import {
  captureByteLength,
  captureDurationMs,
  decodeCapture,
  type Trf1Capture,
} from "./trf1-container";

export interface ManifestEntry {
  readonly name: string;
  readonly file: string;
  readonly covers: string;
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
  /** Total TRF1 bytes across all frames. */
  readonly bytes: number;
  /** First-to-last frame arrival span. */
  readonly durationMs: number;
  /** Frames per second the CELL produced, over that span. Not a display rate —
   * the cell coalesces to at most one frame per damage cycle, so this is the
   * fixture's own cadence and the number a replay should reproduce. */
  readonly framesPerSecond: number;
  readonly meanFrameBytes: number;
  readonly maxFrameBytes: number;
  /** How many frames carry the FullSnapshot flag. A trace whose every frame is
   * full is a trace that never exercised incremental apply. */
  readonly fullSnapshots: number;
  readonly source: Trf1Capture["header"]["source"];
  readonly cadence: Trf1Capture["header"]["cadence"];
  /** Non-frame messages the daemon sent during capture. A `frame-gap` here
   * means this entry HAS A HOLE and any count derived from it is a floor. */
  readonly daemonMessages: readonly string[];
  readonly notes?: readonly string[];
}

export interface CorpusManifest {
  readonly version: 1;
  readonly capturedAt: string;
  readonly ghostteaVersion: string;
  readonly sourceCommit: string;
  readonly host: Trf1Capture["header"]["host"];
  /** The honest limits of this corpus, carried WITH it. */
  readonly limits: readonly string[];
  readonly entries: readonly ManifestEntry[];
  readonly totals: {
    readonly entries: number;
    readonly frames: number;
    readonly bytes: number;
  };
}

/** TRF1's `FrameFlag.FullSnapshot` (`ghosttea-frame/dist/index.js:7`), read
 * straight from the frame header so the manifest costs no decode.
 *
 * `flags` is a **u16 at byte 6** — `decodeFrame` reads `view.getUint16(6, true)`
 * (`index.js:65`); byte 8 begins the u64 `sessionHandle`. An earlier draft of
 * this file read a u32 at 8 and therefore counted the low half of the session
 * handle: every trace came back either all-full or all-incremental, which looked
 * like a finding and was an instrument bug. */
const FULL_SNAPSHOT_FLAG = 1 << 0;
const FLAGS_OFFSET = 6;

export function describeCapture(
  file: string,
  capture: Trf1Capture,
  daemonMessages: readonly string[],
): ManifestEntry {
  const bytes = captureByteLength(capture);
  const durationMs = captureDurationMs(capture);
  let maxFrameBytes = 0;
  let fullSnapshots = 0;
  for (const frame of capture.frames) {
    if (frame.bytes.byteLength > maxFrameBytes) maxFrameBytes = frame.bytes.byteLength;
    if (frame.bytes.byteLength >= FLAGS_OFFSET + 2) {
      const view = new DataView(frame.bytes.buffer, frame.bytes.byteOffset, frame.bytes.byteLength);
      if ((view.getUint16(FLAGS_OFFSET, true) & FULL_SNAPSHOT_FLAG) !== 0) fullSnapshots += 1;
    }
  }
  return {
    name: capture.header.name,
    file,
    covers: capture.header.notes?.[0] ?? "",
    cols: capture.header.cols,
    rows: capture.header.rows,
    frames: capture.frames.length,
    bytes,
    durationMs: Math.round(durationMs * 100) / 100,
    framesPerSecond:
      durationMs > 0 ? Math.round(((capture.frames.length * 1_000) / durationMs) * 100) / 100 : 0,
    meanFrameBytes: capture.frames.length > 0 ? Math.round(bytes / capture.frames.length) : 0,
    maxFrameBytes,
    fullSnapshots,
    source: capture.header.source,
    cadence: capture.header.cadence,
    daemonMessages,
    ...(capture.header.notes === undefined ? {} : { notes: capture.header.notes }),
  };
}

/** Read a `.trf1` file and describe it — used by the bench and by any consumer
 * that wants the manifest's numbers without trusting the manifest. */
export function describeFile(file: string, buffer: Uint8Array): ManifestEntry {
  return describeCapture(file, decodeCapture(buffer), []);
}
