import {
  AGENT_CATALOG,
  type NeedsAnswer,
  type NeedsItem,
  needsKindOf,
  needsOutcomeOf,
  type SparkId,
} from "@vibefield/contracts";
import { sparkStatusWord } from "@vibefield/design-kit/spark-face";
import { NO_HANDLES } from "./at-rows";
import { isOwnAsk, type SparkEntry, statusOfItem } from "./spark-status";

// THE NEEDS-YOU CARD, AS DATA (CP-3; DESIGN.md §8 "Chat's thread", the needs-you card; §9 "The person's queue's
// words", "Chat's words"; CP3-D1, CP3-D4, CP3-D8). The thread item CP-3 adds to SP-1d's seam (`thread-items.ts`): the
// queue's item for the shown spark, what it says, and what it is doing — waiting on you, its answer running, refused
// in fieldd's words, or answered here. Pure: an item and the thread's spark in, the card's words out. `NeedsCardView`
// draws it; `useNeedsCard` (`needs-card-stand.ts`) keeps it standing in the thread. Every act travels by its place
// among the item's acts, never by its word (§9), so a rewording here is no wire change. It names a session as @ names
// it in the thread (track CO, the handle): by @'s handle where @ offers one (`sessionHandlesOf`, handed in by Chat's
// controller), else as fieldd names a run.

/** How long what an answer came to stands on the card, and a refusal of an item no longer waiting: a note's time. */
export const NEEDS_SAID_MS = 2_400;
/** Its way out: 180ms on plain ease, 4 down to 0, inert while it goes. */
export const NEEDS_LEAVE_MS = 180;
/** With reduced motion each way is a fade in place (M6). */
export const NEEDS_FADE_MS = 120;

/** What the card is doing: waiting on you, its answer running (the act pressed, by its place), refused in fieldd's
 * words, or answered here (the act pressed, and the answer fieldd recorded). Refused, it is answered again while its
 * item still waits (`NeedsCard.waits`); once that item has left the queue, its acts go quiet for the note's time it
 * stands. */
export type NeedsAct =
  | { readonly state: "idle" }
  | { readonly state: "busy"; readonly choice: number }
  | { readonly state: "refused"; readonly reason: string }
  | { readonly state: "said"; readonly choice: number };

export const NEEDS_IDLE: NeedsAct = Object.freeze({ state: "idle" });

/** How the card names who asks and whom a send is for: @'s handle for a session @ offers in this thread, else as
 * fieldd names it. A spark is always its name. */
export interface NeedsNames {
  readonly from: string;
  /** a held send's session; null where the item names none */
  readonly to: string | null;
}

/** The names `item` is said by, under @'s `handles` in its thread (by run id; none: fieldd's names alone). */
export function needsNamesOf(item: NeedsItem, handles: ReadonlyMap<string, string>): NeedsNames {
  const run = item.from.spark === undefined ? item.from.session : undefined;
  return {
    from: (run === undefined ? undefined : handles.get(run)) ?? item.from.name,
    to: item.to === undefined ? null : (handles.get(item.to.session) ?? item.to.name),
  };
}

/** The card, as one of the thread's items. */
export interface NeedsCard {
  readonly kind: "needs";
  /** the queue's item it draws (answered here: the item fieldd handed back, with its answer) */
  readonly item: NeedsItem;
  /** who asks and whom a send is for, as the card says them */
  readonly names: NeedsNames;
  /** the thread's spark */
  readonly spark: { readonly id: SparkId; readonly name: string };
  /** TH-1 — its own run's ask (TH-Q29 (a)): the spark asks, so the card names it by its name and its eyebrow is the
   * word alone */
  readonly own: boolean;
  /** how many wait on you in the thread, this one with them: "1 of 3" when more than one */
  readonly of: number;
  /** its item still waits in the queue; one that has left (answered in another window, or ended) answers nothing
   * more, so a refused card's acts go quiet for the note's time it stands */
  readonly waits: boolean;
  readonly act: NeedsAct;
  /** on its way out, inert for its 180ms */
  readonly leaving: boolean;
  /** the person asked for reduced motion: it fades in and out where it stands */
  readonly reduced: boolean;
}

