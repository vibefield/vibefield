import {
  SPARK_TRANSCRIPT,
  type SparkId,
  type SparkTranscriptKnownLine,
  SparkTranscriptOpenTicketResult,
  type SparkTranscriptRun,
  SparkTranscriptServerFrame,
  sparkTranscriptLineOf,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useEffect, useRef, useState } from "react";
import { getRendererLogger } from "../logging";
import { onReconnectedOver } from "../reconnect";

// THE SPARK'S TRANSCRIPT, READ (TH-1; TH-Q30 (a′), EL2; DESIGN.md §8 "Chat's thread", the spark's transcript). The
// window asks fieldd for a ticket (`compose.sparks.transcript.openTicket`) and dials the transcript worker's loopback
// endpoint itself: no transcript byte rides fieldd's RPC or Electron main. It names the runs it reads — the latest
// conversation's, or every run once the earlier conversations are asked for — each after the last line it holds, and
// hears every verified line, `caught-up`, then the tail and any run begun since. A socket that closes, a refusal, or a
// `ready` not heard in time asks for a fresh ticket after a backoff, and the lines held stay drawn meanwhile. A ticket
// fieldd refuses is said in fieldd's words, and asked again when the window's client is connected again. Every effect
// comes through the door, so a test drives it without a window.

/** What the flow reads of the spark's record. */
export type TranscriptReading =
  /** first read: no answer yet */
  | { readonly state: "reading" }
  /** fieldd would not give a ticket, in its words; asked again when the window's client reconnects */
  | { readonly state: "unreadable"; readonly reason: string }
  | {
      readonly state: "ready";
      /** the spark's runs, oldest first, as the ticket named them and the worker announced them since */
      readonly runs: readonly SparkTranscriptRun[];
      /** each run's lines this build knows, in order */
      readonly lines: ReadonlyMap<string, readonly SparkTranscriptKnownLine[]>;
      /** lines the worker would not serve: they failed their check */
      readonly dropped: number;
      /** whether every run was asked for, the earlier conversations' too */
      readonly whole: boolean;
    };

/** A WebSocket as the reader uses one: the window's own, or a test's. */
export interface TranscriptSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

/** The world the reader reaches. */
export interface TranscriptDoor {
  /** fieldd's ticket for the spark's record; throws its refusal */
  openTicket(spark: SparkId): Promise<SparkTranscriptOpenTicketResult>;
  /** a socket to the worker's endpoint */
  connect(endpoint: string): TranscriptSocket;
  /** heard each time the window's client is connected again; the answer stops it */
  onReconnected(listener: () => void): () => void;
}

export const READING: TranscriptReading = { state: "reading" };

/** The window's door: fieldd's ticket over its client, the worker's socket dialled by the window itself. */
export function transcriptDoorOver(client: FielddClient): TranscriptDoor {
  return {
    openTicket: async (spark) =>
      SparkTranscriptOpenTicketResult.parse(
        await client.request("compose.sparks.transcript.openTicket", { spark }),
      ),
    connect: (endpoint) => new WebSocket(endpoint),
    onReconnected: onReconnectedOver(client),
  };
}

/** The runs the latest conversation holds: from its last fresh start to the newest. */
export function latestConversationOf(
  runs: readonly SparkTranscriptRun[],
): readonly SparkTranscriptRun[] {
  let start = 0;
  runs.forEach((run, index) => {
    if (run.fresh) start = index;
  });
  return runs.slice(start);
}

/** A reading from runs and their raw lines, read as the reader reads a line frame: a line this build does not know
 * is skipped, and a line at or before the last one held is a repeat. The catalog builds its plates through this. */
export function transcriptReadingOf(
  runs: readonly SparkTranscriptRun[],
  raw: ReadonlyMap<string, readonly unknown[]>,
  { dropped = 0, whole = false }: { dropped?: number; whole?: boolean } = {},
): TranscriptReading {
  const lines = new Map<string, SparkTranscriptKnownLine[]>();
  for (const [run, each] of raw) {
    for (const line of each) take(lines, run, line);
  }
  return { state: "ready", runs, lines, dropped, whole };
}

/** One line into its run's list; false when it is not taken (unknown, or a repeat). */
function take(lines: Map<string, SparkTranscriptKnownLine[]>, run: string, raw: unknown): boolean {
  const line = sparkTranscriptLineOf(raw);
  if (line === undefined) return false;
  const held = lines.get(run) ?? [];
  const last = held[held.length - 1];
  if (last !== undefined && line.seq <= last.seq) return false;
  held.push(line);
  lines.set(run, held);
  return true;
}

const log = () => getRendererLogger().child({ component: "chat.transcript" });

/** Read `spark`'s record for as long as the answer is not called, each reading published as it changes. `whole`: the
 * earlier conversations too. */
