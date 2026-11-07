import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLOW_LIMITS, FLOW_RECORD_FORMAT, type FlowJournalKnownLine } from "@vibefield/contracts";
import { afterEach, describe, expect, inject, it } from "vitest";
import type { FlowJournalEntry } from "../src/flows/journal";
import { FlowRecords } from "../src/flows/records";
import { FlowReplay, flowAnswerLine, flowCallKey, JOURNAL_REFUSED } from "../src/flows/replay";
import {
  type FlowCallHandler,
  type FlowHostAnswer,
  type FlowHostCall,
  type FlowHostRun,
  startFlowHost,
} from "../src/flows/supervisor";
import { flowsHostLaunch, standInSource } from "./flows-host-bundle";
import { beganRun } from "./flows-run-records";

// CP-4a2a (step0-cp4a2.md §12 commit 8; CP-D9) — replay: a run's calls answered from its journal by their key and
// `#n`, never handed on twice; a new call journaled before it is handed on, then its answer. And J7: the journal's key
// and its MACs never reach the host.
// CP-4a2b (§13a slice 10b; D21, D22, D7) — the answers a replay releases, in the journal's order, one queue; the runs
// the one writer of an answer line (the `writer` below plays them), the replay its hearer; and a new call held while
// calls the journal holds are not made again.

const FIXTURES = join(import.meta.dirname, "..", "..", "contracts", "fixtures");
const RUN = "fr-k3v9q2m7x1";
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as Record<string, unknown>;

/** A handler that answers every call with `answer` and counts what it was handed. */
function inner(
  answer: (call: FlowHostCall) => FlowHostAnswer = () => ({ ok: true, value: "new" }),
) {
  const calls: FlowHostCall[] = [];
  const logs: string[] = [];
  const handler: FlowCallHandler = {
    call: (call) => {
      calls.push(call);
      return Promise.resolve(answer(call));
    },
    log: (text) => {
      logs.push(text);
    },
  };
  return { handler, calls, logs };
}

/** A run's prior journal lines, as FlowRecords.readRun hands them over (the head, then `body`). */
function prior(body: FlowJournalEntry[]): FlowJournalKnownLine[] {
  const head = {
    format: FLOW_RECORD_FORMAT,
    seq: 1,
    kind: "head",
    at: "2026-11-05T11:00:00.000Z",
    run: RUN,
    flow: "release-check",
    name: "Release check",
    n: 1,
    hash: "f".repeat(64),
    starter: { by: "you" },
  };
  return [
    head,
    ...body.map((entry, i) => ({ ...entry, format: 1, seq: i + 2, at: head.at })),
  ] as FlowJournalKnownLine[];
}

/** A turn of the event loop: every answer a replay released is heard by then. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The runs' one write, scripted (D22): `said` journaled once through the one cutter, then handed to `replay`. */
function journalAnswer(
  replay: FlowReplay,
  append: (entry: FlowJournalEntry) => void,
  call: number,
  said: FlowHostAnswer,
  what = "agent",
): void {
  const line = flowAnswerLine(call, what, said);
  append(line.entry);
  replay.answered(call, line.heard);
}

/** The runs' side of the seam (D22), scripted: each call handed on is counted and, given `answer`, answered at once
 * by the runs' one write (`journalAnswer`) to the replay `bind` names; each log line is kept. It returns nothing: a
 * replay hears an answer through `answered` alone. */
function writer(
  append: (entry: FlowJournalEntry) => void,
  answer?: (call: FlowHostCall) => FlowHostAnswer,
) {
  const calls: FlowHostCall[] = [];
  const logs: string[] = [];
  let replay: FlowReplay | undefined;
  const handler = {
    call: (call: FlowHostCall & { readonly call: number }): void => {
      calls.push(call);
      if (answer !== undefined && replay !== undefined)
        journalAnswer(replay, append, call.call, answer(call), call.what);
    },
    log: (text: string): void => {
      logs.push(text);
    },
  };
  const bind = (made: FlowReplay): FlowReplay => {
    replay = made;
    return made;
  };
  return { handler, calls, logs, bind };
}

const REVIEW = [
  "Review the release branch",
  { agent: "codex", label: "review", phase: "Review" },
] as const;

