import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentInputSender,
  FLOW_LIMITS,
  FLOW_RUNS_LISTED_MAX,
  type FlowRunRecordStep,
  type FlowStarter,
  type NeedsItemId,
  RunSummary,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowsHostLaunch } from "../src/flows/launch";
import { FlowLibrary } from "../src/flows/library";
import { FlowRecords, flowHashOf } from "../src/flows/records";
import {
  type FlowRunStarted,
  type FlowRunStartParams,
  FlowRuns,
  type FlowRunsList,
} from "../src/flows/runs";
import type { FlowStepLaunch, FlowStepOrigin, FlowStepSession } from "../src/flows/steps";
import * as words from "../src/flows/words";
import type { RpcCallError } from "../src/native-link";
import type { FlowChangedRaise } from "../src/tool-plane/rooms/you/queue";
import { flowsHostLaunch, standInSource } from "./flows-host-bundle";
import { beganRun } from "./flows-run-records";

// CP-4a2b (§13a slice 7; 13a v2.7, RULED 2026-11-05; D3, D8, D18, CP4-Q5 (a), CP4-Q20 (a)) — the runs: a start, its
// refusals, the bytes it runs, its scope and its bounds, over the REAL flow host and fieldd's real flow records, the
// ports faked. A start reads the flow against its approval and runs the bytes fieldd kept, its record first (D18); a
// changed or new flow asks before any run (N5's item); the bounds are held before any journal line (D3).

const PATH_ONLY = { PATH: process.env["PATH"] ?? "/usr/bin:/bin" };
const VELA = "sp-7k2m9q4x";
const VELA_FROM = { spark: VELA, name: "Vela", session: "run-vela" };
const WAIT_MS = 20_000;

/** A flow that logs one line and returns: no step, no gate. */
const HELLO = [
  'export const meta = { name: "Hello" };',
  "export default async function () {",
  '  log("hi");',
  '  return "done";',
  "}",
  "",
].join("\n");
/** The same flow, edited after its approval. */
const HELLO_EDITED = HELLO.replace('log("hi")', 'log("hello again")');
/** A flow that takes one input. */
const TAKES_TARGET = [
  'export const meta = { name: "Targets", input: { target: "session" } };',
  "export default async function ({ target }) {",
  '  log("target: " + target);',
  "}",
  "",
].join("\n");

