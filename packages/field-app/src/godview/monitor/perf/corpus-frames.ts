import type { AgentMeshFrame, AgentMeshOpen } from "@vibefield/contracts";
import type { AgentSessionSummary } from "../facet-types";
import type { ModelBoardFailure } from "../remote-door";

// Immutable corpus inputs and their JSONL codec. MV-8 removed the live
// recorder; these bytes still drive the offline backend and pre-MV A arms.

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
  | { kind: "mesh-error"; failure: ModelBoardFailure }
  /** A moment a corpus names (a status flip whose first pixel is timed), or a
   * note a harness leaves. Never produced by the live door. */
  | { kind: "mark"; name: string; detail?: Readonly<Record<string, unknown>> };

export type RecordedFrame = FrameStamp & RecordedEvent;

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
