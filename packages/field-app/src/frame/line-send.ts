import { useSyncExternalStore } from "react";
import type { ChipStill, DeskChip } from "./draft";

// SEND TO…'S DOOR INTO THE LINE (DK-14; DESIGN.md §8 "Send to…"; MC-D5: hand off to the line; FC-D1). Send to… is
// pressed on the desk's chrome — the selection bar, the tools in hand, the bar grown into its menu — and it ONLY
// DRAFTS: the selection becomes ONE chip in the line's draft. The line is the frame's and the bar the desk's, siblings
// under ChromeLayer, so the line publishes this door (line-door.ts's shape, for the same reason: a prop threaded
// between them would make ChromeLayer a second owner of something it never reads) and the bar's act knocks on it.
//
// Plain data only crosses: the chip (its face and what it carries), where it flies from, and — later — its still.
// What the line does with it (the flight, the landing at the caret, the @ typed) is the line's own (Composer.tsx);
// what the bar does meanwhile (it steps aside while the act is on and @'s list is open) reads the PHASE below.

/** A box on screen, CSS px of the window. */
export interface WindowBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Where Send to… was pressed (the canon's three doors). */
export type SendFrom = "bar" | "menu" | "hand";

/** The line's answer to a chip it took: where the still goes once the capture resolves. */
export interface LineSendTicket {
  attach(still: ChipStill | null): void;
}

/** The line's side: take a chip flying from `from` — null when it cannot now (another is in flight). */
export interface LineSendReceiver {
  receive(chip: DeskChip, from: WindowBox): LineSendTicket | null;
}

let receiver: LineSendReceiver | null = null;

/** The line publishes its receiver (once mounted); the returned undo withdraws it if it is still this one. */
export function publishLineSend(next: LineSendReceiver): () => void {
  receiver = next;
  return () => {
    if (receiver === next) receiver = null;
  };
}

/** The desk's side: hand the line a chip. Null when no line is here or it is busy with another. */
export function sendToLine(chip: DeskChip, from: WindowBox): LineSendTicket | null {
  return receiver?.receive(chip, from) ?? null;
}

// ── THE MOTION (§8 "Send to…"; §6 M3, M4, M6) ──────────────────────────────────────────────────────────────────────
export interface SendMotion {
  /** The chip FLIES (false: reduced motion — no flight, a fade at the caret). */
  readonly flies: boolean;
  /** The flight: on the island curve, a straight line, shrinking along its travel. */
  readonly flightMs: number;
  readonly fromScale: number;
  readonly toScale: number;
  /** The flier's own fade in as it leaves the selection (the drawing's, mat-chrome page.js: 140 ms `ease`). */
  readonly flierFadeMs: number;
  /** How long the flight's transition stays declared past its length before the landing is taken (DK-12's grace). */
  readonly graceMs: number;
  /** Reduced: the chip's fade in at the caret. */
  readonly fadeMs: number;
  /** The @ comes this long after the chip lands. */
  readonly atAfterMs: number;
}

export const SEND_MOTION: SendMotion = {
  flies: true,
  flightMs: 560,
  fromScale: 1.25,
  toScale: 0.86,
  flierFadeMs: 140,
  graceMs: 100,
  fadeMs: 120,
  atAfterMs: 180,
};

/** Send to…'s motion — reduced (M6): no flight, the chip fading in at the caret over 120 ms (the drawing's), and the
 * @ after half the 180 ms (M6 halves durations). */
export function sendMotion(reduced: boolean): SendMotion {
  return reduced
    ? { ...SEND_MOTION, flies: false, atAfterMs: SEND_MOTION.atAfterMs / 2 }
    : SEND_MOTION;
}

// ── THE PHASE: what the bar steps aside for ─────────────────────────────────────────────────────────────────────────
/**
 * `flying` — pressed: the chip leaves the selection for the caret (or, reduced, fades in there) and the @ is still to
 * come; `listing` — @'s list is open from it; `idle` — neither (the list folded, or an aimed draft took the chip with
 * no @). The bar over the selection stands aside while it is not idle (§8: "away too while @'s list is open from Send
 * to…"); the tools in hand stay under the head (plan addendum (50)).
 */
export type LineSendPhase = "idle" | "flying" | "listing";

let phase: LineSendPhase = "idle";
const listeners = new Set<() => void>();

export function setLineSendPhase(next: LineSendPhase): void {
  if (next === phase) return;
  phase = next;
  for (const fn of [...listeners]) fn();
}

export function lineSendPhase(): LineSendPhase {
  return phase;
}

export function subscribeLineSend(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useLineSendPhase(): LineSendPhase {
  return useSyncExternalStore(subscribeLineSend, lineSendPhase, lineSendPhase);
}

// ── THE RECORD: the last Send to… as it went (a witness — `window.__vfDesk.sent()`) ────────────────────────────────
export interface SendRecord {
  readonly seq: number;
  readonly from: SendFrom;
  /** The chip's face and what it carries in words. */
  readonly label: string;
  readonly glyph: DeskChip["glyph"];
  readonly paper: string | null;
  readonly ink: string | null;
  readonly objects: DeskChip["objects"];
  /** Where the chip flew from (window CSS px) and the capture's rect (CSS px of the desk's view). */
  readonly fromBox: WindowBox;
  readonly rect: WindowBox | null;
  /** The still asked WITHOUT the selection's marks (ICE I40, `capture({ marks: false })`) — the option as asked: the
   * selection is never cleared or put back (DK-17b; DK-14's `{ cleared, restored }` retired). */
  readonly marks: false;
  /** OBSERVED: the selection stood as at the press when the capture was asked and after it answered — null until then. */
  readonly kept: boolean | null;
  /** The line took the chip (false: no line, or another in flight). */
  readonly taken: boolean;
  /** The draft was already aimed: no @, send armed. */
  readonly aimed: boolean | null;
  /** Reduced motion: no flight, a fade at the caret. */
  readonly reduced: boolean | null;
  /** The still attached (its size, device px) — null until the capture resolves, or when the desk had none. */
  readonly still: {
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
  } | null;
  /** `performance.now()` at each step: pressed, the capture done, the chip landed, the @ typed, @'s list open. */
  readonly at: {
    readonly pressed: number;
    readonly captured?: number;
    readonly landed?: number;
    readonly typed?: number;
  };
}

let last: SendRecord | null = null;
let seq = 0;

/** A Send to… begins: its record from the act's facts. */
export function beginSendRecord(
  facts: Omit<
    SendRecord,
    "seq" | "aimed" | "reduced" | "still" | "at" | "marks" | "kept" | "taken"
  > & {
    readonly at?: Partial<SendRecord["at"]>;
  },
): SendRecord {
  seq += 1;
  last = {
    ...facts,
    seq,
    taken: false,
    aimed: null,
    reduced: null,
    still: null,
    marks: false,
    kept: null,
    at: { pressed: performance.now(), ...(facts.at ?? {}) },
  };
  return last;
}

/** What the act or the line learned since — merged into the record it began (ignored once another has begun). */
export function noteSend(
  forSeq: number,
  patch: Partial<Omit<SendRecord, "seq" | "at">> & { readonly at?: Partial<SendRecord["at"]> },
): void {
  if (last === null || last.seq !== forSeq) return;
  last = { ...last, ...patch, at: { ...last.at, ...(patch.at ?? {}) } };
}

/** The last Send to… as it went, or null before any. */
export function lastSend(): SendRecord | null {
  return last;
}

/** The record's seq the line is landing now — the line notes its own steps into it. */
export function currentSendSeq(): number {
  return seq;
}