const roots: string[] = [];
const opened: FlowRuns[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((runs) => runs.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A step's spawn as the runtime was asked for it, and the run's open steps when it was asked (D5: entry first). */
interface Spawned {
  readonly launch: FlowStepLaunch;
  readonly origin: FlowStepOrigin;
  readonly open: readonly FlowRunRecordStep[];
}
/** A line queued for a session, and its step's record when it was queued (D5: the intent first). */
interface Enqueued {
  readonly runtimeRunId: string;
  readonly text: string;
  readonly from: AgentInputSender;
  readonly step: FlowRunRecordStep | undefined;
}

async function harness(
  opts: {
    readonly profiles?: readonly string[];
    /** the host a run starts: fieldd's own build, or a stand-in's */
    readonly launch?: FlowsHostLaunch;
    /** the runtime's refusal of every spawn, in its words */
    readonly spawnRefuses?: string;
    /** the sessions fieldd knows, by their runtime run id */
    readonly sessions?: Readonly<Record<string, FlowStepSession>>;
    /** the folders inputs name, by `<kind>:<value>` */
    readonly folders?: Readonly<Record<string, string>>;
    /** the agents the catalog offers, by id, to the catalog's name for each */
    readonly offers?: Readonly<Record<string, string>>;
    /** the models the runtime discovers, by agent */
    readonly models?: Readonly<Record<string, readonly string[]>>;
    /** the project folders this desktop knows */
    readonly projectFolders?: readonly string[];
    /** each spark's own Agent Profile */
    readonly sparkProfiles?: Readonly<Record<string, string>>;
    /** the person's default Agent Profile; null for none */
    readonly defaultProfile?: string | null;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "vf-flow-runs-"));
  roots.push(root);
  const libraryDir = join(root, "flows");
  mkdirSync(libraryDir);
  const records = new FlowRecords({
    dir: join(root, "fieldd", "flows"),
    keyPath: join(root, "fieldd", "flows.key"),
  });
  const library = new FlowLibrary({ dir: libraryDir, records });
  const raised: FlowChangedRaise[] = [];
  let profiles: readonly string[] = opts.profiles ?? ["work", "review"];
  const spawned: Spawned[] = [];
  const enqueued: Enqueued[] = [];
  const openOf = (run: string): readonly FlowRunRecordStep[] => records.runRecord(run)?.open ?? [];
  const runs = new FlowRuns({
    library,
    records,
    needs: {
      flowChanged: (raise) => {
        raised.push(raise);
        return `ny-changed${raised.length}aaaa` as NeedsItemId;
      },
    },
    profiles: () => profiles,
    agents: {
      spawn: async (launch, origin) => {
        spawned.push({ launch, origin, open: openOf(origin.run) });
        if (opts.spawnRefuses !== undefined) throw new Error(opts.spawnRefuses);
        return { runtimeRunId: `rt-step${spawned.length}` };
      },
      offers: (agent) => {
        const label = (opts.offers ?? { claude: "Claude Code" })[agent];
        return label !== undefined ? { label } : undefined;
      },
      models: async (agent) => (opts.models ?? { claude: ["opus", "sonnet"] })[agent],
    },
    inputs: {
      enqueue: (runtimeRunId, text, from) => {
        const step =
          from.kind === "flow" ? openOf(from.run).find((s) => s.call === from.call) : undefined;
        enqueued.push({ runtimeRunId, text, from, step });
        return { id: `in-${enqueued.length}`, position: 1 };
      },
    },
    sessions: { of: (runtimeRunId) => opts.sessions?.[runtimeRunId] },
    folderOf: (kind, value) => opts.folders?.[`${kind}:${value}`],
    projectFolders: () => opts.projectFolders ?? ["/work"],
    sparkProfile: (spark) => (opts.sparkProfiles ?? { [VELA]: "work" })[spark],
    defaultProfile: () =>
      opts.defaultProfile === null ? undefined : (opts.defaultProfile ?? "work"),
    host: {
      launch: { kind: "launch", launch: opts.launch ?? (await flowsHostLaunch()) },
      environment: PATH_ONLY,
    },
  });
  opened.push(runs);
  /** a flow's file in the person's library, as they saved it */
  const write = (flow: string, text: string): Uint8Array => {
    writeFileSync(join(libraryDir, `${flow}.flow.js`), text);
    return new TextEncoder().encode(text);
  };
  /** a flow saved and approved as it stands */
  const approved = (flow: string, text: string) => records.approve(flow, write(flow, text));
  const start = (params: Partial<FlowRunStartParams> = {}): Promise<FlowRunStarted> =>
    runs.start({ flow: "hello", input: {}, starter: { by: "you" }, scope: ["work"], ...params });
  const setProfiles = (next: readonly string[]) => {
    profiles = next;
  };
  /** the run's journal's lines' kinds, as the store reads it now */
  const kinds = (run: string): string[] => {
    const read = records.readRun(run);
    return read.kind === "kept" ? read.lines.map((line) => line.kind) : [read.kind];
  };
  return {
    root,
    records,
    library,
    runs,
    raised,
    spawned,
    enqueued,
    write,
    approved,
    start,
    setProfiles,
    kinds,
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** The run a start started, or the row fails saying what it got instead. */
function startedRun(started: FlowRunStarted): RunSummary {
  if (!("run" in started)) throw new Error(`the start waits in ${started.waits}`);
  return started.run;
}

/** The summary `run` reads once it reads `state`, as onChange says it. */
function settled(runs: FlowRuns, run: string, state: string): Promise<RunSummary> {
  return new Promise((resolve, reject) => {
    let done = false;
    let off: (() => void) | undefined;
    const timer = setTimeout(() => {
      done = true;
      off?.();
      reject(new Error(`${run} never read ${state}`));
    }, WAIT_MS);
    off = runs.onChange((list) => {
      const found = list.runs.find((summary) => summary.run === run);
      if (done || found?.state !== state) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => off?.());
      resolve(found);
    });
  });
}

/** A start's refusal: its reason and its words, or "started". */
async function refusalOf(
  start: Promise<unknown>,
): Promise<{ reason?: string; message: string } | "started"> {
  try {
    await start;
    return "started";
  } catch (err) {
    const e = err as RpcCallError;
    const details = e.details as { reason?: string } | undefined;
    return {
      ...(details?.reason !== undefined ? { reason: details.reason } : {}),
      message: e.message,
    };
  }
}

/** A run kept in the store as the runs keep one, with no host: what the bounds and the list count. */
function seeded(h: Harness, i: number, state: string, starter: FlowStarter = { by: "you" }) {
  return beganRun(
    h.records,
    {
      run: `fr-seed${String(i).padStart(4, "0")}x`,
      flow: "hello",
      name: "Hello",
      n: i + 1,
      hash: "a".repeat(64),
      starter,
    },
    {
      state,
      ...(state === "running"
        ? {}
        : { endedAt: new Date(Date.UTC(2026, 10, 5, 0, i)).toISOString() }),
    },
  );
}

describe("CP-4a2b — a run starts from the bytes fieldd kept, or asks first; its scope and its bounds (§13a slice 7)", () => {
  it("R1: a run starts from the approved bytes, its record first, through the one wake, and its host runs the script to its end", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const summary = startedRun(await h.start());
    expect(RunSummary.parse(summary)).toMatchObject({
      flow: "hello",
      name: "Hello",
      n: 1,
      hash: approval.hash,
      state: "running",
      calls: 0,
      steps: [],
      starter: { by: "you" },
    });
    // D18: the run's own record stands from its start, with what the runs chose of it
    expect(h.records.runRecord(summary.run)).toMatchObject({
      scope: ["work"],
      calls: 0,
      allowed: FLOW_LIMITS.CALLS_MAX,
      open: [],
      steps: [],
    });
    // the host runs it: its log line is journaled, the run ends done, and its last log line is its summary's
    const done = await settled(h.runs, summary.run, "done");
    expect(done.log).toBe("hi");
    expect(done.endedAt).toBeDefined();
    const read = h.records.readRun(summary.run);
    expect(read.kind === "kept" ? read.lines.map((line) => line.kind) : read.kind).toEqual([
      "head",
      "log",
      "end",
    ]);
    expect(h.records.runRecord(summary.run)).toMatchObject({ state: "done", log: "hi" });
    // the same flow run again is its 2nd on this desktop
    const second = startedRun(await h.start());
    expect(second.n).toBe(2);
    await settled(h.runs, second.run, "done");
  });

  it("R2/R3: a flow changed since its approval, and one never approved, ask before any run: the item names the bytes, and nothing is journaled or kept", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    expect(await h.start()).toEqual({ waits: "ny-changed1aaaa" });
    expect(h.raised).toEqual([
      {
        script: { flow: "hello", hash: flowHashOf(edited), approved: approval.hash },
        name: "Hello",
      },
    ]);
    // a spark's flow_run of a flow never approved: its item tells that spark
    const fresh = h.write("targets", TAKES_TARGET);
    expect(
      await h.start({
        flow: "targets",
        starter: { by: "spark", spark: VELA },
        from: VELA_FROM,
        scope: ["work"],
      }),
    ).toEqual({ waits: "ny-changed2aaaa" });
    expect(h.raised[1]).toEqual({
      script: { flow: "targets", hash: flowHashOf(fresh) },
      name: "Targets",
      from: VELA_FROM,
    });
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
    expect(h.runs.list().runs).toEqual([]);
  });

  it("R7 (D8): a run's scope is frozen at its start, and narrows to the profiles that exist now, never widening", async () => {
    const h = await harness({ profiles: ["work", "review", "home"] });
    h.approved("hello", HELLO);
    const summary = startedRun(await h.start({ scope: ["work", "review"] }));
    expect(h.runs.read(summary.run)).toMatchObject({
      starter: { by: "you" },
      scope: ["work", "review"],
    });
    h.setProfiles(["work", "home"]);
    expect(h.runs.read(summary.run)?.scope).toEqual(["work"]);
    h.setProfiles(["work", "review", "home", "play"]);
    expect(h.runs.read(summary.run)?.scope).toEqual(["work", "review"]);
    expect(h.records.runRecord(summary.run)?.scope).toEqual(["work", "review"]);
    expect(h.runs.read("fr-nosuchrun")).toBeUndefined();
    await settled(h.runs, summary.run, "done");
  });

  it("R8: a start is refused, in §9's words, for a flow not in the library, a file past its bound, and an input the flow does not take", async () => {
    const h = await harness();
    expect(await refusalOf(h.start({ flow: "nowhere" }))).toEqual({
      reason: "not-found",
      message: "VibeField can't find nowhere in your flows.",
    });
    h.write("huge", `// ${"x".repeat(FLOW_LIMITS.SCRIPT_MAX_BYTES)}\n`);
    expect(await refusalOf(h.start({ flow: "huge" }))).toEqual({
      reason: "too-big",
      message: "Its file is larger than a flow may be (64 KiB).",
    });
    h.approved("targets", TAKES_TARGET);
    expect(
      await refusalOf(h.start({ flow: "targets", input: { target: "run-1", branch: "main" } })),
    ).toEqual({
      reason: "input",
      message: "Targets takes no input named branch; nothing was started.",
    });
    expect(h.records.runs()).toEqual([]);
    // the input it does take is its run's, as the journal's head keeps it
    const summary = startedRun(await h.start({ flow: "targets", input: { target: "run-1" } }));
    const read = h.records.readRun(summary.run);
    expect(read.kind === "kept" ? read.head.input : read.kind).toEqual({ target: "run-1" });
    expect((await settled(h.runs, summary.run, "done")).log).toBe("target: run-1");
  });

  it("R9: onChange tells a snapshot, then each change, from the records; list() holds at most 64, the live runs first and the rest counted", async () => {
    const h = await harness();
    for (let i = 0; i < 70; i += 1) seeded(h, i, "done");
    for (let i = 70; i < 73; i += 1) seeded(h, i, "running");
    const list = h.runs.list();
    for (const summary of list.runs) RunSummary.parse(summary);
    expect(list.runs).toHaveLength(FLOW_RUNS_LISTED_MAX);
    expect(list.runs.slice(0, 3).map((summary) => summary.state)).toEqual([
      "running",
      "running",
      "running",
    ]);
    expect(list.runs[3]?.run).toBe("fr-seed0069x");
    expect(list.earlier).toBe(73 - FLOW_RUNS_LISTED_MAX);
    const frames: FlowRunsList[] = [];
    const off = h.runs.onChange((frame) => frames.push(frame));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(list);
    h.approved("hello", HELLO);
    const summary = startedRun(await h.start());
    await settled(h.runs, summary.run, "done");
    off();
    const seen = frames.length;
    expect(seen).toBeGreaterThan(1);
    expect(frames.some((frame) => frame.runs.some((run) => run.run === summary.run))).toBe(true);
    // once off, it is told nothing more
    await settled(h.runs, startedRun(await h.start()).run, "done");
    expect(frames).toHaveLength(seen);
  });

  it("R11 (D3): a 9th run, and a spark's 3rd of its own, are refused before any journal line, in §9's words", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    for (let i = 0; i < FLOW_LIMITS.RUNS_LIVE_MAX; i += 1) seeded(h, i, "running");
    expect(await refusalOf(h.start())).toEqual({
      reason: "runs-live",
      message:
        "VibeField is running 8 flows, as many as it runs at once. Stop one, or run Hello when one ends.",
    });
    expect(h.records.runs()).toHaveLength(FLOW_LIMITS.RUNS_LIVE_MAX);

    const s = await harness();
    s.approved("hello", HELLO);
    const own = { by: "spark", spark: VELA } as const;
    for (let i = 0; i < FLOW_LIMITS.RUNS_PER_SPARK_MAX; i += 1) seeded(s, i, "running", own);
    // one ended run of its own does not count
    seeded(s, 9, "done", own);
    expect(await refusalOf(s.start({ starter: own, from: VELA_FROM }))).toEqual({
      reason: "runs-per-spark",
      message: "Vela is running 2 flows, as many as a spark may.",
    });
    expect(s.records.runs()).toHaveLength(FLOW_LIMITS.RUNS_PER_SPARK_MAX + 1);
    // a run you start in Vela's thread is yours, not the spark's own
    const yours = startedRun(await s.start({ starter: { by: "you", spark: VELA } }));
    await settled(s.runs, yours.run, "done");
  });

  it("says each refusal in DESIGN.md's own words (§9 \"When a run can't start\")", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    for (const said of [
      words.notFound("‹flow›"),
      words.tooBig(),
      words.noSuchInput("‹flow›", "‹name›"),
      words.runsLive("‹flow›"),
      words.runsPerSpark("‹spark›"),
    ]) {
      expect(said).not.toBe("");
      expect(design, said).toContain(`"${said}"`);
    }
    // ‹flow› is the meta name, and a name that is or starts with "VibeField" shows the slug (R18's rule, at the start)
    expect(words.markName("Release check", "release-check")).toBe("Release check");
    expect(words.markName("  vibefield release", "release-check")).toBe("release-check");
    expect(words.markName(undefined, "release-check")).toBe("release-check");
  });
});

