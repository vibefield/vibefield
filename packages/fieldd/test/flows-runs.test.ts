import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentInputSender,
  ErrorData,
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
import { flowCallKey } from "../src/flows/replay";
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
import type { FlowHostTimings } from "../src/flows/supervisor";
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
/** A flow its static read refuses (the sandbox's eval shape, Q-B3 (a)), as a newer read rule refuses a script
 * approved before it (Q-a). */
const EVALS = [
  'export const meta = { name: "Evals" };',
  "export default async function () {",
  '  log(String(eval("1 + 1")));',
  "}",
  "",
].join("\n");
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
/** A host child the runs started (slice 10a): when it started, and when it left. */
interface Host {
  readonly child: ChildProcess;
  readonly at: number;
  leftAt?: number;
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
    /** a copy of VibeField that can't start a flow's host, and why (Q-b) */
    readonly unconfigured?: string;
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
    /** the runtime's models held until this settles, each ask counted (RA2: both starts parked at their await) */
    readonly modelsHeld?: Promise<unknown>;
    /** D1's idle before a waiting host is parked, lowered (slice 10a); fieldd's own HOST_IDLE_MS by default */
    readonly hostIdleMs?: number;
    /** the host's clock, a `shutdown`'s grace among it (R27d) */
    readonly timings?: Partial<FlowHostTimings>;
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
  /** how many times a step asked the runtime for its models */
  let modelAsks = 0;
  /** each host child the runs started, in order, with when it started and when it left (slice 10a) */
  const hosts: Host[] = [];
  /** the spawned sessions a row ended: the runtime holds them no longer live */
  const exited = new Set<string>();
  /** what fieldd's log was told at warn, in order */
  const warned: { event: string; fields: LogFields | undefined }[] = [];
  /** what fieldd's log was told at error, in order, its third argument as given */
  const errored: { event: string; error: unknown }[] = [];
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event, _message, fields) => void warned.push({ event, fields }),
    error: (event, _message, error) => void errored.push({ event, error }),
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
      models: async (agent) => {
        modelAsks += 1;
        if (opts.modelsHeld !== undefined) await opts.modelsHeld;
        return (opts.models ?? { claude: ["opus", "sonnet"] })[agent];
      },
    },
    inputs: {
      enqueue: (runtimeRunId, text, from) => {
        const step =
          from.kind === "flow" ? openOf(from.run).find((s) => s.call === from.call) : undefined;
        enqueued.push({ runtimeRunId, text, from, step });
        return { id: `in-${enqueued.length}`, position: 1 };
      },
    },
    sessions: {
      // a step's session the runtime spawned is live until a row ends it (D2's lookup reads it at a wake)
      of: (runtimeRunId) =>
        opts.sessions?.[runtimeRunId] ??
        (spawned.some((_, i) => `rt-step${i + 1}` === runtimeRunId)
          ? { live: !exited.has(runtimeRunId), onPermission: false }
          : undefined),
    },
    folderOf: (kind, value) => opts.folders?.[`${kind}:${value}`],
    projectFolders: () => opts.projectFolders ?? ["/work"],
    sparkProfile: (spark) => (opts.sparkProfiles ?? { [VELA]: "work" })[spark],
    defaultProfile: () =>
      opts.defaultProfile === null ? undefined : (opts.defaultProfile ?? "work"),
    host: {
      launch:
        opts.unconfigured !== undefined
          ? { kind: "unconfigured", reason: opts.unconfigured }
          : { kind: "launch", launch: opts.launch ?? (await flowsHostLaunch()) },
      environment: PATH_ONLY,
      ...(opts.timings !== undefined ? { timings: opts.timings } : {}),
      spawn: (command, args, options) => {
        const child = spawnChild(command, args, options);
        const host: Host = { child, at: Date.now() };
        child.once("exit", () => {
          host.leftAt = Date.now();
        });
        hosts.push(host);
        return child;
      },
    },
    ...(opts.hostIdleMs !== undefined ? { hostIdleMs: opts.hostIdleMs } : {}),
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
    errored,
    modelAsks: () => modelAsks,
    hosts,
    /** the runtime's session `runtimeRunId` ends: D2's lookup reads it exited */
    exit: (runtimeRunId: string) => void exited.add(runtimeRunId),
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

  it("R1b (Q-a, ruled 2026-11-06; NN1, 2026-11-06): a once-approved script the static read now refuses is refused at its start, before any journal line, its read's own words in §9's frame with the line they name, none for a whole-file refusal; its approval stands, and Run this version of one approves nothing", async () => {
    const h = await harness();
    const approval = h.approved("evals", EVALS);
    const evals = "VibeField can't start Evals: it calls eval(), which a flow may not (line 3).";
    expect(await refusalOf(h.start({ flow: "evals" }))).toEqual({ reason: "read", message: evals });
    // one reader, one gate: Run this version of a version the read refuses is refused there too, before its approval
    const edited = h.write("evals", `${EVALS}// edited\n`);
    const waits = waitsOf(await h.start({ flow: "evals" }));
    const act = h.runs.acts.start({
      id: waits,
      flow: "evals",
      hash: flowHashOf(edited),
      version: "this",
      start: askedOf(h, 0),
    });
    expect(await act).toEqual({ outcome: "failed", reason: evals });
    expect(h.records.approval("evals")?.hash).toBe(approval.hash);
    // a whole-file refusal names no line, so its frame says none (NN1, ruled 2026-11-06): Run this version of one
    const hello = h.approved("hello", HELLO);
    const whole = h.write("hello", 'export const meta = { name: "Hello" };\n');
    const asked = waitsOf(await h.start());
    const wholeAct = h.runs.acts.start({
      id: asked,
      flow: "hello",
      hash: flowHashOf(whole),
      version: "this",
      start: askedOf(h, 1),
    });
    expect(await wholeAct).toEqual({
      outcome: "failed",
      reason: "VibeField can't start Hello: it exports no default function to run.",
    });
    expect(h.records.approval("hello")?.hash).toBe(hello.hash);
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
  });

  it("R1c (Q-b): a copy of VibeField that can't start a flow's host refuses a run at its start in §9's host words, UNAVAILABLE as the flows' doors say it, and records nothing; an act on a kept start is refused the same way", async () => {
    const h = await harness({ unconfigured: "no flows host beside fieldd" });
    const approval = h.approved("hello", HELLO);
    // EL9 (the version review NN4): the refusal's data is the contract's, as its fixture pins it, never restated
    const fixture = join(
      import.meta.dirname,
      "../../contracts/fixtures/error-data.flows-host-unavailable.json",
    );
    const unavailable = ErrorData.parse(JSON.parse(readFileSync(fixture, "utf8")));
    const refusal = await h.start().then(
      () => undefined,
      (error: RpcCallError) => error,
    );
    expect(refusal?.message).toBe(words.hostUnconfigured());
    const data = ErrorData.parse({
      kind: refusal?.kind,
      retryable: refusal?.retryable,
      details: refusal?.details,
    });
    expect(data).toEqual(unavailable);
    // an item raised before the host went missing is acted on now: refused, nothing begun
    const act = h.runs.acts.start({
      id: "ny-0f2e4d6c8b0a1928" as NeedsItemId,
      flow: "hello",
      hash: approval.hash,
      version: "approved",
      start: { input: {}, starter: { by: "you" }, scope: ["work"] },
    });
    expect(await act).toEqual({ outcome: "failed", reason: words.hostUnconfigured() });
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
  });

  it("R1d: an approval whose kept bytes no longer hash to it (an agent edited them) starts nothing, refused at its start in §9's version words before any journal line", async () => {
    const h = await harness();
    const approval = h.approved("hello", HELLO);
    const kept = join(h.root, "fieldd", "flows", "bytes", `${approval.hash}.flow.js`);
    writeFileSync(kept, 'export const meta = { name: "Edited" };\n');
    expect(await refusalOf(h.start())).toEqual({
      reason: "version",
      message: words.notAVersion("hello"),
    });
    expect(h.records.runRecords()).toEqual([]);
    expect(h.records.runs()).toEqual([]);
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
      words.notAVersion("‹flow›"),
      words.hostUnconfigured(),
      words.readRefused("‹flow›", "‹the read's words›"),
      // ‹n› is the line the read names: said here at 7, and read back as §9 writes it
      words.readRefused("‹flow›", "‹the read's words›", 7).replace("(line 7)", "(line ‹n›)"),
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

// CP-4a2b (§13a slice 8b; CP4-S7) — a run's steps that hold a slot at once: LIVE_STEPS_MAX, a run's own. One more
// waits for a slot, visibly, and is never spawned past the bound. (Its start when a slot frees is slice 9's: an answer
// frees it.)

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

  /** A flow whose one step names no Agent Profile, its refusal logged (A2, A2b). */
  const unnamed = (name: string) =>
    [
      `export const meta = { name: "${name}" };`,
      "export default async function () {",
      '  try { await agent("go", { agent: "claude", label: "Go", cwd: "/work/app" }); }',
      "  catch (e) { log(e.message); }",
      "}",
      "",
    ].join("\n");

  it("A2 (W-g): a step that names no Agent Profile takes your default, or the spark's own for its run, each held to the run's scope; with none to give it, it is refused, never the runtime's own default", async () => {
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
    // a default outside the run's scope is none to give it: the step named none, so it is never said to name one (F8)
    const outside = await harness({ defaultProfile: "home", profiles: ["work", "home"] });
    outside.approved("unnamed", unnamed("Unnamed"));
    const homeless = startedRun(await outside.start({ flow: "unnamed", scope: ["work"] })).run;
    expect((await settled(outside.runs, homeless, "done")).log).toBe(
      W("Go", "it names no Agent Profile, and this run has none to give it."),
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

  it("A2b (slices 7–9 review F8, Q3): a step that names no Agent Profile, in a Run from a spark's thread, takes the spark's thinksUnder, as the spark's own run does, and yours takes your default; a thinksUnder outside the run's scope is none to give it", async () => {
    // Vela thinks under review, and your default is home
    const h = await harness({
      sparkProfiles: { [VELA]: "review" },
      defaultProfile: "home",
      profiles: ["work", "review", "home"],
    });
    h.approved("unnamed", unnamed("Unnamed"));
    /** the Agent Profile its step was spawned under, or, once its run has ended in any way (its `endedAt`, which every
     * end writes; the F8 review KK2), how: a done run's log, the words its step was refused in, or another end's
     * state, so a run ended another way fails on the value, never on a timeout */
    const stepOf = (run: string) => {
      const spawn = h.spawned.find((spawned) => spawned.origin.run === run);
      if (spawn !== undefined) return spawn.launch.profileSet;
      const summary = h.runs.read(run)?.summary;
      if (summary?.endedAt === undefined) return undefined;
      if (summary.state === "done" && summary.log !== undefined) return summary.log;
      return `${summary.state}: ${summary.log ?? "no log"}`;
    };
    const ran = async (params: Partial<FlowRunStartParams>) => {
      const run = startedRun(await h.start({ flow: "unnamed", ...params })).run;
      await waitFor(() => expect(stepOf(run)).toBeDefined());
      return stepOf(run);
    };
    const thread: Partial<FlowRunStartParams> = {
      starter: { by: "you", spark: VELA },
      scope: ["work", "review"],
    };
    // a Run in Vela's thread, under Vela's Agent Profiles: Vela's thinksUnder, never your default
    expect(await ran(thread)).toBe("review");
    // the guards: Vela's own run takes its thinksUnder, and yours your default
    const own: Partial<FlowRunStartParams> = {
      starter: { by: "spark", spark: VELA },
      from: VELA_FROM,
      scope: ["work", "review"],
    };
    expect(await ran(own)).toBe("review");
    expect(await ran({ scope: ["work", "home"] })).toBe("home");
    // review since removed: the thread's run is narrowed to work, so Vela's thinksUnder is none to give it
    h.setProfiles(["work", "home"]);
    expect(await ran(thread)).toBe(
      W("Go", "it names no Agent Profile, and this run has none to give it."),
    );
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
      W("‹label›", words.agentsStarted()),
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
    // EE1 (F5 review): the bound's road says its cause in fieldd's log, as the refusal's road does
    expect(h.warned.filter((said) => said.event === "fieldd.flows.step.repair")).toEqual([
      {
        event: "fieldd.flows.step.repair",
        fields: {
          run,
          call: 1,
          n: FLOW_LIMITS.STEP_LINES_MAX,
          lines: FLOW_LIMITS.STEP_LINES_MAX,
        },
      },
    ]);
    expect(h.enqueued).toHaveLength(2);
    expect(h.kinds(run)).toEqual(["head", "call", "answer", "log", "end"]);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps).toMatchObject([{ call: 1, label: "Diff", state: "failed" }]);
  });

  it("R22e (F5 review EE2): Ask once more whose repair line is kept, and which its session's queue refuses, fails its step in §9's words, the line kept as sending and the hold dropped", async () => {
    const h = await harness();
    const run = await heldOnRepair(h);
    vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementationOnce(() => {
      throw new Error("the session's queue is full");
    });
    expect(await askOnceMore(h, run)).toEqual({ outcome: "failed", reason: stepFailed("Diff") });
    expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.step.repair");
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.enqueued).toHaveLength(2);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps[0]).toMatchObject({ call: 1, label: "Diff", state: "failed" });
    expect(record?.steps[0]?.lines?.at(-1)).toEqual({ line: "repair", n: 2, sent: "sending" });
  });

  it("R22f (F5 review EE2): a first repair line kept, and refused by its session's queue, fails its step in §9's words, the line kept as sending and no item raised", async () => {
    const h = await harness();
    h.approved("review", FORMED_CATCHES);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    vi.spyOn(h.runs.ports.inputs, "enqueue").mockImplementationOnce(() => {
      throw new Error("the session's queue is full");
    });
    h.endTurn({
      run,
      call: 1,
      runtimeRunId: "rt-step1",
      turn: "t1",
      outcome: "completed",
      text: "no json here",
    });
    expect((await settled(h.runs, run, "done")).log).toBe(stepFailed("Diff"));
    expect(h.warned.map((said) => said.event)).toContain("fieldd.flows.step.repair");
    expect(h.enqueued).toHaveLength(1);
    expect(h.items).toEqual([]);
    const record = h.records.runRecord(run);
    expect(record?.held).toBeUndefined();
    expect(record?.steps[0]).toMatchObject({ call: 1, label: "Diff", state: "failed" });
    expect(record?.steps[0]?.lines?.at(-1)).toEqual({ line: "repair", n: 1, sent: "sending" });
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

  it("R8c (slices 7–9 review F6): a run's folder is held at its start, on its journal's head: a step after its input's folder moved runs in the begin's; a head that holds one is read at the wake, and one from before it falls back to the input", async () => {
    const folders: Record<string, string> = { "session:run-yours": "/work/yours" };
    const h = await harness({ folders });
    h.approved(
      "held",
      [
        'export const meta = { name: "Held", input: { target: "session" } };',
        "export default async function () {",
        "  const none = {};",
        '  await agent("go", { agent: "claude", profile: "work", label: "Here", cwd: none.cwd });',
        "}",
        "",
      ].join("\n"),
    );
    const cwdOf = (run: string) => h.spawned.find((spawn) => spawn.origin.run === run)?.launch.cwd;
    const folderOf = (run: string) => {
      const read = h.records.readRun(run);
      return read.kind === "kept" ? read.head.folder : read.kind;
    };
    const start = async () =>
      startedRun(await h.start({ flow: "held", input: { target: "run-yours" } })).run;
    // the input's folder moves after the begin: the step runs in the begin's, as the head keeps it
    const moved = await start();
    folders["session:run-yours"] = "/work/moved";
    await waitFor(() => expect(cwdOf(moved)).toBeDefined());
    expect(cwdOf(moved)).toBe("/work/yours");
    expect(folderOf(moved)).toBe("/work/yours");
    // a head that holds a folder is read at the wake, whatever its input names now
    const begin = h.records.beginRun.bind(h.records);
    const beginning = vi.spyOn(h.records, "beginRun");
    beginning.mockImplementationOnce((entry, at) => begin({ ...entry, folder: "/work/held" }, at));
    const held = await start();
    await waitFor(() => expect(cwdOf(held)).toBeDefined());
    expect(cwdOf(held)).toBe("/work/held");
    // a head from before F6 holds none: its wake falls back to the folder its input names then
    beginning.mockImplementationOnce(({ folder: _folder, ...entry }, at) => begin(entry, at));
    const old = await start();
    expect(folderOf(old)).toBeUndefined();
    await waitFor(() => expect(cwdOf(old)).toBeDefined());
    expect(cwdOf(old)).toBe("/work/moved");
  });

  it("R8b: a step that names no folder, in a run whose input names none, is refused at the start in §9's words, nothing journaled; a session or project its input names that VibeField can't find is refused too, and one whose folder it can't run in (GG1), before any approval; only the folder the run holds, its first input's, is checked (JJ1)", async () => {
    const h = await harness({
      folders: {
        "session:run-yours": "/work/yours",
        "project:pj-1": "/work/pj1",
        // GG1: folders VibeField finds and can't run in, one past the head's bound and empty ones
        "session:run-long": `/${"a".repeat(FLOW_LIMITS.FOLDER_CHARS)}`,
        "session:run-blank": "",
        "project:pj-0": "",
      },
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
    // GG1 (the F6 review; ruled 2026-11-06): one whose folder is past FLOW_LIMITS.FOLDER_CHARS, or empty, is the
    // input's refusal at the start, in §9's PROPOSED words, never the store's degraded words from inside its begin
    const long = h.start({ flow: "in-session", input: { target: "run-long" } });
    expect(await refusalOf(long)).toEqual({
      reason: "input-session",
      message: "VibeField can't run in the folder of the session its input names.",
    });
    const empty = h.start({ flow: "in-project", input: { where: "pj-0" } });
    expect(await refusalOf(empty)).toEqual({
      reason: "input-project",
      message: "VibeField can't run in the folder of the project its input names.",
    });
    // on Run this version too, which approves the bytes it runs: it is refused before the approval, so none is kept
    const asked = stepWith("", '{ target: "session" }');
    const approval = h.approved("in-long", asked);
    const edited = h.write("in-long", `${asked}// edited\n`);
    const waits = waitsOf(await h.start({ flow: "in-long", input: { target: "run-long" } }));
    const act = h.runs.acts.start({
      id: waits,
      flow: "in-long",
      hash: flowHashOf(edited),
      version: "this",
      start: askedOf(h, 0),
    });
    expect(await act).toEqual({
      outcome: "failed",
      reason: "VibeField can't run in the folder of the session its input names.",
    });
    expect(h.records.approval("in-long")?.hash).toBe(approval.hash);
    expect(h.warned.map((said) => said.event)).not.toContain("fieldd.flows.run.write");
    expect(h.records.runRecords()).toEqual([]);
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
    // JJ1 (the 1l review; ruled 2026-11-06): only the folder the run holds, its first input's, is checked. An
    // unusable first folder is refused, never passed over for the next input's (no silent fallback)
    h.approved("two", stepWith("", '{ target: "session", other: "session" }'));
    const passed = h.start({ flow: "two", input: { target: "run-long", other: "run-yours" } });
    expect(await refusalOf(passed)).toEqual({
      reason: "input-session",
      message: "VibeField can't run in the folder of the session its input names.",
    });
    // and a later input's folder, which nothing of the run's uses, refuses nothing, empty or past the bound
    for (const other of ["run-blank", "run-long"]) {
      const started = h.start({ flow: "two", input: { target: "run-yours", other } });
      expect(await refusalOf(started), other).toBe("started");
      const read = h.records.readRun(startedRun(await started).run);
      expect(read.kind === "kept" ? read.head.folder : read.kind, other).toBe("/work/yours");
    }
  });

  it("says R8b's refusals in DESIGN.md's own words (§9 \"When a run can't start\")", () => {
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    for (const said of [
      words.inputNotFound("session"),
      words.inputNotFound("project"),
      words.folderUnusable("session"),
      words.folderUnusable("project"),
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

  it("R5b (R4–R6 review H1): Run the one you approved runs the approval standing at the act, never the one that stood at the ask", async () => {
    const h = await harness();
    const first = h.approved("hello", HELLO);
    h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    // the approval moves on after the ask: a third version is approved, as the library's or a proposal's is
    const standing = h.approved("hello", `${HELLO}// a third version\n`);
    const act = h.runs.acts.start({
      id: waits,
      flow: "hello",
      hash: first.hash,
      version: "approved",
      start: askedOf(h, 0),
    });
    const run = ranOf(await act);
    expect(h.records.runRecord(run)?.hash).toBe(standing.hash);
    await settled(h.runs, run, "done");
  });

  it("R5c (R4–R6 review H1): Run the one you approved, for a flow with no approval standing at the act, is refused in §9's version words and begins nothing, though bytes are kept under its hash", async () => {
    const h = await harness();
    // a proposal keeps its bytes, and approves nothing
    const kept = h.records.keep(h.write("fresh", HELLO));
    const waits = waitsOf(await h.start({ flow: "fresh" }));
    const act = h.runs.acts.start({
      id: waits,
      flow: "fresh",
      hash: kept,
      version: "approved",
      start: askedOf(h, 0),
    });
    expect(await act).toEqual({ outcome: "failed", reason: words.notAVersion("fresh") });
    expect(h.records.approval("fresh")).toBeUndefined();
    expect(h.records.runRecords()).toEqual([]);
  });

  it("R4d (R4–R6 review H3): Run this version, on a version that already stands, approves nothing again: its approval keeps its approvedAt and the proposal it came from", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    // the version asked about is approved meanwhile, from a spark's proposal
    const standing = h.records.approve("hello", edited, { proposal: "fp-k3v9q2m7" });
    const act = h.runs.acts.start({
      id: waits,
      flow: "hello",
      hash: flowHashOf(edited),
      version: "this",
      start: askedOf(h, 0),
    });
    const run = ranOf(await act);
    expect(h.records.approval("hello")).toEqual(standing);
    expect(h.records.runRecord(run)?.hash).toBe(standing.hash);
    await settled(h.runs, run, "done");
  });

  it("R4e (the version review NN3, ruled 2026-11-06): Run this version, on a version that stands whose kept bytes were edited in place, runs it: the library's file, whose hash is the standing one, keeps its bytes again, and approves nothing", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    const edited = h.write("hello", HELLO_EDITED);
    const waits = waitsOf(await h.start());
    // the version asked about is approved meanwhile, and then its kept bytes are edited in place (an agent's)
    const standing = h.records.approve("hello", edited, { proposal: "fp-k3v9q2m7" });
    const kept = join(h.root, "fieldd", "flows", "bytes", `${standing.hash}.flow.js`);
    writeFileSync(kept, 'export const meta = { name: "Edited" };\n');
    const acted = await h.runs.acts.start({
      id: waits,
      flow: "hello",
      hash: flowHashOf(edited),
      version: "this",
      start: askedOf(h, 0),
    });
    expect(acted).toMatchObject({ outcome: "done" });
    expect(readFileSync(kept, "utf8")).toBe(HELLO_EDITED);
    expect(h.records.approval("hello")).toEqual(standing);
    const run = ranOf(acted);
    expect(h.records.runRecord(run)?.hash).toBe(standing.hash);
    await settled(h.runs, run, "done");
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
    // the read after the wake, the first to find it lost, is the disk's to refuse. This holds only while nothing
    // subscribes: a subscriber's list() would take the spied throw into #finish's catch (1h review DD2)
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

  it("R6k (the F4b fix review; ruled 2026-11-06): a run's end the disk refuses, its list then unreadable too, is said in fieldd's log as the end's own failure, never the list's; the list's is said as a tell's", async () => {
    const h = await harness();
    h.approved("hello", HELLO);
    // a subscriber, so the end's catch reads the list; the store refuses that one read, just after the end's line
    h.runs.onChange(() => undefined);
    const append = h.records.appendRun.bind(h.records);
    const listed = h.records.runRecords.bind(h.records);
    const full = "ENOSPC: no space left on device, write";
    let refusing = false;
    vi.spyOn(h.records, "appendRun").mockImplementation((run, entry) => {
      if (entry.kind !== "end") return append(run, entry);
      refusing = true;
      throw new Error(full);
    });
    vi.spyOn(h.records, "runRecords").mockImplementation(() => {
      if (!refusing) return listed();
      refusing = false;
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const run = startedRun(await h.start()).run;
    const errors = () => h.errored.map(({ event }) => event);
    await waitFor(() => expect(errors()).toContain("fieldd.flows.run.end"));
    const told = h.warned.filter(({ event }) => event === "fieldd.flows.run.told");
    expect(h.errored).toEqual([
      { event: "fieldd.flows.run.end", error: expect.objectContaining({ run, error: full }) },
    ]);
    expect(told).toEqual([
      { event: "fieldd.flows.run.told", fields: { error: UNREADABLE_WORDS.flows } },
    ]);
  });
});

// CP-4a2b (the slices 7–9 review's F4; Q1 (b), ruled 2026-11-06; the record's count at the refined (A),
// 2026-11-06; LL1's words, 2026-11-06) — a run starts FLOW_LIMITS.RUN_AGENTS_MAX agents at most, counted until its end
// whatever becomes of them: a step that would start one more is refused at its spawn, in DESIGN.md §9's PROPOSED words,
// never made to wait. The count is the run's record's (`agents`), reserved in the one write that reads it, so two
// starts at once never both pass, and a run woken on its record counts as it did. An `in:` starts none.

/** `n` spawned steps at once, each refusal caught and logged; `model` names one, so each start awaits the runtime's
 * models before its spawn; `hand` adds one handed your session by `in:` after them. */
const agentsAtOnce = (
  n: number,
  opts: { readonly model?: string; readonly hand?: boolean } = {},
): string => {
  const model = opts.model !== undefined ? `, model: "${opts.model}"` : "";
  return [
    'export const meta = { name: "Agents" };',
    "export default async function () {",
    "  const steps = [];",
    `  for (let i = 1; i <= ${n}; i += 1)`,
    `    steps.push(agent("look at part " + i, { agent: "claude", label: "Part " + i, profile: "work", cwd: "/work/app"${model} }).catch((e) => log(e.message)));`,
    ...(opts.hand === true
      ? ['  steps.push(agent("Review this", { in: "run-yours", label: "Yours" }));']
      : []),
    "  return await Promise.all(steps);",
    "}",
    "",
  ].join("\n");
};

/** §9's PROPOSED reason (LL1's words), after "VibeField didn't start ‹label›:". */
const AGENTS_STARTED = "this run has already started as many agents as a run may.";

describe("CP-4a2b — a run's agents, RUN_AGENTS_MAX started, counted until its end (the slices 7–9 review's F4)", () => {
  /** The line step `call` of `run` was given, once its agent is working. */
  const lineOf = (h: Harness, run: string, call: number) =>
    h.enqueued.find(({ from }) => from.kind === "flow" && from.run === run && from.call === call);
  /** Step `call` of `run`: "spawned" once its agent was, the words it was refused in once its journal keeps them,
   * "answered" for an answer, and none before any. */
  const outcomeOf = (h: Harness, run: string, call: number): string | undefined => {
    if (h.spawned.some(({ origin }) => origin.run === run && origin.call === call))
      return "spawned";
    const read = h.records.readRun(run);
    if (read.kind !== "kept") return read.kind;
    const answer = read.lines.find((line) => line.kind === "answer" && line.call === call);
    if (answer?.kind !== "answer") return undefined;
    return answer.refused ?? "answered";
  };
  /** Step `call`'s turn ends "ok", in the session its line went to. */
  const answer = (h: Harness, run: string, call: number) =>
    h.endTurn({
      run,
      call,
      runtimeRunId: lineOf(h, run, call)?.runtimeRunId ?? "",
      turn: "t1",
      outcome: "completed",
      text: "ok",
    });
  /** The next run begun with its record keeping `agents` already, as a run woken on its record reads it. */
  const keeping = (h: Harness, agents: number) => {
    const begin = h.records.beginRun.bind(h.records);
    vi.spyOn(h.records, "beginRun").mockImplementationOnce((entry, start) =>
      begin(entry, { ...start, agents }),
    );
  };

  it("RA1: a run's 17th agent is refused at its spawn in §9's words, never spawned and never made to wait; the 16 its steps started are counted on its record", async () => {
    const h = await harness();
    const max = FLOW_LIMITS.RUN_AGENTS_MAX;
    const slots = FLOW_LIMITS.LIVE_STEPS_MAX;
    h.approved("agents", agentsAtOnce(max + 1));
    const run = startedRun(await h.start({ flow: "agents" })).run;
    // each answer frees its slot (CP4-S7) for the next step, and the agent it answered lives on
    for (let call = 1; call <= max - slots + 1; call += 1) {
      await waitFor(() => expect(lineOf(h, run, call)).toBeDefined());
      answer(h, run, call);
    }
    await waitFor(() => expect(outcomeOf(h, run, max + 1)).toBeDefined());
    expect(outcomeOf(h, run, max + 1)).toBe(W(`Part ${max + 1}`, AGENTS_STARTED));
    expect(h.spawned).toHaveLength(max);
    // its record says so: the step failed, never waiting, and the run keeps its 16
    const record = h.records.runRecord(run);
    expect(record?.steps.find((step) => step.call === max + 1)?.state).toBe("failed");
    expect(record).toMatchObject({ agents: max });
  });

  it("RA2: two steps started together at RUN_AGENTS_MAX − 1, each awaiting the runtime's models before its spawn: exactly one is spawned, and the other refused", async () => {
    let free: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      free = resolve;
    });
    const h = await harness({ modelsHeld: held });
    const max = FLOW_LIMITS.RUN_AGENTS_MAX;
    h.approved("agents", agentsAtOnce(2, { model: "opus" }));
    keeping(h, max - 1);
    const run = startedRun(await h.start({ flow: "agents" })).run;
    // the race, held (the F4b review MM1): both starts wait at their models() await, and neither has reserved, so
    // the two reserve after it whatever the host's pipe makes of the two calls. The gate opens whatever the reads say
    // (its fix review's nit), so a start that never asks fails on its count, never parked past the row
    try {
      await waitFor(() => expect(h.modelAsks()).toBe(2));
      expect(h.records.runRecord(run)).toMatchObject({ agents: max - 1 });
    } finally {
      free();
    }
    const outcomes = () => [outcomeOf(h, run, 1), outcomeOf(h, run, 2)];
    await waitFor(() => expect(outcomes()).not.toContain(undefined));
    const refused = [1, 2].filter((call) => outcomeOf(h, run, call) !== "spawned");
    expect(refused).toHaveLength(1);
    const [call = 0] = refused;
    expect(outcomeOf(h, run, call)).toBe(W(`Part ${call}`, AGENTS_STARTED));
    expect(h.spawned).toHaveLength(1);
    expect(h.records.runRecord(run)).toMatchObject({ agents: max });
  });

  it("RA3: a run whose record counts RUN_AGENTS_MAX at its wake, as a run woken on its record does, refuses its next spawn; a step it hands your session by in: starts none, and is handed", async () => {
    const h = await harness({ sessions: { "run-yours": HANDED_YOURS } });
    const max = FLOW_LIMITS.RUN_AGENTS_MAX;
    h.approved("agents", agentsAtOnce(1, { hand: true }));
    keeping(h, max);
    const run = startedRun(await h.start({ flow: "agents" })).run;
    await waitFor(() => expect(outcomeOf(h, run, 1)).toBeDefined());
    expect(outcomeOf(h, run, 1)).toBe(W("Part 1", AGENTS_STARTED));
    expect(h.spawned).toEqual([]);
    // the guard: the in: at RUN_AGENTS_MAX is handed, never refused, and the count stands
    await waitFor(() => expect(h.hands).toHaveLength(1));
    expect(h.hands).toMatchObject([{ runtimeRunId: "run-yours", run, call: 2, gone: false }]);
    expect(h.records.runRecord(run)).toMatchObject({ agents: max });
  });

  it("RA4 (the F4b review MM2): a list the store refuses just after a reservation's write landed is said in fieldd's log, never thrown out of the write: the step still spawns, and its run counts the one agent it started", async () => {
    const h = await harness();
    h.approved("agents", agentsAtOnce(1));
    // a subscriber, so each write's list is read; the store refuses the one read just after the reservation lands
    h.runs.onChange(() => undefined);
    const write = h.records.writeRunRecord.bind(h.records);
    const listed = h.records.runRecords.bind(h.records);
    let reserved = false;
    let refusing = false;
    vi.spyOn(h.records, "writeRunRecord").mockImplementation((run, fields) => {
      write(run, fields);
      if (!reserved && fields.agents === 1) {
        reserved = true;
        refusing = true;
      }
    });
    vi.spyOn(h.records, "runRecords").mockImplementation(() => {
      if (!refusing) return listed();
      refusing = false;
      throw recordsUnreadable(RECORD_STORES.SERVICE_FLOWS, UNREADABLE_WORDS.flows, true);
    });
    const run = startedRun(await h.start({ flow: "agents" })).run;
    await waitFor(() => expect(outcomeOf(h, run, 1)).toBeDefined());
    const events = h.warned.map(({ event }) => event);
    expect(reserved).toBe(true);
    expect(outcomeOf(h, run, 1)).toBe("spawned");
    expect(h.records.runRecord(run)).toMatchObject({ agents: 1 });
    expect(events).toContain("fieldd.flows.run.told");
    expect(events).not.toContain("fieldd.flows.step.start");
  });
});

// CP-4a2b (§13a slice 10a; D1, D2, CL-L5a, CL-L5c, CL-H13, CL-H14, CL-K-d) — the host's life: a run that waits has no
// process. A host with a call out and no frame but pongs for HOST_IDLE_MS (lowered here) is parked: its `stop()` is
// the runs' own, read as `waiting`, never `stopped`, and its journal gains no line. A step's answer journaled wakes
// it: a host started again replays the journal from the top, on the bytes its record names (D8), and a call it makes
// again is looked up first (D2): the record's state for that call, then its session, never spawned again while it
// lives. Moved on (ruled 2026-11-06): R27b and R13e's `ask` leg to slice 11, R27c to 12, R32's wake
// and the exited session's item to 14.

/** D1's idle, lowered for these rows, and the longest a row waits for a park, an end or a host's leaving. */
const IDLE_MS = 250;
const PARK_MS = 5_000;

/** Resolves once `ready()` holds, or after `ms` whatever it reads: a row then fails on what it reads, never on a
 * wait's own timeout. */
const within = async (ms: number, ready: () => boolean): Promise<void> => {
  const until = Date.now() + ms;
  while (!ready() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
};

/** A step's options, labelled `label`, as STEP_AT's are. */
const stepAt = (label: string): string =>
  `{ agent: "claude", label: "${label}", profile: "work", cwd: "/work/app" }`;

/** Two steps at once, A and B, their answers' texts said as the run's one log line. */
const TWO = [
  'export const meta = { name: "Two" };',
  "export default async function () {",
  `  const [a, b] = await Promise.all([agent("look at a", ${stepAt("A")}), agent("look at b", ${stepAt("B")})]);`,
  "  log(a.text + b.text);",
  "}",
  "",
].join("\n");

/** Two steps, A then B, their answers' texts said as the run's one log line. */
const SEQ = [
  'export const meta = { name: "Seq" };',
  "export default async function () {",
  `  const a = await agent("look at a", ${stepAt("A")});`,
  `  const b = await agent("look at b", ${stepAt("B")});`,
  "  log(a.text + b.text);",
  "}",
  "",
].join("\n");

/** B's call in SEQ, as its host journals it: what a kill between D5's first two steps leaves with no record entry. */
const seqB = () => ({
  kind: "call" as const,
  call: 2,
  what: "agent",
  key: flowCallKey("agent", [
    "look at b",
    { agent: "claude", label: "B", profile: "work", cwd: "/work/app" },
  ]),
  n: 1,
  label: "B",
  agent: "claude",
});

/** A flow that says one line, then waits on nothing: its host has no call out. */
const STUCK = [
  'export const meta = { name: "Stuck" };',
  "export default async function () {",
  '  log("waiting on nothing");',
  "  await new Promise(() => {});",
  "}",
  "",
].join("\n");

describe("CP-4a2b — the host's life: parked and woken, and D2's lookup at a wake (§13a slice 10a)", () => {
  /** Whether host `i` the runs started has left. */
  const left = (h: Harness, i: number): boolean => h.hosts[i]?.leftAt !== undefined;
  /** The run's state, as its summary reads it now. */
  const stateOf = (h: Harness, run: string) => h.runs.read(run)?.summary.state;
  /** The session step `call`'s record names, or none. */
  const sessionOf = (h: Harness, run: string, call: number): string =>
    h.records.runRecord(run)?.open.find((step) => step.call === call)?.session ?? "";
  /** Step `call`'s turn ends with `text`, in the session its record names. */
  const answerStep = (h: Harness, run: string, call: number, text: string) =>
    h.endTurn({
      run,
      call,
      runtimeRunId: sessionOf(h, run, call),
      turn: `t${call}`,
      outcome: "completed",
      text,
    });
  /** The run parked: host `i` gone and the run reading `waiting`, or what it reads after PARK_MS. */
  const parkedAt = async (h: Harness, run: string, i = 0) => {
    await within(PARK_MS, () => left(h, i) && stateOf(h, run) === "waiting");
    return { state: stateOf(h, run), left: left(h, i) };
  };
  const PARKED = { state: "waiting", left: true };

  it("R27 (D1): a run whose step waits past HOST_IDLE_MS with no frame is parked: its host has left, it reads waiting, never stopped, and its journal gains no line; the step's answer wakes it, and it ends done", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    expect(h.kinds(run)).toEqual(["head", "call"]);
    answerStep(h, run, 1, "all clean");
    expect((await settled(h.runs, run, "done")).log).toBe("all clean");
    expect(h.hosts).toHaveLength(2);
  });

  it("R10 (L7a): a run parked on the version it began on wakes on that version's bytes, though another was approved while it waited", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    const first = h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    h.approved("review", ANSWERED.replace("log(said.text);", 'log("v2: " + said.text);'));
    answerStep(h, run, 1, "all clean");
    const ended = await settled(h.runs, run, "done");
    expect({ hosts: h.hosts.length, log: ended.log, hash: ended.hash }).toEqual({
      hosts: 2,
      log: "all clean",
      hash: first.hash,
    });
  });

  it("R27d (D1): a wake inside the parked host's leave grace starts its new host only once the old one has left", async () => {
    const grace = 1_000;
    const h = await harness({ hostIdleMs: IDLE_MS, timings: { stopGraceMs: grace } });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    // the old host can't hear its shutdown, so it leaves only at the grace's SIGKILL
    h.hosts[0]?.child.kill("SIGSTOP");
    await within(PARK_MS, () => stateOf(h, run) === "waiting");
    answerStep(h, run, 1, "all clean");
    await within(PARK_MS, () => stateOf(h, run) === "done");
    const [old, next] = h.hosts;
    expect({
      state: stateOf(h, run),
      left: old?.leftAt !== undefined,
      after: (next?.at ?? 0) >= (old?.leftAt ?? Number.POSITIVE_INFINITY),
    }).toEqual({ state: "done", left: true, after: true });
  });

  it("R32a (R32 as 10a pins it; its wake is slice 14's boot): a parked run is found where it was by the runs fieldd starts again: waiting, its step working in its session, its journal as it was, and no host started", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("review", ANSWERED);
    const run = startedRun(await h.start({ flow: "review" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    await within(PARK_MS, () => left(h, 0) && stateOf(h, run) === "waiting");
    await h.runs.close();
    const again = new FlowRuns(h.runs.ports);
    opened.push(again);
    const found = again.read(run)?.summary;
    expect({
      state: found?.state,
      steps: found?.steps.map((step) => [step.call, step.session, step.state]),
      hosts: h.hosts.length,
    }).toEqual({ state: "waiting", steps: [[1, "rt-step1", "working"]], hosts: 1 });
    expect(h.kinds(run)).toEqual(["head", "call"]);
  });

  it("R13 (D2): at a wake, a call made again whose step's session lives binds to it, never spawned again; one whose start is in flight spawns once, and the next wake binds it; one whose session exited fails the step in §9's words, nothing spawned", async () => {
    // a live session binds: B's answer wakes the run, and A, made again, is bound to its session
    const live = await harness({ hostIdleMs: IDLE_MS });
    live.approved("two", TWO);
    const bound = startedRun(await live.start({ flow: "two" })).run;
    await waitFor(() => expect(live.enqueued).toHaveLength(2));
    expect(await parkedAt(live, bound)).toEqual(PARKED);
    answerStep(live, bound, 2, "b");
    await within(PARK_MS, () => live.hosts.length === 2);
    answerStep(live, bound, 1, "a");
    await within(PARK_MS, () => stateOf(live, bound) === "done");
    expect({
      state: stateOf(live, bound),
      log: live.runs.read(bound)?.summary.log,
      spawned: live.spawned.length,
      hosts: live.hosts.length,
    }).toEqual({ state: "done", log: "ab", spawned: 2, hosts: 2 });
    // starting with no session: A's start waits on the runtime's models through the park and the wake, so it is made
    // again while it starts; it spawns once, and the next wake binds it
    let free: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      free = resolve;
    });
    const starting = await harness({ hostIdleMs: IDLE_MS, modelsHeld: held });
    const modelled = TWO.replace(stepAt("A"), stepAt("A").replace(" }", ', model: "opus" }'));
    starting.approved("two", modelled);
    const once = startedRun(await starting.start({ flow: "two" })).run;
    try {
      await waitFor(() => expect(starting.enqueued).toHaveLength(1));
      expect(await parkedAt(starting, once)).toEqual(PARKED);
      answerStep(starting, once, 2, "b");
      await within(PARK_MS, () => starting.hosts.length === 2);
    } finally {
      free();
    }
    await within(PARK_MS, () => starting.enqueued.length === 2);
    expect(await parkedAt(starting, once, 1)).toEqual(PARKED);
    answerStep(starting, once, 1, "a");
    await within(PARK_MS, () => stateOf(starting, once) === "done");
    expect({
      state: stateOf(starting, once),
      spawned: starting.spawned.map(({ origin }) => origin.call),
      hosts: starting.hosts.length,
    }).toEqual({ state: "done", spawned: [2, 1], hosts: 3 });
    // an exited one (ruled 2026-11-06, its item slice 14's): A's session ends while the run is parked, so A made again
    // fails in "‹label› failed.", and nothing spawns and no item is raised
    const gone = await harness({ hostIdleMs: IDLE_MS });
    gone.approved("two", TWO);
    const lost = startedRun(await gone.start({ flow: "two" })).run;
    await waitFor(() => expect(gone.enqueued).toHaveLength(2));
    expect(await parkedAt(gone, lost)).toEqual(PARKED);
    gone.exit(sessionOf(gone, lost, 1));
    answerStep(gone, lost, 2, "b");
    await within(PARK_MS, () => refusalsOf(gone, lost).length > 0);
    expect({
      refused: refusalsOf(gone, lost),
      spawned: gone.spawned.length,
      items: gone.items,
      hosts: gone.hosts.length,
    }).toEqual({ refused: [stepFailed("A")], spawned: 2, items: [], hosts: 2 });
  });

  it("R13b (D2): a wake while a step waits for a slot makes its 9 sessions in all, never more than LIVE_STEPS_MAX live, and the waiting step's prompt is queued once", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    const slots = FLOW_LIMITS.LIVE_STEPS_MAX;
    h.approved("fan", fanOut(slots + 1));
    const run = startedRun(await h.start({ flow: "fan" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(slots));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    // the first step's answer frees its slot for the 9th, and wakes the run
    answerStep(h, run, 1, "one");
    await within(PARK_MS, () => h.hosts.length === 2 && h.enqueued.length === slots + 1);
    const lines = h.enqueued.filter(({ from }) => from.kind === "flow" && from.call === slots + 1);
    const live = h.spawned.map(
      ({ open }) =>
        open.filter((step) => ["starting", "working"].includes(step.state) && step.handed !== true)
          .length,
    );
    expect({ hosts: h.hosts.length, spawned: h.spawned.length, lines: lines.length }).toEqual({
      hosts: 2,
      spawned: slots + 1,
      lines: 1,
    });
    expect(Math.max(...live)).toBeLessThanOrEqual(slots);
  });

  it("R13e (D2, [BR] MED): a journal call line with no record entry, as a kill between D5's first two steps leaves it, reads starting at the wake: its agent spawns once, the record counts its call, and the run is never lost", async () => {
    const h = await harness({ hostIdleMs: IDLE_MS });
    h.approved("seq", SEQ);
    const run = startedRun(await h.start({ flow: "seq" })).run;
    await waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(await parkedAt(h, run)).toEqual(PARKED);
    // B's call, journaled as the first life would have before its record entry, and no entry written
    h.records.appendRun(run, seqB());
    answerStep(h, run, 1, "a");
    await within(PARK_MS, () => h.enqueued.length === 2);
    const woken = h.records.runRecord(run);
    expect({
      spawned: h.spawned.map(({ origin }) => origin.call),
      calls: woken?.calls,
      open: woken?.open.map((step) => [step.call, step.state]),
      state: woken?.state,
    }).toEqual({ spawned: [1, 2], calls: 2, open: [[2, "working"]], state: "running" });
    answerStep(h, run, 2, "b");
    expect((await settled(h.runs, run, "done")).log).toBe("ab");
  });

  it("MM3 (the F4 logic review; ruled 2026-11-06): D2's lookup that binds a step's live agent at a wake reserves no agent, and a respawn of a step with no session reserves one, as LL1 counts a start", async () => {
    // the bind: two agents started, and a wake that binds A keeps the count at 2
    const bound = await harness({ hostIdleMs: IDLE_MS });
    bound.approved("two", TWO);
    const two = startedRun(await bound.start({ flow: "two" })).run;
    await waitFor(() => expect(bound.enqueued).toHaveLength(2));
    expect(await parkedAt(bound, two)).toEqual(PARKED);
    answerStep(bound, two, 2, "b");
    await within(PARK_MS, () => bound.hosts.length === 2);
    answerStep(bound, two, 1, "a");
    await within(PARK_MS, () => stateOf(bound, two) === "done");
    expect({
      state: stateOf(bound, two),
      hosts: bound.hosts.length,
      agents: bound.records.runRecord(two)?.agents,
    }).toEqual({ state: "done", hosts: 2, agents: 2 });
    // the respawn: R13e's journaled call with no entry spawns, and counts one more
    const again = await harness({ hostIdleMs: IDLE_MS });
    again.approved("seq", SEQ);
    const seq = startedRun(await again.start({ flow: "seq" })).run;
    await waitFor(() => expect(again.enqueued).toHaveLength(1));
    expect(await parkedAt(again, seq)).toEqual(PARKED);
    again.records.appendRun(seq, seqB());
    answerStep(again, seq, 1, "a");
    await within(PARK_MS, () => again.enqueued.length === 2);
    const counted = { spawned: again.spawned.length, agents: again.records.runRecord(seq)?.agents };
    expect(counted).toEqual({ spawned: 2, agents: 2 });
  });

  it("R29 (D1, CL-K-d): of the runs ready at once, HOSTS_LIVE_MAX hosts start; the runs past it read waiting, their records kept, and each starts its host when one leaves, in the order they began", async () => {
    const max = FLOW_LIMITS.HOSTS_LIVE_MAX;
    const h = await harness();
    h.approved("review", ANSWERED);
    const started: RunSummary[] = [];
    for (let i = 0; i < max + 2; i += 1)
      started.push(startedRun(await h.start({ flow: "review" })));
    const runs = started.map(({ run }) => run);
    /** the run step `i`'s prompt was queued for */
    const runOf = (i: number) => {
      const from = h.enqueued[i]?.from;
      return from?.kind === "flow" ? from.run : undefined;
    };
    await within(PARK_MS, () => h.enqueued.length >= max);
    expect({ hosts: h.hosts.length, states: started.map(({ state }) => state) }).toEqual({
      hosts: max,
      states: [...Array.from({ length: max }, () => "running"), "waiting", "waiting"],
    });
    // the first run's step answers and its run ends: its host's place goes to the first run that waits
    answerStep(h, runs[0] ?? "", 1, "one");
    await within(PARK_MS, () => h.enqueued.length > max);
    const lastRun = runs[max + 1] ?? "";
    const freed = { hosts: h.hosts.length, next: runOf(max), last: stateOf(h, lastRun) };
    expect(freed).toEqual({ hosts: max + 1, next: runs[max], last: "waiting" });
    answerStep(h, runs[1] ?? "", 1, "two");
    await within(PARK_MS, () => h.enqueued.length > max + 1);
    expect({ hosts: h.hosts.length, next: runOf(max + 1) }).toEqual({
      hosts: max + 2,
      next: runs[max + 1],
    });
  });

  it("R30 (CL-H13): a host that left on its own with no call out is started again at once; one that leaves twice with no new journal line between is not started a third time, and its run fails in DESIGN.md §9's words", async () => {
    const h = await harness();
    h.approved("stuck", STUCK);
    const run = startedRun(await h.start({ flow: "stuck" })).run;
    await within(PARK_MS, () => h.kinds(run).includes("log"));
    h.hosts[0]?.child.kill("SIGKILL");
    await within(PARK_MS, () => h.hosts.length === 2);
    // the host started again holds its log line in the journal, so it writes nothing new before it leaves too
    h.hosts[1]?.child.kill("SIGKILL");
    await within(PARK_MS, () => stateOf(h, run) === "failed");
    const ended = h.runs.read(run)?.summary;
    expect({ state: ended?.state, log: ended?.log, hosts: h.hosts.length }).toEqual({
      state: "failed",
      log: "VibeField ended Stuck: its script stopped twice before it could go on.",
      hosts: 2,
    });
    expect(h.kinds(run)).toEqual(["head", "log", "end"]);
    const design = readFileSync(join(import.meta.dirname, "../../../DESIGN.md"), "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(design).toContain(`"${words.leftTwice("‹flow›")}"`);
  });
});
