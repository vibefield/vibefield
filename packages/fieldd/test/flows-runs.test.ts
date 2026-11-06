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
  RECORD_STORES,
  RunSummary,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowStepEvents, type FlowStepTurnEnd } from "../src/flow-step-events";
import { RUNS_DIR } from "../src/flows/journal";
import type { FlowsHostLaunch } from "../src/flows/launch";
import { FlowLibrary } from "../src/flows/library";
import { FlowRecords, flowHashOf } from "../src/flows/records";
import {
  type FlowRunSpark,
  type FlowRunStarted,
  type FlowRunStartParams,
  FlowRuns,
  type FlowRunsList,
} from "../src/flows/runs";
import {
  type FlowStepLaunch,
  type FlowStepOrigin,
  type FlowStepSession,
  stepFailed,
} from "../src/flows/steps";
import * as words from "../src/flows/words";
import type { RpcCallError } from "../src/native-link";
import { recordsUnreadable, UNREADABLE_WORDS } from "../src/signed-record";
import type {
  FlowChangedRaise,
  FlowItemRaise,
  FlowItemStarted,
} from "../src/tool-plane/rooms/you/queue";
import { fakeAgent } from "./flow-step-agent";
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
/** A session an `in:` handed a step, as the runs told the step listener (9b): how many lines were queued at the hand,
 * and whether the runs let it go. */