/** How the card moves: leaving, and with reduced motion. */
export interface NeedsMotion {
  readonly leaving?: boolean | undefined;
  readonly reduced?: boolean | undefined;
}

/** How the card moves, and @'s handles in its thread (`sessionHandlesOf`, by run id), which name its sessions. */
export interface NeedsCardOptions extends NeedsMotion {
  readonly handles?: ReadonlyMap<string, string> | undefined;
}

/** The card for `item` in `entry`'s thread: its first item waiting, or the one this window answers, which counts
 * itself among what waits though fieldd has dropped it from the queue meanwhile. */
export function needsCardOf(
  entry: SparkEntry,
  item: NeedsItem,
  act: NeedsAct = NEEDS_IDLE,
  { leaving = false, reduced = false, handles = NO_HANDLES }: NeedsCardOptions = {},
): NeedsCard {
  const waits = entry.items.some((each) => each.id === item.id);
  const own = isOwnAsk(entry, item);
  return {
    kind: "needs",
    item,
    // its own run asks as the spark, never by its run's title
    names: own ? { from: entry.spark.name, to: null } : needsNamesOf(item, handles),
    spark: { id: entry.spark.id, name: entry.spark.name },
    own,
    of: entry.items.length + (waits ? 0 : 1),
    waits,
    act,
    leaving,
    reduced,
  };
}

/** The card a thread stands while this window answers none of its items: what holds its own run first, its own run's
 * ask, then the oldest waiting (CO-Q12 (b), James); or none. */
export function waitingCardOf(entry: SparkEntry, options: NeedsCardOptions = {}): NeedsCard | null {
  const first = entry.items.find((item) => isOwnAsk(entry, item)) ?? entry.items[0];
  return first === undefined ? null : needsCardOf(entry, first, NEEDS_IDLE, options);
}

/** One of the card's acts: its place among the item's acts, its word, and whether it is the first (primary). */
export interface NeedsCardAct {
  readonly choice: number;
  readonly word: string;
  readonly primary: boolean;
}

/** What the card says, row by row (§8: the eyebrow, the question, the words, the sub, the acts). */
export interface NeedsCardWords {
  /** the word Chat's row says for the item, then " · " and the asker when it is not the thread's spark */
  readonly eyebrow: string;
  /** what you are asked */
  readonly question: string;
  /** a held send's first held words, a held spawn's first task, an unknown kind's words: as fieldd hands them, so
   * words it cut end in its own "…" (`NeedsItem.cut`) and the card adds none */
  readonly words: string | null;
  /** how many more held words wait behind them ("and 2 more") */
  readonly more: string | null;
  readonly sub: string | null;
  /** the item's acts, by their place; none where it has nothing to answer here */
  readonly acts: readonly NeedsCardAct[];
  /** Show, alone: an agent's own ask, answered in its pane (or a kind with no acts that names its session) */
  readonly show: boolean;
  /** its place among what waits, when more than one does: "1 of 3" */
  readonly place: string | null;
  /** what it asks, as it is announced on arriving: the eyebrow (its asker after a comma), then the question */
  readonly asked: string;
  /** its accessible name: what it asks, then its place when more wait */
  readonly label: string;
}

/** The catalog's label for a held spawn's agent (a lookup, never a compare to a literal: R23b), else its id. */
function agentLabelOf(agent: string): string {
  return AGENT_CATALOG.find((entry) => entry.id === agent)?.label ?? agent;
}

/** What you are asked, by the item's kind. */
function questionOf(item: NeedsItem, { from: asker, to }: NeedsNames): string {
  switch (needsKindOf(item)) {
    case "question":
      return item.words ?? `${asker} needs you`;
    case "held-send":
      return to === null ? `${asker} needs you` : `${asker} wants to send to ${to}`;
    case "held-spawn": {
      if (item.agent === undefined) return `${asker} wants another agent`;
      const where = item.folder === undefined ? "" : ` in ${item.folder}`;
      return `${asker} wants another agent: ${agentLabelOf(item.agent)}${where}`;
    }
    case "agent-ask":
      if (item.ask === "permission")
        return item.tool === undefined
          ? `${asker} asks for your OK`
          : `${asker} asks to run ${item.tool}`;
      if (item.ask === "question") return `${asker} has a question`;
      return `${asker} needs you`;
    default:
      return `${asker} needs you`;
  }
}

