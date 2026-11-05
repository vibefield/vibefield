import type { FlowJournalHead, FlowJournalKnownLine, FlowRunId } from "@vibefield/contracts";
import type { SetAsideWhy } from "../signed-record";

// CP-4a2a (CP4-S15, CP-D9; 4A2-Q10 (a), ruled by VF-PM 2026-11-05 08:51Z) — a run's journal, its lines: one JSONL file
// per run under the flows store (`runs/<run>.jsonl` in LAYOUT.FLOWS_DIR, flows/records.ts keeps it), written by fieldd
// alone. Each line carries `mac`: the flows store's record signer's HMAC over the canonical JSON of {run, prev, line
// without its mac}, `prev` the line before's mac ("" for the head), so a line copied from another run, dropped or moved
// breaks the chain and its run is set aside as lost. This file is the lines' rule and imports no fs: the store reads
// and writes the file.
//
// SKELETON (the red, commit 8): nothing verifies.

/** The journals' folder in the flows store, and a journal's file suffix. */
export const RUNS_DIR = "runs";
export const JOURNAL_SUFFIX = ".jsonl";

/** A line after the head as it is written: its kind and body, without the format, seq, time and MAC fieldd adds
 * (contracts' FlowJournalCall, FlowJournalAnswer, FlowJournalLog and FlowJournalEnd). */
export type FlowJournalEntry =
  | {
      readonly kind: "call";
      readonly call: number;
      readonly what: string;
      readonly key: string;
      readonly n: number;
      readonly label?: string;
      readonly agent?: string;
      readonly phase?: string;
    }
  | {
      readonly kind: "answer";
      readonly call: number;
      readonly value?: unknown;
      readonly cut?: true;
      readonly refused?: string;
    }
  | { readonly kind: "log"; readonly text: string }
  | {
      readonly kind: "end";
      readonly state: string;
      readonly host?: string;
      readonly threw?: string;
      readonly ended?: number;
    };

/** The head as a run begins it: what contracts' FlowJournalHead names, without what fieldd adds. */
export type FlowJournalHeadEntry = Pick<
  FlowJournalHead,
  "run" | "flow" | "name" | "n" | "hash" | "starter" | "input"
>;

/** Where a journal stands: its last line's seq and mac (the next line's `prev`). */
export interface JournalTail {
  readonly seq: number;
  readonly mac: string;
}

/** What a journal's text says:
 * - `kept`: every whole line verified, in its order, the head first and naming this run;
 * - `lost`: a line is not VibeField's (it does not parse, is unsigned, does not verify or is out of its place), so the
 *   run is set aside, never replayed (`line`: the first that failed, from 1);
 * - `newer`: a newer VibeField wrote it; kept for it, never read as this one. */
export type JournalVerdict =
  | {
      readonly kind: "kept";
      readonly head: FlowJournalHead;
      readonly lines: readonly FlowJournalKnownLine[];
      readonly tail: JournalTail;
    }
  | { readonly kind: "lost"; readonly why: SetAsideWhy; readonly line: number }
  | { readonly kind: "newer"; readonly format: number };

/** What a line's MAC is over. */
export function journalMacInput(
  _run: FlowRunId,
  _prev: string,
  _line: Record<string, unknown>,
): unknown {
  return {};
}

/** Read a journal's text. `verifies` is the store's signer's check. A last piece with no newline after it is a line the
 * disk never finished (a crash mid-write): not a line, never served, and no proof of anything. */
export function readJournal(
  _text: string,
  _run: FlowRunId,
  _verifies: (unsigned: unknown, mac: string) => boolean,
  _ownFormat: number,
): JournalVerdict {
  return { kind: "lost", why: "unreadable", line: 0 };
}
