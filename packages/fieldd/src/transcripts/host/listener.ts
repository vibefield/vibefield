import { once } from "node:events";
import { open, readdir } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import {
  RECORD_STORES,
  SPARK_TRANSCRIPT,
  SparkTranscriptOpen,
  type SparkTranscriptRun,
  type SparkTranscriptServerFrame,
} from "@vibefield/contracts";
import { type WebSocket, WebSocketServer } from "ws";
import {
  isKeptRunId,
  isKeptSparkId,
  type LineVerifier,
  RUN_FILE_SUFFIX,
  readLines,
  runOfFile,
} from "../../spark-transcript-lines";
import { type TicketRegistration, TRANSCRIPT_PATH } from "../protocol";

// TH-1 (TH0-Q5 (b)) — THE TRANSCRIPT WORKER'S LISTENER. One loopback WebSocket server (`/transcripts`), each socket one
// window reading one spark's runs:
// - a socket's first frame is `open {ticket, runs}`: the ticket fieldd registered (single use; redeemable until its
//   `expiresAt`, which bounds redemption alone — an open socket has no timer, the files erratum of 2026-10-07), each
//   run one of that spark's files. A foreign Origin, a ticket unknown, used or expired, a run not the spark's, a frame
//   that is not an `open` are each refused in the worker's word, and the socket closes;
// - then `ready {generation}`, each named run's verified lines after the seq the window holds, `caught-up {dropped}`,
//   and the tail: a run's file that grew (fieldd's `appended` nudge) serves its next lines; a run of the spark begun
//   after the open is announced (`run`) and served from its start;
// - every line is read from the spark's folder and verified under the key fieldd handed on the pipe
//   (`spark-transcript-lines.ts`): one that fails is never served, only counted;
// - item 172's rule: a read the disk does not answer is tried RECORD_STORES.READ_TRIES times; past the last, an open
//   is never answered as nothing — the socket closes before `caught-up`, said in the log, and the window's next ticket
//   hears fieldd's own refusal (`records-unreadable`) while the disk still does not answer. A tail's read that fails
//   stops where it is, and the next nudge reads on from there.
// Read-only: the listener never writes, renames or sets aside (fieldd's store does).

/** The worker's own bounds. */
export const TRANSCRIPT_HOST_LIMITS = {
  /** sockets at once, every window's */
  SOCKETS_MAX: 64,
  /** tickets registered and not yet redeemed */
  TICKETS_MAX: 256,
  /** the one frame a window sends */
  OPEN_BYTES: 64 * 1024,
  /** one read of a run's file */
  READ_CHUNK_BYTES: 1024 * 1024,
  /** a socket whose window is this far behind is closed; it asks again */
  SOCKET_BUFFER_BYTES: 16 * 1024 * 1024,
} as const;

/** What the listener refuses with, in the contract's open words. */
export type TranscriptRefusal =
  | "ticket-unknown"
  | "ticket-used"
  | "ticket-expired"
  | "origin"
  | "run-unknown"
  | "malformed"
  | "busy";

/** A registration the worker will not hold. */
export class HostFailure extends Error {
  constructor(
    readonly code: "busy" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

/** A read the disk did not answer, past RECORD_STORES.READ_TRIES tries (`code`: its last errno). */
class DiskUnanswered extends Error {
  constructor(readonly code: string) {
    super(`the disk did not answer (${code})`);
  }
}

const codeOf = (error: unknown): string => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && code !== "" ? code : "EIO";
};

/** `read`, tried RECORD_STORES.READ_TRIES times while the disk does not answer (RecordSigner's rule): undefined for
 * nothing there (ENOENT; ENOTDIR, a file where its folder would be) or for a folder where a run's file is (EISDIR: not
 * a record; fieldd's store sets it aside), else its answer; past the last try, DiskUnanswered. */
async function tried<T>(read: () => Promise<T>): Promise<T | undefined> {
  let code = "EIO";
  for (let attempt = 0; attempt < RECORD_STORES.READ_TRIES; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      code = codeOf(error);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return undefined;
    }
  }
  throw new DiskUnanswered(code);
}

