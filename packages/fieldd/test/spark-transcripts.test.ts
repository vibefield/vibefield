import { createHmac } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  RECORD_STORES,
  SPARK_TRANSCRIPT_FORMAT,
  SPARK_TRANSCRIPT_SERVICE,
  sparkTranscriptLineOf,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import { RecordSigner } from "../src/signed-record";
import {
  SparkTranscriptRecorder,
  SparkTranscripts,
  TRANSCRIPTS_UNREADABLE,
  type TranscriptAgent,
} from "../src/spark-transcripts";

// TH-1 (step0-th.md §4.1, §4.2; TH0-Q1 = O1) — the spark's transcript, kept: one JSONL file per run in the spark's own
// folder (item 159's, LAYOUT.SPARK_FILES_DIR), 0600 in 0700, each line MAC'd by the folder's one key over
// {spark, run, line}, so a line an edit touched, or one copied from another run or spark, is dropped and counted, never
// served; a file the disk will not hand over is never written over (item 172's rule). The recorder writes it from a
// spark's own run's events and from VibeField's own facts. The ticket and the worker that serves it are
// spark-transcript-ticket.test.ts's; the say's line is compose-say's.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // gone already
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

type Logged = { event: string; attrs: LogFields | undefined };
function capture(events: Logged[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: (event, _m, attrs) => void events.push({ event, attrs }),
    warn: (event, _m, attrs) => void events.push({ event, attrs }),
    error: (event, _m, _e, attrs) => void events.push({ event, attrs }),
    fatal: () => undefined,
    isLevelEnabled: () => true,
  };
  return logger;
}

const VELA = "sp-vela00000000";
const KIWI = "sp-kiwi00000000";
const RUN = "run-vela-1";
const AT = "2026-11-05T04:00:00.000Z";

