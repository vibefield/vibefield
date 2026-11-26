import type { AtWorkState, SparkId } from "@vibefield/contracts";
import {
  SPARK_NEEDS_YOU,
  type SparkStatus,
  sparkStatusWord,
} from "@vibefield/design-kit/spark-face";
import { agentLabel } from "../../../frame/peek-model";
import type { AtWorkShown } from "./at-work-model";
import type { AtWorkRow } from "./at-work-rows";
import type { AtWorkBoard } from "./at-work-store";

// THE AT-WORK MARK'S WORDS (item 550, 2026-11-18; DESIGN.md §9 "The desk's at-work words", §8 "At work on the mat",
// §2.10). A GL mark has no name, so who is at work on the desk, on what, and how, is said in words: a visually hidden
// list per board, live (polite) only when a run needs you or failed, and the chip on the line's glass beside a seat
// that needs you or just failed. State is said here and never by colour (DESIGN.md §2.5); the chip's words take no
// state ink unless the switch below gives them theirs. ‹name› is the agent's catalog label, looked up by id and never
// compared (wall R23b), or the agent's id itself for one this build has no row for, as the window names it elsewhere
// (`agentLabel`), never the run's handle; ‹project› the project as Godview names it; ‹object› the object's name as the
// bar says it; ‹spark› a spark's name. A spark's own line and chip say its status as Chat's list holds it, the status
// its star wears (§2.10: one status on every surface, never one mapped from its row); while the list does not hold the
// spark, its line has no word. Never on screen: a run's id or handle, `since`, the state ids or fieldd (§9). PURE.

/** What the words need from outside the rows. */
export interface AtWorkWordSources {
  /** a spark's name as Chat shows it, or null while the sparks are not read */
  readonly sparkName: (spark: SparkId) => string | null;
  /** the object's name as the bar says it, or null for an object the desk does not hold */
  readonly thingOf: (key: string) => string | null;
  /** a spark's status as Chat's list holds it, the one its star wears, or null while the list does not hold it: its
   * line then has no word */
  readonly sparkStatus: (spark: SparkId) => SparkStatus | null;
}

/** Item 550 (2026-11-18): the chip's words in their state inks (DESIGN.md §8, at the chip's line). As built they keep
 * the chrome's ink; this one switch gives them §2.5's attention and danger inks (at-work.css holds both rules). */
export const AT_WORK_CHIP_INKS = false as const;

/** A chip stands at needs you, and for a while at failed. */
export type AtWorkChipState = Extract<AtWorkState, "needs-you" | "failed">;

/** An agent's chip at needs you says the word the desk already says for a run that waits on you (DESIGN.md §9, §8). */
const NEEDS_YOU = "Needs you";

/** Item 550 (2026-11-18): every word the mark says (DESIGN.md §9 "The desk's at-work words"). */
export const AT_WORK_WORDS = {
  /** the hidden list's own name */
  list: "At work on the desk",
  /** an object the desk does not name */
  thing: "an object",
  /** a spark whose name is not read yet */
  spark: "A spark",
  /** an agent's who, in a project */
  inProject: (name: string, project: string) => `${name} in ${project}`,
  /** each shown state's line in the board's names, by who and the object */
  names: {
    open: (who: string, thing: string) => `${who} has ${thing} open`,
    reading: (who: string, thing: string) => `${who} is reading ${thing}`,
    // the feed carries no present-tense words for an act, so one verb serves every object (§9)
    acting: (who: string, thing: string) => `${who} is changing ${thing}`,
    "needs-you": (who: string, thing: string) => `${who} needs you on ${thing}`,
    paused: (who: string, thing: string) => `${who} is paused: you have ${thing}`,
    failed: (who: string, thing: string) => `${who}: an act on ${thing} failed`,
  } satisfies Readonly<Record<AtWorkShown, (who: string, thing: string) => string>>,
  /** a crew run's line ends with the spark it works for */
  forSpark: (line: string, spark: string) => `${line} for ${spark}`,
  /** a spark's own line, and its status's word after it */
  sparkOn: (spark: string, thing: string) => `${spark} on ${thing}`,
  sparkSays: (line: string, word: string) => `${line}: ${word}`,
  /** the chip's role on a spark's own chip, and on a crew run's */
  sparkRole: "spark",
  crew: (spark: string) => `${spark}'s crew`,
  /** a chip's last word for an agent's run: the desk's own words for those states, Needs you as §8 says it of a run
   * that waits on you and Failed as a spark's status says it (§9), so an agent's chip and a spark's speak one
   * vocabulary */
  chip: {
    "needs-you": NEEDS_YOU,
    failed: sparkStatusWord("failed"),
  } satisfies Readonly<Record<AtWorkChipState, string>>,
  /** between a chip's parts */
  between: " · ",
  /** the paper seat that counts the rest: a count, never a word */
  count: (n: number) => `+${n}`,
} as const;

/** Whether an agent's run is said aloud as it happens: at needs you and failed only (DESIGN.md §8, the names). PURE. */
export const isAtWorkUrgent = (state: AtWorkState): boolean =>
  state === "needs-you" || state === "failed";

/** Whether a spark's own line is said aloud: while its status, as Chat's list holds it, is one of S-4's four that need
 * you, or Failed, for as long as it is (DESIGN.md §2.10, §8). Its chip is the model's, and stands at the four, and at
 * Failed only for 2.4 s from the turn. PURE. */
export const isAtWorkSparkUrgent = (status: SparkStatus | null): boolean =>
  status !== null && (SPARK_NEEDS_YOU.has(status) || status === "failed");