// CP-4a2b (§13a slice 8a; D5, D9) — a step's agent, by the ONE spawn road (steps.ts `startStep`): the record's step
// entry before the spawn, the session on the record and the prompt's `sending` intent before it is queued, and
// `queued` in the tick the queue takes it; the prompt is the run's own words, marked as the flow's (Q-B1 (a)).

/** A flow with one step, its every option a step's card shows. */
const REVIEW = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  '  return await agent("Review the diff", {',
  '    agent: "claude",',
  '    label: "Diff",',
  '    phase: "check",',
  '    profile: "work",',
  '    cwd: "/work/app",',
  "  });",
  "}",
  "",
].join("\n");
/** The same step, its refusal caught and said as the run's log line. */
const REVIEW_CATCHES = REVIEW.replace(
  '  return await agent("Review the diff", {',
  '  try { await agent("Review the diff", {',
).replace("  });\n}", "  }); } catch (e) { log(e.message); }\n}");
/** A flow whose meta name would speak as VibeField: its mark is its slug (R18). */
const SPEAKS_AS_VIBEFIELD = REVIEW.replace('name: "Review"', 'name: "VibeField release"').replace(
  'label: "Diff"',
  'label: "Notes"',
);

/** A stand-in host that calls a `what` no flow has, and says the answer it got as its one log line. */
function unknownCallHost(root: string): FlowsHostLaunch {
  const file = join(root, "unknown-call.cjs");
  writeFileSync(
    file,
    standInSource([
      "say({ t: 'ready', pid: process.pid });",
      "on((m) => {",
      "  if (m && m.t === 'run') say({ t: 'call', id: 1, what: 'spawn', args: ['rm -rf /'] });",
      "  if (m && m.t === 'answer') say({ t: 'log', text: String(m.refused) });",
      "  if (m && m.t === 'ping') say({ t: 'pong', n: m.n });",
      "  if (m && m.t === 'shutdown') process.exit(0);",
      "});",
    ]),
  );
  return { command: process.execPath, args: [file] };
}