function harness() {
  const root = mkdtempSync(join(tmpdir(), "vf-transcripts-"));
  dirs.push(root);
  const dir = join(root, "spark-files");
  const keyPath = join(root, "spark-files.key");
  const events: Logged[] = [];
  let clock = Date.parse(AT);
  const open = () =>
    new SparkTranscripts({
      dir,
      keyPath,
      logger: capture(events),
      now: () => {
        clock += 1000;
        return new Date(clock);
      },
    });
  const file = (spark: string, run: string) => join(dir, spark, `${run}.jsonl`);
  const raw = (spark: string, run: string) =>
    readFileSync(file(spark, run), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { root, dir, keyPath, events, open, file, raw };
}

/** What a call answered, or what it threw as a door would answer it: an RpcCallError's kind, retryability, words and
 * details. */
function answerOf(call: () => unknown): unknown {
  try {
    return { answered: call() };
  } catch (error) {
    return error instanceof RpcCallError
      ? {
          kind: error.kind,
          retryable: error.retryable,
          message: error.message,
          details: error.details,
        }
      : { threw: String(error) };
  }
}

/** Item 172's refusal, the transcript store's: UNAVAILABLE {spark-transcripts, records-unreadable}, in DESIGN.md §9's
 * words, retryable (the store reads at each ask). */
const UNREADABLE = {
  kind: "UNAVAILABLE",
  retryable: true,
  message: TRANSCRIPTS_UNREADABLE,
  details: { service: SPARK_TRANSCRIPT_SERVICE.SERVICE, state: RECORD_STORES.STATE_UNREADABLE },
};

/** A run as puppeteer's Agent hands it to the recorder: its `.on` surface, and its monitor's evidence. */
function fakeAgent(lastEvidenceAt?: string) {
  const listeners = new Map<string, Set<(envelope: unknown) => void>>();
  let sequence = 0;
  const agent = {
    on: (selector: string, listener: (envelope: unknown) => void) => {
      const set = listeners.get(selector) ?? new Set();
      set.add(listener);
      listeners.set(selector, set);
      return () => set.delete(listener);
    },
    monitor: { freshness: lastEvidenceAt === undefined ? {} : { lastEvidenceAt } },
  } as unknown as TranscriptAgent;
  const emit = (
    type: string,
    event: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) => {
    const env = {
      type,
      category: type.split(":")[0],
      sequence: ++sequence,
      sessionId: "pty-vela",
      timestamp: AT,
      monotonicTime: sequence,
      source: "hook",
      confidence: "high",
      event: { type, ...event },
      ...envelope,
    };
    for (const selector of ["*", `${type.split(":")[0]}:*`, type])
      for (const listener of listeners.get(selector) ?? []) listener(env);
  };
  return { agent, emit };
}

describe("the spark's transcript, kept (TH-1)", () => {
  it("appends each line in the spark's own folder, 0600 in 0700, its seq the next, MAC'd over {spark, run, line}", () => {
    const h = harness();
    const store = h.open();
    store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
    store.append(VELA, RUN, { kind: "you", via: "terminal", text: "run the tests" });
    const lines = h.raw(VELA, RUN);
    expect(lines.map((line) => [line["seq"], line["kind"], line["v"]])).toEqual([
      [1, "run", SPARK_TRANSCRIPT_FORMAT],
      [2, "you", SPARK_TRANSCRIPT_FORMAT],
    ]);
    // every line is one of the contract's, read as the window reads it
    for (const line of lines) expect(sparkTranscriptLineOf(line)).toBeDefined();
    // the MAC is the folder's one signer's, over the spark, the run and the line without its own mac
    const signer = new RecordSigner({ keyPath: h.keyPath });
    for (const { mac, ...line } of lines)
      expect(signer.verifies({ spark: VELA, run: RUN, line }, String(mac))).toBe(true);
    expect(statSync(h.file(VELA, RUN)).mode & 0o777).toBe(0o600);
    expect(statSync(join(h.dir, VELA)).mode & 0o777).toBe(0o700);
    // the key a worker of fieldd's own verifies with, handed on its pipe (EL7)
    const [first] = lines;
    if (first === undefined) throw new Error("no line");
    const { mac, ...unsigned } = first;
    expect(
      createHmac("sha256", store.secret())
        .update(canonicalJson({ spark: VELA, run: RUN, line: unsigned }))
        .digest("hex"),
    ).toBe(mac);
  });

  it("reads back the lines that verify, in order; one an edit touched, one copied from another run or spark, and a replayed seq are dropped and counted, never served", () => {
    const h = harness();
    const store = h.open();
    store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
    store.append(VELA, RUN, { kind: "reply", messageId: "m-1", text: "On it." });
    store.append(VELA, RUN, { kind: "turn", edge: "end" });
    store.append(KIWI, "run-kiwi-1", { kind: "run", runtimeRunId: "run-kiwi-1", fresh: true });
    store.append(KIWI, "run-kiwi-1", { kind: "reply", messageId: "m-9", text: "Kiwi's words" });
    const text = readFileSync(h.file(VELA, RUN), "utf8").split("\n");
    const kiwis = readFileSync(h.file(KIWI, "run-kiwi-1"), "utf8").split("\n");
    // an edit: the reply's words changed, its MAC kept
    const edited = text[1]?.replace("On it.", "Done, all green.");
    // a line copied in from Kiwi's run, and the first line again
    writeFileSync(h.file(VELA, RUN), [text[0], edited, text[2], kiwis[1], text[0], ""].join("\n"), {
      mode: 0o600,
    });
    const read = store.read(VELA, RUN);
    if (!("lines" in read)) throw new Error("not read");
    expect(read.lines.map((line) => [line.seq, line.kind])).toEqual([
      [1, "run"],
      [3, "turn"],
    ]);
    expect(read.dropped).toBe(3);
  });

  it("continues a run's seq across a restart, reading the file first, and never skips a number", () => {
    const h = harness();
    h.open().append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: false });
    h.open().append(VELA, RUN, { kind: "turn", edge: "start" });
    h.open().append(VELA, RUN, { kind: "turn", edge: "end" });
    expect(h.raw(VELA, RUN).map((line) => line["seq"])).toEqual([1, 2, 3]);
  });

  it("lists a spark's runs oldest first, each by its run line: its id, when it began, and whether it began a conversation", () => {
    const h = harness();
    const store = h.open();
    store.append(VELA, "run-vela-2", { kind: "run", runtimeRunId: "run-vela-2", fresh: false });
    store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
    // the first written began later: its run line says when
    const runs = store.runs(VELA);
    if (!("runs" in runs)) throw new Error("not read");
    expect(runs.runs.map((run) => [run.runtimeRunId, run.fresh])).toEqual([
      ["run-vela-2", false],
      [RUN, true],
    ]);
    expect((runs.runs[0]?.startedAt ?? "") < (runs.runs[1]?.startedAt ?? "")).toBe(true);
    // a spark with no folder has no runs, and that is no failure
    expect(store.runs(KIWI)).toEqual({ runs: [] });
  });

  it("never writes over a run's file the disk will not hand over, and refuses a file or a folder it cannot read in fieldd's words, never with an empty list (item 172's rule)", () => {
    const h = harness();
    const store = h.open();
    store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
    expect(existsSync(h.file(VELA, RUN)), "the run's line is kept").toBe(true);
    // a run's file the disk will not hand over (EACCES, every try): a fresh store must not begin its seq again over it
    chmodSync(h.file(VELA, RUN), 0o000);
    expect(
      h.open().append(VELA, RUN, { kind: "turn", edge: "start" }),
      "a line written over a file the store could not read",
    ).toBeUndefined();
    expect(
      h.events.map((event) => event.event),
      "the store says it could not read the run's file",
    ).toContain("fieldd.transcripts.unreadable");
    // the door's listing: item 172's refusal, the store's own, in fieldd's words
    expect(answerOf(() => h.open().runs(VELA))).toEqual(UNREADABLE);
    chmodSync(h.file(VELA, RUN), 0o600);
    // a folder the disk refuses: the same refusal, never an empty list
    chmodSync(join(h.dir, VELA), 0o000);
    expect(answerOf(() => h.open().runs(VELA))).toEqual(UNREADABLE);
    chmodSync(join(h.dir, VELA), 0o700);
    expect(h.raw(VELA, RUN)).toHaveLength(1);
    // fieldd's words are DESIGN.md's (§8 "Chat's thread", under §9's rule), quoted whole
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8");
    expect(design.replace(/\s+/g, " ")).toContain(`"${TRANSCRIPTS_UNREADABLE}"`);
  });

  it("sets aside what is not a record (a folder where a run's file is), and keeps a run a newer VibeField wrote in for it, never written to (item 172's rule)", () => {
    const h = harness();
    const store = h.open();
    // a folder where a run's file is: set aside beside itself, said, and the run begins its file anew
    mkdirSync(join(h.dir, VELA, "run-vela-dir.jsonl"), { recursive: true, mode: 0o700 });
    expect(
      store.append(VELA, "run-vela-dir", { kind: "run", runtimeRunId: "run-vela-dir", fresh: true })
        ?.seq,
      "the run's first line, written anew",
    ).toBe(1);
    expect(
      readdirSync(join(h.dir, VELA)).filter((name) =>
        name.startsWith("run-vela-dir.jsonl.unreadable-"),
      ),
      "the folder, set aside beside itself",
    ).toHaveLength(1);
    // a run whose file holds a line a newer VibeField wrote: kept for it, never written to, said once
    const line = {
      v: SPARK_TRANSCRIPT_FORMAT + 1,
      seq: 1,
      kind: "run",
      at: AT,
      runtimeRunId: RUN,
      fresh: true,
    };
    const mac = new RecordSigner({ keyPath: h.keyPath }).sign({ spark: VELA, run: RUN, line });
    writeFileSync(h.file(VELA, RUN), `${JSON.stringify({ ...line, mac })}\n`, { mode: 0o600 });
    const fresh = h.open();
    expect(
      fresh.append(VELA, RUN, { kind: "turn", edge: "start" }),
      "a line written to a newer VibeField's run",
    ).toBeUndefined();
    expect(fresh.append(VELA, RUN, { kind: "turn", edge: "end" }), "nor the next").toBeUndefined();
    expect(
      h.events.filter((event) => event.event === "fieldd.records.newer"),
      "said once",
    ).toHaveLength(1);
    expect(h.raw(VELA, RUN)).toHaveLength(1);
    // never served: its format is not this build's
    expect(fresh.read(VELA, RUN)).toEqual({ lines: [], dropped: 0 });
  });

  it("sets a run's file other users could read aside, never served; the run's next line begins its file again", () => {
    const h = harness();
    const store = h.open();
    store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
    chmodSync(h.file(VELA, RUN), 0o644);
    const fresh = h.open();
    expect(fresh.read(VELA, RUN)).toEqual({ absent: true });
    expect(h.events.some((event) => event.event === "fieldd.transcripts.set_aside")).toBe(true);
    expect(fresh.runs(VELA)).toEqual({ runs: [] });
    // the next line begins again at 1, 0600, and the run is listed by it as a continuation
    expect(fresh.append(VELA, RUN, { kind: "turn", edge: "start" })?.seq).toBe(1);
    expect(statSync(h.file(VELA, RUN)).mode & 0o777).toBe(0o600);
    const runs = fresh.runs(VELA);
    expect("runs" in runs && runs.runs.map((run) => [run.runtimeRunId, run.fresh])).toEqual([
      [RUN, false],
    ]);
  });

  it("keeps a run only under an id it can name a file by, and a spark only by its id (EL7)", () => {
    const h = harness();
    const store = h.open();
    expect(store.append(VELA, "../escape", { kind: "turn", edge: "start" })).toBeUndefined();
    expect(store.append("not-a-spark", RUN, { kind: "turn", edge: "start" })).toBeUndefined();
    expect(() => statSync(join(h.root, "escape.jsonl"))).toThrow();
  });
});