interface Handed {
  readonly runtimeRunId: string;
  readonly run: string;
  readonly call: number;
  readonly at: number;
  gone: boolean;
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
    /** the sessions the step listener never heard enter: a hand on one answers none (review F3) */
    readonly unheard?: readonly string[];
    /** the step listener itself (flow-step-events.ts), for a row whose turn ends go through it (slices 7–9 review F3):
     * the harness's endTurn then reaches nothing */
    readonly stepEvents?: FlowStepEvents;
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
  /** each spark by its name and its Agent Profiles now (CP-L4): a spark not here is gone */
  const sparks = new Map<string, FlowRunSpark>([
    [VELA, { name: "Vela", profiles: ["work", "review"] }],
  ]);
  const spawned: Spawned[] = [];
  const enqueued: Enqueued[] = [];
  const hands: Handed[] = [];
  const items: FlowItemRaise[] = [];
  const turnListeners = new Set<(end: FlowStepTurnEnd) => void>();
  /** what fieldd's log was told at warn, in order */
  const warned: { event: string; fields: LogFields | undefined }[] = [];
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event, _message, fields) => void warned.push({ event, fields }),
    error: () => undefined,
    fatal: () => undefined,
    isLevelEnabled: () => true,
  };
  /** a step's turn ended, as flow-step-events.ts tells it */
  const endTurn = (end: FlowStepTurnEnd) => {
    for (const listener of turnListeners) listener(end);
  };
  const openOf = (run: string): readonly FlowRunRecordStep[] => records.runRecord(run)?.open ?? [];
  const runs = new FlowRuns({
    library,
    records,
    needs: {
      flowChanged: (raise) => {
        raised.push(raise);
        return `ny-changed${raised.length}aaaa` as NeedsItemId;
      },
      flowItem: (raise) => {
        items.push(raise);
        return `ny-item${items.length}aaaaaa` as NeedsItemId;
      },
    },
    stepEnds: opts.stepEvents ?? {
      onTurnEnd: (listener) => {
        turnListeners.add(listener);
        return () => turnListeners.delete(listener);
      },
      hand: (runtimeRunId, step) => {
        if (opts.unheard?.includes(runtimeRunId)) return undefined;
        const handed: Handed = { runtimeRunId, ...step, at: enqueued.length, gone: false };
        hands.push(handed);
        return () => {
          handed.gone = true;
        };
      },
    },
    profiles: () => profiles,
    sparkOf: (spark) => sparks.get(spark),
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
    logger,
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
  /** a spark's Agent Profiles from now on, or (undefined) the spark gone */
  const setSparkScope = (spark: string, scope: readonly string[] | undefined) => {
    const known = sparks.get(spark);
    if (scope === undefined) sparks.delete(spark);
    else sparks.set(spark, { name: known?.name ?? spark, profiles: scope });
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
    items,
    endTurn,
    spawned,
    enqueued,
    hands,
    write,
    approved,
    start,
    setProfiles,
    setSparkScope,
    kinds,
    warned,
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
    // Q4 (ruled 2026-11-06 (c)): the item's record keeps the start as it was asked, so an act begins this same run
    expect(h.raised).toEqual([
      {
        script: { flow: "hello", hash: flowHashOf(edited), approved: approval.hash },
        name: "Hello",
        start: { input: {}, starter: { by: "you" }, scope: ["work"] },
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
      start: { input: {}, starter: { by: "spark", spark: VELA }, scope: ["work"] },
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
    // the session its input names is one VibeField can find (R8b)
    const h = await harness({ folders: { "session:run-1": "/work/one" } });
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
      words.noSparkProfiles("‹spark›"),
      words.noProfiles(),
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

/** `n` spawned steps at once, then one handed your session by `in:`, then one more spawned (F9). */
const slotsAndAHand = (n: number): string =>
  [
    'export const meta = { name: "Slots" };',
    "export default async function () {",
    "  const steps = [];",
    `  for (let i = 1; i <= ${n}; i += 1)`,
    '    steps.push(agent("look at part " + i, { agent: "claude", label: "Part " + i, profile: "work", cwd: "/work/app" }));',
    '  steps.push(agent("Review this", { in: "run-yours", label: "Yours" }));',
    '  steps.push(agent("one more", { agent: "claude", label: "More", profile: "work", cwd: "/work/app" }));',
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
      folders: { "session:run-yours": "/work/yours" },
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
      folders: { "session:run-yours": "/work/yours" },
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

// CP-4a2b (§13a slice 9; CP4-S2, CP4-Q7 (a), D11, D12, D22, CL-H6) — a step's answer: its turn's end, heard through
// flow-step-events.ts, answered once ({text}, and a form's fields beside it, Q-A1 (a)), bounded WHOLE by the one
// cutter (boundedAnswer, U-a), checked against its form (form-check.ts); a miss is the repair turn, once, with
// nothing journaled, and a second miss holds the run on the person (`flow-repair`), whose Ask once more sends the line
// again. A late turn end journals nothing; a failed turn is "‹label› failed."; an answer frees its slot (R14b).

const STEP_AT = '{ agent: "claude", label: "Diff", profile: "work", cwd: "/work/app" }';
const FORM =
  '{ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] }';
/** One step, its answer's text said as the run's log line, and returned. */
const ANSWERED = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  `  const said = await agent("Review the diff", ${STEP_AT});`,
  "  log(said.text);",
  "  return said;",
  "}",
  "",
].join("\n");
/** One step with a form, its verdict said as the run's log line. */
const FORMED = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  `  const said = await agent("Review the diff", { ...${STEP_AT}, schema: ${FORM} });`,
  '  log(said.verdict + " " + (said.text.length < 70000));',
  "  return said;",
  "}",
  "",
].join("\n");
/** FORMED, its step's refusal caught and said as the run's log line. */
const FORMED_CATCHES = [
  'export const meta = { name: "Review" };',
  "export default async function () {",
  `  try { await agent("Review the diff", { ...${STEP_AT}, schema: ${FORM} }); } catch (e) { log(e.message); }`,
  "}",
  "",
].join("\n");
const fenced = (json: string) => `\`\`\`json\n${json}\n\`\`\``;
const repairLine = (check: string) =>
  `your last message did not match this step's form (${check}). Answer once more in that form.`;

/** A FORMED_CATCHES run whose step missed its form twice, so the run is held on the person (CP4-Q7 (a)). */
async function heldOnRepair(h: Harness): Promise<string> {
  h.approved("review", FORMED_CATCHES);
  const run = startedRun(await h.start({ flow: "review" })).run;
  await waitFor(() => expect(h.enqueued).toHaveLength(1));
  const at = { run, call: 1, runtimeRunId: "rt-step1", outcome: "completed" } as const;
  h.endTurn({ ...at, turn: "t1", text: "no json here" });
  await waitFor(() => expect(h.enqueued).toHaveLength(2));
  h.endTurn({ ...at, turn: "t2", text: "still none" });
  await waitFor(() => expect(h.items).toHaveLength(1));
  return run;
}

/** The person's Ask once more on a held run's first item. */
const askOnceMore = (h: Harness, run: string) =>
  h.runs.acts.answer({
    id: "ny-item1aaaaaa" as NeedsItemId,
    kind: "flow-repair",
    run: { run, flow: "review", call: 1, label: "Diff" },
    choice: 0,
    stop: false,
  });

/** The run's journal's answer lines, in order. */
function answersOf(h: Harness, run: string) {
  const read = h.records.readRun(run);
  return read.kind === "kept" ? read.lines.filter((line) => line.kind === "answer") : [];
}

describe("CP-4a2b — a step's answer: heard once, bounded whole, checked against its form, repaired once (§13a slice 9)", () => {
  it("R19 (D22; slices 7–9 review F3): a step's turn end is its answer, journaled once; the same turn told again journals nothing, and a missed end told twice with no turn id is one repair", async () => {
    const h = await harness();
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const end = {
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
    } as const;
    h.endTurn({ ...end, text: "all clean" });
    h.endTurn({ ...end, text: "all clean" });
    expect((await settled(h.runs, run, "done")).log).toBe("all clean");
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
    expect(answersOf(h, run)[0]).toMatchObject({ call: 1, value: { text: "all clean" } });
    expect(h.records.runRecord(run)).toMatchObject({
      open: [],
      steps: [{ call: 1, label: "Diff", session: "rt-step1", state: "answered" }],
    });
    // F3: a form step's missed end told twice with no turn id, through the step listener itself, is one repair: no
    // item, the step still repairing, and the repaired answer settles it
    const events = new FlowStepEvents();
    const f = await harness({ stepEvents: events });
    f.approved("review", FORMED);
    const formed = startedRun(await f.start({ flow: "review" })).run;
    await waitFor(() => expect(f.enqueued).toHaveLength(1));
    const step = fakeAgent();
    events.entered({
      agent: step.agent,
      runtimeRunId: "rt-step1",
      begun: "spawn",
      origin: { by: "flow", run: formed, call: 1 },
    });
    step.emit("turn:started", {});
    step.emit("turn:completed", { lastAssistantMessage: "no json here" });
    step.emit("turn:completed", { lastAssistantMessage: "no json here" });
    await waitFor(() => expect(f.enqueued).toHaveLength(2));
    expect(f.items).toEqual([]);
    expect(f.records.runRecord(formed)?.open[0]?.state).toBe("repairing");
    step.emit("turn:started", {});
    step.emit("turn:completed", { lastAssistantMessage: fenced('{"verdict":"clean"}') });
    expect((await settled(f.runs, formed, "done")).log).toBe("clean true");
    expect(f.enqueued).toHaveLength(2);
    expect(f.items).toEqual([]);
  });

  it("R24: a turn end for a step already answered journals nothing, while its run goes on", async () => {
    const h = await harness();
    h.approved(
      "two",
      [
        'export const meta = { name: "Two" };',
        "export default async function () {",
        `  const a = await agent("one", { ...${STEP_AT}, label: "One" });`,
        `  const b = await agent("two", { ...${STEP_AT}, label: "Two" });`,
        '  log(a.text + " " + b.text);',
        "}",
        "",
      ].join("\n"),
    );
    const run = startedRun(await h.start({ flow: "two" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "first",
    });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t2",
      outcome: "completed",
      text: "late",
    });
    h.endTurn({
      run,
      call: 2,
      runtimeRunId: "rt-step2",
      turn: "t1",
      outcome: "completed",
      text: "second",
    });
    expect((await settled(h.runs, run, "done")).log).toBe("first second");
    expect(answersOf(h, run).map((line) => line.value)).toEqual([
      { text: "first" },
      { text: "second" },
    ]);
  });

  it("R20 (Q-A1 (a)): a step with a form answers its fields beside its text, the form's JSON read from the last fenced block", async () => {
    const h = await harness();
    h.approved("review", FORMED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const text = `Looked at it.\n${fenced('{"verdict":"clean"}')}`;
    h.endTurn({ run, call: 1, runtimeRunId: "rt-step1", turn: "t1", outcome: "completed", text });
    expect((await settled(h.runs, run, "done")).log).toBe("clean true");
    expect(answersOf(h, run)[0]?.value).toEqual({ verdict: "clean", text });
  });

  it("R20b (D12): a form the run can't check is refused at the call, in §9's words, with nothing spawned", async () => {
    const h = await harness();
    h.approved(
      "forms",
      callsEach([
        {
          agent: "claude",
          label: "Pattern",
          profile: "work",
          cwd: "/work/app",
          schema: { type: "object", pattern: "x" },
        },
        {
          agent: "claude",
          label: "Top",
          profile: "work",
          cwd: "/work/app",
          schema: { type: "string" },
        },
      ]),
    );
    const run = startedRun(await h.start({ flow: "forms" })).run;
    await settled(h.runs, run, "done");
    expect(refusalsOf(h, run)).toEqual([
      "VibeField can't check Pattern's form: it uses pattern, which a flow's form may not. A form takes type, properties, required, items and enum.",
      "VibeField can't check Top's form: a form's top takes type object.",
    ]);
    expect(h.spawned).toEqual([]);
  });

  it("R21/R22 (CP4-Q7 (a)): a miss is the repair line once, naming no field, nothing journaled; a 2nd miss holds the run on flow-repair, whose Ask once more sends the line again (n: 2)", async () => {
    const h = await harness();
    h.approved("review", FORMED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const at = { run, call: 1, runtimeRunId: "rt-step1", outcome: "completed" } as const;
    h.endTurn({ ...at, turn: "t1", text: "no json here" });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    const repair = repairLine("the answer holds no JSON the form can read");
    expect(h.enqueued[1]).toMatchObject({
      runtimeRunId: "rt-step1",
      text: repair,
      from: { kind: "fieldd", flow: { run, call: 1, line: "repair", n: 1 } },
    });
    expect(h.enqueued[1]?.text).not.toContain("verdict");
    expect(h.records.runRecord(run)?.open[0]).toMatchObject({
      state: "repairing",
      lines: [
        { line: "prompt", n: 1, sent: "queued" },
        { line: "repair", n: 1, sent: "queued" },
      ],
    });
    expect(h.kinds(run)).toEqual(["head", "call"]);
    // a second miss holds the run on the person
    h.endTurn({ ...at, turn: "t2", text: "still none" });
    await waitFor(() => expect(h.items).toHaveLength(1));
    expect(h.items[0]).toEqual({
      kind: "flow-repair",
      run: { run, flow: "review", call: 1, label: "Diff" },
      name: "Review",
      acts: ["Ask once more"],
    });
    expect(h.records.runRecord(run)).toMatchObject({
      held: { item: "ny-item1aaaaaa", kind: "flow-repair" },
      open: [{ call: 1, state: "holding" }],
    });
    expect(h.enqueued).toHaveLength(2);
    // Ask once more sends the same line again, its 2nd
    expect(
      await h.runs.acts.answer({
        id: "ny-item1aaaaaa" as NeedsItemId,
        kind: "flow-repair",
        run: { run, flow: "review", call: 1, label: "Diff" },
        choice: 0,
        stop: false,
      }),
    ).toEqual({ outcome: "done" });
    expect(h.enqueued[2]).toMatchObject({
      text: repair,
      from: { kind: "fieldd", flow: { run, call: 1, line: "repair", n: 2 } },
    });
    expect(h.records.runRecord(run)?.held).toBeUndefined();
    expect(h.records.runRecord(run)?.open[0]?.state).toBe("repairing");
    h.endTurn({ ...at, turn: "t3", text: fenced('{"verdict":"clean"}') });
    expect((await settled(h.runs, run, "done")).log).toBe("clean true");
  });

  it("R22b (1c review Y2): Ask once more whose repair line is queued, and whose record can't say so, is done: the refusal is logged, never thrown, and the agent's answer settles the step", async () => {
    const h = await harness();
    h.approved("review", FORMED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const at = { run, call: 1, runtimeRunId: "rt-step1", outcome: "completed" } as const;
    h.endTurn({ ...at, turn: "t1", text: "no json here" });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    h.endTurn({ ...at, turn: "t2", text: "still none" });
    await waitFor(() => expect(h.items).toHaveLength(1));
    // the record refuses the write that marks Ask once more's line queued
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((kept, fields) => {
      const again = (line: { line: string; n: number; sent: string }) =>
        line.line === "repair" && line.n === 2 && line.sent === "queued";
      const queued = fields.open.some((step) => step.lines?.some(again));
      if (!refused && queued) {
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      }
      write(kept, fields);
    });
    expect(
      await h.runs.acts.answer({
        id: "ny-item1aaaaaa" as NeedsItemId,
        kind: "flow-repair",
        run: { run, flow: "review", call: 1, label: "Diff" },
        choice: 0,
        stop: false,
      }),
    ).toEqual({ outcome: "done" });
    expect(h.enqueued).toHaveLength(3);
    expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.step.queued");
    expect(h.records.runRecord(run)?.open[0]?.state).toBe("repairing");
    h.endTurn({ ...at, turn: "t3", text: fenced('{"verdict":"clean"}') });
    expect((await settled(h.runs, run, "done")).log).toBe("clean true");
  });

  it("R22c (slices 7–9 review F5): Ask once more whose repair line can't be recorded fails its step in §9's words, its hold dropped with it: no item held, no line queued, never a silent wait", async () => {
    const h = await harness();
    const run = await heldOnRepair(h);
    // the record refuses the write that would say Ask once more's line is being sent
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((kept, fields) => {
      const again = fields.open.some((step) =>
        step.lines?.some((line) => line.line === "repair" && line.n === 2),
      );
      if (!refused && again) {
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      }
      write(kept, fields);
    });
    expect(await askOnceMore(h, run)).toEqual({ outcome: "failed", reason: stepFailed("Diff") });
    expect(refused).toBe(true);
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.enqueued).toHaveLength(2);
    expect(h.items).toHaveLength(1);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps).toMatchObject([{ call: 1, label: "Diff", state: "failed" }]);
  });

  it("R22d (slices 7–9 review F5, Q2): Ask once more at FLOW_LIMITS.STEP_LINES_MAX lines fails its step in §9's words, its hold dropped with it, and nothing is written or queued past the bound", async () => {
    const h = await harness();
    const run = await heldOnRepair(h);
    // the step's record at the bound: its prompt and STEP_LINES_MAX − 1 repair lines, as Ask once more said again
    const kept = h.records.runRecord(run);
    if (kept === undefined) throw new Error("the run's record was not kept");
    const lines = [
      { line: "prompt", n: 1, sent: "queued" },
      ...Array.from({ length: FLOW_LIMITS.STEP_LINES_MAX - 1 }, (_, i) => ({
        line: "repair",
        n: i + 1,
        sent: "queued",
      })),
    ];
    h.records.writeRunRecord(kept.run, {
      ...kept,
      open: kept.open.map((step) => ({ ...step, lines })),
    });
    // every write from here on: none holds a line past the bound
    const write = h.records.writeRunRecord.bind(h.records);
    const most: number[] = [];
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((at, fields) => {
      most.push(Math.max(0, ...fields.open.map((step) => step.lines?.length ?? 0)));
      write(at, fields);
    });
    expect(await askOnceMore(h, run)).toEqual({ outcome: "failed", reason: stepFailed("Diff") });
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(Math.max(0, ...most)).toBeLessThanOrEqual(FLOW_LIMITS.STEP_LINES_MAX);
    expect(h.enqueued).toHaveLength(2);
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps).toMatchObject([{ call: 1, label: "Diff", state: "failed" }]);
  });

  it("R23 (D11): an answer is bounded whole: its text is cut to what its fields leave, marked cut; fields alone past the bound are a miss, never a truncation", async () => {
    const h = await harness();
    h.approved("review", FORMED);
    const long = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const text = `${fenced('{"verdict":"clean"}')}\n${"x".repeat(70 * 1024)}`;
    h.endTurn({
      run: long,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text,
    });
    expect((await settled(h.runs, long, "done")).log).toBe("clean true");
    expect(answersOf(h, long)[0]).toMatchObject({ cut: true, value: { verdict: "clean" } });
    expect(h.records.runRecord(long)?.steps[0]).toMatchObject({ state: "answered", cut: true });
    // fields that alone leave no room for the text: the repair turn, in the bounder's words
    const wide = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    const fields = `{"verdict":"${"y".repeat(FLOW_LIMITS.RESULT_MAX_BYTES - 20)}"}`;
    h.endTurn({
      run: wide,
      call: 1,
      runtimeRunId: "rt-step2",
      turn: "t1",
      outcome: "completed",
      text: fields,
    });
    await waitFor(() => expect(h.enqueued).toHaveLength(3));
    expect(h.enqueued[2]?.text).toBe(
      repairLine("the answer's fields are longer than a flow may keep"),
    );
    expect(h.kinds(wide)).toEqual(["head", "call"]);
  });

  it('R25: a failed turn is the step\'s refusal, "‹label› failed."', async () => {
    const h = await harness();
    h.approved("review", REVIEW_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    h.endTurn({ run, call: 1, runtimeRunId: "rt-step1", turn: "t1", outcome: "failed" });
    expect((await settled(h.runs, run, "done")).log).toBe("Diff failed.");
    expect(h.records.runRecord(run)?.steps[0]).toMatchObject({ call: 1, state: "failed" });
  });

  it("R14b (CP4-S7; slices 7–9 review F10): an answer frees its step's slot, and of the two steps waiting for one, the first in call order starts", async () => {
    const h = await harness();
    h.approved("fan", fanOut(FLOW_LIMITS.LIVE_STEPS_MAX + 2));
    const run = startedRun(await h.start({ flow: "fan" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX));
    h.endTurn({
      run,
      call: 3,
      runtimeRunId: "rt-step3",
      turn: "t1",
      outcome: "completed",
      text: "part 3",
    });
    await waitFor(() => expect(h.enqueued).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX + 1));
    expect(h.spawned.at(-1)?.origin).toEqual({ by: "flow", run, call: 9 });
    expect(h.records.runRecord(run)?.open.find((step) => step.call === 9)).toMatchObject({
      state: "working",
      session: "rt-step9",
    });
    // F10: the one slot went to call 9, never 10, which waits for the next
    expect(h.records.runRecord(run)?.open.find((step) => step.call === 10)?.state).toBe("waiting");
    expect(h.spawned).toHaveLength(FLOW_LIMITS.LIVE_STEPS_MAX + 1);
  });

  it('R14c (slices 7–9 review F2): a step whose start throws is refused "‹label› failed." and frees its slot: past LIVE_STEPS_MAX caught ones, a valid step starts, never waits', async () => {
    const h = await harness();
    const stuck = FLOW_LIMITS.LIVE_STEPS_MAX + 1;
    // W-h's stub throws at a folder that is no name: a start that throws, as an enqueue guard or a record refusal does
    const bad = Array.from({ length: stuck }, () => ({ label: "Bad", cwd: "" }));
    const good = { agent: "claude", label: "Good", cwd: "/work/app", profile: "work" };
    h.approved("stuck", callsEach(bad, good));
    const run = startedRun(await h.start({ flow: "stuck", scope: ["work"] })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // each is journaled as its refusal, so its step settles failed, and the script hears it (on a replay too)
    expect(refusalsOf(h, run)).toEqual(Array.from({ length: stuck }, () => "Bad failed."));
    const record = h.records.runRecord(run);
    expect(record?.steps.map((step) => [step.label, step.state])).toEqual(
      Array.from({ length: stuck }, () => ["Bad", "failed"]),
    );
    expect(record?.open.map((step) => [step.call, step.state])).toEqual([[stuck + 1, "working"]]);
    expect(h.spawned.map((spawn) => spawn.origin.call)).toEqual([stuck + 1]);
  });

  it("R14i (slices 7–9 review F9): an in: step never waits for a slot: past LIVE_STEPS_MAX spawned steps it is handed at once, and the next answer starts the first spawned step waiting", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("slots", slotsAndAHand(FLOW_LIMITS.LIVE_STEPS_MAX));
    const max = FLOW_LIMITS.LIVE_STEPS_MAX;
    // every state the in: step's record is written with, from its call line on
    const states: string[] = [];
    const write = h.records.writeRunRecord.bind(h.records);
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((kept, fields) => {
      const state = fields.open.find((step) => step.call === max + 1)?.state;
      if (state !== undefined) states.push(state);
      write(kept, fields);
    });
    const run = startedRun(await h.start({ flow: "slots" })).run;
    await waitFor(() => expect(h.records.runRecord(run)?.open).toHaveLength(max + 2));
    // decided at its call line: no "waiting" ever reaches its record, and its hand is at once
    expect(states).not.toContain("waiting");
    expect(h.hands).toMatchObject([{ runtimeRunId: "run-yours", run, call: max + 1, gone: false }]);
    const open = h.records.runRecord(run)?.open ?? [];
    expect(open.find((step) => step.call === max + 1)).toMatchObject({ handed: true });
    // the spawned step after it waits: every slot is a spawn's (that the in: step holds none, the answer below shows)
    expect(open.find((step) => step.call === max + 2)?.state).toBe("waiting");
    await waitFor(() => expect(h.enqueued).toHaveLength(max + 1));
    expect(h.spawned).toHaveLength(max);
    // an answer's one slot starts the first SPAWNED step waiting
    h.endTurn({
      run,
      call: 3,
      runtimeRunId: "rt-step3",
      turn: "t1",
      outcome: "completed",
      text: "part 3",
    });
    await waitFor(() => expect(h.spawned).toHaveLength(max + 1));
    expect(h.spawned.at(-1)?.origin).toEqual({ by: "flow", run, call: max + 2 });
  });

  it("R14j (F9 review CC1): under the bound, the spawned step after an in: step's hand is written starting and spawned at once: the hand is on the record before the next call line", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    const max = FLOW_LIMITS.LIVE_STEPS_MAX;
    h.approved("slots", slotsAndAHand(max - 1));
    // every state the last spawned step's record is written with, from its call line on
    const states: string[] = [];
    const write = h.records.writeRunRecord.bind(h.records);
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((kept, fields) => {
      const state = fields.open.find((step) => step.call === max + 1)?.state;
      if (state !== undefined) states.push(state);
      write(kept, fields);
    });
    const run = startedRun(await h.start({ flow: "slots" })).run;
    await waitFor(() => expect(h.spawned).toHaveLength(max));
    // max − 1 spawned, the handed one counted for none: its call line found a slot
    expect(states[0]).toBe("starting");
    expect(states).not.toContain("waiting");
    expect(h.spawned.map((spawn) => spawn.origin.call)).toContain(max + 1);
    expect(h.hands).toMatchObject([{ runtimeRunId: "run-yours", run, call: max, gone: false }]);
  });

  it("R14d (F2 review T1, T3, T6): a start that throws while the runs store does not answer settles its step with no read on the failure road: no rejection escapes, its call's own label names it, and its slot frees", async () => {
    const h = await harness();
    // past FLOW_LABEL_MAX, so the record's entry keeps no label: only the call's own names the step (T3)
    const long = "Look ".repeat(26).trim();
    const good = { agent: "claude", label: "Good", cwd: "/work/app", profile: "work" };
    const look = { agent: "claude", label: long, profile: "work", cwd: "/work/app", model: "opus" };
    h.approved("broken", callsEach([look], good));
    // the start throws as the disk stops answering, and the store's next read before the answer's line refuses
    const read = h.records.runRecord.bind(h.records);
    let refusing = false;
    vi.spyOn(h.records, "runRecord").mockImplementation((run) => {
      if (!refusing) return read(run);
      refusing = false;
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const append = h.records.appendRun.bind(h.records);
    vi.spyOn(h.records, "appendRun").mockImplementation((run, entry) => {
      if (entry.kind === "answer") refusing = false;
      return append(run, entry);
    });
    vi.spyOn(h.runs.ports.agents, "models").mockImplementation(async () => {
      refusing = true;
      throw new Error("EIO: i/o error, read");
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const run = startedRun(await h.start({ flow: "broken" })).run;
      await waitFor(() => expect(h.enqueued).toHaveLength(1));
      expect(refusalsOf(h, run)).toEqual([stepFailed(long)]);
      expect(stepFailed(long)).not.toBe(stepFailed(undefined));
      const record = h.records.runRecord(run);
      expect(record?.steps.map((step) => [step.call, step.state])).toEqual([[1, "failed"]]);
      expect(record?.open.map((step) => [step.call, step.state])).toEqual([[2, "working"]]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("R14e (F2 review T5; 1c review Y3): a read that throws on a step's own road, before its waiter, settles the step failed: no rejection escapes, and its entry never holds a slot", async () => {
    const h = await harness();
    const good = { agent: "claude", label: "Good", cwd: "/work/app", profile: "work" };
    const look = { agent: "claude", label: "Look", profile: "work", cwd: "/work/app" };
    h.approved("unread", callsEach([look], good));
    // a subscriber, so each write's list is read too (Y3): it never takes the refusal meant for the step's road
    h.runs.onChange(() => undefined);
    // the step's entry is on the record; the step's own read, the next one no list makes, is the disk's to refuse
    const read = h.records.runRecord.bind(h.records);
    const write = h.records.writeRunRecord.bind(h.records);
    const listed = h.records.runRecords.bind(h.records);
    let entered = false;
    let refusing = false;
    let listing = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      write(run, fields);
      if (!entered && fields.open.some((step) => step.call === 1)) {
        entered = true;
        refusing = true;
      }
    });
    vi.spyOn(h.records, "runRecords").mockImplementation(() => {
      listing = true;
      try {
        return listed();
      } finally {
        listing = false;
      }
    });
    vi.spyOn(h.records, "runRecord").mockImplementation((run) => {
      if (!refusing || listing) return read(run);
      refusing = false;
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const run = startedRun(await h.start({ flow: "unread" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(refusalsOf(h, run)).toEqual([stepFailed("Look")]);
    const record = h.records.runRecord(run);
    expect(record?.steps.map((step) => [step.label, step.state])).toEqual([["Look", "failed"]]);
    expect(record?.open.map((step) => [step.call, step.state])).toEqual([[2, "working"]]);
  });

  it("R14f (F2 review T2): a start that throws after its agent started and before its line was queued fails the step, and fieldd's warn names the agent it leaves (slice 13's R42 ends it)", async () => {
    const h = await harness();
    h.approved("review", REVIEW_CATCHES);
    vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementationOnce(() => {
      throw new Error("the input queue refused it");
    });
    const run = startedRun(await h.start({ flow: "review" })).run;
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.spawned.map((spawn) => spawn.origin.call)).toEqual([1]);
    expect(h.records.runRecord(run)?.steps).toMatchObject([
      { call: 1, session: "rt-step1", state: "failed" },
    ]);
    expect(h.warned.filter((said) => said.event === "fieldd.flows.step.orphan")).toEqual([
      {
        event: "fieldd.flows.step.orphan",
        fields: expect.objectContaining({ run, call: 1, runtimeRunId: "rt-step1" }),
      },
    ]);
  });

  it("R14h (1c review Y1): a step whose session never reached its record, the write that names it refused after its spawn, settles failed naming that session in the settle's own write, and fieldd keeps it for the run's end", async () => {
    const h = await harness();
    h.approved("review", REVIEW_CATCHES);
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      const working = fields.open.some((step) => step.call === 1 && step.state === "working");
      if (!refused && working) {
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      }
      write(run, fields);
    });
    const run = startedRun(await h.start({ flow: "review" })).run;
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.records.runRecord(run)?.steps).toMatchObject([
      { call: 1, session: "rt-step1", state: "failed" },
    ]);
    expect(h.warned.filter((said) => said.event === "fieldd.flows.step.orphan")).toEqual([
      {
        event: "fieldd.flows.step.orphan",
        fields: expect.objectContaining({ run, call: 1, runtimeRunId: "rt-step1" }),
      },
    ]);
  });

  it("R14g (F2 review T2): a record that can't say a queued line was queued is logged, never thrown: the step works on, and its agent's answer settles it", async () => {
    const h = await harness();
    h.approved("review", ANSWERED);
    const write = h.records.writeRunRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      const queued = fields.open.some((step) => step.lines?.some((line) => line.sent === "queued"));
      if (!refused && queued) {
        refused = true;
        throw new Error("ENOSPC: no space left on device, write");
      }
      write(run, fields);
    });
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() =>
      expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.step.queued"),
    );
    expect(refusalsOf(h, run)).toEqual([]);
    expect(h.records.runRecord(run)?.open).toMatchObject([
      {
        call: 1,
        session: "rt-step1",
        state: "working",
        lines: [{ line: "prompt", sent: "sending" }],
      },
    ]);
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "all clean",
    });
    expect((await settled(h.runs, run, "done")).log).toBe("all clean");
  });
});

// CP-4a2b (slice 7's R8b; D9, CP4-Q20 (a); Q2 (a), ruled 2026-11-06) — the folder at the start, read from the
// static read's `cwd` (one reader): a script with a step that names no folder, whose input names none, is refused
// before any journal line; an input that names a session or a project VibeField can't find is refused too (§9's
// PROPOSED lines, 804c16ed3). A step whose folder is computed passes, to its call.

describe("CP-4a2b — a run's folder, held at its start (slice 7's R8b)", () => {
  /** A one-step flow: its step names its folder plainly, computes it, or names none. */
  const stepWith = (cwd: string, input = "{}") =>
    [
      `export const meta = { name: "Folder", input: ${input} };`,
      "export default async function () {",
      "  const none = {};",
      `  await agent("go", { agent: "claude", label: "Go", profile: "work"${cwd} });`,
      "}",
      "",
    ].join("\n");

  it("R8b: a step that names no folder, in a run whose input names none, is refused at the start in §9's words, nothing journaled; a session or project its input names that VibeField can't find is refused too", async () => {
    const h = await harness({
      folders: { "session:run-yours": "/work/yours", "project:pj-1": "/work/pj1" },
    });
    h.approved("bare", stepWith(""));
    expect(await refusalOf(h.start({ flow: "bare" }))).toEqual({
      reason: "folder",
      message: NO_FOLDER,
    });
    h.approved("in-session", stepWith("", '{ target: "session" }'));
    expect(await refusalOf(h.start({ flow: "in-session", input: { target: "run-gone" } }))).toEqual(
      {
        reason: "input-session",
        message: "VibeField can't find the session its input names.",
      },
    );
    h.approved("in-project", stepWith("", '{ where: "project" }'));
    expect(await refusalOf(h.start({ flow: "in-project", input: { where: "pj-9" } }))).toEqual({
      reason: "input-project",
      message: "VibeField can't find the project its input names.",
    });
    expect(h.records.runs()).toEqual([]);
    expect(h.spawned).toEqual([]);
    // what the start lets through: the input's folder, one written plainly, one computed (held at its call)
    startedRun(await h.start({ flow: "in-session", input: { target: "run-yours" } }));
    startedRun(await h.start({ flow: "in-project", input: { where: "pj-1" } }));
    h.approved("named", stepWith(', cwd: "/work/app"'));
    startedRun(await h.start({ flow: "named" }));
    h.approved("computed", stepWith(", cwd: none.cwd"));
    startedRun(await h.start({ flow: "computed" }));
    await waitFor(() => expect(h.spawned).toHaveLength(3));
    expect(h.spawned.map((spawn) => spawn.launch.cwd).sort()).toEqual([
      "/work/app",
      "/work/pj1",
      "/work/yours",
    ]);
  });

  it("says R8b's refusals in DESIGN.md's own words (§9 \"When a run can't start\")", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    for (const said of [
      words.inputNotFound("session"),
      words.inputNotFound("project"),
      NO_FOLDER,
    ]) {
      expect(said).not.toBe("");
      expect(design, said).toContain(`"${said}"`);
    }
  });
});

// CP-4a2b (§13a slice 9b; ruled 2026-11-06) — a step handed a live session by `in:` (D9). The runs tell the step listener
// at the hand (`stepEnds.hand`, flow-step-events.ts), before the step's line is queued, so the session's turn ends are
// heard as the step's; they let it go at the answer, at a failed turn and at the run's end, and keep it through a
// miss's repair turn. The harness's endTurn stands for the listener; flow-step-events.test.ts's SH rows hold its side.

const HANDED_YOURS: FlowStepSession = { live: true, profile: "work", onPermission: false };
/** One step handed your session, its answer's text the run's log line; `more` adds to its options. */
const handedTo = (more = "") =>
  [
    'export const meta = { name: "Handed" };',
    "export default async function () {",
    `  const said = await agent("Review this", { in: "run-yours", label: "Yours"${more} });`,
    "  log(said.text);",
    "}",
    "",
  ].join("\n");

describe("CP-4a2b — a step handed a session: heard from the hand, let go at the answer (§13a slice 9b)", () => {
  it("R19h (9b): the runs hand the step listener your session before the step's line is queued; its turn's end answers, and the hand is let go at the answer", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo());
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.enqueued[0]).toMatchObject({ runtimeRunId: "run-yours", text: "Review this" });
    expect(h.hands).toEqual([{ runtimeRunId: "run-yours", run, call: 1, at: 0, gone: false }]);
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "run-yours",
      turn: "t1",
      outcome: "completed",
      text: "looks good",
    });
    expect(h.hands.map((hand) => hand.gone)).toEqual([true]);
    expect((await settled(h.runs, run, "done")).log).toBe("looks good");
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
  });

  it("R19h-2 (9b, CP4-Q7 (a)): a handed step's miss keeps the hand through its repair turn, sent to the same session; the answer lets it go", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo(`, schema: ${FORM}`));
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    const at = { run, call: 1, runtimeRunId: "run-yours", outcome: "completed" } as const;
    h.endTurn({ ...at, turn: "t1", text: "no fenced block here" });
    await waitFor(() => expect(h.enqueued).toHaveLength(2));
    expect(h.enqueued[1]).toMatchObject({
      runtimeRunId: "run-yours",
      text: repairLine("the answer holds no JSON the form can read"),
    });
    expect(h.hands.map((hand) => hand.gone)).toEqual([false]);
    h.endTurn({ ...at, turn: "t2", text: fenced('{"verdict":"clean"}') });
    expect(h.hands.map((hand) => hand.gone)).toEqual([true]);
    await settled(h.runs, run, "done");
  });

  it("R19h-3 (9b): a failed turn lets the hand go, and so does the run's end with its handed step unanswered", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved(
      "fails",
      [
        'export const meta = { name: "Fails" };',
        "export default async function () {",
        '  try { await agent("Review this", { in: "run-yours", label: "Yours" }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n"),
    );
    h.approved(
      "leaves",
      [
        'export const meta = { name: "Leaves" };',
        "export default async function () {",
        '  agent("Look later", { in: "run-yours", label: "Later" });',
        '  return "early";',
        "}",
        "",
      ].join("\n"),
    );
    const fails = startedRun(await h.start({ flow: "fails" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    h.endTurn({ run: fails, call: 1, runtimeRunId: "run-yours", turn: "t1", outcome: "failed" });
    expect(h.hands).toEqual([
      { runtimeRunId: "run-yours", run: fails, call: 1, at: 0, gone: true },
    ]);
    expect((await settled(h.runs, fails, "done")).log).toBe("Yours failed.");
    const leaves = startedRun(await h.start({ flow: "leaves" })).run;
    await settled(h.runs, leaves, "done");
    expect(h.hands.filter((hand) => hand.run === leaves)).toEqual([
      { runtimeRunId: "run-yours", run: leaves, call: 1, at: 1, gone: true },
    ]);
  });

  it('R19h-4 (9b, review F3): a step handed a session the step listener never heard enter is refused "‹label› failed." before its line is queued, never left waiting', async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS }, unheard: ["run-yours"] });
    h.approved(
      "unheard",
      [
        'export const meta = { name: "Unheard" };',
        "export default async function () {",
        '  try { await agent("Review this", { in: "run-yours", label: "Yours" }); }',
        "  catch (e) { log(e.message); }",
        "}",
        "",
      ].join("\n"),
    );
    const run = startedRun(await h.start({ flow: "unheard" })).run;
    await waitFor(() => expect(h.enqueued.length + refusalsOf(h, run).length).toBeGreaterThan(0));
    expect(h.enqueued).toEqual([]);
    expect(refusalsOf(h, run)).toEqual(["Yours failed."]);
    expect((await settled(h.runs, run, "done")).log).toBe("Yours failed.");
    expect(h.hands).toEqual([]);
  });

  it("R19h-5 (9b): fieldd's own stop lets a handed step's hand go, the run left as it stands for the next boot", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    h.approved("handed", handedTo());
    const run = startedRun(await h.start({ flow: "handed" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.hands.map((hand) => hand.gone)).toEqual([false]);
    await h.runs.close();
    expect(h.hands.map((hand) => hand.gone)).toEqual([true]);
    expect(h.records.runRecord(run)?.state).toBe("running");
  });
});