/** The sub, by the item's kind: how long a yes lasts, the cap, or where an agent's ask is answered. */
function subOf(item: NeedsItem, { from: asker, to }: NeedsNames): string | null {
  switch (needsKindOf(item)) {
    case "held-send":
      return to === null ? null : `Your yes lasts until ${to} ends.`;
    case "held-spawn":
      return item.live === undefined
        ? null
        : `${item.live} of ${asker}'s agents are running, the most a spark may run.`;
    case "agent-ask":
      return "Answer it in its pane.";
    default:
      return null;
  }
}

export function needsCardWords(card: NeedsCard): NeedsCardWords {
  const { item, spark, names } = card;
  const asker = names.from;
  const word = sparkStatusWord(statusOfItem(item));
  // its own run's ask is the spark's: the word alone (TH-Q29 (a))
  const other = !card.own && item.from.spark !== spark.id;
  const question = questionOf(item, names);
  const kind = needsKindOf(item);
  // the asker's own words, for the kinds whose question is not them
  const shown = kind === "question" || kind === "agent-ask" ? undefined : item.words;
  const more = kind === "held-send" && (item.count ?? 1) > 1 ? (item.count ?? 1) - 1 : 0;
  // an agent's own ask is answered in its pane, never here (CP-L4, AR-6): Show alone, whatever it carries
  const choices = kind === "agent-ask" ? [] : (item.choices ?? []);
  const acts = choices.map(
    (choice, index): NeedsCardAct => ({ choice: index, word: choice, primary: index === 0 }),
  );
  const place = card.of > 1 ? `1 of ${card.of}` : null;
  const asked = `${other ? `${word}, ${asker}` : word}: ${question}`;
  return {
    eyebrow: other ? `${word} · ${asker}` : word,
    question,
    words: shown ?? null,
    more: more > 0 ? `and ${more} more` : null,
    sub: subOf(item, names),
    acts,
    show: acts.length === 0 && item.from.session !== undefined,
    place,
    asked,
    label: place === null ? asked : `${asked}, ${place}`,
  };
}

/** What an answer given here came to: done, an act fieldd could not do, or one its spark has not heard yet. */
export type NeedsSaidTone = "done" | "failed" | "unheard";

export interface NeedsSaid {
  readonly text: string;
  readonly tone: NeedsSaidTone;
}

/** The line an answered card gives its acts to, and the status line's words for it off screen: "You said Allow", then
 * what the act came to where it did not go as asked, in fieldd's words. When both hold, the act's failure is said. It
 * names as the card does (`names`: the card's own; none handed, as fieldd names them). */
export function needsSaid(
  item: NeedsItem,
  choice: number,
  names: NeedsNames = needsNamesOf(item, NO_HANDLES),
): NeedsSaid {
  const answer: NeedsAnswer | undefined = item.answer;
  const said = `You said ${item.choices?.[answer?.choice ?? choice] ?? ""}`.trimEnd();
  const why = (reason: string | undefined): string => (reason === undefined ? "" : `: ${reason}`);
  if (needsOutcomeOf(answer) === "failed") {
    const kind = needsKindOf(item);
    const failed =
      kind === "held-send" && names.to !== null
        ? `Couldn't send ${names.from}'s words to ${names.to}`
        : kind === "held-spawn"
          ? "Couldn't start the agent"
          : "Couldn't finish it";
    return { text: `${said} · ${failed}${why(answer?.reason)}`, tone: "failed" };
  }
  if (answer?.told === false) {
    return {
      text: `${said} · ${names.from} hears it when it wakes${why(answer.waits)}`,
      tone: "unheard",
    };
  }
  return { text: said, tone: "done" };
}

/** A refused answer, said under the card's words: fieldd's words after the colon. */
export function needsRefused(reason: string): string {
  return `Couldn't answer: ${reason}`;
}
