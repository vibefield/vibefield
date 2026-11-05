/**
 * TH-1 — the spark's transcript, read (`chat/transcript-port.ts`; TH-Q30 (a′), EL2): a ticket from fieldd, the
 * worker's socket dialled by the window itself, the latest conversation's runs named after the lines held, verified
 * lines in and `caught-up`, then the tail; a closed socket, a slow `ready` or a refused ticket asked again. The door
 * is a fake, the frames the contracts' own fixtures (EL9, the window's side).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SPARK_TRANSCRIPT, type SparkTranscriptOpenTicketResult } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  latestConversationOf,
  readTranscript,
  type TranscriptDoor,
  type TranscriptReading,
  type TranscriptSocket,
  transcriptDoorOver,
  transcriptReadingOf,
} from "../src/chat/transcript-port";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = <T = Record<string, unknown>>(name: string): T =>
  JSON.parse(readFileSync(join(here, "../../contracts/fixtures", `${name}.json`), "utf8")) as T;

const TICKET = fixture<SparkTranscriptOpenTicketResult>("spark-transcript-ticket.valid");
const SPARK = TICKET.spark;
const [FIRST, LATEST] = TICKET.runs as [
  SparkTranscriptOpenTicketResult["runs"][number],
  SparkTranscriptOpenTicketResult["runs"][number],
];
const line = (name: string) => fixture(`spark-transcript-line.${name}`);

class FakeSocket implements TranscriptSocket {
  readonly sent: unknown[] = [];
  closed = false;
  private readonly listeners = new Map<string, ((event: { data: unknown }) => void)[]>();
  constructor(readonly endpoint: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data: data === undefined ? undefined : JSON.stringify(data) });
  }
}

function doorOf(answers: (() => Promise<SparkTranscriptOpenTicketResult>)[] = []) {
  const sockets: FakeSocket[] = [];
  const reconnected: (() => void)[] = [];
  const openTicket = vi.fn(async () => {
    const next = answers.shift();
    return next === undefined ? TICKET : next();
  });
  const door: TranscriptDoor = {
    openTicket,
    connect: (endpoint) => {
      const socket = new FakeSocket(endpoint);
      sockets.push(socket);
      return socket;
    },
    onReconnected: (listener) => {
      reconnected.push(listener);
      return () => reconnected.splice(reconnected.indexOf(listener), 1);
    },
  };
  return { door, openTicket, sockets, reconnected };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

/** The socket a reader dialled, opened and ready, its runs' lines served and caught up. */
async function caughtUp(
  socket: FakeSocket | undefined,
  lines: [string, Record<string, unknown>][],
  dropped = 0,
) {
  if (socket === undefined) throw new Error("no socket dialled");
  socket.fire("open");
  socket.fire("message", { type: "ready", generation: 2 });
  for (const [run, each] of lines) socket.fire("message", { type: "line", run, line: each });
  socket.fire("message", { type: "caught-up", dropped });
  await flush();
}

