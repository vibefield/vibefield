import {
  FLOW_LIMITS,
  type FlowJournalHead,
  type FlowJournalKnownLine,
  type FlowRunId,
  flowJournalLineOf,
} from "@vibefield/contracts";
import type { SetAsideWhy } from "../signed-record";
import { nestsWithin } from "./protocol";

// CP-4a2a (CP4-S15, CP-D9; 4A2-Q10 (a), ruled by VF-PM 2026-11-05 08:51Z) — a run's journal, its lines: one JSONL file
// per run under the flows store (`runs/<run>.jsonl` in LAYOUT.FLOWS_DIR, flows/records.ts keeps it), written by fieldd
// alone. Each line carries `mac`: the flows store's record signer's HMAC over the canonical JSON of {run, prev, line
// without its mac}, `prev` the line before's mac ("" for the head), so a line copied from another run, dropped or moved
// breaks the chain and its run is set aside as lost. This file is the lines' rule and imports no fs: the store reads
// and writes the file.
//
// A journal's text reads line by line, in item 172's order: a line that does not parse is `unreadable`, one with no
// `mac` `unsigned`, one whose MAC does not verify against the line before it, or whose seq is not its place, or that
// names another run, `forged`. The head is the file's first line; a head a newer VibeField wrote (its MAC verified,
// its format above this build's) is kept for it. A verified line of a kind this build never heard of is passed over,
// never served, and the chain goes on through it (the tolerant reader).
//
// A journal cut short at its end (its last lines taken off) chains as well as a whole one: read alone it is a run that
// stopped mid-step, and its steps after the cut are asked again. The store that wrote it knows its own tail and reads
// the cut as forged (flows/records.ts); across a restart, the anchor that would say so is the run's own signed record,
// CP-4a2b's (bth's review P3, ruled 2026-11-05 11:51Z), and DESIGN.md §9 says it plainly until then.

/** How deep a journal's line may nest: a value at most FLOW_LIMITS.ARGS_DEPTH_MAX deep (replay refuses a deeper
 * answer, journaling the refusal), inside the line's own fields. A line deeper is no line fieldd wrote, and it is read
 * as forged before its MAC is checked, so no recursive read meets it (bth's review P1, ruled 11:46Z and 12:27Z). */
export const JOURNAL_LINE_DEPTH_MAX = FLOW_LIMITS.ARGS_DEPTH_MAX + 4;

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
 * - `kept`: every whole line verified, in its order, the head first and naming this run; `bytes` is where its whole
 *   lines end, so the next line is written there (a piece past it is a line the disk never finished);
 * - `lost`: a line is not VibeField's (it does not parse, is unsigned, does not verify or is out of its place), so the
 *   run is set aside, never replayed (`line`: the first that failed, from 1);
 * - `newer`: a newer VibeField wrote it; kept for it, never read as this one. */
export type JournalVerdict =
  | {
      readonly kind: "kept";
      readonly head: FlowJournalHead;
      readonly lines: readonly FlowJournalKnownLine[];
      readonly tail: JournalTail;
      readonly bytes: number;
    }
  | { readonly kind: "lost"; readonly why: SetAsideWhy; readonly line: number }
  | { readonly kind: "newer"; readonly format: number };

/** What a line's MAC is over. */
export function journalMacInput(
  run: FlowRunId,
  prev: string,
  line: Record<string, unknown>,
): unknown {
  const { mac: _mac, ...unsigned } = line;
  return { run, prev, line: unsigned };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Read a journal's text. `verifies` is the store's signer's check. A last piece with no newline after it is a line the
 * disk never finished (a crash mid-write): not a line, never served, and no proof of anything. */
export function readJournal(
  text: string,
  run: FlowRunId,
  verifies: (unsigned: unknown, mac: string) => boolean,
  ownFormat: number,
): JournalVerdict {
  const pieces = text.split("\n");
  pieces.pop();
  if (pieces.length === 0) return { kind: "lost", why: "unreadable", line: 1 };
  const lines: FlowJournalKnownLine[] = [];
  let head: FlowJournalHead | undefined;
  let prev = "";
  for (const [index, piece] of pieces.entries()) {
    const place = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(piece);
    } catch {
      return { kind: "lost", why: "unreadable", line: place };
    }
    if (!isRecord(parsed)) return { kind: "lost", why: "unreadable", line: place };
    if (!nestsWithin(parsed, JOURNAL_LINE_DEPTH_MAX))
      return { kind: "lost", why: "forged", line: place };
    const mac = parsed["mac"];
    if (typeof mac !== "string") return { kind: "lost", why: "unsigned", line: place };
    let verified: boolean;
    try {
      verified = verifies(journalMacInput(run, prev, parsed), mac);
    } catch (error) {
      // a line too deep for the MAC's own canonical JSON is no line fieldd wrote; any other throw is the key's
      if (error instanceof RangeError) return { kind: "lost", why: "forged", line: place };
      throw error;
    }
    if (!verified) return { kind: "lost", why: "forged", line: place };
    if (parsed["seq"] !== place) return { kind: "lost", why: "forged", line: place };
    if (place === 1) {
      const format = parsed["format"];
      if (typeof format === "number" && Number.isInteger(format) && format > ownFormat)
        return { kind: "newer", format };
    }
    prev = mac;
    const known = flowJournalLineOf(parsed);
    if (place === 1) {
      if (known?.kind !== "head" || known.run !== run)
        return { kind: "lost", why: "forged", line: place };
      head = known;
    } else if (known?.kind === "head") return { kind: "lost", why: "forged", line: place };
    if (known !== undefined) lines.push(known);
  }
  if (head === undefined) return { kind: "lost", why: "unreadable", line: 1 };
  // a newline never sits inside a UTF-8 sequence, and every verified line is JSON.stringify's (surrogates escaped)
  const bytes = Buffer.byteLength(text.slice(0, text.lastIndexOf("\n") + 1), "utf8");
  return { kind: "kept", head, lines, tail: { seq: pieces.length, mac: prev }, bytes };
}