const waitFor = (check: () => void): Promise<void> =>
  vi.waitFor(check, { timeout: WAIT_MS, interval: 20 });

describe("CP-4a2b — a step's agent, by the one spawn road: entry first, then the spawn, then the prompt queued (§13a slice 8a)", () => {
  it("R12 (D5): one spawn, origin {by: flow, run, call: 1}, after the step's entry; the prompt queued as the flow's words after its sending intent, and queued in the same tick", async () => {
    const h = await harness();
    h.approved("review", REVIEW);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.spawned).toHaveLength(1);
    const [spawn] = h.spawned;
    expect(spawn?.launch).toEqual({
      agent: "claude",
      profileSet: "work",
      cwd: "/work/app",
      title: "Review · Diff",
    });
    expect(spawn?.origin).toEqual({ by: "flow", run, call: 1 });
    // D5 step 2: the step's entry is on the record before the spawn
    expect(spawn?.open).toEqual([
      { call: 1, label: "Diff", agent: "claude", phase: "check", state: "starting" },
    ]);
    // D5 steps 4–6: the session and the prompt's intent are on the record before the queue takes it
    const [line] = h.enqueued;
    expect(line).toEqual({
      runtimeRunId: "rt-step1",
      text: "Review the diff",
      from: { kind: "flow", flow: "review", name: "Review", run, call: 1 },
      step: {
        call: 1,
        label: "Diff",
        agent: "claude",
        phase: "check",
        session: "rt-step1",
        state: "working",
        lines: [{ line: "prompt", n: 1, sent: "sending" }],
      },
    });
    // D5 step 7: `queued`, in the tick the queue took it; the call counted (D10)
    expect(h.records.runRecord(run)).toMatchObject({
      calls: 1,
      open: [
        {
          call: 1,
          session: "rt-step1",
          state: "working",
          lines: [{ line: "prompt", n: 1, sent: "queued" }],
        },
      ],
    });
    expect(h.runs.read(run)?.summary.steps).toEqual([
      {
        call: 1,
        label: "Diff",
        agent: "claude",
        session: "rt-step1",
        phase: "check",
        state: "working",
      },
    ]);
    expect(h.kinds(run)).toEqual(["head", "call"]);

    // a run a spark started: its step's words are marked as that spark's flow (Q-B2 (a))
    const s = await harness();
    s.approved("review", REVIEW);
    const sparks = startedRun(
      await s.start({ flow: "review", starter: { by: "spark", spark: VELA }, from: VELA_FROM }),
    ).run;
    await waitFor(() => expect(s.enqueued).toHaveLength(1));
    expect(s.enqueued[0]?.from).toEqual({
      kind: "flow",
      flow: "review",
      name: "Review",
      run: sparks,
      call: 1,
      ran: "Vela",
    });
  });

  it("R12b: a spawn the runtime refuses is the step's refusal, in §9's words: journaled, the step failed, nothing queued", async () => {
    const h = await harness({ spawnRefuses: "the floor is not answering" });
    h.approved("review", REVIEW_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    const done = await settled(h.runs, run, "done");
    expect(done.log).toBe("VibeField couldn't start Diff: the floor is not answering");
    expect(h.spawned).toHaveLength(1);
    expect(h.enqueued).toEqual([]);
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
    expect(h.records.runRecord(run)).toMatchObject({
      calls: 1,
      open: [],
      steps: [{ call: 1, label: "Diff", state: "failed" }],
    });
  });

  it("R17 (D9): a call no flow makes is refused at fieldd's side and journaled as the refusal; nothing is spawned", async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-flow-standin-"));
    roots.push(root);
    const h = await harness({ launch: unknownCallHost(root) });
    h.approved("hello", HELLO);
    const run = startedRun(await h.start()).run;
    await waitFor(() => expect(h.kinds(run)).toEqual(["head", "call", "answer", "log"]));
    const read = h.records.readRun(run);
    const lines = read.kind === "kept" ? read.lines : [];
    expect(lines[1]).toMatchObject({ kind: "call", call: 1, what: "spawn" });
    expect(lines[2]).toMatchObject({
      kind: "answer",
      call: 1,
      refused: "VibeField can't send this spawn: a flow's calls are agent() and ask()",
    });
    expect(lines[3]).toMatchObject({
      kind: "log",
      text: "VibeField can't send this spawn: a flow's calls are agent() and ask()",
    });
    expect(h.spawned).toEqual([]);
    expect(h.records.runRecord(run)).toMatchObject({ calls: 1, open: [], steps: [] });
  });

  it("R18 (D9; CL-E7-14): a flow whose meta name reads as VibeField is marked by its slug, in its steps' title and its words' mark", async () => {
    const h = await harness();
    h.approved("release-check", SPEAKS_AS_VIBEFIELD);
    const run = startedRun(await h.start({ flow: "release-check" }));
    expect(run.name).toBe("release-check");
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.spawned[0]?.launch.title).toBe("release-check · Notes");
    expect(h.enqueued[0]?.from).toMatchObject({ kind: "flow", name: "release-check" });
  });
});