interface Ticket extends TicketRegistration {
  timer: NodeJS.Timeout | null;
  used: boolean;
}

interface RunCursor {
  /** bytes of the file read so far */
  offset: number;
  /** the bytes after the last newline read: a line still being written, kept as bytes so a character split across
   * two reads is never decoded in halves */
  rest: Buffer;
  /** the highest seq that verified */
  seen: number;
  /** the last seq the window holds: lines at or below it are passed over unserved */
  readonly after: number;
  /** a read of this run is under way: a nudge meanwhile asks it to read on once more */
  reading: Promise<void> | null;
  again: boolean;
}

const cursorAt = (offset = 0, seen = 0, after = 0): RunCursor => ({
  offset,
  rest: Buffer.alloc(0),
  seen,
  after,
  reading: null,
  again: false,
});

interface Reader {
  readonly socket: WebSocket;
  readonly spark: string;
  readonly clientId: string;
  readonly ticket: string;
  readonly runs: Map<string, RunCursor>;
  /** the open's lines are served: the tail may speak */
  caughtUp: boolean;
}

export interface TranscriptListenerOptions {
  /** LAYOUT.SPARK_FILES_DIR, absolute */
  readonly dir: string;
  readonly verify: LineVerifier;
  /** the Origins a window may send; a socket with no Origin is a client of this machine's own */
  readonly allowedOrigins: readonly string[];
  readonly generation: number;
  /** test seam; production listens on an ephemeral port */
  readonly port?: number;
  readonly now?: () => number;
  readonly onLog?: (event: string, message: string, fields?: Record<string, unknown>) => void;
}

export class TranscriptListener {
  readonly #server: WebSocketServer;
  readonly #opts: TranscriptListenerOptions;
  readonly #now: () => number;
  readonly #tickets = new Map<string, Ticket>();
  readonly #readers = new Set<Reader>();
  #stopped = false;

