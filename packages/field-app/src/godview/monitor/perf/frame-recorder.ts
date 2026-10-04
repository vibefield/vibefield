import type { AgentMeshFrame, AgentMeshOpen } from "@vibefield/contracts";
import type { AgentSessionSummary } from "../facet-types";
import type { MeshBoardFailure, MonitorDoor } from "../remote-door";

// THE FRAME RECORDER (MV-0, `design-mv.md` §5).
//
// What reaches the monitor through the door, written down as it arrives: every
// fold frame (`agent.subscribe {}`'s whole board, `door.observe`), every mesh
// open and per-device frame (`door.observeMesh`), and every failure either
// half reports — each stamped with a monotonic clock and the wall clock. The
// seam is the DOOR because the door is where the renderer's reading of the
// daemon begins: what is recorded here is exactly what `useLocalAgentField`
// and `useMeshField` would have been handed, so a corpus replayed through the
// same door drives today's seam with today's inputs and nothing invented.
//
// It changes nothing it does not record. `recordingDoor` tees; it never holds a
// frame back, reorders one, or copies one (the listener receives the object the
// daemon's parse produced, and the recorder keeps the same reference until it is
// drained). The buffer is BOUNDED, because a recorder left on under a sixty-agent
// board at the fold's 16 ms tick would otherwise grow by megabytes a second;
// what did not fit is counted, never silently lost (`dropped`).
//
// The recorder is dormant unless `door-instruments.ts` installs it, and it has
// no opinion on where its frames go: the renderer cannot write a file, so a
// host (Electron main, a harness) drains it over `executeJavaScript` and gzips
// the JSONL on its side (`electron-shell/src/main/godview-recording.ts`).

/** Monotonic and wall clocks, injectable so a fixture can pin both. */
export interface RecorderClock {
  /** monotonic milliseconds (`performance.now()` in a renderer) */
  now(): number;
  /** wall-clock milliseconds since the epoch (`Date.now()`) */
  wall(): number;
}

/** The stamp every frame carries: its order, when it arrived on the monotonic
 * clock, and the wall clock at the same instant (so a reader can relate the
 * corpus to a daemon's own ISO timestamps). */
export interface FrameStamp {
  seq: number;
  t: number;
  wall: number;
}

export type RecordedEvent =
  | { kind: "fold"; rows: readonly AgentSessionSummary[] }
  | { kind: "fold-error"; reason: string }
  | { kind: "mesh-open"; open: AgentMeshOpen }
  | { kind: "mesh-frame"; frame: AgentMeshFrame }
  | { kind: "mesh-error"; failure: MeshBoardFailure }
  /** A moment a corpus names (a status flip whose first pixel is timed), or a
   * note a harness leaves. Never produced by the live door. */
  | { kind: "mark"; name: string; detail?: Readonly<Record<string, unknown>> };

export type RecordedFrame = FrameStamp & RecordedEvent;

export interface FrameRecorder {
  /** Stamp and hold one event. Returns the stamped frame (or the frame that
   * WOULD have been held when the bound dropped it — the stamp is still true). */
  record(event: RecordedEvent): RecordedFrame;
  /** Take everything held, in arrival order, and forget it. */
  drain(): RecordedFrame[];
  /** How many frames are held right now. */
  held(): number;
  /** Frames that did not fit the bound since the last drain. */
  dropped(): number;
  /** The recorder's own epoch: `t` and `wall` read at creation. */
  readonly origin: FrameStamp;
}

/** 20 000 frames is five minutes of a fold ticking at 16 ms. */
export const DEFAULT_RECORDER_CAPACITY = 20_000;

function defaultClock(): RecorderClock {
  const monotonic =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? () => performance.now()
      : () => Date.now();
  return { now: monotonic, wall: () => Date.now() };
}

export function createFrameRecorder(
  options: { clock?: RecorderClock; capacity?: number } = {},
): FrameRecorder {
  const clock = options.clock ?? defaultClock();
  const capacity = Math.max(1, options.capacity ?? DEFAULT_RECORDER_CAPACITY);
  const origin: FrameStamp = { seq: 0, t: clock.now(), wall: clock.wall() };
  let frames: RecordedFrame[] = [];
  let seq = 0;
  let dropped = 0;
  return {
    origin,
    record(event) {
      seq += 1;
      const frame: RecordedFrame = { ...event, seq, t: clock.now(), wall: clock.wall() };
      if (frames.length >= capacity) dropped += 1;
      else frames.push(frame);
      return frame;
    },
    drain() {
      const taken = frames;
      frames = [];
      dropped = 0;
      return taken;
    },
    held: () => frames.length,
    dropped: () => dropped,
  };
}

/**
 * The door, teed. Every OTHER member of the door is the same reference — a
 * recording door attaches, creates and mounts exactly as the door it wraps,
 * which `godview-frame-recorder.test.ts` holds by identity. The frame is
 * recorded BEFORE the listener sees it, so `t` is its arrival and not the time
 * the listener took.
 */
export function recordingDoor(door: MonitorDoor, recorder: FrameRecorder): MonitorDoor {
  return {
    ...door,
    observe: (listener) =>
      door.observe({
        onFrame: (rows) => {
          recorder.record({ kind: "fold", rows });
          listener.onFrame(rows);
        },
        onError: (reason) => {
          recorder.record({ kind: "fold-error", reason });
          listener.onError(reason);
        },
      }),
    observeMesh: (listener) =>
      door.observeMesh({
        onOpen: (open) => {
          recorder.record({ kind: "mesh-open", open });
          listener.onOpen(open);
        },
        onFrame: (frame) => {
          recorder.record({ kind: "mesh-frame", frame });
          listener.onFrame(frame);
        },
        onError: (failure) => {
          recorder.record({ kind: "mesh-error", failure });
          listener.onError(failure);
        },
      }),
  };
}

// ── JSONL ─────────────────────────────────────────────────────────────────────
// One frame per line, `JSON.stringify` of the stamped frame and nothing else:
// the rows are the daemon's own parsed shapes, so a line parses straight back
// into what the door would have delivered. Gzip is the host's business.

export function encodeFrameLine(frame: RecordedFrame): string {
  return JSON.stringify(frame);
}

export function encodeFramesJsonl(frames: readonly RecordedFrame[]): string {
  if (frames.length === 0) return "";
  return `${frames.map(encodeFrameLine).join("\n")}\n`;
}

const FRAME_KINDS: ReadonlySet<string> = new Set([
  "fold",
  "fold-error",
  "mesh-open",
  "mesh-frame",
  "mesh-error",
  "mark",
]);

/** A line that is not a stamped frame of a known kind is skipped, never thrown
 * on: a corpus a host interleaved with its own header lines still reads. */
export function decodeFrameLine(line: string): RecordedFrame | undefined {
  const text = line.trim();
  if (text === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const frame = value as Partial<RecordedFrame>;
  if (
    typeof frame.kind !== "string" ||
    !FRAME_KINDS.has(frame.kind) ||
    typeof frame.seq !== "number" ||
    typeof frame.t !== "number" ||
    typeof frame.wall !== "number"
  ) {
    return undefined;
  }
  return frame as RecordedFrame;
}

export function decodeFramesJsonl(text: string): RecordedFrame[] {
  const frames: RecordedFrame[] = [];
  for (const line of text.split("\n")) {
    const frame = decodeFrameLine(line);
    if (frame !== undefined) frames.push(frame);
  }
  return frames;
}