describe("CP-4a2a — replay by a call's key and #n (CP-D9)", () => {
  it("P1: a call's key is what it is and every argument the script passed, canonical; contracts' fixture agrees", () => {
    const key = flowCallKey("agent", REVIEW);
    expect(key).toBe(fixture("flow-journal-line.call")["key"]);
    // key order inside an argument is not part of it; everything else is
    expect(
      flowCallKey("agent", [REVIEW[0], { phase: "Review", label: "review", agent: "codex" }]),
    ).toBe(key);
    for (const other of [
      flowCallKey("ask", REVIEW),
      flowCallKey("agent", ["Review the main branch", REVIEW[1]]),
      flowCallKey("agent", [REVIEW[0], { ...REVIEW[1], agent: "claude" }]),
      flowCallKey("agent", [REVIEW[0], { ...REVIEW[1], model: "gpt-5" }]),
      flowCallKey("agent", [REVIEW[0]]),
    ])
      expect(other).not.toBe(key);
  });

  it("P2: steps that finished out of order replay the same: each call is answered by its own key and n", async () => {
    const a = flowCallKey("agent", ["a"]);
    const b = flowCallKey("agent", ["b"]);
    const appended: FlowJournalEntry[] = [];
    const { handler, calls } = inner();
    const replay = new FlowReplay({
      prior: prior([
        { kind: "call", call: 1, what: "agent", key: a, n: 1 },
        { kind: "call", call: 2, what: "agent", key: b, n: 1 },
        { kind: "answer", call: 2, value: "B" },
        { kind: "answer", call: 1, value: "A" },
      ]),
      append: (entry) => appended.push(entry),
      inner: handler,
    });
    const [first, second] = await Promise.all([
      replay.call({ what: "agent", args: ["a"] }),
      replay.call({ what: "agent", args: ["b"] }),
    ]);
    expect(first).toEqual({ ok: true, value: "A" });
    expect(second).toEqual({ ok: true, value: "B" });
    expect(calls).toEqual([]);
    expect(appended).toEqual([]);
  });

  it("P3: a call the journal already answered is released from it in journal order, never handed on, and a refusal replays as one", async () => {
    const key = flowCallKey("agent", REVIEW);
    const { handler, calls } = inner();
    const appended: FlowJournalEntry[] = [];
    const replay = new FlowReplay({
      prior: prior([
        { kind: "call", call: 1, what: "agent", key, n: 1 },
        { kind: "answer", call: 1, value: { verdict: "clean" } },
        { kind: "call", call: 2, what: "agent", key, n: 2 },
        { kind: "answer", call: 2, refused: "VibeField ended this step." },
      ]),
      append: (entry) => appended.push(entry),
      inner: handler,
    });
    expect(await replay.call({ what: "agent", args: [...REVIEW] })).toEqual({
      ok: true,
      value: { verdict: "clean" },
    });
    // the same call again is its #2: the journal's second answer
    expect(await replay.call({ what: "agent", args: [...REVIEW] })).toEqual({
      ok: false,
      refused: "VibeField ended this step.",
    });
    expect(calls).toHaveLength(0);
    expect(appended).toEqual([]);
  });

  it("P4: a new call is journaled, handed on once with its number, and its answer, journaled after by the runs (D22), is what it hears", async () => {
    const key = flowCallKey("agent", ["a"]);
    const appended: FlowJournalEntry[] = [];
    const append = (entry: FlowJournalEntry) => void appended.push(entry);
    const w = writer(append, () => ({ ok: true, value: "fresh" }));
    const replay = w.bind(
      new FlowReplay({
        prior: prior([
          { kind: "call", call: 1, what: "agent", key, n: 1 },
          { kind: "answer", call: 1, value: "old" },
        ]),
        append,
        inner: w.handler,
      }),
    );
    expect(await replay.call({ what: "agent", args: ["a"] })).toEqual({ ok: true, value: "old" });
    // the same call a second time is new: #2, call 2
    expect(await replay.call({ what: "agent", args: ["a"] })).toEqual({ ok: true, value: "fresh" });
    expect(w.calls).toEqual([{ what: "agent", args: ["a"], call: 2 }]);
    expect(appended).toEqual([
      { kind: "call", call: 2, what: "agent", key, n: 2 },
      { kind: "answer", call: 2, value: "fresh" },
    ]);
  });

  it("P5: a log line the journal holds is not said twice; the next is journaled and heard", () => {
    const { handler, logs } = inner();
    const appended: FlowJournalEntry[] = [];
    const replay = new FlowReplay({
      prior: prior([{ kind: "log", text: "started" }]),
      append: (entry) => appended.push(entry),
      inner: handler,
    });
    replay.log("started");
    replay.log("reviewed");
    expect(logs).toEqual(["reviewed"]);
    expect(appended).toEqual([{ kind: "log", text: "reviewed" }]);
  });

  it("P6: a call that cannot be keyed or journaled is refused to the script, never thrown at fieldd", async () => {
    const { handler, calls } = inner();
    const appended: FlowJournalEntry[] = [];
    const replay = new FlowReplay({
      prior: [],
      append: (entry) => appended.push(entry),
      inner: handler,
    });
    // arguments nested past FLOW_LIMITS.ARGS_DEPTH_MAX, and a list holding undefined (no canonical JSON keys it)
    let deep: unknown = "x";
    for (let i = 0; i < FLOW_LIMITS.ARGS_DEPTH_MAX + 1; i++) deep = [deep];
    for (const args of [[deep], ["a", [undefined]]]) {
      let said: Promise<FlowHostAnswer> | undefined;
      expect(() => {
        said = replay.call({ what: "agent", args });
      }, "the handler never throws at fieldd's pipe").not.toThrow();
      await expect(said).resolves.toMatchObject({ ok: false, refused: expect.any(String) });
    }
    expect(calls).toEqual([]);
    expect(appended).toEqual([]);
    // a journal the disk does not take: refused in the journal's words, and nothing handed on
    const full = new FlowReplay({
      prior: [],
      append: () => {
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      },
      inner: handler,
    });
    await expect(full.call({ what: "agent", args: ["a"] })).resolves.toMatchObject({
      ok: false,
      refused: expect.stringMatching(/journal/),
    });
    expect(calls).toEqual([]);
  });

  it("P8: an answer nested past ARGS_DEPTH_MAX is refused to the script and journaled as a refusal, so its journal reads back (bth's review P1)", async () => {
    let deep: unknown = "x";
    for (let i = 0; i < FLOW_LIMITS.ARGS_DEPTH_MAX + 1; i++) deep = [deep];
    const appended: FlowJournalEntry[] = [];
    const append = (entry: FlowJournalEntry) => void appended.push(entry);
    const w = writer(append, () => ({ ok: true, value: deep }));
    const replay = w.bind(new FlowReplay({ prior: [], append, inner: w.handler }));
    await expect(replay.call({ what: "agent", args: ["a"] })).resolves.toMatchObject({
      ok: false,
      refused: expect.stringMatching(/nest/),
    });
    expect(w.calls).toHaveLength(1);
    expect(appended.at(-1)).toMatchObject({
      kind: "answer",
      call: 1,
      refused: expect.stringMatching(/nest/),
    });
  });

  it("P7: an answer is journaled as the pipe carries it: an undefined in a list is null, kept, and replayed so", async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-flows-replay-"));
    try {
      const records = new FlowRecords({
        dir: join(root, "fieldd", "flows"),
        keyPath: join(root, "fieldd", "flows.key"),
      });
      beganRun(records, {
        run: RUN,
        flow: "release-check",
        name: "Release check",
        n: 1,
        hash: "f".repeat(64),
        starter: { by: "you" },
      });
      const append = (entry: FlowJournalEntry) => {
        records.appendRun(RUN, entry);
      };
      const w = writer(append, () => ({ ok: true, value: [1, undefined, "x"] }));
      const replay = w.bind(new FlowReplay({ prior: [], append, inner: w.handler }));
      await expect(replay.call({ what: "agent", args: ["a"] })).resolves.toEqual({
        ok: true,
        value: [1, null, "x"],
      });
      const read = records.readRun(RUN);
      expect(read).toMatchObject({ kind: "kept" });
      const lines = (read as Extract<typeof read, { kind: "kept" }>).lines;
      expect(lines.at(-1)).toMatchObject({ kind: "answer", call: 1, value: [1, null, "x"] });
      // the host started again hears the same value, from the journal
      const again = inner();
      const replayed = new FlowReplay({
        prior: lines,
        append: () => undefined,
        inner: again.handler,
      });
      await expect(replayed.call({ what: "agent", args: ["a"] })).resolves.toEqual({
        ok: true,
        value: [1, null, "x"],
      });
      expect(again.calls).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("CP-4a2a — the journal stays fieldd's (CP4-S15)", () => {
  const roots: string[] = [];
  const runs: FlowHostRun[] = [];
  afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.stop()));
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("P9: a cut answer reaches the script marked, and its replay is byte for byte the same (finding 7, ruled (a))", async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-flows-replay-"));
    roots.push(root);
    const records = new FlowRecords({
      dir: join(root, "fieldd", "flows"),
      keyPath: join(root, "fieldd", "flows.key"),
    });
    const run = "fr-p9cutmark1";
    beganRun(records, {
      run,
      flow: "release-check",
      name: "Release check",
      n: 1,
      hash: "f".repeat(64),
      starter: { by: "you" },
    });
    const script = new TextEncoder().encode(
      'export const meta = { name: "P9" };\nexport default async function () {\n  return await agent("Review");\n}\n',
    );
    const append = (entry: FlowJournalEntry) => records.appendRun(run, entry);
    const once = async (w: ReturnType<typeof writer>): Promise<unknown> => {
      const read = records.readRun(run);
      const host = startFlowHost({
        launch: { kind: "launch", launch: await flowsHostLaunch() },
        bytes: script,
        input: {},
        handler: w.bind(
          new FlowReplay({
            prior: read.kind === "kept" ? read.lines : [],
            append,
            inner: w.handler,
          }),
        ),
        environment: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
      });
      runs.push(host);
      const deadline = Date.now() + 15_000;
      const ended = await Promise.race([
        host.ended,
        new Promise((resolve) => setTimeout(() => resolve("timeout"), deadline - Date.now())),
      ]);
      return ended;
    };
    const long = writer(append, () => ({
      ok: true,
      value: "x".repeat(FLOW_LIMITS.RESULT_MAX_BYTES + 100),
    }));
    const first = await once(long);
    expect(first).toMatchObject({ kind: "done" });
    const heard = (first as { value?: unknown }).value;
    expect(typeof heard).toBe("string");
    expect((heard as string).endsWith("…"), "the script hears the cut").toBe(true);
    // the journal keeps the pipe's text and its `cut`: the mark is the script's, never the journal's
    const kept = records.readRun(run);
    const answer = (kept.kind === "kept" ? kept.lines : []).find((line) => line.kind === "answer");
    expect(answer).toMatchObject({
      kind: "answer",
      call: 1,
      cut: true,
      value: (heard as string).slice(0, -1),
    });
    // a host started again from the journal hears the same text, byte for byte, and hands nothing on
    const again = writer(append);
    const second = await once(again);
    expect(second).toEqual({ kind: "done", value: heard });
    expect(again.calls).toEqual([]);
  });

  it("J7: no key and no MAC ever cross the pipe: the host hears values and refusals alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-flows-replay-"));
    roots.push(root);
    const keyPath = join(root, "fieldd", "flows.key");
    const records = new FlowRecords({ dir: join(root, "fieldd", "flows"), keyPath });
    const run = "fr-j7pipe0001";
    beganRun(records, {
      run,
      flow: "release-check",
      name: "Release check",
      n: 1,
      hash: "f".repeat(64),
      starter: { by: "you" },
    });
    // a stand-in child that keeps every message fieldd sends it and says them back, whole, as its one log line
    const dir = mkdtempSync(join(inject("fielddRunRoot"), "vf-fh-j7-"));
    const file = join(dir, "stand-in.cjs");
    writeFileSync(
      file,
      standInSource([
        "const heard = [];",
        "say({ t: 'ready', pid: process.pid });",
        "on((m) => {",
        "  heard.push(m);",
        "  if (m && m.t === 'run') say({ t: 'call', id: 1, what: 'agent', args: ['Review'] });",
        "  if (m && m.t === 'answer') say({ t: 'log', text: JSON.stringify(heard) });",
        "  if (m && m.t === 'shutdown') process.exit(0);",
        "});",
      ]),
    );
    const append = (entry: FlowJournalEntry) => records.appendRun(run, entry);
    const w = writer(append, () => ({ ok: true, value: { verdict: "clean" } }));
    const read = records.readRun(run);
    const host = startFlowHost({
      launch: { kind: "launch", launch: { command: process.execPath, args: [file] } },
      bytes: new TextEncoder().encode(
        'export const meta = { name: "J7" };\nexport default async function () {}\n',
      ),
      input: {},
      handler: w.bind(
        new FlowReplay({
          prior: read.kind === "kept" ? read.lines : [],
          append,
          inner: w.handler,
        }),
      ),
      environment: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
    });
    runs.push(host);
    const deadline = Date.now() + 15_000;
    while (w.logs.length === 0 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 25));
    expect(w.logs).toHaveLength(1);
    const heard = w.logs[0] as string;
    expect(existsSync(keyPath), "the store made the journal's key").toBe(true);
    const key = readFileSync(keyPath, "utf8").trim();
    expect(heard).not.toContain(key);
    // no 64-hex string at all (a MAC, a key, a call's replay key): the host is handed values, never the journal
    expect(heard).not.toMatch(/[0-9a-f]{64}/);
    // and the journal holds the call, its answer and the stand-in's log line (the host's own `log`), each MAC'd
    const kept = records.readRun(run);
    expect(kept.kind === "kept" ? kept.lines.map((line) => line.kind) : kept.kind).toEqual([
      "head",
      "call",
      "answer",
      "log",
    ]);
  });
});

