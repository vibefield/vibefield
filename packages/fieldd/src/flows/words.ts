import { FLOW_LIMITS, type FlowHostEnding, nameWords } from "@vibefield/contracts";

// CP-4a2b (§13a slices 7–11) — what VibeField says of a run, one authority: DESIGN.md §9, line for line. No sentence
// is here before §9 holds it. The file holds:
// - a run's refusals: why it can't start ("When a run can't start"), said after "Couldn't run ‹flow›:", which the
//   window says before it; the host's sentence ("When a run's script cannot go on"); why a step's call is refused,
//   said after steps.ts's "VibeField didn't start ‹label›:" ("A step's call refused"); and why a run can't go on, each
//   said whole ("A run that can't go on");
// - an ask's frames (slice 11, "An ask refused"): the words a script's `await ask()` throws with when VibeField didn't
//   ask you (the read's own words inside them, unchanged) or couldn't keep the question;
// - the spark's facts (slice 11, "What VibeField tells a spark"): what a run a spark started tells that spark when it
//   holds on you and when it ends, built from the spark's name, ‹flow› and the run's id alone.
// ‹flow› is `markName`'s: the name the flow's `meta` gives it, on one line and cut at 64 characters with "…"; a name
// that is, or starts with, "VibeField" (trimmed, any case) shows the flow's slug instead, so a flow never speaks as
// VibeField (R18). The bounds are FLOW_LIMITS' own numbers, so the words never say one the runs do not hold.

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

/** A run whose host left twice on its own with no new journal line between (D1, CL-H13): never started a third
 * time, it fails in DESIGN.md §9's words ("A run that can't go on"). */
export const leftTwice = (flow: string): string =>
  `VibeField ended ${flow}: its script stopped twice before it could go on.`;

/** D7 (slice 10b) — a run set aside `lost` when its host goes quiet with a new call held, while calls its journal
 * holds were not made again: DESIGN.md §9's "A run that can't go on". */
export const asideNew = (flow: string): string =>
  `VibeField set ${flow} aside: run again, its script asked for something it never asked before.`;

/** D7 (slice 10b; §9, PROPOSED) — set aside when its host goes quiet with nothing new asked: calls its journal holds
 * not made again, or an answer behind them its journal's order can't release. */
export const asideUnmatched = (flow: string): string =>
  `VibeField set ${flow} aside: run again, its script didn't ask what it asked before.`;

/** A copy of VibeField that can't start a flow's host (its file is not beside fieldd; FLOW_HOST.STATE_UNCONFIGURED):
 * a run is refused at its start in §9's host sentence ("When a run's script cannot go on"), the agents' sentence for
 * the same loss (Q-b). */
export const hostUnconfigured = (): string =>
  "VibeField can't run flows: this copy of VibeField is missing the file it runs them with. Reinstall VibeField.";

/** Why fieldd ended a run's host, by FLOW_HOST_ENDINGS' word: §9's four (DESIGN.md "When a run's script cannot go
 * on"), each said after "VibeField ended ‹flow›:". A Record over the word, so a fifth ending fails tsc here until
 * §9 holds its sentence. */
const HOST_ENDED: Readonly<Record<FlowHostEnding, string>> = {
  unanswered: "it stopped answering",
  memory: "it used more memory than a flow may",
  protocol: "it sent something VibeField can't read",
  flood: "it sent more than a flow may",
};

/** CP-4a2b slice 13 (Q13, R43) — a run whose host fieldd ended (`ended`, FLOW_HOST_ENDINGS' `why`): said once, in
 * fieldd's voice, on its record in place of the script's latest log line (DESIGN.md §9 "When a run's script cannot go
 * on"). J1's flood says it too (its F2). `fatal`'s sentence is not FLOW_HOST_ENDINGS', so not here (13b's). */
export const hostEnded = (flow: string, why: FlowHostEnding): string =>
  `VibeField ended ${flow}: ${HOST_ENDED[why]}.`;

/** No run fieldd keeps under that id. */
export const noSuchRun = (run: string): string => `VibeField has no run ${run}.`;

/** The version asked for is not one fieldd keeps for the flow. */
export const notAVersion = (flow: string): string => `That version isn't one of ${flow}'s.`;

/** A version its static read refuses, at its start (Q-a; the version review NN1, PROPOSED in §9, ruled
 * 2026-11-06): the read's own words (`read`, "What a flow's read refuses"), unchanged, with the line they name;
 * a whole-file refusal names none, and is said without one. */
export const readRefused = (flow: string, read: string, line?: number): string =>
  `VibeField can't start ${flow}: ${read}${line !== undefined ? ` (line ${line})` : ""}.`;

/** An `ask()` its gate's rule refuses at its call (slice 11, Q6/Q7, R34; §9 "An ask refused", PROPOSED, ruled
 * 2026-11-06): the read's own words (`read`, gate-check.ts's, "What a flow's read refuses"), unchanged, in the
 * frame the script's `await` throws with and the run's journal keeps. */
export const askRefused = (read: string): string => `VibeField didn't ask you: ${read}.`;

/** An `ask()` VibeField could not put in what waits on you: its raise threw, the store's refusal or any other (slice 11,
 * Q8, R34b; §9 "An ask refused", PROPOSED, the same). */
export const askUnkept = (): string => "VibeField couldn't ask you: it couldn't keep the question.";

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

// The spark's facts (slice 11, Q9; §9 "What VibeField tells a spark", PROPOSED, ruled 2026-11-06): one marked
// line each, without the "VibeField: " the input queue's mark adds (markedText) and with no closing stop, as that
// family's are (tool-plane/rooms/you/words.ts). Built from the spark's name (`nameWords`: one line, cut at 64), ‹flow›
// (`markName`'s) and the run's id alone: never the gate's question, a step's answer, a log line or what the script threw.
const sparksRun = (spark: string, flow: string, run: string): string =>
  `${nameWords(spark)}'s run of ${flow} (${run})`;

/** A run a spark started holds on you: a gate's item, or a step whose answer missed twice (Q9 (a)). */
export const factAsking = (spark: string, flow: string, run: string): string =>
  `${sparksRun(spark, flow, run)} is asking you`;

/** A run a spark started ended `done` (Q9 (b)). */
export const factDone = (spark: string, flow: string, run: string): string =>
  `${sparksRun(spark, flow, run)} is done`;

/** A run a spark started ended `failed` (Q9 (b)). */
export const factFailed = (spark: string, flow: string, run: string): string =>
  `${sparksRun(spark, flow, run)} failed`;

/** A run a spark started was set aside `lost` (Q9 (b); D7). */
export const factSetAside = (spark: string, flow: string, run: string): string =>
  `${sparksRun(spark, flow, run)} was set aside`;

/** CP-4a2b slice 13 (Q15; W1, §9's Proposed line of 2026-11-07, ruled 2026-11-07) — a run a spark started that a Stop
 * ended `stopped` (END_FACTS' `stopped`). Who stopped it is not said: the record keeps no stopper (CP-4b's). */
export const factStopped = (spark: string, flow: string, run: string): string =>
  `${sparksRun(spark, flow, run)} was stopped`;
