import { basename, isAbsolute, relative, resolve } from "node:path";
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
// D9's checks are held here, before any spawn or send, each in §9's words: the keys, the agent (the catalog's door),
// its Agent Profile (named, or the spark's own or your default, held to the run's scope), its folder (the run's, or a
// project's, or inside one), its model (a name the runtime discovered), its prompt, and an `in:`.
// Built later in M-r2: D2's lookup at a wake (10a), the answer and a freed slot (9).

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

/** A session a step's `in:` names, as fieldd knows it (D9): live under this daemon, the Agent Profile it is placed
 * in (`profileSetOfRun`), who started it, the spark it is the own session of, and whether it waits on a permission. */
export interface FlowStepSession {
  readonly live: boolean;
  readonly profile?: string | undefined;
  readonly origin?: { readonly by: string; readonly run?: string | undefined } | undefined;
  readonly spark?: string | undefined;
  readonly onPermission: boolean;
}

/** fieldd's own interface to a run's steps (R32): the runtime's spawn, each session's input queue, the sessions an
 * `in:` may name, and the folder an input names (CP4-Q20 (a)). */
export interface FlowStepPorts {
  readonly agents: {
    spawn(launch: FlowStepLaunch, origin: FlowStepOrigin): Promise<{ runtimeRunId: string }>;
    /** the catalog's door (R23b): an agent offered for a spawn here, by the catalog's name for it; none otherwise */
    offers(agent: string): { readonly label: string } | undefined;
    /** the models the runtime discovers for `agent` in that folder and profile, by id; none when it can read none */
    models(
      agent: string,
      where: { readonly cwd: string; readonly profileSet: string },
    ): Promise<readonly string[] | undefined>;
  };
  readonly inputs: {
    enqueue(
      runtimeRunId: string,
      text: string,
      from: AgentInputSender,
    ): { id: string; position: number };
  };
  readonly sessions: { of(runtimeRunId: string): FlowStepSession | undefined };
  /** the folder an input of `kind` (`session`, `project`) names by `value`; none for another kind or one not found */
  folderOf(kind: string, value: string): string | undefined;
  /** the project folders this desktop knows: a step's `cwd` may be one, or inside one (D9) */
  projectFolders(): readonly string[];
  /** the Agent Profile a spark thinks under (`thinksUnder`): a step of its run that names none takes it (A2) */
  sparkProfile(spark: string): string | undefined;
  /** the person's default Agent Profile: a step of your run that names none takes it (A2); none, it is refused */
  defaultProfile(): string | undefined;
}

