import { createHmac, timingSafeEqual } from "node:crypto";
import {
  canonicalJson,
  SparkId,
  type SparkTranscriptKnownLine,
  SparkTranscriptLine,
  sparkTranscriptLineOf,
} from "@vibefield/contracts";

// TH-1 — ONE RUN'S FILE, READ (the spark's transcript; `spark-transcripts.ts` writes it, the transcript worker serves
// it). Shared by the daemon's store and the worker, so both read a file by one rule:
// - a line is the contract's (`sparkTranscriptLineOf`), its `mac` the folder key's HMAC-SHA256 over the canonical JSON
//   of {spark, run, line with its own mac left out} (signed-record.ts's form), so a line copied from another spark's or
//   another run's file does not verify here;
// - lines are served in their seq's order: one at or below a seq already served is a replay or a copy, dropped;
// - what does not parse, does not verify or is a replay is DROPPED and counted, never served;
// - the file's last piece, with no newline after it yet, is a line still being written: held, never counted.
// Imports no fs: the store and the worker each read the bytes their own way.

/** The file a run's lines are kept in, in its spark's folder. */
export const RUN_FILE_SUFFIX = ".jsonl";

/** A run id a file may be named by: fieldd's own ids, and nothing that could leave the folder (the input queue's
 * rule, agent-input-queue.ts). */
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const isKeptRunId = (run: string): boolean => SAFE_RUN_ID.test(run);
export const isKeptSparkId = (spark: string): boolean => SparkId.safeParse(spark).success;

/** The run a file name names, or undefined for a file that is not a run's. */
export function runOfFile(name: string): string | undefined {
  if (!name.endsWith(RUN_FILE_SUFFIX)) return undefined;
  const run = name.slice(0, -RUN_FILE_SUFFIX.length);
  return isKeptRunId(run) ? run : undefined;
}

/** What a line's MAC is over. */
export function macInput(spark: string, run: string, line: Record<string, unknown>): unknown {
  const { mac: _mac, ...unsigned } = line;
  return { spark, run, line: unsigned };
}

/** Whether `mac` is the key's for what it signs. */
export type LineVerifier = (unsigned: unknown, mac: string) => boolean;

const HEX_32_BYTES = /^[0-9a-f]{64}$/;

/** A verifier over the folder's key as its bytes: the worker's, handed the key on its pipe. */
export function keyVerifier(key: Buffer): LineVerifier {
  return (unsigned, mac) =>
    HEX_32_BYTES.test(mac) &&
    timingSafeEqual(
      Buffer.from(mac, "hex"),
      createHmac("sha256", key).update(canonicalJson(unsigned)).digest(),
    );
}

export interface ReadLines {
  readonly lines: SparkTranscriptKnownLine[];
  readonly dropped: number;
  /** the highest seq that verified, read or held before: what a read of the next bytes passes as its `seen` */
  readonly seen: number;
  /** the bytes after the last newline: a line still being written */
  readonly rest: string;
}

/** The lines of `text` that verify, in order. `after`: the last seq the reader already holds, passed over unserved.
 * `seen`: the highest seq that verified in the bytes before `text` (a tail's read), so a line at or below it is a
 * replay. */
export function readLines(
  text: string,
  spark: string,
  run: string,
  verify: LineVerifier,
  from: { readonly after?: number; readonly seen?: number } = {},
): ReadLines {
  const after = from.after ?? 0;
  const pieces = text.split("\n");
  const rest = pieces.pop() ?? "";
  const lines: SparkTranscriptKnownLine[] = [];
  let dropped = 0;
  let seen = from.seen ?? 0;
  for (const piece of pieces) {
    if (piece.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(piece);
    } catch {
      dropped += 1;
      continue;
    }
    const head = SparkTranscriptLine.safeParse(parsed);
    if (
      !head.success ||
      !verify(macInput(spark, run, parsed as Record<string, unknown>), head.data.mac) ||
      // a seq at or below one already read is a replay or a copy
      head.data.seq <= seen
    ) {
      dropped += 1;
      continue;
    }
    seen = head.data.seq;
    if (head.data.seq <= after) continue;
    const known = sparkTranscriptLineOf(parsed);
    // a kind or a format this build does not know is passed over: never counted as a failure, never served
    if (known !== undefined) lines.push(known);
  }
  return { lines, dropped, seen, rest };
}

/** The writer's own read of a run's file: the highest seq that verifies, so the next line is that plus one, and the
 * highest format among the lines that verify (item 172's rule: a file a newer VibeField wrote in is never written to
 * by this one; `SPARK_TRANSCRIPT_FORMAT` is this build's). */
export function tailOf(
  text: string,
  spark: string,
  run: string,
  verify: LineVerifier,
): { readonly seq: number; readonly format: number } {
  let seq = 0;
  let format = 0;
  for (const piece of text.split("\n")) {
    if (piece.trim() === "") continue;
    try {
      const parsed = JSON.parse(piece) as Record<string, unknown>;
      const head = SparkTranscriptLine.safeParse(parsed);
      if (!head.success || !verify(macInput(spark, run, parsed), head.data.mac)) continue;
      seq = Math.max(seq, head.data.seq);
      format = Math.max(format, head.data.v);
    } catch {
      // a line that does not parse holds no seq
    }
  }
  return { seq, format };
}
