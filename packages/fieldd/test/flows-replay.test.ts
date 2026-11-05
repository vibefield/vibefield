import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLOW_LIMITS, FLOW_RECORD_FORMAT, type FlowJournalKnownLine } from "@vibefield/contracts";
import { afterEach, describe, expect, inject, it } from "vitest";
import type { FlowJournalEntry } from "../src/flows/journal";
import { FlowRecords } from "../src/flows/records";
import { FlowReplay, flowCallKey } from "../src/flows/replay";
import {
  type FlowCallHandler,
  type FlowHostAnswer,
  type FlowHostCall,
  type FlowHostRun,
  startFlowHost,
} from "../src/flows/supervisor";
import { flowsHostLaunch, standInSource } from "./flows-host-bundle";

// CP-4a2a (step0-cp4a2.md §12 commit 8; CP-D9) — replay: a run's calls answered from its journal by their key and
// `#n`, never handed on twice; a new call journaled before it is handed on, then its answer. And J7: the journal's key
// and its MACs never reach the host.

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

  it("P3: a call the journal already answered is answered from it, never handed on, and a refusal replays as one", async () => {
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

  it("P4: a new call is journaled, handed on once with its number, and its answer journaled after", async () => {
    const key = flowCallKey("agent", ["a"]);
    const { handler, calls } = inner(() => ({ ok: true, value: "fresh" }));
    const appended: FlowJournalEntry[] = [];
    const replay = new FlowReplay({
      prior: prior([
        { kind: "call", call: 1, what: "agent", key, n: 1 },
        { kind: "answer", call: 1, value: "old" },
      ]),
      append: (entry) => appended.push(entry),
      inner: handler,
    });
    expect(await replay.call({ what: "agent", args: ["a"] })).toEqual({ ok: true, value: "old" });
    // the same call a second time is new: #2, call 2
    expect(await replay.call({ what: "agent", args: ["a"] })).toEqual({ ok: true, value: "fresh" });
    expect(calls).toEqual([{ what: "agent", args: ["a"], call: 2 }]);
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
    const { handler, calls } = inner(() => ({ ok: true, value: deep }));
    const appended: FlowJournalEntry[] = [];
    const replay = new FlowReplay({
      prior: [],
      append: (entry) => appended.push(entry),
      inner: handler,
    });
    await expect(replay.call({ what: "agent", args: ["a"] })).resolves.toMatchObject({
      ok: false,
      refused: expect.stringMatching(/nest/),
    });
    expect(calls).toHaveLength(1);
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
      records.beginRun({
        run: RUN,
        flow: "release-check",
        name: "Release check",
        n: 1,
        hash: "f".repeat(64),
        starter: { by: "you" },
      });
      const { handler } = inner(() => ({ ok: true, value: [1, undefined, "x"] }));
      const replay = new FlowReplay({
        prior: [],
        append: (entry) => {
          records.appendRun(RUN, entry);
        },
        inner: handler,
      });
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
    records.beginRun({
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
    const once = async (handler: FlowCallHandler): Promise<unknown> => {
      const read = records.readRun(run);
      const host = startFlowHost({
        launch: { kind: "launch", launch: await flowsHostLaunch() },
        bytes: script,
        input: {},
        handler: new FlowReplay({
          prior: read.kind === "kept" ? read.lines : [],
          append: (entry) => records.appendRun(run, entry),
          inner: handler,
        }),
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
    const long = inner(() => ({ ok: true, value: "x".repeat(FLOW_LIMITS.RESULT_MAX_BYTES + 100) }));
    const first = await once(long.handler);
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
    const again = inner();
    const second = await once(again.handler);
    expect(second).toEqual({ kind: "done", value: heard });
    expect(again.calls).toEqual([]);
  });

  it("J7: no key and no MAC ever cross the pipe: the host hears values and refusals alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-flows-replay-"));
    roots.push(root);
    const keyPath = join(root, "fieldd", "flows.key");
    const records = new FlowRecords({ dir: join(root, "fieldd", "flows"), keyPath });
    const run = "fr-j7pipe0001";
    records.beginRun({
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
    const { handler, logs } = inner(() => ({ ok: true, value: { verdict: "clean" } }));
    const read = records.readRun(run);
    const host = startFlowHost({
      launch: { kind: "launch", launch: { command: process.execPath, args: [file] } },
      bytes: new TextEncoder().encode(
        'export const meta = { name: "J7" };\nexport default async function () {}\n',
      ),
      input: {},
      handler: new FlowReplay({
        prior: read.kind === "kept" ? read.lines : [],
        append: (entry) => records.appendRun(run, entry),
        inner: handler,
      }),
      environment: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
    });
    runs.push(host);
    const deadline = Date.now() + 15_000;
    while (logs.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(logs).toHaveLength(1);
    const heard = logs[0] as string;
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