/** The run a step is of, as its words are marked: its slug, its mark's name, and the spark that started it. */
export interface FlowStepRun {
  readonly run: string;
  readonly flow: string;
  /** ‹flow›, as `markName` says it */
  readonly name: string;
  /** the spark that started the run, by its name (Q-B2 (a)); none for yours */
  readonly ran?: string | undefined;
  /** its Agent Profiles now: its frozen scope, narrowed to the profiles that exist (D8) */
  readonly scope: readonly string[];
  /** the folder its input names, a session's or a project's, where a step that names none runs (CP4-Q20 (a)) */
  readonly folder?: string | undefined;
  /** the spark whose own start the run is, whose profile a step that names none takes (A2); none for yours */
  readonly spark?: string | undefined;
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

/** The keys an `agent()` call may set (D9): any other is refused in words. */
const STEP_KEYS: ReadonlySet<string> = new Set([
  "agent",
  "model",
  "profile",
  "cwd",
  "label",
  "phase",
  "schema",
  "in",
]);

/** The keys whose value is a name or a path and that no other sentence covers: a value that is neither is refused in
 * words not yet drafted (W-h, sent for a ruling), so until then such a call is not started at all. `agent` is W-a's
 * and `model` W-f's. */
const NAMED_KEYS = ["profile", "cwd", "in"] as const;

/** The keys a spawn sets, which an `in:` beside them may not (A3). */
const SPAWN_KEYS = ["agent", "model", "profile", "cwd"] as const;

/** Whether `folder` is `root` or inside it, by the path alone (D9's `cwd`; a symlink is the runtime's to resolve). */
const within = (folder: string, root: string): boolean => {
  const rel = relative(resolve(root), resolve(folder));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** DESIGN.md §9's folder sentence, at the start and at a call that names none (CP4-Q20 (a)). */
export const NO_FOLDER =
  "None of its steps names a folder, and its input names none. Run it from a session or a project, or name a folder in it.";

/** A step's call refused before anything started (§9 "A step's call refused"). */
const didntStart = (label: string | undefined, why: string): FlowStepStarted => ({
  ok: false,
  refused: `VibeField didn't start ${labelWords(label)}: ${why}`,
});

/** Whether a step may be handed `session` (D9's `in:`): live, in the run's scope, no spark's own, no other flow's
 * step, and waiting on no permission. Your own session is the review loop's shape, and is allowed. */
const mayHand = (run: FlowStepRun, session: FlowStepSession | undefined): boolean =>
  session?.live === true &&
  session.profile !== undefined &&
  run.scope.includes(session.profile) &&
  session.spark === undefined &&
  !(session.origin?.by === "flow" && session.origin.run !== run.run) &&
  !session.onPermission;

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
  if (typeof prompt !== "string") return didntStart(label, "its prompt isn't words.");
  if (NAMED_KEYS.some((key) => options[key] !== undefined && said(options[key]) === undefined))
    throw new Error("CP-4a2b: a step's name that is not a name waits on its words (W-h)");
  const key = Object.keys(options).find((option) => !STEP_KEYS.has(option));
  if (key !== undefined)
    return didntStart(label, `it asks for ${nameWords(key)}, which a step may not set.`);
  const from: AgentInputSender = {
    kind: "flow",
    flow: run.flow,
    name: run.name,
    run: run.run,
    call,
    ...(run.ran !== undefined ? { ran: run.ran } : {}),
  };
  const handed = said(options["in"]);
  if (handed !== undefined) {
    // A3: a handed session is no spawn, so it sets none of a spawn's keys
    const spawnKey = SPAWN_KEYS.find((option) => options[option] !== undefined);
    if (spawnKey !== undefined)
      return didntStart(label, `it asks for ${spawnKey}, which a step may not set.`);
    if (!mayHand(run, ports.sessions.of(handed)))
      return {
        ok: false,
        refused: `VibeField didn't send ${labelWords(label)}: that session is outside this run's Agent Profiles, isn't running, is a spark's or another flow's, or is waiting on a permission.`,
      };
    return sent(ports, write, call, handed, "in", prompt, from);
  }
  // D9's agent: named, and offered for a spawn by the catalog's door (R23b)
  const agent = said(options["agent"]);
  if (agent === undefined) return didntStart(label, "it names no agent.");
  const offered = ports.agents.offers(agent);
  if (offered === undefined)
    return didntStart(label, `it names an agent VibeField doesn't start (${nameWords(agent)}).`);
  // A2: a step that names no Agent Profile takes the spark's own for a spark's run and your default for yours; none
  // to give it is refused, never the runtime's own default (a silent fallback); any is held to the run's scope (D8)
  const profileSet =
    said(options["profile"]) ??
    (run.spark !== undefined ? ports.sparkProfile(run.spark) : ports.defaultProfile());
  if (profileSet === undefined)
    return didntStart(label, "it names no Agent Profile, and this run has none to give it.");
  if (!run.scope.includes(profileSet))
    return didntStart(
      label,
      `it names an Agent Profile this run can't use (${nameWords(profileSet)}).`,
    );
  // CP4-Q20 (a): a step with no folder runs in the one its run's input names, and none is a default; a folder it names
  // is that one, or a project this desktop knows, or inside one (D9), checked here because it may be computed
  const named = said(options["cwd"]);
  const cwd = named ?? run.folder;
  if (cwd === undefined) return { ok: false, refused: NO_FOLDER };
  const roots = [...(run.folder !== undefined ? [run.folder] : []), ...ports.projectFolders()];
  if (named !== undefined && !(isAbsolute(named) && roots.some((root) => within(named, root))))
    return didntStart(
      label,
      `its folder (${nameWords(basename(resolve(named)) || "/")}) is outside this run's folder and your projects.`,
    );
  // A1: a model is a model's name, one the runtime discovered for this agent here (puppeteer checks it again); a flow
  // sets none of its controls
  const written = options["model"];
  let model: string | undefined;
  if (written !== undefined) {
    if (typeof written !== "string")
      return didntStart(label, "its model isn't written as a model's name.");
    model = written;
  }
  if (model !== undefined) {
    const models = await ports.agents.models(agent, { cwd, profileSet });
    if (models === undefined || !models.includes(model))
      return didntStart(
        label,
        `it names a model ${offered.label} doesn't offer (${nameWords(model)}).`,
      );
  }
  const launch: FlowStepLaunch = {
    agent,
    cwd,
    title: label === undefined ? run.name : `${run.name} · ${labelWords(label)}`,
    profileSet,
    ...(model !== undefined ? { model: { modelId: model } } : {}),
  };
  let runtimeRunId: string;
  try {
    ({ runtimeRunId } = await ports.agents.spawn(launch, { by: "flow", run: run.run, call }));
  } catch (error) {
    const why = oneLineWords(error instanceof Error ? error.message : String(error), FLOW_LOG_MAX);
    return { ok: false, refused: `VibeField couldn't start ${labelWords(label)}: ${why}` };
  }
  return sent(ports, write, call, runtimeRunId, "prompt", prompt, from);
}

/** D5 4–7 for a step's first line, `prompt` to the session it started or `in` to the one it was handed: the session
 * (`handed` for an `in:`, never ended, CP4-Q10), `working` and the line's intent on the record before the queue takes
 * it, then `queued` in the same tick. */
function sent(
  ports: FlowStepPorts,
  write: FlowStepWrite,
  call: number,
  session: string,
  line: "prompt" | "in",
  text: string,
  from: AgentInputSender,
): FlowStepStarted {
  write(call, (step) => ({
    ...step,
    session,
    ...(line === "in" ? { handed: true as const } : {}),
    state: "working",
    lines: [{ line, n: 1, sent: "sending" }],
  }));
  ports.inputs.enqueue(session, text, from);
  write(call, (step) => ({
    ...step,
    lines: (step.lines ?? []).map((kept) =>
      kept.line === line && kept.n === 1 ? { ...kept, sent: "queued" } : kept,
    ),
  }));
  return { working: session };
}