describe("the recorder (TH-1; a spark's own run's events, and VibeField's own facts)", () => {
  it("writes a birth's run line as a new conversation and a resume's as its continuation; a re-attach writes a gap only on evidence the run moved", () => {
    const h = harness();
    const store = h.open();
    const recorder = new SparkTranscriptRecorder(store);
    recorder.entered({ agent: fakeAgent().agent, spark: VELA, runtimeRunId: RUN, begun: "spawn" });
    recorder.entered({
      agent: fakeAgent().agent,
      spark: VELA,
      runtimeRunId: "run-vela-2",
      begun: "resume",
    });
    expect(h.raw(VELA, RUN).map((line) => [line["kind"], line["fresh"]])).toEqual([["run", true]]);
    expect(h.raw(VELA, "run-vela-2").map((line) => [line["kind"], line["fresh"]])).toEqual([
      ["run", false],
    ]);
    // fieldd restarted: the same run again, its evidence no newer than its last line, so no gap
    const quiet = new SparkTranscriptRecorder(h.open());
    quiet.entered({
      agent: fakeAgent("2026-11-05T03:00:00.000Z").agent,
      spark: VELA,
      runtimeRunId: RUN,
      begun: "reattach",
    });
    expect(h.raw(VELA, RUN).map((line) => line["kind"])).toEqual(["run"]);
    // …and once more, the run having moved while fieldd was away: a gap from the last line it holds
    const moved = new SparkTranscriptRecorder(h.open());
    moved.entered({
      agent: fakeAgent("2026-11-05T05:00:00.000Z").agent,
      spark: VELA,
      runtimeRunId: RUN,
      begun: "reattach",
    });
    const lines = h.raw(VELA, RUN);
    expect(lines.map((line) => line["kind"])).toEqual(["run", "gap"]);
    expect(lines[1]?.["since"]).toBe(lines[0]?.["at"]);
  });

  it("writes the spark's replies whole, its turns' edges and each tool by its kind and detail — never a display-only or unfinished reply, a tool's name or title, a subagent's or a replay's", () => {
    const h = harness();
    const recorder = new SparkTranscriptRecorder(h.open());
    const run = fakeAgent();
    recorder.entered({ agent: run.agent, spark: VELA, runtimeRunId: RUN, begun: "spawn" });
    run.emit("turn:started", { turnId: "t-1" });
    run.emit("conversation:assistant-message", {
      messageId: "m-0",
      text: "thinking out loud",
      displayOnly: true,
    });
    run.emit("conversation:assistant-message", { messageId: "m-1", text: "Half", final: false });
    run.emit("tool:requested", {
      toolCallId: "c-1",
      tool: "Bash",
      presentation: { kind: "command", title: "Using Bash", detail: "pnpm test" },
    });
    run.emit(
      "tool:requested",
      { toolCallId: "c-2", tool: "Read", presentation: { kind: "file-read", title: "Read" } },
      { agentId: "sub-1" },
    );
    run.emit("conversation:assistant-message", { messageId: "m-x", text: "old" }, { replay: true });
    run.emit("conversation:assistant-message", { messageId: "m-1", text: "Half done, all green." });
    run.emit("turn:completed", { turnId: "t-1" });
    const lines = h.raw(VELA, RUN).slice(1);
    expect(lines.map((line) => line["kind"])).toEqual(["turn", "tool", "reply", "turn"]);
    expect(lines[0]).toMatchObject({ edge: "start", turn: "t-1" });
    expect(lines[1]).toMatchObject({ toolCallId: "c-1", toolKind: "command", detail: "pnpm test" });
    expect(JSON.stringify(lines[1])).not.toContain("Bash");
    expect(lines[2]).toMatchObject({ messageId: "m-1", text: "Half done, all green." });
    expect(lines[3]).toMatchObject({ edge: "end", turn: "t-1" });
  });

  it("binds a prompt to the input fieldd pasted, and writes a prompt nothing of fieldd's pasted as yours via the terminal", () => {
    const h = harness();
    const recorder = new SparkTranscriptRecorder(h.open());
    const run = fakeAgent();
    recorder.entered({ agent: run.agent, spark: VELA, runtimeRunId: RUN, begun: "spawn" });
    recorder.said(VELA, RUN, {
      text: "carry on with the migration",
      input: "in-1",
      requestId: "say-000000000001",
      state: "queued",
    });
    // the queue pastes it at Vela's next idle, and her turn starts on it: no second line for it
    recorder.expectPrompt(RUN, "carry on with the migration");
    run.emit("turn:started", { turnId: "t-1", prompt: "carry on with the migration" });
    // a prompt typed into her pane in Godview: yours, via the terminal
    run.emit("turn:started", { turnId: "t-2", prompt: "/compact" });
    const lines = h.raw(VELA, RUN).slice(1);
    expect(lines.map((line) => [line["kind"], line["via"] ?? line["edge"]])).toEqual([
      ["you", "chat"],
      ["turn", "start"],
      ["you", "terminal"],
      ["turn", "start"],
    ]);
    expect(lines[2]).toMatchObject({ text: "/compact" });
  });

  it("writes your words via chat with their input, request id, receipt and chips, then what became of them as the queue told it", () => {
    const h = harness();
    const recorder = new SparkTranscriptRecorder(h.open());
    recorder.entered({ agent: fakeAgent().agent, spark: VELA, runtimeRunId: RUN, begun: "spawn" });
    recorder.said(VELA, RUN, {
      text: "ask Claude Code in vibe-field (session run-his) to rebase",
      input: "in-1",
      requestId: "say-000000000002",
      state: "waking",
      chips: [{ start: 4, length: 42, kind: "session" }],
    });
    recorder.outcome(RUN, "in-1", "delivered");
    recorder.outcome(RUN, "in-2", "uncertain", "restarted");
    const lines = h.raw(VELA, RUN).slice(1);
    expect(lines[0]).toMatchObject({
      kind: "you",
      via: "chat",
      input: "in-1",
      requestId: "say-000000000002",
      state: "waking",
      chips: [{ start: 4, length: 42, kind: "session" }],
    });
    expect(lines.slice(1)).toMatchObject([
      { kind: "outcome", of: "in-1", state: "delivered" },
      { kind: "outcome", of: "in-2", state: "uncertain", reason: "restarted" },
    ]);
    // a run the recorder never entered names no spark: nothing is written for it
    recorder.outcome("run-unknown", "in-3", "delivered");
    expect(h.raw(VELA, RUN)).toHaveLength(4);
  });

  it("writes VibeField's own acts, and marks an MCP tool fieldd served in that turn as ours", () => {
    const h = harness();
    const recorder = new SparkTranscriptRecorder(h.open());
    const run = fakeAgent();
    recorder.entered({ agent: run.agent, spark: VELA, runtimeRunId: RUN, begun: "spawn" });
    recorder.act(VELA, RUN, "notify", "the build is green");
    run.emit("turn:started", { turnId: "t-1" });
    run.emit("tool:requested", {
      toolCallId: "c-1",
      tool: "mcp__vibefield__agent_send",
      presentation: { kind: "mcp", title: "mcp__vibefield__agent_send" },
    });
    recorder.served(RUN);
    run.emit("tool:completed", { toolCallId: "c-1", tool: "mcp__vibefield__agent_send" });
    run.emit("tool:requested", {
      toolCallId: "c-2",
      tool: "mcp__github__list_issues",
      presentation: { kind: "mcp", title: "mcp__github__list_issues" },
    });
    run.emit("turn:completed", { turnId: "t-1" });
    const lines = h.raw(VELA, RUN).slice(1);
    expect(
      lines.map((line) => [line["kind"], line["what"] ?? line["toolCallId"] ?? line["edge"]]),
    ).toEqual([
      ["act", "notify"],
      ["turn", "start"],
      ["tool", "c-1"],
      ["tool", "c-2"],
      ["turn", "end"],
    ]);
    expect(lines[2]?.["ours"]).toBe(true);
    expect(lines[3]?.["ours"]).toBeUndefined();
    expect(JSON.stringify(lines)).not.toContain("mcp__");
  });

  it("reads the input queue's outcomes: yours as outcome lines, fieldd's line told as a wake, a paste turned away let go", () => {
    const h = harness();
    const recorder = new SparkTranscriptRecorder(h.open());
    const run = fakeAgent();
    recorder.entered({ agent: run.agent, spark: VELA, runtimeRunId: RUN, begun: "spawn" });
    const at = "2026-11-05T04:00:00.000Z";
    const yours = { id: "in-1", text: "rebase it", from: { kind: "you" as const }, at };
    const facts = { id: "in-2", text: "claude·2 finished", from: { kind: "fieldd" as const }, at };
    recorder.heard(RUN, yours, "waiting", "it is busy");
    recorder.heard(RUN, yours, "delivered");
    // fieldd's line: pasted marked, told once delivered, as VibeField's act
    recorder.expectPrompt(RUN, "VibeField: claude·2 finished");
    recorder.heard(RUN, facts, "delivered");
    run.emit("turn:started", { turnId: "t-1", prompt: "VibeField: claude·2 finished" });
    // a paste turned away is let go: the same words typed into the pane later are yours via the terminal
    recorder.expectPrompt(RUN, "VibeField: claude·2 failed");
    recorder.heard(RUN, { ...facts, id: "in-3", text: "claude·2 failed" }, "waiting");
    run.emit("turn:started", { turnId: "t-2", prompt: "VibeField: claude·2 failed" });
    const lines = h.raw(VELA, RUN).slice(1);
    expect(
      lines.map((line) => [
        line["kind"],
        line["state"] ?? line["what"] ?? line["via"] ?? line["edge"],
      ]),
    ).toEqual([
      ["outcome", "waiting"],
      ["outcome", "delivered"],
      ["act", "wake"],
      ["turn", "start"],
      ["you", "terminal"],
      ["turn", "start"],
    ]);
    expect(lines[0]).toMatchObject({ of: "in-1", reason: "it is busy" });
    expect(lines[2]).toMatchObject({ text: "claude·2 finished" });
  });
});