// CP-4a2b (§13a slice 8b; CP4-S7) — a run's step agents alive at once: LIVE_STEPS_MAX, a run's own. One more waits for
// a slot, visibly, and is never spawned past the bound. (Its start when a slot frees is slice 9's: an answer frees it.)

/** A fan-out of `n` steps at once, each its own label. */
const fanOut = (n: number): string =>
  [
    'export const meta = { name: "Fan" };',
    "export default async function () {",
    "  const steps = [];",
    `  for (let i = 1; i <= ${n}; i += 1)`,
    '    steps.push(agent("look at part " + i, { agent: "claude", label: "Part " + i, profile: "work", cwd: "/work/app" }));',
    "  return await Promise.all(steps);",
    "}",
    "",
  ].join("\n");

describe("CP-4a2b — a run's live steps, LIVE_STEPS_MAX at once (§13a slice 8b)", () => {
  it("R14 (CP4-S7): of 9 steps at once, 8 are spawned and the 9th waits for a slot on the record, never spawned; another run's steps are its own", async () => {
    const h = await harness();
    h.approved("fan", fanOut(FLOW_LIMITS.LIVE_STEPS_MAX + 1));
    const run = startedRun(await h.start({ flow: "fan" })).run;
    await waitFor(() => expect(h.records.runRecord(run)?.open).toHaveLength(9));
    await waitFor(() => expect(h.enqueued).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX));
    expect(h.spawned).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX);
    const open = h.records.runRecord(run)?.open ?? [];
    expect(open.filter((step) => step.state === "working")).toHaveLength(
      FLOW_LIMITS.LIVE_STEPS_MAX,
    );
    expect(open.find((step) => step.call === 9)).toEqual({
      call: 9,
      label: "Part 9",
      agent: "claude",
      state: "waiting",
    });
    expect(h.spawned.map((spawn) => spawn.origin.call)).not.toContain(9);
    expect(h.runs.read(run)?.summary.steps.at(-1)).toMatchObject({ call: 9, state: "waiting" });
    expect(h.records.runRecord(run)?.calls).toBe(9);
    // a second run's steps are counted against its own bound, never the first's
    h.approved("review", REVIEW);
    const other = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() =>
      expect(h.spawned.filter((spawn) => spawn.origin.run === other)).toHaveLength(1),
    );
    expect(h.spawned).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX + 1);
  });
});