export function readTranscript(
  spark: SparkId,
  door: TranscriptDoor,
  whole: boolean,
  publish: (reading: TranscriptReading) => void,
  held: TranscriptReading = READING,
): () => void {
  let stopped = false;
  let socket: TranscriptSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoff: number = SPARK_TRANSCRIPT.RETRY_MIN_MS;
  const runs: SparkTranscriptRun[] = held.state === "ready" ? [...held.runs] : [];
  const lines = new Map<string, SparkTranscriptKnownLine[]>(
    held.state === "ready" ? [...held.lines].map(([run, each]) => [run, [...each]]) : [],
  );
  let dropped = held.state === "ready" ? held.dropped : 0;
  let caught = held.state === "ready";
  let skipped = 0;
  let pending = false;

  const ready = (): TranscriptReading => ({
    state: "ready",
    runs: [...runs],
    lines: new Map([...lines].map(([run, each]) => [run, [...each]])),
    dropped,
    whole,
  });
  // the lines of one catch-up arrive in a burst: one reading for the burst
  const changed = () => {
    if (!caught || pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!stopped) publish(ready());
    });
  };
  const later = () => {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void ask();
    }, backoff);
    backoff = Math.min(backoff * 2, SPARK_TRANSCRIPT.RETRY_MAX_MS);
  };
  const drop = () => {
    const was = socket;
    socket = null;
    was?.close();
  };

  async function ask(): Promise<void> {
    if (stopped) return;
    let ticket: SparkTranscriptOpenTicketResult;
    try {
      ticket = await door.openTicket(spark);
    } catch (error) {
      if (stopped) return;
      const reason = error instanceof Error ? error.message : String(error);
      log().info("renderer.chat.transcript_refused", "fieldd would not open the spark's record", {
        spark,
        reason,
      });
      // what was drawn stays drawn; with nothing drawn, the flow says why
      if (!caught) publish({ state: "unreadable", reason });
      return;
    }
    if (stopped) return;
    for (const run of ticket.runs) {
      if (!runs.some((each) => each.runtimeRunId === run.runtimeRunId)) runs.push(run);
    }
    runs.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const wanted = whole ? runs : latestConversationOf(runs);
    if (wanted.length === 0) {
      // a spark with no run in its record yet: nothing to read, and nothing to tail until a ticket names one
      caught = true;
      publish(ready());
      return;
    }
    const open = door.connect(ticket.endpoint);
    socket = open;
    const deadline = setTimeout(() => {
      if (socket !== open) return;
      log().info("renderer.chat.transcript_slow", "the transcript worker did not answer in time", {
        spark,
      });
      drop();
      later();
    }, SPARK_TRANSCRIPT.OPEN_TIMEOUT_MS);
    open.addEventListener("open", () => {
      if (socket !== open) return;
      open.send(
        JSON.stringify({
          type: "open",
          ticket: ticket.ticket,
          runs: wanted.map((run) => {
            const last = lines.get(run.runtimeRunId)?.at(-1)?.seq;
            return last === undefined
              ? { run: run.runtimeRunId }
              : { run: run.runtimeRunId, after: last };
          }),
        }),
      );
    });
    open.addEventListener("message", (event) => {
      if (socket !== open) return;
      let frame: SparkTranscriptServerFrame;
      try {
        const parsed = SparkTranscriptServerFrame.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) return; // a frame this build does not know: passed over
        frame = parsed.data;
      } catch {
        return;
      }
      switch (frame.type) {
        case "ready":
          clearTimeout(deadline);
          backoff = SPARK_TRANSCRIPT.RETRY_MIN_MS;
          return;
        case "line":
          if (
            !take(lines, frame.run, frame.line) &&
            sparkTranscriptLineOf(frame.line) === undefined
          ) {
            skipped += 1;
            if (skipped === 1)
              log().info(
                "renderer.chat.transcript_line_skipped",
                "a line this build does not read",
                {
                  spark,
                  kind: frame.line.kind,
                },
              );
          }
          changed();
          return;
        case "caught-up":
          dropped = frame.dropped;
          if (!caught) {
            caught = true;
            publish(ready());
          } else changed();
          return;
        case "run":
          if (!runs.some((each) => each.runtimeRunId === frame.run.runtimeRunId))
            runs.push(frame.run);
          changed();
          return;
        case "refused":
          log().info(
            "renderer.chat.transcript_open_refused",
            "the transcript worker refused the open",
            {
              spark,
              reason: frame.reason,
            },
          );
          return;
      }
    });
    const closed = () => {
      if (socket !== open) return;
      clearTimeout(deadline);
      socket = null;
      later();
    };
    open.addEventListener("close", closed);
    open.addEventListener("error", closed);
  }

  const stopReconnect = door.onReconnected(() => {
    if (!caught && socket === null) {
      backoff = SPARK_TRANSCRIPT.RETRY_MIN_MS;
      void ask();
    }
  });
  if (held.state !== "ready") publish(READING);
  void ask();
  return () => {
    stopped = true;
    stopReconnect();
    if (timer !== null) clearTimeout(timer);
    drop();
  };
}

/** The shown spark's record as the flow reads it, or null with no spark or no door (a window that reads none). */
export function useSparkTranscript(
  spark: SparkId | null,
  door: TranscriptDoor | null,
  whole: boolean,
): TranscriptReading | null {
  const [reading, setReading] = useState<{
    readonly spark: SparkId;
    readonly reading: TranscriptReading;
  } | null>(null);
  // the lines held for this spark stay drawn while the earlier conversations are asked for
  const last = useRef(reading);
  last.current = reading;
  useEffect(() => {
    if (spark === null || door === null) return;
    const now = last.current;
    return readTranscript(
      spark,
      door,
      whole,
      (next) => setReading({ spark, reading: next }),
      now?.spark === spark ? now.reading : READING,
    );
  }, [spark, door, whole]);
  if (spark === null || door === null) return null;
  return reading?.spark === spark ? reading.reading : READING;
}