/** An agent's name: its catalog label, looked up by its id, or the id itself for one this build has no row for, as the
 * window names it elsewhere (`agentLabel`) — never its run's handle (DESIGN.md §9). PURE. */
export function atWorkAgentName(agent: string): string {
  return agentLabel(agent) ?? agent;
}

/** One name in the hidden list. */
export interface AtWorkName {
  /** the run and the object's key: the list's key */
  readonly run: string;
  readonly key: string;
  readonly text: string;
  /** said aloud as it happens (an agent at needs you or failed, a spark while its status, as Chat's list holds it, is
   * one of S-4's four or Failed) */
  readonly urgent: boolean;
}

/** One row's line in the board's names ("Claude Code in vibe-field is reading Q3 plan", "… for Vela" on a crew run,
 * "Vela on Q3 plan: Asking you" for a spark's own, its word Chat's), or null for a row that is leaving (released). The
 * person's own hand reaches the names as fieldd's paused, a feed window later. PURE but for `sources`. */
export function atWorkSentence(
  row: AtWorkRow,
  key: string,
  sources: AtWorkWordSources,
): AtWorkName | null {
  const state = row.state;
  if (state === "released") return null;
  const W = AT_WORK_WORDS;
  const thing = sources.thingOf(key) ?? W.thing;
  if (row.spark !== undefined) {
    const line = W.sparkOn(sources.sparkName(row.spark) ?? W.spark, thing);
    const status = sources.sparkStatus(row.spark);
    const text = status === null ? line : W.sparkSays(line, sparkStatusWord(status));
    return { run: row.run, key, text, urgent: isAtWorkSparkUrgent(status) };
  }
  const name = atWorkAgentName(row.agent);
  const project = row.project?.name;
  const said = W.names[state](project === undefined ? name : W.inProject(name, project), thing);
  const crew = row.startedBy === undefined ? null : sources.sparkName(row.startedBy);
  return {
    run: row.run,
    key,
    text: crew === null ? said : W.forSpark(said, crew),
    urgent: isAtWorkUrgent(state),
  };
}

/** Every name on a board, in the feed's order (a leaving row says none). PURE but for `sources`. */
export function atWorkNamesOf(board: AtWorkBoard, sources: AtWorkWordSources): AtWorkName[] {
  const out: AtWorkName[] = [];
  for (const object of board.objects.values()) {
    for (const row of object.agents) {
      const name = atWorkSentence(row, object.key, sources);
      if (name !== null) out.push(name);
    }
  }
  return out;
}

/** A chip's parts on the line's glass, in its order: the mark, the name, the project with its folder mark, the role,
 * the word (DESIGN.md §9: "‹name› · ‹project› · Needs you", a crew run's "· ‹spark›'s crew" before the word, a spark's
 * "‹spark› · spark · ‹its status's word›"). */
export interface AtWorkChipParts {
  /** whose mark leads: an agent's catalog mark (looked up by its id), or a spark's own face */
  readonly mark: { readonly agent: string } | { readonly spark: SparkId };
  /** the status a spark's face wears on its chip, the one its star wears (Chat's); null on an agent's chip, or while
   * Chat's list does not hold the spark */
  readonly face: SparkStatus | null;
  readonly name: string;
  /** the agent's project, named, with Godview's deal for its folder mark's colour (null: not dealt yet) */
  readonly project: { readonly name: string; readonly seq: number | null } | null;
  /** "spark" on a spark's own chip, "‹spark›'s crew" on a crew run's */
  readonly role: string | null;
  readonly word: string;
  /** the state the word says: the key of its ink, when the switch gives it one */
  readonly state: AtWorkChipState;
}

/** A spark's chip's word: Failed for the 2.4 s its chip stands from the turn, else its status's word while that is one
 * of the four that need you (DESIGN.md §9); null for none — a spark never says an agent's "Needs you". PURE. */
function sparkChipWord(state: AtWorkChipState, status: SparkStatus | null): string | null {
  if (state === "failed") return AT_WORK_WORDS.chip.failed;
  return status !== null && SPARK_NEEDS_YOU.has(status) ? sparkStatusWord(status) : null;
}

/** One run's chip at `state`, the model's word for why it stands; null for a spark's at needs you whose status, as
 * Chat's list holds it, is no longer one of the four (read between Chat's publish and the layer's next step, which
 * takes that chip down). PURE but for `sources`. */
export function atWorkChipOf(
  row: AtWorkRow,
  state: AtWorkChipState,
  sources: AtWorkWordSources,
): AtWorkChipParts | null {
  const W = AT_WORK_WORDS;
  if (row.spark !== undefined) {
    const status = sources.sparkStatus(row.spark);
    const word = sparkChipWord(state, status);
    if (word === null) return null;
    return {
      mark: { spark: row.spark },
      face: status,
      name: sources.sparkName(row.spark) ?? W.spark,
      project: null,
      role: W.sparkRole,
      word,
      state,
    };
  }
  const project = row.project?.name;
  const crew = row.startedBy === undefined ? null : sources.sparkName(row.startedBy);
  return {
    mark: { agent: row.agent },
    face: null,
    name: atWorkAgentName(row.agent),
    project: project === undefined ? null : { name: project, seq: row.project?.seq ?? null },
    role: crew === null ? null : W.crew(crew),
    word: W.chip[state],
    state,
  };
}

/** A chip's words as one line, its parts joined as the chip shows them. PURE. */
export function atWorkChipText(chip: AtWorkChipParts): string {
  return [chip.name, chip.project?.name ?? null, chip.role, chip.word]
    .filter((part): part is string => part !== null)
    .join(AT_WORK_WORDS.between);
}