// CP-4a2b (§13a slice 8c-1; D9, CP4-Q20 (a)) — what a step's call may be, held at the call with nothing spawned, in
// DESIGN.md §9's words ("A step's call refused"): its option keys, its Agent Profile within the run's scope, an `in:`
// that names a live session within scope that is no spark's own and no other flow's and waits on no permission; and
// the folder a step with none runs in, the one its run's input names.

/** A flow that calls a step with each of `calls`' options in turn, keeping each refusal; then awaits `last`'s. */
const callsEach = (calls: readonly object[], last?: object): string =>
  [
    'export const meta = { name: "Checks", input: { target: "session" } };',
    "export default async function () {",
    `  for (const options of ${JSON.stringify(calls)}) {`,
    '    try { await agent("go", options); } catch (e) { log(e.message); }',
    "  }",
    ...(last !== undefined
      ? [`  return await agent("Review this", ${JSON.stringify(last)});`]
      : []),
    "}",
    "",
  ].join("\n");

/** The refusals a run's journal kept, in its calls' order. */
function refusalsOf(h: Harness, run: string): string[] {
  const read = h.records.readRun(run);
  return read.kind === "kept"
    ? read.lines.flatMap((line) =>
        line.kind === "answer" && line.refused !== undefined ? [line.refused] : [],
      )
    : [];
}

const IN_REFUSED =
  "VibeField didn't send ‹label›: that session is outside this run's Agent Profiles, isn't running, is a spark's or another flow's, or is waiting on a permission.";
const NO_FOLDER =
  "None of its steps names a folder, and its input names none. Run it from a session or a project, or name a folder in it.";

