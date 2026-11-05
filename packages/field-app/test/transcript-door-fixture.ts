/**
 * TH-1 — a window's transcript door, scripted, for the suites that mount Chat's controller (`ChatView`): fieldd's ticket
 * and the worker's socket in place (`chat/transcript-port.ts`'s `TranscriptDoor`). A spark's record is what the test
 * keeps for it — its runs and their raw lines — served on open as the worker serves them (`ready`, each line after the
 * one named, `caught-up`), and a line said later reaches every socket open on that spark, as the worker's tail does. A
 * spark the test keeps nothing for has an empty record: its ticket names no run, so nothing is dialled. The reader's
 * own rules (backoff, slow `ready`, refusals) are `transcript-port.test.ts`'s.
 */

import type { SparkId, SparkTranscriptRun } from "@vibefield/contracts";
import type { TranscriptDoor, TranscriptSocket } from "../src/chat/transcript-port";

interface OpenFrame {
  readonly type: "open";
  readonly runs: readonly { readonly run: string; readonly after?: number }[];
}

class ScriptedSocket implements TranscriptSocket {
  closed = false;
  private readonly listeners = new Map<string, ((event: { readonly data: unknown }) => void)[]>();
  constructor(private readonly opened: (socket: ScriptedSocket, frame: OpenFrame) => void) {
    // the socket opens once the reader has listened, as a WebSocket's does
    queueMicrotask(() => this.fire("open"));
  }
  send(data: string): void {
    const frame = JSON.parse(data) as { readonly type?: unknown };
    if (frame.type === "open") this.opened(this, frame as OpenFrame);
  }
  close(): void {
    this.closed = true;
  }
  addEventListener(type: string, listener: (event: { readonly data: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, frame?: unknown): void {
    if (this.closed) return;
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data: frame === undefined ? undefined : JSON.stringify(frame) });
  }
}

interface Kept {
  readonly runs: SparkTranscriptRun[];
  readonly lines: Map<string, unknown[]>;
}

const ENDPOINT = "ws://127.0.0.1:1/transcripts";

export interface ScriptedTranscripts {
  readonly door: TranscriptDoor;
  /** the sparks a ticket was asked for, in order */
  readonly asked: SparkId[];
  /** a spark's record: its runs, oldest first, and each run's raw lines */
  keep(
    spark: SparkId,
    runs: readonly SparkTranscriptRun[],
    lines: ReadonlyMap<string, readonly unknown[]>,
  ): void;
  /** a line kept in one of `spark`'s runs after its readers caught up: the worker's tail hands it on */
  say(spark: SparkId, run: string, line: unknown): void;
  /** fieldd refuses the next tickets in these words, until null */
  refuse(reason: string | null): void;
}

export function scriptedTranscripts(): ScriptedTranscripts {
  const records = new Map<SparkId, Kept>();
  const open = new Map<SparkId, Set<ScriptedSocket>>();
  const asked: SparkId[] = [];
  let refusal: string | null = null;
  const recordOf = (spark: SparkId): Kept => {
    let record = records.get(spark);
    if (record === undefined) {
      record = { runs: [], lines: new Map() };
      records.set(spark, record);
    }
    return record;
  };
  const seqOf = (line: unknown): number =>
    typeof line === "object" && line !== null && typeof (line as { seq?: unknown }).seq === "number"
      ? (line as { seq: number }).seq
      : 0;
  const door: TranscriptDoor = {
    openTicket: async (spark) => {
      asked.push(spark);
      if (refusal !== null) throw new Error(refusal);
      return {
        spark,
        // the fixture's endpoint names the spark, so the socket it dials serves that spark's record
        endpoint: `${ENDPOINT}?spark=${encodeURIComponent(spark)}`,
        ticket: "VGhlRml4dHVyZVRyYW5zY3JpcHRUaWNrZXRfMDAwMDE",
        expiresAt: Date.now() + 60_000,
        generation: 1,
        runs: [...recordOf(spark).runs],
      };
    },
    connect: (endpoint) => {
      const spark = new URL(endpoint).searchParams.get("spark") ?? "";
      return new ScriptedSocket((socket, frame) => {
        const record = recordOf(spark);
        socket.fire("message", { type: "ready", generation: 1 });
        for (const { run, after } of frame.runs) {
          for (const line of record.lines.get(run) ?? []) {
            if (after === undefined || seqOf(line) > after)
              socket.fire("message", { type: "line", run, line });
          }
        }
        socket.fire("message", { type: "caught-up", dropped: 0 });
        const sockets = open.get(spark) ?? new Set();
        sockets.add(socket);
        open.set(spark, sockets);
      });
    },
    onReconnected: () => () => undefined,
  };
  return {
    door,
    asked,
    keep: (spark, runs, lines) => {
      const record = recordOf(spark);
      record.runs.splice(0, record.runs.length, ...runs);
      record.lines.clear();
      for (const [run, each] of lines) record.lines.set(run, [...each]);
    },
    say: (spark, run, line) => {
      const record = recordOf(spark);
      record.lines.set(run, [...(record.lines.get(run) ?? []), line]);
      for (const socket of open.get(spark) ?? [])
        socket.fire("message", { type: "line", run, line });
    },
    refuse: (reason) => {
      refusal = reason;
    },
  };
}

/** A door every spark's record is empty behind: the flow draws at once, with nothing dialled. */
export const NO_TRANSCRIPTS: TranscriptDoor = scriptedTranscripts().door;

/** A record line as fieldd writes one (`spark-transcript.ts`): its head, then its kind's fields. The MAC is the
 * worker's to check and never the window's, so any well-formed value stands. */
export function transcriptLine(
  seq: number,
  kind: string,
  at: string,
  fields: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { v: 1, seq, mac: "0".repeat(64), kind, at, ...fields };
}