  private constructor(server: WebSocketServer, opts: TranscriptListenerOptions) {
    this.#server = server;
    this.#opts = opts;
    this.#now = opts.now ?? Date.now;
    server.on("connection", (socket, request) => this.#connect(socket, request));
    server.on("error", () => void this.close());
  }

  static async start(opts: TranscriptListenerOptions): Promise<TranscriptListener> {
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port: opts.port ?? 0,
      maxPayload: TRANSCRIPT_HOST_LIMITS.OPEN_BYTES,
      perMessageDeflate: false,
    });
    const listener = new TranscriptListener(server, opts);
    await once(server, "listening");
    return listener;
  }

  get port(): number {
    const address = this.#server.address();
    if (typeof address === "string" || address === null)
      throw new Error("the transcript listener is not ready");
    return address.port;
  }

  register(ask: TicketRegistration): void {
    if (this.#stopped || ask.expiresAt <= this.#now())
      throw new HostFailure("invalid", "ticket expired");
    if (!isKeptSparkId(ask.spark)) throw new HostFailure("invalid", "not a spark's id");
    if (this.#tickets.has(ask.ticket)) throw new HostFailure("invalid", "duplicate ticket");
    if (this.#tickets.size >= TRANSCRIPT_HOST_LIMITS.TICKETS_MAX)
      throw new HostFailure("busy", "the transcript worker holds no more tickets");
    const ticket: Ticket = { ...ask, used: false, timer: null };
    // an unredeemed ticket goes at its expiry; a redeemed one is kept until then, to say it was used
    ticket.timer = setTimeout(() => this.#tickets.delete(ask.ticket), ask.expiresAt - this.#now());
    ticket.timer.unref?.();
    this.#tickets.set(ask.ticket, ticket);
  }

  closeTicket(clientId: string, ticket: string): boolean {
    let closed = false;
    const held = this.#tickets.get(ticket);
    if (held !== undefined && held.clientId === clientId) {
      this.#forget(held);
      closed = true;
    }
    for (const reader of this.#readers)
      if (reader.clientId === clientId && reader.ticket === ticket) {
        reader.socket.close(1000, "closed");
        closed = true;
      }
    return closed;
  }

  revokeClient(clientId: string): void {
    for (const ticket of this.#tickets.values())
      if (ticket.clientId === clientId) this.#forget(ticket);
    for (const reader of this.#readers)
      if (reader.clientId === clientId) reader.socket.close(1008, "revoked");
  }

  /** fieldd wrote a line to `run` of `spark`: each reader of that spark reads on, or hears of the run. */
  appended(spark: string, run: string): void {
    if (!isKeptSparkId(spark) || !isKeptRunId(run)) return;
    for (const reader of this.#readers) {
      if (reader.spark !== spark || !reader.caughtUp) continue;
      const cursor = reader.runs.get(run);
      if (cursor !== undefined) this.#readOn(reader, run, cursor);
      else void this.#announce(reader, run);
    }
  }

  async close(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const ticket of this.#tickets.values()) if (ticket.timer) clearTimeout(ticket.timer);
    this.#tickets.clear();
    for (const reader of this.#readers) reader.socket.terminate();
    this.#readers.clear();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #forget(ticket: Ticket): void {
    if (ticket.timer) clearTimeout(ticket.timer);
    this.#tickets.delete(ticket.ticket);
  }

  #send(socket: WebSocket, frame: SparkTranscriptServerFrame): void {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > TRANSCRIPT_HOST_LIMITS.SOCKET_BUFFER_BYTES) {
      // a window this far behind reads nothing more on this socket; it asks again and catches up from what it holds
      socket.close(1013, "behind");
      return;
    }
    socket.send(JSON.stringify(frame));
  }

  #refuse(socket: WebSocket, reason: TranscriptRefusal): void {
    this.#send(socket, { type: "refused", reason });
    socket.close(1008, reason);
  }

  #connect(socket: WebSocket, request: IncomingMessage): void {
    socket.on("error", () => socket.terminate());
    if (this.#stopped || request.url !== TRANSCRIPT_PATH) {
      socket.terminate();
      return;
    }
    if (this.#server.clients.size > TRANSCRIPT_HOST_LIMITS.SOCKETS_MAX) {
      this.#refuse(socket, "busy");
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !this.#opts.allowedOrigins.includes(origin)) {
      this.#refuse(socket, "origin");
      return;
    }
    const timeout = setTimeout(() => socket.terminate(), SPARK_TRANSCRIPT.OPEN_TIMEOUT_MS);
    timeout.unref?.();
    socket.once("close", () => clearTimeout(timeout));
    let opened = false;
    socket.on("message", (data, binary) => {
      if (opened) {
        // the window speaks once; anything after its open is no part of the wire
        this.#refuse(socket, "malformed");
        return;
      }
      opened = true;
      clearTimeout(timeout);
      if (binary) {
        this.#refuse(socket, "malformed");
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(String(data));
      } catch {
        this.#refuse(socket, "malformed");
        return;
      }
      void this.#open(socket, value);
    });
  }

  async #open(socket: WebSocket, value: unknown): Promise<void> {
    const parsed = SparkTranscriptOpen.safeParse(value);
    if (!parsed.success) {
      this.#refuse(socket, "malformed");
      return;
    }
    const ticket = this.#tickets.get(parsed.data.ticket);
    if (ticket === undefined) {
      this.#refuse(socket, "ticket-unknown");
      return;
    }
    if (ticket.used) {
      this.#refuse(socket, "ticket-used");
      return;
    }
    if (ticket.expiresAt <= this.#now()) {
      this.#forget(ticket);
      this.#refuse(socket, "ticket-expired");
      return;
    }
    // consumed before any await: a replay in the same moment cannot win
    ticket.used = true;
    const folder = join(this.#opts.dir, ticket.spark);
    const asked = new Map<string, number>();
    for (const { run, after } of parsed.data.runs) {
      if (!isKeptRunId(run) || asked.has(run)) {
        this.#refuse(socket, "run-unknown");
        return;
      }
      asked.set(run, after ?? 0);
    }
    try {
      await this.#serveOpen(socket, ticket, folder, asked);
    } catch (error) {
      // never answered as nothing: no `caught-up`; the window asks again, and fieldd's door says what it cannot read
      this.#opts.onLog?.(
        "fieldd.transcripts.worker_unreadable",
        "The transcript worker could not read a spark's runs; the window's open was closed before it caught up",
        { spark: ticket.spark, code: error instanceof DiskUnanswered ? error.code : "internal" },
      );
      socket.close(1011, "unreadable");
    }
  }

  /** An open's reading, once its ticket is spent: the runs it names, served, then `caught-up` and the tail. */
  async #serveOpen(
    socket: WebSocket,
    ticket: Ticket,
    folder: string,
    asked: ReadonlyMap<string, number>,
  ): Promise<void> {
    const before = new Set(await this.#runsIn(folder));
    for (const run of asked.keys())
      if (!before.has(run)) {
        this.#refuse(socket, "run-unknown");
        return;
      }
    if (socket.readyState !== socket.OPEN) return;
    const reader: Reader = {
      socket,
      spark: ticket.spark,
      clientId: ticket.clientId,
      ticket: ticket.ticket,
      runs: new Map(),
      caughtUp: false,
    };
    this.#readers.add(reader);
    socket.once("close", () => this.#readers.delete(reader));
    this.#send(socket, { type: "ready", generation: this.#opts.generation });
    let dropped = 0;
    for (const [run, after] of asked) {
      const cursor = cursorAt(0, 0, after);
      reader.runs.set(run, cursor);
      dropped += await this.#serve(reader, run, cursor, true);
    }
    // the spark's other runs the window did not name stand where they end now: it asks for them with a ticket of its
    // own (its earlier conversations); a run begun after this open is announced (`run`) and served from its start
    for (const run of before)
      if (!asked.has(run)) reader.runs.set(run, await this.#endOf(reader.spark, run));
    this.#send(socket, { type: "caught-up", dropped });
    reader.caughtUp = true;
    // what was written while the open was being served: each run read on once, each new run announced (a folder the
    // disk does not answer now is the tail's: the next nudge announces what it holds)
    for (const [run, cursor] of reader.runs) this.#readOn(reader, run, cursor);
    const since = await this.#runsIn(folder).catch(() => [] as string[]);
    for (const run of since) if (!reader.runs.has(run)) void this.#announce(reader, run);
  }

  /** The runs a spark's folder holds, by their files' names; none for a folder that is not there. A folder the disk
   * does not answer throws DiskUnanswered. */
  async #runsIn(folder: string): Promise<string[]> {
    return ((await tried(() => readdir(folder))) ?? []).flatMap((name) => {
      const run = runOfFile(name);
      return run === undefined ? [] : [run];
    });
  }

  /** A cursor at the end of a run's file as it stands, its last whole line's: what is written after is served. */
  async #endOf(spark: string, run: string): Promise<RunCursor> {
    const path = join(this.#opts.dir, spark, `${run}${RUN_FILE_SUFFIX}`);
    const end = await tried(async () => {
      const file = await open(path, "r");
      try {
        const { size } = await file.stat();
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await file.read(buffer, 0, size, 0);
        const last = buffer.subarray(0, bytesRead).lastIndexOf(0x0a) + 1;
        const read = readLines(
          buffer.subarray(0, last).toString("utf8"),
          spark,
          run,
          this.#opts.verify,
        );
        return cursorAt(last, read.seen);
      } finally {
        await file.close().catch(() => undefined);
      }
    });
    // gone since it was listed (set aside): what is written there anew is served from its start
    return end ?? cursorAt();
  }

  /** Serve `run`'s lines from the cursor to the file's end, past what the window holds; the count of lines that
   * failed their check. Each read is tried RECORD_STORES.READ_TRIES times. For an open (`opening`), a read the disk
   * does not answer throws DiskUnanswered, so the open is never answered as nothing; for the tail it stops here, and
   * the next nudge reads on from the same place. */
  async #serve(reader: Reader, run: string, cursor: RunCursor, opening = false): Promise<number> {
    try {
      return await this.#serveFrom(reader, run, cursor);
    } catch (error) {
      if (opening) throw error;
      // the tail's: what was read stands, and the next nudge reads on
      return 0;
    }
  }

  async #serveFrom(reader: Reader, run: string, cursor: RunCursor): Promise<number> {
    let dropped = 0;
    const file = await tried(() =>
      open(join(this.#opts.dir, reader.spark, `${run}${RUN_FILE_SUFFIX}`), "r"),
    );
    // not there (set aside since it was listed): nothing to serve
    if (file === undefined) return 0;
    try {
      for (;;) {
        const buffer = Buffer.alloc(TRANSCRIPT_HOST_LIMITS.READ_CHUNK_BYTES);
        const chunk = await tried(() => file.read(buffer, 0, buffer.length, cursor.offset));
        if (chunk === undefined) break;
        const { bytesRead } = chunk;
        if (bytesRead === 0) break;
        cursor.offset += bytesRead;
        const bytes = Buffer.concat([cursor.rest, buffer.subarray(0, bytesRead)]);
        const end = bytes.lastIndexOf(0x0a) + 1;
        cursor.rest = Buffer.from(bytes.subarray(end));
        const read = readLines(
          bytes.subarray(0, end).toString("utf8"),
          reader.spark,
          run,
          this.#opts.verify,
          { after: cursor.after, seen: cursor.seen },
        );
        cursor.seen = read.seen;
        dropped += read.dropped;
        for (const line of read.lines) this.#send(reader.socket, { type: "line", run, line });
        if (bytesRead < buffer.length) break;
      }
    } finally {
      await file.close().catch(() => undefined);
    }
    return dropped;
  }

  #readOn(reader: Reader, run: string, cursor: RunCursor): void {
    if (cursor.reading !== null) {
      cursor.again = true;
      return;
    }
    cursor.reading = (async () => {
      do {
        cursor.again = false;
        await this.#serve(reader, run, cursor);
      } while (cursor.again);
    })().finally(() => {
      cursor.reading = null;
    });
  }

  /** A run of the reader's spark the window has not heard of: announced by its first line that verifies, then
   * served from its start. */
  async #announce(reader: Reader, run: string): Promise<void> {
    if (reader.runs.has(run)) return;
    const cursor = cursorAt();
    reader.runs.set(run, cursor);
    let head: SparkTranscriptRun | undefined;
    try {
      head = await tried(async () => {
        const file = await open(
          join(this.#opts.dir, reader.spark, `${run}${RUN_FILE_SUFFIX}`),
          "r",
        );
        try {
          const buffer = Buffer.alloc(64 * 1024);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
          const [first] = readLines(`${firstLine}\n`, reader.spark, run, this.#opts.verify).lines;
          return first === undefined
            ? undefined
            : {
                runtimeRunId: run,
                startedAt: first.at,
                fresh: first.kind === "run" && first.fresh,
              };
        } finally {
          await file.close().catch(() => undefined);
        }
      });
    } catch {
      // the disk did not answer (READ_TRIES tries): the tail's, so the next nudge asks again
    }
    if (head === undefined) {
      reader.runs.delete(run);
      return;
    }
    this.#send(reader.socket, { type: "run", run: head });
    this.#readOn(reader, run, cursor);
  }
}
