import {
  NEEDS_CHOICE_MAX,
  NEEDS_NOTICE_CHARS,
  NEEDS_REASON_MAX,
  nameWords,
  oneLineWords as oneLine,
} from "@vibefield/contracts";

// CP-3 — what VibeField tells a spark about the person's answers, one authority: DESIGN.md §9 "The person's queue's
// words", line for line, without the "VibeField: " the input queue's mark adds (markedText). Each is one marked line of
// facts with no closing stop, so that lines waiting together join with " · " (AgentInputQueues.wake). Every value a
// fact quotes stays on its line: whitespace runs, line breaks among them, are said as one space, a name is cut at 64
// characters and a question at 120, the last of them "…" (critiques 8 and 16). A question or a choice an agent wrote can
// therefore never stage a second "VibeField:" line.

/** A question as a fact quotes it. */
export const FACT_QUESTION_CHARS = 120;

// The session-naming rule and its line helpers live in contracts since SP-1e2's renderer half (SR-Q4 (a)), one rule for
// fieldd and the window; they are re-exported here under the names this room's words have always used.
export {
  clipWords as clip,
  collapseWords as collapse,
  nameWords,
  oneLineWords as oneLine,
  type SessionNaming,
  sessionName,
} from "@vibefield/contracts";

/** fieldd's own words for why an act stopped, on one line. */
export const reasonWords = (s: string): string => oneLine(s, NEEDS_REASON_MAX);

/** A notify's words: one line, cut at NEEDS_NOTICE_CHARS. Empty only for a text that is all whitespace. */
export const noticeWords = (text: string): string => oneLine(text, NEEDS_NOTICE_CHARS);

const n = nameWords;

/** An answer to a question; Not now is said the same way. */
export const answeredFact = (spark: string, question: string, choice: string): string =>
  `you answered ${n(spark)}'s question "${oneLine(question, FACT_QUESTION_CHARS)}": ${oneLine(choice, NEEDS_CHOICE_MAX)}`;

export const sendAllowedFact = (spark: string, to: string): string =>
  `you allowed ${n(spark)}'s words to ${n(to)}; they wait for its next idle moment, and its later words to ${n(to)} are not held`;

export const sendHeldBackFact = (spark: string, to: string): string =>
  `you held back ${n(spark)}'s words to ${n(to)} (Not now); they were not sent`;

export const sendEndedFact = (spark: string, to: string): string =>
  `${n(to)} ended before you answered; ${n(spark)}'s words were not sent`;

/** An Allow whose re-check failed other than by the session ending. */
export const sendFailedFact = (spark: string, to: string, reason: string): string =>
  `${n(spark)}'s words to ${n(to)} were not sent: ${reasonWords(reason)}`;

export const spawnAllowedFact = (spark: string, agent: string, session: string): string =>
  `you allowed ${n(spark)} one more agent: ${n(agent)} started as ${n(session)}`;

export const spawnNotNowFact = (spark: string, max: number): string =>
  `you said Not now to one more agent for ${n(spark)}: limit, ${max} live agents is the most a spark may run`;

export const spawnFailedFact = (spark: string, reason: string): string =>
  `the agent you allowed ${n(spark)} could not start: ${reasonWords(reason)}`;

/** Why an answer waits again (its `waits`, drawn after the card's "Vela hears it when it wakes:"; item 158, CO-Q9 (b)):
 * the spark's session that held its fact ended before it took the line. */
export const sessionEndedWaits = (spark: string): string =>
  `${n(spark)}'s session ended before it took this`;

// An act a restart finds begun and never recorded done is never done again (CP2-D2). The restart may have broken into
// it, or have come after it was done and told, once the disk did not take the record of its end (queue.ts's `#stand`):
// so what the spark hears then is true in both orders, whether or not it heard what the act did before. Either way the
// held send's yes is gone (its record is no allowance), so its later words to that session are held again; a spawn's
// yes was for that one agent.

/** A held send's Allow a restart found begun. */
export const actUncertainFact = (spark: string, to: string): string =>
  `VibeField restarted, and cannot tell whether it finished acting on your answer about ${n(spark)}'s words to ${n(to)} (read the session to see); ${n(spark)}'s later words to ${n(to)} are held again`;

/** A held spawn's Allow one more a restart found begun (critique 15). */
export const spawnUncertainFact = (spark: string): string =>
  `VibeField restarted, and cannot tell whether the agent you allowed ${n(spark)} started; list ${n(spark)}'s agents to see`;

/** The answer's own reason for such an act (`outcome: "failed"`, as an act not recorded done). */
export const UNCERTAIN_REASON = "VibeField restarted, and cannot tell how the act ended";

// CP-4a2b (§13a slice 6's N5; CP4-Q5 (a)) — what a spark that ran a changed flow is told of your answer, in the held
// spawn's voice (DESIGN.md §9, amended 2026-11-06). ‹flow› is the flow's name as its mark says it; ‹run› the run's id.

/** Run this version: the bytes it would run started. */
export const flowRanFact = (spark: string, flow: string, run: string): string =>
  `you ran ${n(flow)} for ${n(spark)} as it is now: it started as ${n(run)}`;

/** Run the one you approved: the approved bytes started. */
export const flowRanApprovedFact = (spark: string, flow: string, run: string): string =>
  `you ran ${n(flow)} as you approved it, for ${n(spark)}: it started as ${n(run)}`;

/** Not now: nothing started; why it asked, as the item's bytes say (a version approved, or none). */
export const flowNotNowFact = (spark: string, flow: string, approved: boolean): string =>
  `you said Not now to ${n(spark)}'s run of ${n(flow)}: ${approved ? "it changed since you approved it" : "you haven't approved it"}, so it did not run`;

/** A start the runs could not make. */
export const flowStartFailedFact = (spark: string, flow: string, reason: string): string =>
  `the run of ${n(flow)} you allowed ${n(spark)} could not start: ${reasonWords(reason)}`;

/** A start a restart found begun (CP2-D2): never made again. */
export const flowStartUncertainFact = (spark: string, flow: string): string =>
  `VibeField restarted, and cannot tell whether the run of ${n(flow)} you allowed ${n(spark)} started; list ${n(spark)}'s flows to see`;