// CP-4a2b (§13a slice 7's R4–R6; CP4-Q5 (a), Q4, D8) — a changed flow's acts, as the needs queue hands the runs the
// person's choice (`acts.start`): the version chosen, the start as it was asked (the item record's, Q4) and a spark's
// `from`. Run this version approves the bytes the item asked about, as yours ("Run this version (approves it)",
// round-flows CP4-Q5 (a)), then begins the asked-for run on them; Run the one you approved begins it on the approved
// bytes fieldd kept. The start's scope is narrowed to the profiles that exist at the act, never widened (D8). An act
// that can't begin is failed in §9's start words, with nothing approved and nothing begun. Not now is the queue's
// alone (needs-queue N5): no act reaches the runs.

/** A flow with an input whose version changed since its approval. */
const TARGETS_EDITED = TAKES_TARGET.replace('log("target: " + target)', 'log("aim: " + target)');

/** The item a start waits in, or the row fails saying what it got instead. */
function waitsOf(started: FlowRunStarted): NeedsItemId {
  if (!("waits" in started)) throw new Error(`the start began ${started.run.run}`);
  return started.waits;
}

/** The start the n-th raise kept, as the queue hands it back with the act (Q4). */
function askedOf(h: { readonly raised: readonly FlowChangedRaise[] }, n: number) {
  const raised = h.raised[n];
  if (raised === undefined) throw new Error(`no raise ${n}: ${h.raised.length} were raised`);
  return raised.start;
}

