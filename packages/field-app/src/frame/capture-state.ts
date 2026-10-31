import type { ScreenshotCaptureResult } from "@vibefield/contracts";
import { useSyncExternalStore } from "react";
import { captureRefusal } from "./cards/cards-words";
import { SNAPSHOT_NO_HELPER } from "./line-model";

// WHAT THE SNAPSHOT TOOL LAST SAID OF ITSELF (DESIGN.md §8 "The line": with
// the helper missing or Screen Recording refused, the snapshot "waits, faint by
// ink, and its tooltip says why"; R-B 4). A capture door can be there and still
// not capture, and only the tool's own answer says so. Two presses reach the one
// tool — the line's own, and main's ⌃⌘A or the View menu's Take Screenshot,
// whose answers the hand hears (`Cards`) — so what either learns is kept HERE,
// once per window, and the line reads it. The clipboard tray kept its last
// answer for the same reason, until the door moved to the line without it.

/** The snapshot's state, as the tool's last answer left it. */
export interface CaptureState {
  /** Why the snapshot waits — no capture helper here: faint by ink, never
   * pressed, its tooltip says so. */
  readonly waits: string | null;
  /** Why the last capture was refused while the snapshot can still be pressed
   * — Screen Recording is off, and a press asks the system again: its tooltip
   * says so in place of its key. */
  readonly why: string | null;
}

const READY: CaptureState = { waits: null, why: null };

let state: CaptureState = READY;
const listeners = new Set<() => void>();

/** The state an answer leaves, or null where it proves nothing of the door. A
 * still kept, or a cancel — the tool came up, and it asks for Screen Recording
 * before its overlay shows — clears what was said; no helper for this platform
 * makes the snapshot wait; Screen Recording off is said, the snapshot still
 * pressable; one at a time, and the tool's own failures, leave it as it is. */
function stateAfter(result: ScreenshotCaptureResult): CaptureState | null {
  if (result.status !== "error") return READY;
  switch (result.code) {
    case "helper-missing":
    case "unsupported-platform":
      return { waits: SNAPSHOT_NO_HELPER, why: null };
    case "permission-denied":
      return { waits: null, why: captureRefusal(result) };
    default:
      return null;
  }
}

/** What a capture answered, from either press: the line's own (`Composer`) or
 * one main ran (the hand's subscription, `Cards`). */
export function noteCapture(result: ScreenshotCaptureResult): void {
  const next = stateAfter(result);
  if (next === null || (next.waits === state.waits && next.why === state.why)) return;
  state = next;
  for (const fn of [...listeners]) fn();
}

export function getCaptureState(): CaptureState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The line's side. */
export function useCaptureState(): CaptureState {
  return useSyncExternalStore(subscribe, getCaptureState, getCaptureState);
}

/** Test seam: the tool's answers forgotten (its hearers unsubscribe themselves). */
export function resetCaptureStateForTest(): void {
  state = READY;
}
