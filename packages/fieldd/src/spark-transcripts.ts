import {
  appendFileSync,
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  type ComposeSayChip,
  type CrewId,
  RECORD_STORES,
  SPARK_TRANSCRIPT,
  SPARK_TRANSCRIPT_FORMAT,
  SPARK_TRANSCRIPT_SERVICE,
  type SparkId,
  type SparkTranscriptKnownLine,
  type SparkTranscriptRun,
  sparkTranscriptLineOf,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { markedText, type QueuedInput } from "./agent-input-queue";
import { RpcCallError } from "./native-link";
import { ownLive, type RunEntered, type RunEnteredAgent } from "./run-entry";
import {
  RecordSigner,
  recordsUnreadable,
  type SetAsideWhy,
  StoreGuard,
  setAsideFile,
  UNREADABLE_WORDS,
} from "./signed-record";
import {
  isKeptRunId,
  isKeptSparkId,
  type LineVerifier,
  RUN_FILE_SUFFIX,
  readLines,
  runOfFile,
  tailOf,
} from "./spark-transcript-lines";

// TH-1 — THE SPARK'S TRANSCRIPT, KEPT (TH0-Q1 = O1, VF-PM 2026-11-04 05:01Z; DESIGN.md §8 "Chat's thread", the
// spark's transcript; the line and the wire are contracts' `spark-transcript.ts`). VibeField keeps a spark's
// conversation as its own record, never the vendor's file and never History's (AR-L1): one JSONL file per run,
// `<runtimeRunId>.jsonl`, in the spark's own folder of fieldd's (item 159's, LAYOUT.SPARK_FILES_DIR/<sparkId>), 0600 in
// 0700, beside its kept record and never in its home, which is its agent's cwd.
// - Each line is MAC'd by the folder's one key (SPARK_FILES_KEY_FILE, the kept record's signer) over {spark, run, line},
//   so the spark, the run and the line's place are inside it. A reader drops and counts a line that does not verify,
//   one copied from another file, and a replayed seq (`spark-transcript-lines.ts`, which the worker shares). That holds
//   against an edit; the key is 0600 to the same uid, so it is no wall against an agent that reads it (EL7).
// - Item 172's rule (DESIGN.md §9 "What VibeField keeps, when it cannot read it"; RecordSigner's four kinds, read line
//   by line here, through a StoreGuard of its own): a line that fails its check is never served, only counted; a run's
//   file open to other users is set aside; a file or folder the disk does not hand over after RECORD_STORES.READ_TRIES
//   is left where it is, never served and never written over, said in the log, and the door that reads it refuses in
//   fieldd's words (UNAVAILABLE {spark-transcripts, records-unreadable}), never with an empty list; a run's file that
//   holds a newer VibeField's line is never written to again.
// - Appended, never rewritten: a line once written stands, and what a later line says (an outcome, a reply's last
//   words) is read as the latest by the reader.
// - Kept whole, for the spark's life: it goes when the spark is deleted, which RU-19's ⋯ owns and is unbuilt.
//
// The recorder writes it. It listens to a spark's OWN runs only, as the agent runtime enters them (`entered`), and to
// fieldd's own facts as the daemon hands them: your words as a say queued them (`said`), what the input queue made of
// them (`outcome`), VibeField's acts (`act`), and the calls the tool plane served (`served`). Its agents' runs, plain
// runs and a flow's steps are not recorded at TH-1.

/** A run line is small: the first line of a run's file is read in at most this many bytes. */
const FIRST_LINE_BYTES = 64 * 1024;

/** A tool's `detail`, at most (the contract's bound). */
const DETAIL_MAX = 2_000;

/** A line's body as a writer hands it: its kind's own fields, `at` when it is not now. */
export type TranscriptBody =
  | { readonly kind: "run"; readonly runtimeRunId: string; readonly fresh: boolean }
  | {
      readonly kind: "you";
      readonly via: "chat" | "terminal";
      readonly text: string;
      readonly input?: string | undefined;
      readonly requestId?: string | undefined;
      readonly state?: string | undefined;
      readonly chips?: readonly ComposeSayChip[] | undefined;
    }
  | {
      readonly kind: "outcome";
      readonly of: string;
      readonly state: string;
      readonly reason?: string | undefined;
    }
  | {
      readonly kind: "reply";
      readonly messageId: string;
      readonly turn?: string | undefined;
      readonly text: string;
    }
  | {
      readonly kind: "tool";
      readonly toolCallId: string;
      readonly turn?: string | undefined;
      readonly toolKind: string;
      readonly detail?: string | undefined;
      readonly ours?: true | undefined;
    }
  | {
      readonly kind: "act";
      readonly what: string;
      readonly text: string;
      /** SP-1e2 — the crew a `crew` act names (SPE-Q39 (a)) */
      readonly crew?: CrewId | undefined;
    }
  | { readonly kind: "turn"; readonly edge: string; readonly turn?: string | undefined }
  | { readonly kind: "gap"; readonly since: string };

/** One run's file read back: its lines that verify, in order, and how many did not; or why it could not be read. */
export type TranscriptRead =
  | { readonly lines: readonly SparkTranscriptKnownLine[]; readonly dropped: number }
  | { readonly absent: true }
  | { readonly unavailable: string };

/** A spark's runs as its folder holds them, oldest first. */
export interface TranscriptRuns {
  readonly runs: readonly SparkTranscriptRun[];
}

export interface SparkTranscriptsOptions {
  /** LAYOUT.SPARK_FILES_DIR, absolute: each spark's folder, item 159's */
  readonly dir: string;
  /** LAYOUT.SPARK_FILES_KEY_FILE, absolute: the folder's one key */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
  readonly now?: () => Date;
}

/** A run's file read back, in RecordSigner's four kinds (item 172): its text, whose lines are each checked
 * (`spark-transcript-lines.ts`); why it is not a record and is set aside; the errno of a disk that did not answer; or
 * nothing there. */
type FileRead =
  | { readonly text: string }
  | { readonly why: Extract<SetAsideWhy, "exposed" | "unreadable"> }
  | { readonly absent: true }
  | { readonly unavailable: string };

const errnoOf = (error: unknown): string => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && code !== "" ? code : "EIO";
};