describe("CP-4a2b — what a step's call may be, held at the call with nothing spawned (§13a slice 8c-1)", () => {
  it("R16 (D9): a key a step may not set, and an Agent Profile outside the run's scope, are refused in §9's words with no spawn", async () => {
    const h = await harness();
    h.approved(
      "checks",
      callsEach([
        { agent: "claude", label: "Budget", cwd: "/work/app", profile: "work", budget: 5 },
        { agent: "claude", label: "Review", cwd: "/work/app", profile: "review" },
        { agent: "claude", label: "Gone", cwd: "/work/app", profile: "nowhere" },
      ]),
    );
    const run = startedRun(await h.start({ flow: "checks", scope: ["work"] })).run;
    await settled(h.runs, run, "done");
    expect(refusalsOf(h, run)).toEqual([
      "VibeField didn't start Budget: it asks for budget, which a step may not set.",
      "VibeField didn't start Review: it names an Agent Profile this run can't use (review).",
      "VibeField didn't start Gone: it names an Agent Profile this run can't use (nowhere).",
    ]);
    expect(h.spawned).toEqual([]);
    expect(h.records.runRecord(run)).toMatchObject({ calls: 3, open: [] });
    expect(h.records.runRecord(run)?.steps.map((step) => step.state)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
  });

  it("R15 (D9): an in: that names a session gone, outside the scope, another flow's step, a spark's own, or one on a permission is refused, nothing sent; your own session in scope is handed the line", async () => {
    const yours: FlowStepSession = { live: true, profile: "work", onPermission: false };
    const h = await harness({
      sessions: {
        "run-yours": yours,
        "run-exited": { ...yours, live: false },
        "run-home": { ...yours, profile: "home" },
        "run-other-flow": { ...yours, origin: { by: "flow", run: "fr-0ther0ther0ther0" } },
        "run-vela": { ...yours, spark: VELA },
        "run-asking": { ...yours, onPermission: true },
      },
    });
    const refused = [
      "run-nowhere",
      "run-exited",
      "run-home",
      "run-other-flow",
      "run-vela",
      "run-asking",
    ];
    h.approved(
      "checks",
      callsEach(
        refused.map((session) => ({ in: session, label: session })),
        { in: "run-yours", label: "Yours" },
      ),
    );
    const run = startedRun(
      await h.start({ flow: "checks", input: { target: "run-yours" }, scope: ["work"] }),
    ).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(refusalsOf(h, run)).toEqual(
      refused.map((session) => IN_REFUSED.replace("‹label›", session)),
    );
    expect(h.spawned).toEqual([]);
    expect(h.enqueued[0]).toEqual({
      runtimeRunId: "run-yours",
      text: "Review this",
      from: { kind: "flow", flow: "checks", name: "Checks", run, call: refused.length + 1 },
      step: {
        call: refused.length + 1,
        label: "Yours",
        session: "run-yours",
        handed: true,
        state: "working",
        lines: [{ line: "in", n: 1, sent: "sending" }],
      },
    });
    expect(h.records.runRecord(run)?.open).toEqual([
      {
        call: refused.length + 1,
        label: "Yours",
        session: "run-yours",
        handed: true,
        state: "working",
        lines: [{ line: "in", n: 1, sent: "queued" }],
      },
    ]);
  });

  it("the folder (CP4-Q20 (a)): a step with no folder runs in the one its run's input names, a session's or a project's; with none named, its call is refused in §9's words", async () => {
    const h = await harness({
      folders: { "session:run-yours": "/work/yours", "project:pj-1": "/work/pj1" },
    });
    const noFolder = (name: string, input: string) =>
      [
        `export const meta = { name: "${name}", input: ${input} };`,
        "export default async function () {",
        "  const none = {};",
        '  try { await agent("go", { agent: "claude", profile: "work", label: "Here", cwd: none.cwd }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n");
    h.approved("in-session", noFolder("In session", '{ target: "session" }'));
    h.approved("in-project", noFolder("In project", '{ where: "project" }'));
    h.approved("nowhere", noFolder("Nowhere", '{ note: "text" }'));
    const inSession = startedRun(
      await h.start({ flow: "in-session", input: { target: "run-yours" } }),
    ).run;
    const inProject = startedRun(
      await h.start({ flow: "in-project", input: { where: "pj-1" } }),
    ).run;
    await waitFor(() => expect(h.spawned).toHaveLength(2));
    const cwdOf = (run: string) => h.spawned.find((spawn) => spawn.origin.run === run)?.launch.cwd;
    expect(cwdOf(inSession)).toBe("/work/yours");
    expect(cwdOf(inProject)).toBe("/work/pj1");
    const nowhere = startedRun(await h.start({ flow: "nowhere", input: { note: "hello" } })).run;
    expect((await settled(h.runs, nowhere, "done")).log).toBe(NO_FOLDER);
    expect(h.spawned).toHaveLength(2);
  });
});

// CP-4a2b (§13a slice 8c-2; D9, A1–A3, ruled 2026-11-06, confirmed) — the rest of what a step's call
// may be, in §9's PROPOSED lines (dd7eb1c53): its agent, offered by the catalog's door; its model, a model's name the
// runtime discovered for that agent; its folder, within its run's folder or a project this desktop knows; its
// prompt, words; its Agent Profile when it names none, the spark's own or your default, held to the run's scope, and
// never the runtime's own default; and an `in:` that sets none of a spawn's keys.

const W = (label: string, why: string) => `VibeField didn't start ${label}: ${why}`;

describe("CP-4a2b — a step's agent, model, folder, prompt and profile, held at the call with nothing spawned (§13a slice 8c-2)", () => {
  it("R16 (D9; W-a…W-f, A1, A3): no agent, one not offered, a model it doesn't offer or not written as a name, a folder outside the bound, and a spawn's key beside in:, each refused with no spawn; a discovered model starts", async () => {
    const h = await harness({
      sessions: { "run-yours": { live: true, profile: "work", onPermission: false } },
    });
    const at = { cwd: "/work/app", profile: "work" };
    h.approved(
      "checks",
      callsEach(
        [
          { ...at, label: "No agent" },
          { ...at, label: "Seven", agent: 7 },
          { ...at, label: "Nobody", agent: "nobody" },
          { ...at, label: "Flag", agent: "claude", model: "--dangerously-skip-permissions" },
          { ...at, label: "Shape", agent: "claude", model: { modelId: "opus" } },
          { label: "Outside", agent: "claude", profile: "work", cwd: "/etc" },
          { label: "Climbs", agent: "claude", profile: "work", cwd: "/work/../etc" },
          { label: "Relative", agent: "claude", profile: "work", cwd: "app" },
          { label: "Both", in: "run-yours", agent: "claude" },
        ],
        { ...at, label: "Opus", agent: "claude", model: "opus" },
      ),
    );
    const run = startedRun(
      await h.start({ flow: "checks", input: { target: "run-yours" }, scope: ["work"] }),
    ).run;
    await waitFor(() => expect(h.spawned).toHaveLength(1));
    expect(refusalsOf(h, run)).toEqual([
      W("No agent", "it names no agent."),
      W("Seven", "it names no agent."),
      W("Nobody", "it names an agent VibeField doesn't start (nobody)."),
      W("Flag", "it names a model Claude Code doesn't offer (--dangerously-skip-permissions)."),
      W("Shape", "its model isn't written as a model's name."),
      W("Outside", "its folder (etc) is outside this run's folder and your projects."),
      W("Climbs", "its folder (etc) is outside this run's folder and your projects."),
      W("Relative", "its folder (app) is outside this run's folder and your projects."),
      W("Both", "it asks for agent, which a step may not set."),
    ]);
    expect(h.enqueued).toHaveLength(1);
    expect(h.spawned[0]?.launch).toEqual({
      agent: "claude",
      cwd: "/work/app",
      profileSet: "work",
      model: { modelId: "opus" },
      title: "Checks · Opus",
    });
  });

  it("W-e: a prompt that isn't words is refused, with nothing spawned", async () => {
    const h = await harness();
    h.approved(
      "numbers",
      [
        'export const meta = { name: "Numbers" };',
        "export default async function () {",
        '  try { await agent(42, { agent: "claude", label: "Count", profile: "work", cwd: "/work/app" }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n"),
    );
    const run = startedRun(await h.start({ flow: "numbers" })).run;
    expect((await settled(h.runs, run, "done")).log).toBe(W("Count", "its prompt isn't words."));
    expect(h.spawned).toEqual([]);
  });

  it("A2 (W-g): a step that names no Agent Profile takes your default, or the spark's own for its run, each held to the run's scope; with none to give it, it is refused, never the runtime's own default", async () => {
    const unnamed = (name: string) =>
      [
        `export const meta = { name: "${name}" };`,
        "export default async function () {",
        '  try { await agent("go", { agent: "claude", label: "Go", cwd: "/work/app" }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n");
    // yours takes your default, and the spark's run its own
    const h = await harness({ sparkProfiles: { [VELA]: "review" } });
    h.approved("unnamed", unnamed("Unnamed"));
    const yours = startedRun(await h.start({ flow: "unnamed", scope: ["work", "review"] })).run;
    const velas = startedRun(
      await h.start({
        flow: "unnamed",
        starter: { by: "spark", spark: VELA },
        from: VELA_FROM,
        scope: ["work", "review"],
      }),
    ).run;
    await waitFor(() => expect(h.spawned).toHaveLength(2));
    const profileOf = (run: string) =>
      h.spawned.find((spawn) => spawn.origin.run === run)?.launch.profileSet;
    expect(profileOf(yours)).toBe("work");
    expect(profileOf(velas)).toBe("review");
    // a default outside the run's scope is refused as a named one is
    const outside = await harness({ defaultProfile: "home", profiles: ["work", "home"] });
    outside.approved("unnamed", unnamed("Unnamed"));
    const homeless = startedRun(await outside.start({ flow: "unnamed", scope: ["work"] })).run;
    expect((await settled(outside.runs, homeless, "done")).log).toBe(
      W("Go", "it names an Agent Profile this run can't use (home)."),
    );
    // no default at all: refused, never the runtime's own
    const none = await harness({ defaultProfile: null });
    none.approved("unnamed", unnamed("Unnamed"));
    const bare = startedRun(await none.start({ flow: "unnamed" })).run;
    expect((await settled(none.runs, bare, "done")).log).toBe(
      W("Go", "it names no Agent Profile, and this run has none to give it."),
    );
    expect([...outside.spawned, ...none.spawned]).toEqual([]);
  });

  it("says each step refusal in DESIGN.md's own words (§9 \"A step's call refused\")", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    for (const said of [
      W("‹label›", "it names no agent."),
      W("‹label›", "it names an agent VibeField doesn't start (‹agent›)."),
      W("‹label›", "it names a model ‹agent› doesn't offer (‹model›)."),
      W("‹label›", "its model isn't written as a model's name."),
      W("‹label›", "it names no Agent Profile, and this run has none to give it."),
      W("‹label›", "its folder (‹folder›) is outside this run's folder and your projects."),
      W("‹label›", "its prompt isn't words."),
      W("‹label›", "it names an Agent Profile this run can't use (‹profile›)."),
      W("‹label›", "it asks for ‹key›, which a step may not set."),
    ])
      expect(design, said).toContain(`"${said}"`);
  });
});
