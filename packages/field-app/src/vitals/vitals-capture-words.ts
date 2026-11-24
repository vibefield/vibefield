import type {
  VitalsCaptureFailure,
  VitalsCaptureKind,
  VitalsCaptureState,
  VitalsFrameCountV1,
} from "@vibefield/contracts/vitals";
import { durationWords, memoryWords } from "./vitals-words";

// VT-5 (track VT, 2026-11-24) — the captures' words (DESIGN.md §9 "Vitals' words", the captures; §8 "Vitals",
// "Captures"). Plain, in the window's voice: what runs, how long, what was saved and what it holds.

export const CAPTURE_KIND_WORDS: Readonly<Record<VitalsCaptureKind, string>> = {
  trace: "App trace",
  profile: "fieldd profile",
  frames: "Desk frames",
};

export const CAPTURE_WORDS = {
  whatLabel: "What to capture",
  lengthLabel: "How long",
  capture: "Capture",
  capturing: "Capturing…",
  reveal: "Show in Finder",
  traceNote:
    "A trace holds the addresses and titles of the pages open in VibeField. It stays on this computer.",
  noFrames: "No frames: the desk's window drew none.",
} as const;

export const CAPTURE_FAILURE_WORDS: Readonly<Record<VitalsCaptureFailure, string>> = {
  busy: "Another capture is running.",
  "no-fieldd": "fieldd isn't answering.",
  "no-desk": "The desk's window isn't open.",
  "cut-short": "It stopped before its time.",
  "not-saved": "It couldn't be saved.",
  "not-started": "It couldn't be started.",
};

export function lengthWords(seconds: number): string {
  return `${seconds} s`;
}

/** A file's size as memory is said ("4 MB"), and a small file never "0 KB": under a megabyte it is whole KB, up. */
export function fileSizeWords(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return memoryWords(bytes);
}

/** "App trace · 12 s left" */
export function runningWords(kind: VitalsCaptureKind, secondsLeft: number): string {
  return `${CAPTURE_KIND_WORDS[kind]} · ${Math.max(0, Math.ceil(secondsLeft))} s left`;
}

/** A frame count's one line: its rate, its longest frame, and how many ran over a 60 Hz frame and over 50 ms. */
export function frameCountWords(count: VitalsFrameCountV1): string {
  if (count.frames === 0 || count.meanFps === undefined) return CAPTURE_WORDS.noFrames;
  const parts = [`${Math.round(count.meanFps)} frames a second`];
  if (count.longestMs !== undefined) parts.push(`longest ${durationWords(count.longestMs)}`);
  parts.push(`${count.slowFrames} over 16.7 ms`, `${count.longFrames} over 50 ms`);
  return parts.join(" · ");
}

/** A saved capture's line: its size and what it holds. Its name is said beside it, in its own ink. */
export function savedWords(state: Extract<VitalsCaptureState, { state: "saved" }>): string {
  const holds =
    state.kind === "frames"
      ? state.frames === undefined
        ? CAPTURE_WORDS.noFrames
        : frameCountWords(state.frames)
      : state.kind === "trace"
        ? `${state.seconds} s of the app · opens in Perfetto`
        : `${state.seconds} s of fieldd · opens in Chrome's DevTools`;
  return `${fileSizeWords(state.bytes)} · ${holds}`;
}

/** "fieldd profile · fieldd isn't answering." */
export function failedWords(kind: VitalsCaptureKind, reason: VitalsCaptureFailure): string {
  return `${CAPTURE_KIND_WORDS[kind]} · ${CAPTURE_FAILURE_WORDS[reason]}`;
}