/** Read a run's file by RecordSigner's rule, tried RECORD_STORES.READ_TRIES times while the disk does not answer: one
 * whose mode lets group or others at it is exposed; a folder, or anything else that is not a regular file, is not a
 * record; nothing there (ENOENT, or ENOTDIR: a file where its folder would be) is absent; past the last try, the
 * disk's last word. */
function readTried(path: string, bytes?: number): FileRead {
  let code = "EIO";
  for (let attempt = 0; attempt < RECORD_STORES.READ_TRIES; attempt += 1) {
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return { why: "unreadable" };
      // the mode bits say nothing on win32 (signed-record.ts's rule)
      if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) return { why: "exposed" };
      if (bytes === undefined) return { text: readFileSync(path, "utf8") };
      const fd = openSync(path, "r");
      try {
        const buffer = Buffer.alloc(bytes);
        const read = readSync(fd, buffer, 0, bytes, 0);
        return { text: buffer.subarray(0, read).toString("utf8") };
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      code = errnoOf(error);
      if (code === "ENOENT" || code === "ENOTDIR") return { absent: true };
    }
  }
  return { unavailable: code };
}

/** An object without the fields it leaves undefined: a line says what it holds, and its MAC is over just that. */
function defined(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export class SparkTranscripts {
  readonly #signer: RecordSigner;
  readonly #verify: LineVerifier;
  readonly #logger: Logger;
  /** item 172's guard: the folder listed and a file the disk did not answer refused in fieldd's words, a newer
   * VibeField's run held */
  readonly #guard: StoreGuard;
  readonly #now: () => Date;
  /** each run's next seq, once its file has been read (`spark/run`) */
  readonly #next = new Map<string, number>();
  /** the runs whose file the disk refused, said once each until it answers again */
  readonly #refused = new Set<string>();
  readonly #listeners = new Set<
    (spark: SparkId, run: string, line: SparkTranscriptKnownLine) => void
  >();

  constructor(readonly opts: SparkTranscriptsOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
    this.#signer = new RecordSigner({ keyPath: opts.keyPath, logger: this.#logger });
    this.#verify = (unsigned, mac) => this.#signer.verifies(unsigned, mac);
    this.#guard = new StoreGuard({
      store: "spark-transcripts",
      format: SPARK_TRANSCRIPT_FORMAT,
      refusal: () =>
        recordsUnreadable(SPARK_TRANSCRIPT_SERVICE.SERVICE, UNREADABLE_WORDS.transcripts, true),
      logger: this.#logger,
    });
  }

  /** The folder's key, for the transcript worker that verifies each line it serves: handed on its IPC pipe, never in
   * its environment (EL7). */
  secret(): Buffer {
    return this.#signer.secret();
  }

  /** Each line as it is written, for the worker's tail (the daemon hands it on). */
  onAppend(
    listener: (spark: SparkId, run: string, line: SparkTranscriptKnownLine) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A run's file as the store reads it: one that is not a record (open to other users, or a folder where the file
   * is) is set aside for a human, as every signed store's is (signed-record.ts), and reads as absent; one the disk will
   * not hand over is its word. */
  #held(
    spark: SparkId,
    run: string,
    path: string,
    bytes?: number,
  ): Exclude<FileRead, { why: string }> {
    const held = readTried(path, bytes);
    if (!("why" in held)) return held;
    const aside = setAsideFile(path, held.why);
    this.#next.delete(`${spark}/${run}`);
    this.#logger.warn(
      "fieldd.transcripts.set_aside",
      "A spark's transcript file that is not a record was set aside, never served",
      { spark, run, why: held.why, aside: basename(aside) },
    );
    return { absent: true };
  }

  /** The spark's folder, where its runs' files stand. */
  folderOf(spark: SparkId): string {
    return join(this.opts.dir, spark);
  }

  /** Write one line of `run` of `spark`, signed, its seq the next: the line written, or undefined when it is not
   * (a spark or run id no file is named by, a body the contract refuses, a file the disk will not hand over or take).
   * Never throws: a transcript that cannot be written is said in the log, and the act it records goes on. */
  append(spark: SparkId, run: string, body: TranscriptBody): SparkTranscriptKnownLine | undefined {
    if (!isKeptSparkId(spark) || !isKeptRunId(run)) {
      this.#logger.warn(
        "fieldd.transcripts.refused_id",
        "A transcript line was not kept: its spark or run id names no file",
        {
          kind: body.kind,
        },
      );
      return undefined;
    }
    const key = `${spark}/${run}`;
    try {
      return this.#append(spark, run, key, body);
    } catch (error) {
      // the key or the folder the disk would not hand over or take: read the file again before the next line, so a
      // torn write leaves its last seq to the file
      this.#next.delete(key);
      this.#logger.warn("fieldd.transcripts.append_failed", "A transcript line was not written", {
        spark,
        run,
        kind: body.kind,
        code: errnoOf(error),
      });
      return undefined;
    }
  }

  #append(
    spark: SparkId,
    run: string,
    key: string,
    body: TranscriptBody,
  ): SparkTranscriptKnownLine | undefined {
    const path = join(this.folderOf(spark), `${run}${RUN_FILE_SUFFIX}`);
    // a newer VibeField's run is kept for it, never written to (said once, by the guard)
    if (!this.#guard.keeps(key)) return undefined;
    let seq = this.#next.get(key);
    if (seq === undefined) {
      const held = this.#held(spark, run, path);
      if ("unavailable" in held) {
        if (!this.#refused.has(key)) {
          this.#refused.add(key);
          this.#logger.warn(
            "fieldd.transcripts.unreadable",
            "A spark's transcript file could not be read; nothing is written to it, and it stays where it is",
            { spark, run, code: held.unavailable },
          );
        }
        return undefined;
      }
      this.#refused.delete(key);
      if ("absent" in held) seq = 1;
      else {
        const tail = tailOf(held.text, spark, run, this.#verify);
        if (this.#guard.newer(key, path, { format: tail.format })) return undefined;
        seq = tail.seq + 1;
      }
    }
    const { at, ...fields } = body as TranscriptBody & { readonly at?: string };
    const unsigned = defined({
      ...fields,
      v: SPARK_TRANSCRIPT_FORMAT,
      seq,
      at: at ?? this.#now().toISOString(),
    });
    const line = { ...unsigned, mac: this.#signer.sign({ spark, run, line: unsigned }) };
    const known = sparkTranscriptLineOf(line);
    if (known === undefined) {
      this.#logger.error(
        "fieldd.transcripts.refused_line",
        "A transcript line the contract refuses was not kept",
        undefined,
        { spark, run, kind: body.kind },
      );
      return undefined;
    }
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    const folder = this.folderOf(spark);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
    appendFileSync(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    this.#next.set(key, seq + 1);
    for (const listener of this.#listeners) listener(spark, run, known);
    return known;
  }

  /** One run's file, read whole: the lines that verify, in order, and how many did not. */
  read(spark: SparkId, run: string): TranscriptRead {
    if (!isKeptSparkId(spark) || !isKeptRunId(run)) return { absent: true };
    const held = this.#held(spark, run, join(this.folderOf(spark), `${run}${RUN_FILE_SUFFIX}`));
    if (!("text" in held)) return held;
    try {
      const read = readLines(held.text, spark, run, this.#verify);
      return { lines: read.lines, dropped: read.dropped };
    } catch (error) {
      // the folder's key could not be read: nothing verifies, which is no proof a line is not ours
      return { unavailable: errnoOf(error) };
    }
  }

  /** The spark's runs, oldest first by their first line, the newest SPARK_TRANSCRIPT.RUNS_MAX. A file whose first
   * line does not verify is passed over; one whose first line is not its run line (lost, or set aside and begun again)
   * is listed as a continuation. A spark with no folder has none. A folder, a run's file or the key the disk does not
   * hand over throws the store's refusal (UNAVAILABLE {spark-transcripts, records-unreadable}, in fieldd's words), said
   * in the log: never an empty list. */
  runs(spark: SparkId): TranscriptRuns {
    if (!isKeptSparkId(spark)) return { runs: [] };
    const folder = this.folderOf(spark);
    const names = this.#guard.entries(folder).map((entry) => entry.name);
    try {
      return this.#runs(spark, folder, names);
    } catch (error) {
      if (error instanceof RpcCallError) throw error;
      // the folder's key could not be read: nothing verifies, which is no proof the folder holds no run
      return this.#guard.unavailable(this.opts.keyPath, errnoOf(error));
    }
  }

  #runs(spark: SparkId, folder: string, names: readonly string[]): TranscriptRuns {
    const runs: SparkTranscriptRun[] = [];
    for (const name of names) {
      const run = runOfFile(name);
      if (run === undefined) continue;
      const path = join(folder, name);
      const head = this.#held(spark, run, path, FIRST_LINE_BYTES);
      if ("absent" in head) continue;
      if ("unavailable" in head) this.#guard.unavailable(path, head.unavailable);
      const firstLine = head.text.split("\n")[0] ?? "";
      const [first] = readLines(`${firstLine}\n`, spark, run, this.#verify).lines;
      if (first === undefined) continue;
      runs.push({
        runtimeRunId: run,
        startedAt: first.at,
        fresh: first.kind === "run" && first.fresh,
      });
    }
    runs.sort((a, b) =>
      a.startedAt === b.startedAt
        ? a.runtimeRunId.localeCompare(b.runtimeRunId)
        : a.startedAt.localeCompare(b.startedAt),
    );
    return { runs: runs.slice(-SPARK_TRANSCRIPT.RUNS_MAX) };
  }
}

/** What the recorder hears a run by: puppeteer's Agent, its one `.on(...)` surface and its monitor (run-entry.ts). */
export type TranscriptAgent = RunEnteredAgent;

/** A spark's own run as it entered (run-entry.ts's `RunEntered`), its own spark named: the one a transcript records. */
export type SparkRunEntered = RunEntered & { readonly spark: SparkId };

/** How many pasted prompts a run holds while it waits for their turns, at most. */
const PROMPTS_KEPT = 16;

/** Words compared as a prompt: their whitespace one space, trimmed. */
const promptWords = (text: string): string => text.replace(/\s+/gu, " ").trim();

type ToolBody = Extract<TranscriptBody, { kind: "tool" }>;

interface Recording {
  readonly spark: SparkId;
  /** what fieldd pasted into the run, waiting for the turn it starts */
  readonly prompts: string[];
  /** MCP tools asked for and not ended: written at their end, so one fieldd served is marked ours */
  readonly pending: { body: ToolBody; ours: boolean }[];
  /** calls fieldd served before their tool was asked for (none in practice): the next MCP tool's */
  credits: number;
  /** the last reply kept since the run's last turn started, trimmed: a turn's end saying the same adds none (item 227) */
  said: string | undefined;
}

export class SparkTranscriptRecorder {
  readonly #runs = new Map<string, Recording>();

  constructor(
    readonly store: SparkTranscripts,
    readonly logger: Logger = createNoopLogger(),
  ) {}

  /** A spark's own run entered the agent runtime (agent-runtime.ts's `enter`). A birth's file opens with its run line,
   * a new conversation; a resume's, its continuation. A re-attach after fieldd restarted writes `gap` from the last
   * line it holds, only when the run's monitor has evidence newer than that line. Its events are heard from now. */
  entered(run: SparkRunEntered): void {
    const { agent, spark, runtimeRunId, begun } = run;
    if (this.#runs.has(runtimeRunId)) return;
    const state: Recording = { spark, prompts: [], pending: [], credits: 0, said: undefined };
    this.#runs.set(runtimeRunId, state);
    const held = this.store.read(spark, runtimeRunId);
    const lines = "lines" in held ? held.lines : [];
    if (!("unavailable" in held)) {
      const last = lines[lines.length - 1];
      if (last === undefined)
        this.store.append(spark, runtimeRunId, {
          kind: "run",
          runtimeRunId,
          fresh: begun === "spawn",
        });
      else if (begun === "reattach") {
        const evidence = agent.monitor?.freshness?.lastEvidenceAt;
        if (typeof evidence === "string" && evidence > last.at)
          this.store.append(spark, runtimeRunId, { kind: "gap", since: last.at });
      }
    }
    const reply = (messageId: string, turn: string | undefined, text: string) => {
      const kept = this.store.append(spark, runtimeRunId, { kind: "reply", messageId, turn, text });
      if (kept !== undefined) state.said = text.trim();
    };
    agent.on("conversation:assistant-message", (envelope) => {
      if (!ownLive(envelope)) return;
      const message = envelope.event;
      if (message.displayOnly === true || message.final === false || message.text.trim() === "")
        return;
      reply(
        message.messageId ?? envelope.eventId ?? `seq-${envelope.sequence}`,
        message.turnId ?? envelope.turnId,
        message.text,
      );
    });
    agent.on("turn:started", (envelope) => {
      if (!ownLive(envelope)) return;
      state.said = undefined;
      const prompt = envelope.event.prompt;
      if (prompt !== undefined && prompt.trim() !== "" && !this.#pasted(runtimeRunId, prompt))
        this.store.append(spark, runtimeRunId, { kind: "you", via: "terminal", text: prompt });
      this.store.append(spark, runtimeRunId, {
        kind: "turn",
        edge: "start",
        turn: envelope.event.turnId ?? envelope.turnId,
      });
    });
    const ended = (
      edge: "end" | "failed",
      turn: string | undefined,
      words?: { readonly messageId: string; readonly text: string },
    ) => {
      this.#flush(runtimeRunId);
      const text = words?.text.trim();
      if (words !== undefined && text !== "" && text !== state.said)
        reply(words.messageId, turn, words.text);
      this.store.append(spark, runtimeRunId, { kind: "turn", edge, turn });
    };
    // Item 227: a turn's end carries its last words, and for a run whose hooks are live they are the only copy heard.
    // Puppeteer withholds the transcript's copy of a message from such a run, and the hook's copy is display-only.
    agent.on("turn:completed", (envelope) => {
      if (!ownLive(envelope)) return;
      const text = envelope.event.lastAssistantMessage;
      const messageId = envelope.eventId ?? `seq-${envelope.sequence}`;
      ended(
        "end",
        envelope.event.turnId ?? envelope.turnId,
        text === undefined ? undefined : { messageId, text },
      );
    });
    agent.on("turn:failed", (envelope) => {
      if (ownLive(envelope)) ended("failed", envelope.event.turnId ?? envelope.turnId);
    });
    agent.on("tool:requested", (envelope) => {
      if (!ownLive(envelope)) return;
      const presentation = envelope.event.presentation;
      // its kind and what it touched, never its name nor the title that carries it (AR-L1)
      const body: ToolBody = {
        kind: "tool",
        toolCallId: envelope.event.toolCallId,
        turn: envelope.turnId,
        toolKind: presentation?.kind ?? "other",
        detail:
          presentation?.detail === undefined || presentation.detail.trim() === ""
            ? undefined
            : presentation.detail.slice(0, DETAIL_MAX),
      };
      if (body.toolKind !== "mcp") {
        this.store.append(spark, runtimeRunId, body);
        return;
      }
      const recording = this.#runs.get(runtimeRunId);
      if (recording === undefined) return;
      const ours = recording.credits > 0;
      if (ours) recording.credits -= 1;
      recording.pending.push({ body, ours });
    });
    const toolEnded = (toolCallId: string) => {
      const recording = this.#runs.get(runtimeRunId);
      const at = recording?.pending.findIndex((each) => each.body.toolCallId === toolCallId) ?? -1;
      if (recording === undefined || at < 0) return;
      const [held] = recording.pending.splice(at, 1);
      if (held !== undefined) this.#writeTool(spark, runtimeRunId, held);
    };
    agent.on("tool:completed", (envelope) => {
      if (ownLive(envelope)) toolEnded(envelope.event.toolCallId);
    });
    agent.on("tool:failed", (envelope) => {
      if (ownLive(envelope)) toolEnded(envelope.event.toolCallId);
    });
  }

  /** fieldd is pasting `text` into the run (the input queue's delivery, marked as it lands): the turn it starts is
   * that input's, so no second line is written for it. Bound by its words, as puppeteer confirms the paste by the
   * matching prompt (step0-th §4.2; whitespace is one space either side); one that never starts a turn is let go at its
   * outcome (`heard`), and at most PROMPTS_KEPT wait. */
  expectPrompt(runtimeRunId: string, text: string): void {
    const recording = this.#runs.get(runtimeRunId);
    if (recording === undefined) return;
    recording.prompts.push(promptWords(text));
    if (recording.prompts.length > PROMPTS_KEPT) recording.prompts.shift();
  }

  /** Your words, as a say queued them into the spark's run: its input, its request id, the receipt it was queued with,
   * and its chips as spans of the words. */
  said(
    spark: SparkId,
    runtimeRunId: string,
    say: {
      readonly text: string;
      readonly input: string;
      readonly requestId: string;
      readonly state: string;
      readonly chips?: readonly ComposeSayChip[] | undefined;
    },
  ): void {
    this.store.append(spark, runtimeRunId, {
      kind: "you",
      via: "chat",
      text: say.text,
      input: say.input,
      requestId: say.requestId,
      state: say.state,
      chips: say.chips !== undefined && say.chips.length > 0 ? say.chips : undefined,
    });
  }

  /** What became of an input in a spark's run, as the input queue told it. A run the recorder never entered is no
   * spark's it holds, and nothing is written. */
  outcome(runtimeRunId: string, of: string, state: string, reason?: string): void {
    const recording = this.#runs.get(runtimeRunId);
    if (recording === undefined) return;
    this.store.append(recording.spark, runtimeRunId, {
      kind: "outcome",
      of,
      state,
      reason: reason === undefined || reason.trim() === "" ? undefined : reason.slice(0, 500),
    });
  }

  /** What the input queue made of one input to a run (its `onOutcome`), as the record keeps it:
   * - your words (`you`): the outcome line of their `you` line, every state the queue says;
   * - fieldd's own line, delivered: VibeField's act `wake`, the facts it told, at the moment it was told;
   * - a line not pasted (`waiting`, `dropped`): its prompt is no longer waited for.
   * A spark's words to another spark's run are SP-1e's crew, not recorded at TH-1. */
  heard(runtimeRunId: string, input: QueuedInput, outcome: string, reason?: string): void {
    const recording = this.#runs.get(runtimeRunId);
    if (recording === undefined) return;
    if (outcome === "waiting" || outcome === "dropped") this.letGo(runtimeRunId, markedText(input));
    if (input.from.kind === "you") this.outcome(runtimeRunId, input.id, outcome, reason);
    else if (input.from.kind === "fieldd" && outcome === "delivered")
      this.act(recording.spark, runtimeRunId, "wake", input.text);
  }

  /** A paste that did not happen (turned away, or its run ended first): its prompt is no longer waited for. */
  letGo(runtimeRunId: string, text: string): void {
    const recording = this.#runs.get(runtimeRunId);
    if (recording === undefined) return;
    const at = recording.prompts.lastIndexOf(promptWords(text));
    if (at >= 0) recording.prompts.splice(at, 1);
  }

  /** VibeField's own act, in the spark's run's file: a wake that told it something, an answer you gave, a notify, and
   * (SP-1e2) a crew's line, which names its crew: a later line of the same crew replaces it where it first stood. */
  act(
    spark: SparkId,
    runtimeRunId: string,
    what: string,
    text: string,
    fields?: { readonly crew?: CrewId | undefined },
  ): void {
    if (text.trim() === "") return;
    this.store.append(spark, runtimeRunId, { kind: "act", what, text, crew: fields?.crew });
  }

  /** The tool plane served one of VibeField's own tools to the spark's run: the MCP tool asked for and not yet ended
   * is that call, and is marked ours (TH-Q1 (ii)); its act line says what it did. */
  served(runtimeRunId: string): void {
    const recording = this.#runs.get(runtimeRunId);
    if (recording === undefined) return;
    const pending = recording.pending.find((each) => !each.ours);
    if (pending !== undefined) pending.ours = true;
    else recording.credits = Math.min(recording.credits + 1, PROMPTS_KEPT);
  }

  /** A run ended: what it held is let go. */
  forget(runtimeRunId: string): void {
    this.#flush(runtimeRunId);
    this.#runs.delete(runtimeRunId);
  }

  /** Whether `prompt` is one fieldd pasted into the run; the one it is leaves the waiting list. */
  #pasted(runtimeRunId: string, prompt: string): boolean {
    const recording = this.#runs.get(runtimeRunId);
    if (recording === undefined) return false;
    const words = promptWords(prompt);
    const at = recording.prompts.findIndex((each) => each === words);
    if (at < 0) return false;
    recording.prompts.splice(at, 1);
    return true;
  }

  /** Every MCP tool the run asked for and has not ended, written: a turn's end ends them. */
  #flush(runtimeRunId: string): void {
    const recording = this.#runs.get(runtimeRunId);
    if (recording === undefined) return;
    for (const held of recording.pending.splice(0))
      this.#writeTool(recording.spark, runtimeRunId, held);
  }

  #writeTool(spark: SparkId, runtimeRunId: string, held: { body: ToolBody; ours: boolean }): void {
    this.store.append(spark, runtimeRunId, held.ours ? { ...held.body, ours: true } : held.body);
  }
}
