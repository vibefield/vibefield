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

/** No run fieldd keeps under that id. */
export const noSuchRun = (run: string): string => `VibeField has no run ${run}.`;

/** The version asked for is not one fieldd keeps for the flow. */
export const notAVersion = (flow: string): string => `That version isn't one of ${flow}'s.`;

/** RUNS_LIVE_MAX runs are live on this desktop (D3). */
export const runsLive = (flow: string): string =>
  `VibeField is running ${FLOW_LIMITS.RUNS_LIVE_MAX} flows, as many as it runs at once. Stop one, or run ${flow} when one ends.`;

/** A spark has RUNS_PER_SPARK_MAX runs of its own live (D3). */
export const runsPerSpark = (spark: string): string =>
  `${spark} is running ${FLOW_LIMITS.RUNS_PER_SPARK_MAX} flows, as many as a spark may.`;