const linesIn = (reading: TranscriptReading | undefined, run: string) =>
  reading?.state === "ready" ? (reading.lines.get(run) ?? []).map((each) => each.seq) : null;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the reader (TH-Q30 (a′))", () => {
  it("dials the ticket's endpoint, names the latest conversation's runs, and draws once caught up", async () => {
    const { door, sockets } = doorOf();
    const published: TranscriptReading[] = [];
    const stop = readTranscript(SPARK, door, false, (reading) => published.push(reading));
    await flush();
    expect(published).toEqual([{ state: "reading" }]);
    const socket = sockets[0];
    expect(socket?.endpoint).toBe(TICKET.endpoint);
    await caughtUp(
      socket,
      [
        [LATEST.runtimeRunId, line("run")],
        [LATEST.runtimeRunId, line("you")],
        [LATEST.runtimeRunId, line("unknown-kind")],
        [LATEST.runtimeRunId, line("you")],
      ],
      1,
    );
    // the first run is fresh and the second resumes it: one conversation, both named, neither after a line yet
    expect(socket?.sent).toEqual([
      {
        type: "open",
        ticket: TICKET.ticket,
        runs: [{ run: FIRST.runtimeRunId }, { run: LATEST.runtimeRunId }],
      },
    ]);
    const last = published.at(-1);
    // the unknown kind is passed over, the repeat too
    expect(linesIn(last, LATEST.runtimeRunId)).toEqual([1, 2]);
    expect(last?.state === "ready" && [last.dropped, last.whole, last.runs.length]).toEqual([
      1,
      false,
      2,
    ]);
    stop();
  });

  it("hears the tail after caught-up, one reading a burst, and a run begun since", async () => {
    const { door, sockets } = doorOf();
    const published: TranscriptReading[] = [];
    readTranscript(SPARK, door, false, (reading) => published.push(reading));
    await flush();
    await caughtUp(sockets[0], [[LATEST.runtimeRunId, line("run")]]);
    const before = published.length;
    sockets[0]?.fire("message", { type: "line", run: LATEST.runtimeRunId, line: line("you") });
    sockets[0]?.fire("message", { type: "line", run: LATEST.runtimeRunId, line: line("reply") });
    await flush();
    expect(published.length).toBe(before + 1);
    expect(linesIn(published.at(-1), LATEST.runtimeRunId)).toEqual([1, 2, 7]);
    sockets[0]?.fire("message", fixture("spark-transcript-frame.run"));
    await flush();
    const last = published.at(-1);
    expect(last?.state === "ready" && last.runs.map((run) => run.runtimeRunId)).toEqual([
      FIRST.runtimeRunId,
      LATEST.runtimeRunId,
      "run-01JC4P7M2N",
    ]);
  });

  it("asks a fresh ticket when the socket closes, naming each run after the last line it holds", async () => {
    const { door, sockets, openTicket } = doorOf();
    const published: TranscriptReading[] = [];
    readTranscript(SPARK, door, false, (reading) => published.push(reading));
    await flush();
    await caughtUp(sockets[0], [
      [LATEST.runtimeRunId, line("run")],
      [LATEST.runtimeRunId, line("reply")],
    ]);
    sockets[0]?.fire("close");
    await vi.advanceTimersByTimeAsync(SPARK_TRANSCRIPT.RETRY_MIN_MS - 1);
    expect(openTicket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(openTicket).toHaveBeenCalledTimes(2);
    sockets[1]?.fire("open");
    expect(sockets[1]?.sent).toEqual([
      {
        type: "open",
        ticket: TICKET.ticket,
        runs: [{ run: FIRST.runtimeRunId }, { run: LATEST.runtimeRunId, after: 7 }],
      },
    ]);
    // what was drawn stays drawn meanwhile
    expect(linesIn(published.at(-1), LATEST.runtimeRunId)).toEqual([1, 7]);
  });

  it("drops a socket whose ready is not heard in time, and asks again", async () => {
    const { door, sockets, openTicket } = doorOf();
    readTranscript(SPARK, door, false, () => {});
    await flush();
    sockets[0]?.fire("open");
    await vi.advanceTimersByTimeAsync(SPARK_TRANSCRIPT.OPEN_TIMEOUT_MS);
    expect(sockets[0]?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(SPARK_TRANSCRIPT.RETRY_MIN_MS);
    expect(openTicket).toHaveBeenCalledTimes(2);
  });

  it("says fieldd's refusal with nothing drawn, and asks again when the window's client reconnects", async () => {
    const { door, openTicket, reconnected } = doorOf([
      async () => {
        throw new Error("fieldd isn't running");
      },
    ]);
    const published: TranscriptReading[] = [];
    readTranscript(SPARK, door, false, (reading) => published.push(reading));
    await flush();
    expect(published.at(-1)).toEqual({ state: "unreadable", reason: "fieldd isn't running" });
    for (const listener of reconnected) listener();
    await flush();
    expect(openTicket).toHaveBeenCalledTimes(2);
  });

  it("names every run once the earlier conversations are asked for, and only the latest's before", async () => {
    const earlier = {
      runtimeRunId: "run-earlier01",
      startedAt: "2026-10-30T09:00:00.000Z",
      fresh: true,
    };
    const ticket = { ...TICKET, runs: [earlier, { ...FIRST }, LATEST] };
    for (const whole of [false, true]) {
      const { door, sockets } = doorOf([async () => ticket]);
      readTranscript(SPARK, door, whole, () => {});
      await flush();
      sockets[0]?.fire("open");
      const open = sockets[0]?.sent[0] as { runs: { run: string }[] };
      expect(open.runs.map((each) => each.run)).toEqual(
        whole
          ? ["run-earlier01", FIRST.runtimeRunId, LATEST.runtimeRunId]
          : [FIRST.runtimeRunId, LATEST.runtimeRunId],
      );
    }
  });

  it("stops: the socket closes, and nothing more is published or asked", async () => {
    const { door, sockets, openTicket } = doorOf();
    const published: TranscriptReading[] = [];
    const stop = readTranscript(SPARK, door, false, (reading) => published.push(reading));
    await flush();
    stop();
    expect(sockets[0]?.closed).toBe(true);
    const count = published.length;
    sockets[0]?.fire("close");
    await vi.advanceTimersByTimeAsync(SPARK_TRANSCRIPT.RETRY_MAX_MS);
    expect([published.length, openTicket.mock.calls.length]).toEqual([count, 1]);
  });
});

describe("the conversation's runs (TH0-Q6 (c))", () => {
  it("is the runs from the last fresh start", () => {
    const a = { runtimeRunId: "a", startedAt: "2026-11-01T00:00:00.000Z", fresh: true };
    const b = { runtimeRunId: "b", startedAt: "2026-11-02T00:00:00.000Z", fresh: false };
    const c = { runtimeRunId: "c", startedAt: "2026-11-03T00:00:00.000Z", fresh: true };
    const d = { runtimeRunId: "d", startedAt: "2026-11-04T00:00:00.000Z", fresh: false };
    expect(latestConversationOf([a, b, c, d])).toEqual([c, d]);
    expect(latestConversationOf([a, b])).toEqual([a, b]);
    expect(latestConversationOf([])).toEqual([]);
  });

  it("reads raw lines as the reader does, for the catalog's plates", () => {
    const reading = transcriptReadingOf(
      [LATEST],
      new Map([
        [LATEST.runtimeRunId, [line("run"), line("you"), line("you"), line("unknown-kind")]],
      ]),
      { dropped: 2 },
    );
    expect(linesIn(reading, LATEST.runtimeRunId)).toEqual([1, 2]);
    expect(reading.state === "ready" && reading.dropped).toBe(2);
  });
});

describe("the window's door", () => {
  it("asks fieldd's ticket door for the spark, and refuses an answer it cannot read", async () => {
    const request = vi.fn(async () => TICKET as unknown);
    const client = {
      request,
      onStatusChange: () => () => {},
      status: "ready",
    } as unknown as FielddClient;
    const door = transcriptDoorOver(client);
    await expect(door.openTicket(SPARK)).resolves.toEqual(TICKET);
    expect(request).toHaveBeenCalledWith("compose.sparks.transcript.openTicket", { spark: SPARK });
    request.mockResolvedValueOnce({ ...TICKET, endpoint: "ws://evil.invalid/transcripts" });
    await expect(door.openTicket(SPARK)).rejects.toThrow();
  });
});
