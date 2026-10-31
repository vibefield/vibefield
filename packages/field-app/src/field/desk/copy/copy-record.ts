import type { DealFrom } from "../../../frame/cards/cards-store";

// THE DESK'S COPY, AS IT WENT — a witness (`window.__vfDesk.copied()`; HN-D3). The act (copy-to-hand.ts) begins a record
// at the press and notes each step into it: the card it dealt, the words it gave the system clipboard, the still. Kept
// apart from the act so the desk's door reads it without importing the act, which reads the door. Plain data only: a
// harness carries it across `executeJavaScript`, so the card is named, never handed over (its bytes would not cross).

/** Where Copy was pressed: the bar's pill, the grown menu's row, the pill in hand — or ⌘C (product-chords' `desk-copy`). */
export type CopyFrom = "bar" | "menu" | "hand" | "key";

/** A box in CSS px of the desk's view (the anchor's, the pick's). */
export interface ViewBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface CopyRecord {
  readonly seq: number;
  readonly from: CopyFrom;
  /** The objects copied, in selection order: each one's type and its human name. */
  readonly objects: readonly { readonly type: string; readonly name: string }[];
  /** Where the card leaves from — the objects' own box, window CSS px — and the capture's rect, CSS px of the desk's view
   * (null when nothing of the box is on the view). */
  readonly fromBox: DealFrom;
  readonly rect: ViewBox | null;
  /** The words given the system clipboard, null with none; whether its door took them, null until it answered. */
  readonly words: string | null;
  readonly wrote: boolean | null;
  /** The marks the still was asked with, as the capture door was HANDED them — `false`, the
   * objects without the selection's marks (ICE I40, `capture({ rect, marks: false })`; ICE draws
   * them when the option is left out) — null until the door was asked, and for a text card,
   * which asks none. The selection is never cleared or put back (DK-17b). */
  readonly marks: boolean | null;
  /** OBSERVED: the selection stood as at the press when the still was asked and after it answered — null until then. */
  readonly kept: boolean | null;
  /** The still (its size, device px, and its PNG's bytes) — null until it came, and for a text card. */
  readonly still: {
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
  } | null;
  /** The card dealt — its id, kind and title — or null before it is, and when none was (`refused` says why). */
  readonly card: {
    readonly id: string;
    readonly kind: "text" | "pict";
    readonly title: string;
  } | null;
  readonly refused: string | null;
  /** `performance.now()` at each step: pressed, the still taken, the card dealt. */
  readonly at: {
    readonly pressed: number;
    readonly captured?: number;
    readonly dealt?: number;
  };
}

let last: CopyRecord | null = null;
let seq = 0;

/** A Copy begins: its record from the act's facts. */
export function beginCopyRecord(
  facts: Pick<CopyRecord, "from" | "objects" | "fromBox" | "rect" | "words">,
): CopyRecord {
  seq += 1;
  last = {
    ...facts,
    seq,
    wrote: null,
    marks: null,
    kept: null,
    still: null,
    card: null,
    refused: null,
    at: { pressed: performance.now() },
  };
  return last;
}

/** What the act learned since — merged into the record it began (ignored once another has begun). */
export function noteCopy(
  forSeq: number,
  patch: Partial<Omit<CopyRecord, "seq" | "at">> & { readonly at?: Partial<CopyRecord["at"]> },
): void {
  if (last === null || last.seq !== forSeq) return;
  last = { ...last, ...patch, at: { ...last.at, ...(patch.at ?? {}) } };
}

/** The last Copy as it went, or null before any. */
export function lastCopy(): CopyRecord | null {
  return last;
}