describe("CP-4a2b — replay's order, and the one answer writer (§13a slice 10b; D21, D22, D7)", () => {
  /** `agent(prompt)`, as the script makes it. */
  const ask = (prompt: string): FlowHostCall => ({ what: "agent", args: [prompt] });
  /** A journal's call line: call `call`, the `n`th `agent(prompt)` of its life. */
  const made = (call: number, prompt: string, n = 1): FlowJournalEntry => ({
    kind: "call",
    call,
    what: "agent",
    key: flowCallKey("agent", [prompt]),
    n,
  });
  /** A journal's answer line. */
  const answer = (call: number, value: string): FlowJournalEntry => ({
    kind: "answer",
    call,
    value,
  });
  /** A host's replay of the journal `body`, with the runs' side scripted (no call answered unless a row does). */
  const replayOf = (body: FlowJournalEntry[]) => {
    const appended: FlowJournalEntry[] = [];
    const append = (entry: FlowJournalEntry) => void appended.push(entry);
    const w = writer(append);
    const replay = w.bind(new FlowReplay({ prior: prior(body), append, inner: w.handler }));
    return { replay, appended, append, handed: w.calls };
  };
  /** What a call is heard as, once it is: nothing until then. */
  const hearing = (said: Promise<FlowHostAnswer>) => {
    const heard: { answer?: FlowHostAnswer } = {};
    void said.then((answer) => {
      heard.answer = answer;
    });
    return heard;
  };

  it("P10 (D21): a race replayed hears its answers in journal order, so it makes again the call its first life made (C), never another (D)", async () => {
    // its first life: A and B raced, B's answer came first and the script made C; then A's answer came
    const { replay, handed, appended } = replayOf([
      made(1, "a"),
      made(2, "b"),
      answer(2, "B"),
      made(3, "c"),
      answer(1, "A"),
    ]);
    const first = await Promise.race([
      replay.call(ask("a")).then(() => "A"),
      replay.call(ask("b")).then(() => "B"),
    ]);
    void replay.call(ask(first === "B" ? "c" : "d"));
    await settle();
    expect({ first, handed, appended }).toEqual({
      first: "B",
      handed: [{ ...ask("c"), call: 3 }],
      appended: [],
    });
  });

  it("P10b (D21; the 10b fix's delta review, #1): a race made again in its first life's order hears the answers one release gives in journal order, so it makes C again, never D", async () => {
    // its first life: A and B raced; B's answer came, then A's before the script, having taken B, made C. Made again
    // A then B, B's call releases both answers at once, and the race must take B, the first the journal holds
    const { replay, handed, appended } = replayOf([
      made(1, "a"),
      made(2, "b"),
      answer(2, "B"),
      answer(1, "A"),
      made(3, "c"),
    ]);
    const first = await Promise.race([
      replay.call(ask("a")).then(() => "A"),
      replay.call(ask("b")).then(() => "B"),
    ]);
    void replay.call(ask(first === "B" ? "c" : "d"));
    await settle();
    expect({ first, handed, appended }).toEqual({
      first: "B",
      handed: [{ ...ask("c"), call: 3 }],
      appended: [],
    });
  });

  it("P11 (D21): two branches that make the same call after their own answers keep their first life's #1 and #2", async () => {
    // its first life: B's answer came first, so B's branch made C as its #1 (call 3), and A's made it as #2 (call 4)
    const { replay, handed, appended } = replayOf([
      made(1, "a"),
      made(2, "b"),
      answer(2, "B"),
      made(3, "c", 1),
      answer(1, "A"),
      made(4, "c", 2),
      answer(3, "C after B"),
      answer(4, "C after A"),
    ]);
    const after = async (prompt: string) => {
      await replay.call(ask(prompt));
      return replay.call(ask("c"));
    };
    const [afterA, afterB] = await Promise.all([after("a"), after("b")]);
    expect({ afterA, afterB, handed, appended }).toEqual({
      afterA: { ok: true, value: "C after A" },
      afterB: { ok: true, value: "C after B" },
      handed: [],
      appended: [],
    });
  });

  it("P12 (D7, D21): an answer behind a call its script never makes again is never released: the replay reads unmatched, and hands nothing on", async () => {
    // its first life made X between A and A's answer; this life never makes X
    const { replay, handed, appended } = replayOf([made(1, "a"), made(2, "x"), answer(1, "A")]);
    const a = hearing(replay.call(ask("a")));
    await settle();
    expect({ heard: a.answer, stuck: replay.stuck(), handed, appended }).toEqual({
      heard: undefined,
      stuck: "unmatched",
      handed: [],
      appended: [],
    });
  });

  it("P13 (D22): what the inner handler's call resolves to is never journaled and never heard; the script hears the answer the runs journal", async () => {
    const appended: FlowJournalEntry[] = [];
    const append = (entry: FlowJournalEntry) => void appended.push(entry);
    // a handler as handlers were before D22: its call resolves with an answer
    const late = inner(() => ({ ok: true, value: "late" }));
    const replay = new FlowReplay({ prior: [], append, inner: late.handler });
    const a = hearing(replay.call(ask("a")));
    await settle();
    const before = { heard: a.answer, appended: [...appended] };
    journalAnswer(replay, append, 1, { ok: true, value: "the runs'" });
    await settle();
    expect({ before, heard: a.answer, handed: late.calls }).toEqual({
      before: { heard: undefined, appended: [made(1, "a")] },
      heard: { ok: true, value: "the runs'" },
      handed: [{ ...ask("a"), call: 1 }],
    });
    expect(appended).toEqual([made(1, "a"), answer(1, "the runs'")]);
  });

  it("R28 (D21's one queue, scripted): an answer handed on after its host started waits behind every answer still held, and is released after them, in journal order", async () => {
    // A was answered and B out when the host parked; this life makes B first, so A's answer waits for A's call
    const { replay, append, handed } = replayOf([made(1, "a"), made(2, "b"), answer(1, "A")]);
    const order: string[] = [];
    const heardAs = (said: Promise<FlowHostAnswer>) =>
      said.then((heard) => order.push(heard.ok ? String(heard.value) : heard.refused));
    const b = heardAs(replay.call(ask("b")));
    await settle();
    journalAnswer(replay, append, 2, { ok: true, value: "B" });
    await settle();
    const early = [...order];
    const a = heardAs(replay.call(ask("a")));
    await Promise.all([a, b]);
    expect({ early, order, handed }).toEqual({
      early: [],
      order: ["A", "B"],
      handed: [{ ...ask("b"), call: 2 }],
    });
  });

  it("R31 (D7): a new call made while a call its journal holds is not made again is held: never journaled, never handed on, and read as new", async () => {
    // its first life made X after A's answer; this life makes B there instead
    const { replay, handed, appended } = replayOf([made(1, "a"), answer(1, "A"), made(2, "x")]);
    expect(await replay.call(ask("a"))).toEqual({ ok: true, value: "A" });
    const b = hearing(replay.call(ask("b")));
    await settle();
    expect({ heard: b.answer, stuck: replay.stuck(), handed, appended }).toEqual({
      heard: undefined,
      stuck: "new",
      handed: [],
      appended: [],
    });
  });

  it("P15 (Q3 (a), F21; slice 12): a call line the journal refuses takes no number: its script hears the refusal, and the next kept call is numbered as the journal counts it, so a call's number and the run's count stay one measure", async () => {
    // F21: the number is safe to use again within one life, since appendRun drops a refused line's leftover bytes
    // before the next append, and a refused append leaves its tail as it was. The mutation: take the number before the
    // append, the form before slice 12's green, and the kept call reads 2
    const appended: FlowJournalEntry[] = [];
    let refuses = 1;
    const append = (entry: FlowJournalEntry) => {
      if (entry.kind === "call" && refuses > 0) {
        refuses -= 1;
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      }
      appended.push(entry);
    };
    const w = writer(append, () => ({ ok: true, value: "kept" }));
    const replay = w.bind(new FlowReplay({ prior: [], append, inner: w.handler }));
    const refused = await replay.call(ask("a"));
    const kept = await replay.call(ask("b"));
    expect({ refused, kept, handed: w.calls, appended }).toEqual({
      refused: { ok: false, refused: JOURNAL_REFUSED },
      kept: { ok: true, value: "kept" },
      handed: [{ ...ask("b"), call: 1 }],
      appended: [made(1, "b"), answer(1, "kept")],
    });
  });

  it("F3 (D21; slice 12): a line D21's one queue has released leaves it, so a replay keeps only its unreleased tail for its host's life, never the journal it was started on", async () => {
    // its first life: A, B and C answered, then D made and never answered (its host left mid-call). V11: that the
    // journal it was started on (`prior`) is let go is shown by read, not by a row; a GC witness would need --expose-gc
    const { replay, append, handed } = replayOf([
      made(1, "a"),
      answer(1, "A"),
      made(2, "b"),
      answer(2, "B"),
      made(3, "c"),
      answer(3, "C"),
      made(4, "d"),
    ]);
    const started = replay.held();
    for (const prompt of ["a", "b", "c"]) await replay.call(ask(prompt));
    // six lines released; D's call line waits for the script to make D again
    const tail = replay.held();
    const d = replay.call(ask("d"));
    journalAnswer(replay, append, 4, { ok: true, value: "D" });
    const heard = await d;
    expect({ started, tail, done: replay.held(), heard, handed }).toEqual({
      started: 7,
      tail: 1,
      done: 0,
      heard: { ok: true, value: "D" },
      handed: [{ ...ask("d"), call: 4 }],
    });
  });

  it("F3b (D21; slice 12): a queue compacted past its threshold drops only lines it has released: calls made two at a time, each pair's second first, are heard in journal order across both compactions, and the one call not made again is its tail", async () => {
    // its first life: 1,100 calls answered, then one made and never answered: 2,201 lines. At the green D21's queue
    // compacts (QUEUE_COMPACT_AT, 1024) after call 551 (head 1104 of 2,201) and after call 1063 (head 1024 of 1,097).
    // The pairs made second first are a race replayed (D21), so a compaction that drops the next pair's first call
    // line loses that call's answer
    const CALLS = 1100;
    const body: FlowJournalEntry[] = [];
    for (let i = 1; i <= CALLS; i += 1) body.push(made(i, `p${i}`), answer(i, `A${i}`));
    body.push(made(CALLS + 1, "last"));
    const { replay, append, handed } = replayOf(body);
    // two at a time, each pair's second first (2, 1, 4, 3 …), with no await between; then one flush
    const heard: FlowHostAnswer[] = [];
    for (let k = 1; k < CALLS; k += 2) {
      void replay.call(ask(`p${k + 1}`)).then((said) => heard.push(said));
      void replay.call(ask(`p${k}`)).then((said) => heard.push(said));
    }
    await settle();
    const tail = replay.held();
    const last = hearing(replay.call(ask("last")));
    journalAnswer(replay, append, CALLS + 1, { ok: true, value: "L" });
    await settle();
    expect({ heard, tail, done: replay.held(), last: last.answer, handed }).toEqual({
      heard: Array.from({ length: CALLS }, (_, i) => ({ ok: true, value: `A${i + 1}` })),
      tail: 1,
      done: 0,
      last: { ok: true, value: "L" },
      handed: [{ ...ask("last"), call: CALLS + 1 }],
    });
  });
});
