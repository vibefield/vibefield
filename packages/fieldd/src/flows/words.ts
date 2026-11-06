import { FLOW_LIMITS, nameWords } from "@vibefield/contracts";

// CP-4a2b (§13a slice 7) — what a run says when it cannot start, one authority: DESIGN.md §9 "When a run can't start",
// line for line. Each is the sentence said after "Couldn't run ‹flow›:", which the window says before it. ‹flow› is
// `markName`'s: the name the flow's `meta` gives it, on one line and cut at 64 characters with "…"; a name that is, or
// starts with, "VibeField" (trimmed, any case) shows the flow's slug instead, so a flow never speaks as VibeField
// (R18). The bounds are FLOW_LIMITS' own numbers, so the words never say one the runs do not hold.

/** A flow's name as its mark says it (‹flow›): its `meta.name` on one line, or its slug (R18). */
export function markName(name: string | undefined, flow: string): string {
  if (name === undefined) return flow;
  const said = nameWords(name);
  return said === "" || /^vibefield/i.test(said) ? flow : said;
}

/** No flow under that slug in the person's library. */
export const notFound = (flow: string): string => `VibeField can't find ${flow} in your flows.`;

/** The flow's file is past SCRIPT_MAX_BYTES: never read, never run. */
export const tooBig = (): string =>
  `Its file is larger than a flow may be (${FLOW_LIMITS.SCRIPT_MAX_BYTES / 1024} KiB).`;

/** An input the flow's `meta.input` does not name. */
export const noSuchInput = (flow: string, name: string): string =>
  `${flow} takes no input named ${name}; nothing was started.`;

/** An input naming a session or a project VibeField can't find (CP4-Q20 (a), R8b). */
export const inputNotFound = (kind: "session" | "project"): string =>
  `VibeField can't find the ${kind} its input names.`;

/** An input naming a session or a project VibeField finds, whose folder it can't run in: an empty one, or one past
 * FLOW_LIMITS.FOLDER_CHARS (the F6 review GG1; ruled 2026-11-06). */
export const folderUnusable = (kind: "session" | "project"): string =>
  `VibeField can't run in the folder of the ${kind} its input names.`;

/** The spark a start was asked by, or in whose thread, is gone (G2; CP-L4). */
export const noSpark = (): string => "VibeField can't find that spark; nothing was started.";

/** A run whose record fieldd could not keep: it never began (D18). §9 says it whole, under "A run that can't go on",
 * never after "Couldn't run ‹flow›:". */
export const neverBegan = (flow: string): string =>
  `VibeField couldn't begin ${flow}: it couldn't keep the run's record. Nothing was started.`;

/** A copy of VibeField that can't start a flow's host (its file is not beside fieldd; FLOW_HOST.STATE_UNCONFIGURED):
 * a run is refused at its start in §9's host sentence ("When a run's script cannot go on"), the agents' sentence for
 * the same loss (Q-b). */
export const hostUnconfigured = (): string =>
  "VibeField can't run flows: this copy of VibeField is missing the file it runs them with. Reinstall VibeField.";

/** No run fieldd keeps under that id. */
export const noSuchRun = (run: string): string => `VibeField has no run ${run}.`;

/** The version asked for is not one fieldd keeps for the flow. */
export const notAVersion = (flow: string): string => `That version isn't one of ${flow}'s.`;

/** A version its static read refuses, at its start (Q-a; the version review NN1, PROPOSED in §9, ruled
 * 2026-11-06): the read's own words (`read`, "What a flow's read refuses"), unchanged, with the line they name;
 * a whole-file refusal names none, and is said without one. */
export const readRefused = (flow: string, read: string, line?: number): string =>
  `VibeField can't start ${flow}: ${read}${line !== undefined ? ` (line ${line})` : ""}.`;

/** A run whose asked Agent Profiles are none of that spark's now: the spark's narrowing, at the act (the 1b review
 * V5, said by cause in the 1e review's AA1; PROPOSED in §9, ruled 2026-11-06). */
export const noSparkProfiles = (spark: string): string =>
  `None of the Agent Profiles it asked for is ${spark}'s now; nothing was started.`;

/** A run whose asked Agent Profiles no longer exist, anyone's, as it begins (V5, AA1; PROPOSED in §9, the same). */
export const noProfiles = (): string =>
  "None of the Agent Profiles it asked for exists now; nothing was started.";

/** RUNS_LIVE_MAX runs are live on this desktop (D3). */
export const runsLive = (flow: string): string =>
  `VibeField is running ${FLOW_LIMITS.RUNS_LIVE_MAX} flows, as many as it runs at once. Stop one, or run ${flow} when one ends.`;

/** A spark has RUNS_PER_SPARK_MAX runs of its own live (D3). */
export const runsPerSpark = (spark: string): string =>
  `${spark} is running ${FLOW_LIMITS.RUNS_PER_SPARK_MAX} flows, as many as a spark may.`;

/** A step that would start an agent once its run has started FLOW_LIMITS.RUN_AGENTS_MAX, counted until its end
 * whatever becomes of them (the slices 7–9 review's F4, ruled 2026-11-06; LL1, 2026-11-06): why it wasn't
 * started, said after steps.ts's "VibeField didn't start ‹label›:" (DESIGN.md §9 "A step's call refused"). */
export const agentsStarted = (): string =>
  "this run has already started as many agents as a run may.";