/** The run an act began, or the row fails saying why it did not. */
function ranOf(started: FlowItemStarted): string {
  if (started.outcome !== "done") throw new Error(`the act failed: ${started.reason}`);
  return started.run;
}

describe("CP-4a2b — a changed flow's acts begin the asked-for run (§13a slice 7's R4–R6)", () => {
  it("R4 (CP4-Q5 (a), Q4, D8): Run this version approves the asked-about bytes as yours and begins the asked-for run on them, its input carried and its scope narrowed to the profiles that exist", async () => {
    const h = await harness({ folders: { "session:run-yours": "/work/yours" } });
    h.approved("targets", TAKES_TARGET);
    const edited = h.write("targets", TARGETS_EDITED);
    const waits = waitsOf(
      await h.start({ flow: "targets", input: { target: "run-yours" }, scope: ["work", "review"] }),
    );
    // D8: the scope is the start's, narrowed at the act to the profiles that exist, never widened by a new one
    h.setProfiles(["work", "home"]);
    const run = ranOf(
      await h.runs.acts.start({
        id: waits,
        flow: "targets",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 0),
      }),
    );
    expect(h.records.approval("targets")).toMatchObject({ hash: flowHashOf(edited), by: "you" });
    expect(h.records.runRecord(run)).toMatchObject({
      flow: "targets",
      hash: flowHashOf(edited),
      starter: { by: "you" },
      scope: ["work"],
    });
    const read = h.records.readRun(run);
    expect(read.kind === "kept" ? read.head.input : read.kind).toEqual({ target: "run-yours" });
    expect((await settled(h.runs, run, "done")).log).toBe("aim: run-yours");
  });

  it("R5 (CP4-Q5 (a), Q4): Run the one you approved begins a spark's asked-for run on the approved bytes fieldd kept, its approval unchanged", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    h.write("hello", HELLO_EDITED);
    const waits = waitsOf(
      await h.start({ starter: { by: "spark", spark: VELA }, from: VELA_FROM }),
    );
    const run = ranOf(
      await h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: approval.hash,
        version: "approved",
        start: askedOf(h, 0),
        from: VELA_FROM,
      }),
    );
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    expect(h.records.runRecord(run)).toMatchObject({
      hash: approval.hash,
      starter: { by: "spark", spark: VELA },
    });
    expect((await settled(h.runs, run, "done")).log).toBe("hi");
  });

  it("R4b (R4–R6 review G2; CP-L4, TL-D5): a spark's kept start, its own or a Run in its thread, narrows again at its act to the spark's Agent Profiles now; a spark that is gone starts nothing, nothing approved", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const own = waitsOf(
      await h.start({
        starter: { by: "spark", spark: VELA },
        from: VELA_FROM,
        scope: ["work", "review"],
      }),
    );
    // Vela is under review alone since it asked, as an Allow re-reads it
    h.setSparkScope(VELA, ["review"]);
    const run = ranOf(
      await h.runs.acts.start({
        id: own,
        flow: "hello",
        hash: approval.hash,
        version: "approved",
        start: askedOf(h, 0),
        from: VELA_FROM,
      }),
    );
    expect(h.records.runRecord(run)?.scope).toEqual(["review"]);
    await settled(h.runs, run, "done");
    // a Run in Vela's thread is yours, its scope Vela's (CP4-Q20 (a)): acted on once Vela is gone
    const thread = waitsOf(
      await h.start({ starter: { by: "you", spark: VELA }, scope: ["review"] }),
    );
    h.setSparkScope(VELA, undefined);
    expect(
      await h.runs.acts.start({
        id: thread,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 1),
      }),
    ).toEqual({ outcome: "failed", reason: words.noSpark() });
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    expect(h.records.runRecords().map((record) => record.run)).toEqual([run]);
  });

  it("R4c (the 1b review V5; 1e review AA1): a start whose asked Agent Profiles, narrowed as it starts, leave none starts nothing, before any approval, in §9's words by cause: the spark's narrowing at the act, or none that exists as it begins", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const act = (id: string, n: number, from?: typeof VELA_FROM) =>
      h.runs.acts.start({
        id,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, n),
        ...(from !== undefined ? { from } : {}),
      });
    // Vela's own, asked under work: Vela is under review alone since, so none it asked for is Vela's now
    const own = waitsOf(
      await h.start({ starter: { by: "spark", spark: VELA }, from: VELA_FROM, scope: ["work"] }),
    );
    h.setSparkScope(VELA, ["review"]);
    expect(await act(own, 0, VELA_FROM)).toEqual({
      outcome: "failed",
      reason: words.noSparkProfiles("Vela"),
    });
    // a Run in Vela's thread, asked under work, is narrowed by Vela the same way (G2): Vela's words
    const spun = waitsOf(await h.start({ starter: { by: "you", spark: VELA }, scope: ["work"] }));
    expect(await act(spun, 1)).toEqual({
      outcome: "failed",
      reason: words.noSparkProfiles("Vela"),
    });
    // one asked under review, which Vela keeps, once review exists no more: that is the cause, whoever's run it is
    // (AA1), so none it asked for exists now
    const thread = waitsOf(
      await h.start({ starter: { by: "you", spark: VELA }, scope: ["review"] }),
    );
    h.setProfiles(["work"]);
    expect(await act(thread, 2)).toEqual({ outcome: "failed", reason: words.noProfiles() });
    // yours, under review: the same
    const yours = waitsOf(await h.start({ scope: ["review"] }));
    expect(await act(yours, 3)).toEqual({ outcome: "failed", reason: words.noProfiles() });
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    expect(h.records.runRecords()).toEqual([]);
    // the door, on the approved version: none that exists, for yours and a spark's own alike (AA1), before any record
    h.approved("hello", HELLO);
    expect(await refusalOf(h.start({ scope: ["review"] }))).toEqual({
      reason: "no-profiles",
      message: words.noProfiles(),
    });
    expect(
      await refusalOf(
        h.start({ starter: { by: "spark", spark: VELA }, from: VELA_FROM, scope: ["review"] }),
      ),
    ).toEqual({ reason: "no-profiles", message: words.noProfiles() });
    expect(h.records.runRecords()).toEqual([]);
    // a scope that keeps one it asked for starts, narrowed to it (D8)
    const run = startedRun(await h.start({ scope: ["review", "work"] }));
    expect(h.records.runRecord(run.run)?.scope).toEqual(["work"]);
    await settled(h.runs, run.run, "done");
  });

  it("R6 (CP4-Q5 (a); R4–R6 review H5): an act that can't begin is failed in §9's start words, nothing approved and nothing begun: a version changed again since it asked, an input the version no longer takes, and a bound reached since", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    h.write("hello", `${HELLO_EDITED}// and again\n`);
    expect(
      await h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 0),
      }),
    ).toEqual({ outcome: "failed", reason: words.notAVersion("hello") });
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    // a version that takes no input, asked to run with one: refused before its approval is written
    const targets = h.approved("targets", TAKES_TARGET);
    const bare = h.write(
      "targets",
      'export const meta = { name: "Targets" };\nexport default async function () {}\n',
    );
    const asked = waitsOf(await h.start({ flow: "targets", input: { target: "run-yours" } }));
    expect(
      await h.runs.acts.start({
        id: asked,
        flow: "targets",
        hash: flowHashOf(bare),
        version: "this",
        start: askedOf(h, 1),
      }),
    ).toEqual({ outcome: "failed", reason: words.noSuchInput("Targets", "target") });
    expect(h.records.approval("targets")?.hash).toBe(targets.hash);
    expect(h.records.runRecords()).toEqual([]);
    // a bound reached since it asked (D3): refused before its approval is written, as every refusal is
    const bound = waitsOf(await h.start({ flow: "targets" }));
    for (let i = 0; i < FLOW_LIMITS.RUNS_LIVE_MAX; i += 1) seeded(h, i, "running");
    expect(
      await h.runs.acts.start({
        id: bound,
        flow: "targets",
        hash: flowHashOf(bare),
        version: "this",
        start: askedOf(h, 2),
      }),
    ).toEqual({ outcome: "failed", reason: words.runsLive("Targets") });
    expect(h.records.approval("targets")?.hash).toBe(targets.hash);
  });

  it("R6c (R4–R6 review H2): Run this version checks the run's begin before it approves, so the store's refusal leaves no approval; a disk's refusal is said in §9's words, never its own, and past the checks the run never began", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const act = async () => {
      const waits = waitsOf(await h.start());
      return h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, h.raised.length - 1),
      });
    };
    // the runs store refuses the run's begin (item 172's guard): refused before the approval is written
    const refusing = vi.spyOn(h.records, "checkBegin").mockImplementation(() => {
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    expect(await act()).toEqual({ outcome: "failed", reason: UNREADABLE_WORDS.flows });
    refusing.mockRestore();
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    // a disk that refuses the approval: nothing was changed, so the store's sentence says it, never the disk's words
    const approving = vi.spyOn(h.records, "approve").mockImplementation(() => {
      throw new Error("EIO: i/o error, write");
    });
    expect(await act()).toEqual({ outcome: "failed", reason: UNREADABLE_WORDS.flows });
    approving.mockRestore();
    expect(h.records.approval("hello")?.hash).toBe(approval.hash);
    // the one window past the checks, at its REAL write (1b review V2): a disk that takes the approval and the run's
    // record and refuses its head (the journals' folder is a file). The run never began, in §9's words, in this life
    // too: its record is ended `failed` in them. The approval, the person's own, stands
    writeFileSync(join(h.root, "fieldd", "flows", RUNS_DIR), "not a folder");
    expect(await act()).toEqual({ outcome: "failed", reason: words.neverBegan("Hello") });
    expect(h.records.approval("hello")?.hash).toBe(flowHashOf(edited));
    expect(h.records.runRecords()).toMatchObject([
      { state: "failed", log: words.neverBegan("Hello") },
    ]);
  });

  it("R6d (ruled 2026-11-06, window (c)): once the run's record is kept the run has begun, so the act is done with it; a read-back that throws past it is logged, and the run is listed as its record says", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    // the record is kept, and the read that follows it is the disk's to refuse
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "runRecord").mockImplementationOnce(() => {
        throw new Error("EIO: i/o error, read");
      });
      return head;
    });
    const run = ranOf(
      await h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 0),
      }),
    );
    expect(h.records.approval("hello")?.hash).toBe(flowHashOf(edited));
    expect(h.runs.list().runs.map((summary) => summary.run)).toEqual([run]);
    // its host never started: the record says it runs, and slice 14's boot wakes it
    expect(h.records.runRecord(run)?.state).toBe("running");
  });

  it("R6e (1a review W1, W2): a door's start whose run's record is kept answers that run, as #begin wrote it, though its read-back throws; the list its subscribers hear holds it", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const told: FlowRunsList[] = [];
    h.runs.onChange((list) => void told.push(list));
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "runRecord").mockImplementationOnce(() => {
        throw new Error("EIO: i/o error, read");
      });
      return head;
    });
    const summary = startedRun(await h.start());
    expect(summary).toMatchObject({
      flow: "hello",
      name: "Hello",
      n: 1,
      state: "running",
      calls: 0,
      steps: [],
      starter: { by: "you" },
    });
    expect(told.at(-1)?.runs.map((run) => run.run)).toEqual([summary.run]);
    // its host never started: the record says it runs, and slice 14's boot wakes it
    expect(h.records.runRecord(summary.run)?.state).toBe("running");
  });

  it("R6f (1a review W3): a run whose record reads back as nothing, or whose journal reads as none VibeField keeps, is no run it can wake: the door and the act answer that it never began, and its record ends so", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    // the door's start: the record is kept, and reads back as nothing (set aside, or held)
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "runRecord").mockReturnValueOnce(undefined);
      return head;
    });
    await expect(h.start()).rejects.toMatchObject({ message: words.neverBegan("Hello") });
    expect(h.records.runRecords()).toMatchObject([
      { state: "failed", log: words.neverBegan("Hello") },
    ]);
    // the act: the record reads back, and its journal reads as no journal
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    vi.spyOn(h.records, "readRun").mockReturnValueOnce({ kind: "absent" });
    expect(
      await h.runs.acts.start({
        id: waits,
        flow: "hello",
        hash: flowHashOf(edited),
        version: "this",
        start: askedOf(h, 0),
      }),
    ).toEqual({ outcome: "failed", reason: words.neverBegan("Hello") });
    expect(h.records.runRecords().map((record) => record.state)).toEqual(["failed", "failed"]);
  });

  it("R6g (1b review V2; 1d review Z3; 1f+1g review BB1): a run that never began, its record kept and its ending refused too, is passed by at the bounds until a restart settles it, and reads in this life as never begun, its subscribers told", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const told: FlowRunsList[] = [];
    h.runs.onChange((list) => void told.push(list));
    const journals = join(h.root, "fieldd", "flows", RUNS_DIR);
    writeFileSync(journals, "not a folder");
    vi.spyOn(h.records, "endUnbegun").mockImplementationOnce(() => {
      throw new Error("ENOSPC: no space left on device, write");
    });
    await expect(h.start()).rejects.toMatchObject({ message: words.neverBegan("Hello") });
    expect(h.records.runRecords()).toMatchObject([{ state: "running" }]);
    // Z3: the record stands as the disk keeps it, and this life reads the run failed, in §9's words
    const unbegun = h.records.runRecords()[0]?.run ?? "";
    const said = { state: "failed", log: words.neverBegan("Hello"), endedAt: expect.any(String) };
    expect(h.runs.list().runs).toMatchObject([{ run: unbegun, ...said }]);
    expect(h.runs.read(unbegun)?.summary).toMatchObject(said);
    // BB1: its subscribers' last frame holds it so too
    expect(told.at(-1)?.runs).toMatchObject([{ run: unbegun, ...said }]);
    // the journals' folder answers again: RUNS_LIVE_MAX running records, the one that never began among them
    rmSync(journals);
    for (let i = 0; i < FLOW_LIMITS.RUNS_LIVE_MAX - 1; i += 1) seeded(h, i, "running");
    expect(startedRun(await h.start()).state).toBe("running");
  });

  it("R6i (1d review Z4): a run whose bytes are gone by its wake is ended lost there, and the door answers it lost, as its record says", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    // its begin reads the approved bytes; by its wake they are gone (D8: bytes that no longer hash are lost)
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "bytes").mockReturnValue(undefined);
      return head;
    });
    const summary = startedRun(await h.start());
    expect(summary.state).toBe("lost");
    expect(h.records.runRecord(summary.run)?.state).toBe("lost");
  });

  it("R6j (1f+1g review BB3): a woken run whose record can't be read again is answered as it was read: the door says running, fieldd's warn says why, and the record reads lost", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    // R6i's road: its bytes are gone by its wake, so the wake ends it lost
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) => {
      const head = begin(entry, start);
      vi.spyOn(h.records, "bytes").mockReturnValue(undefined);
      return head;
    });
    // the read after the wake, the first to find it lost, is the disk's to refuse
    const read = h.records.runRecord.bind(h.records);
    let refused = false;
    vi.spyOn(h.records, "runRecord").mockImplementation((run) => {
      const record = read(run);
      if (!refused && record?.state === "lost") {
        refused = true;
        throw new Error("EIO: i/o error, read");
      }
      return record;
    });
    const summary = startedRun(await h.start());
    expect(refused).toBe(true);
    expect(summary.state).toBe("running");
    expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.run.reread");
    expect(h.records.runRecord(summary.run)?.state).toBe("lost");
  });

  it("R6h (1b review V4): a records write the disk refuses at a run's begin is said in the store's own shape, UNAVAILABLE for the flows, in its sentence", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    vi.spyOn(h.records, "checkBegin").mockImplementationOnce(() => {
      throw new Error("EIO: i/o error, stat");
    });
    await expect(h.start()).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: UNREADABLE_WORDS.flows,
      details: { service: RECORD_STORES.SERVICE_FLOWS, state: RECORD_STORES.STATE_UNREADABLE },
    });
    expect(h.records.runRecords()).toEqual([]);
  });
});
