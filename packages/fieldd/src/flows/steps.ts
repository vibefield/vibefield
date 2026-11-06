import {
  type AgentInputSender,
  type AgentModelSelection,
  FLOW_LOG_MAX,
  type FlowRunRecordStep,
  nameWords,
  oneLineWords,
} from "@vibefield/contracts";

// CP-4a2b (§13a slice 8; D5, D9) — a flow's steps: `startStep` is the ONE road a step's agent is started by
// (CL-H5), in D5's order, each fact on the run's record before the next act:
//   1. the call is journaled (replay.ts, before it is handed on);
//   2. the step's entry is in the record's `open`, `starting` (the runs write it at the call's line);
//   3. the spawn, the runtime writing `origin {by: "flow", run, call}` on the session's record;
//   4–5. the session, `working`, and the prompt's intent `{line: "prompt", n: 1, sent: "sending"}`, one write;
//   6. the prompt queued as the run's own words (Q-B1 (a)'s `flow` sender), never argv (CL-E7-4);
//   7. `sent: "queued"`, written in the tick the queue took it, with no await between.
// A spawn the runtime refuses is the step's refusal, in DESIGN.md §9's words ("A step's call refused"). The spawn
// shape has no approval or permission field (AgentSpawnParams), so a step never asks for one (CP-L4).
// Built later in M-r2: D2's lookup and the slots (8b), D9's checks on each option (8c), the answer (9).

/** What a step's agent is started with: the runtime's spawn, by fieldd's own interface (R32). */
export interface FlowStepLaunch {
  readonly agent: string;
  readonly cwd: string;
  /** "‹flow› · ‹label›", or ‹flow› for a step with no label (D9) */
  readonly title: string;
  readonly profileSet?: string | undefined;
  readonly model?: AgentModelSelection | undefined;
}

/** Who started a step's session, as its record says it (CP-D15): the run and its call (D2's lookup reads it). */
export interface FlowStepOrigin {
  readonly by: "flow";
  readonly run: string;
  readonly call: number;
}

/** fieldd's own interface to a run's steps (R32): the runtime's spawn and each session's input queue. */
export interface FlowStepPorts {
  readonly agents: {
    spawn(launch: FlowStepLaunch, origin: FlowStepOrigin): Promise<{ runtimeRunId: string }>;
  };
  readonly inputs: {
    enqueue(
      runtimeRunId: string,
      text: string,
      from: AgentInputSender,
    ): { id: string; position: number };
  };
}

/** The run a step is of, as its words are marked: its slug, its mark's name, and the spark that started it. */
export interface FlowStepRun {
  readonly run: string;
  readonly flow: string;
  /** ‹flow›, as `markName` says it */
  readonly name: string;
  /** the spark that started the run, by its name (Q-B2 (a)); none for yours */
  readonly ran?: string | undefined;
}

/** The run's record of its open step `call`, written through the runs (the one writer of a run's record). */
export type FlowStepWrite = (
  call: number,
  patch: (step: FlowRunRecordStep) => FlowRunRecordStep,
) => void;

/** How a step's start went: refused, in the script's words, or working in its session. */
export type FlowStepStarted =
  | { readonly ok: false; readonly refused: string }
  | { readonly working: string };

/** The options an `agent()` call passed, plain. */
type StepOptions = Readonly<Record<string, unknown>>;

const optionsOf = (args: readonly unknown[]): StepOptions => {
  const options = args[1];
  return typeof options === "object" && options !== null && !Array.isArray(options)
    ? (options as StepOptions)
    : {};
};

const said = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** ‹label› in a step's words: its label on one line, cut at 64 with "…"; "this step" for one with none. */
export function labelWords(label: string | undefined): string {
  const words = label === undefined ? "" : nameWords(label);
  return words === "" ? "this step" : words;
}

/** The ONE road a step's agent starts by (CL-H5): D5's steps 3–7 for call `call` of `run`, whose entry the runs have
 * written. Answers the refusal the script's `await` throws with, or the session the step works in. */
export async function startStep(
  ports: FlowStepPorts,
  run: FlowStepRun,
  write: FlowStepWrite,
  call: number,
  args: readonly unknown[],
): Promise<FlowStepStarted> {
  const options = optionsOf(args);
  const prompt = args[0];
  const label = said(options["label"]);
  const agent = said(options["agent"]);
  const cwd = said(options["cwd"]);
  // D9's checks on each option, and the folder a step names none of, are slice 8c's: until then a call they would
  // decide is not started at all, and the host refuses it in fieldd's own words
  if (typeof prompt !== "string" || agent === undefined || cwd === undefined)
    throw new Error("CP-4a2b: a step's options are checked in M-r2's slice 8c");
  const profileSet = said(options["profile"]);
  const launch: FlowStepLaunch = {
    agent,
    cwd,
    title: label === undefined ? run.name : `${run.name} · ${labelWords(label)}`,
    ...(profileSet !== undefined ? { profileSet } : {}),
  };
  let runtimeRunId: string;
  try {
    ({ runtimeRunId } = await ports.agents.spawn(launch, { by: "flow", run: run.run, call }));
  } catch (error) {
    const why = oneLineWords(error instanceof Error ? error.message : String(error), FLOW_LOG_MAX);
    return { ok: false, refused: `VibeField couldn't start ${labelWords(label)}: ${why}` };
  }
  // D5 4–5: the session and the prompt's intent, before the queue takes it
  write(call, (step) => ({
    ...step,
    session: runtimeRunId,
    state: "working",
    lines: [{ line: "prompt", n: 1, sent: "sending" }],
  }));
  ports.inputs.enqueue(runtimeRunId, prompt, {
    kind: "flow",
    flow: run.flow,
    name: run.name,
    run: run.run,
    call,
    ...(run.ran !== undefined ? { ran: run.ran } : {}),
  });
  // D5 7: in the tick the queue took it
  write(call, (step) => ({
    ...step,
    lines: (step.lines ?? []).map((line) =>
      line.line === "prompt" && line.n === 1 ? { ...line, sent: "queued" } : line,
    ),
  }));
  return { working: runtimeRunId };
}
