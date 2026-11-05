import type { AgentFieldRow, CrewId } from "@vibefield/contracts";
import type { CrewsReading } from "./crews-port";
import type { BoardRows } from "./sparks-feed";

// CHAT'S CREW CARD, AS DATA (SP-1e2's renderer half; DESIGN.md §8 "Chat's crew card", §9 its words). Pure: the crews
// fieldd keeps for the shown spark (`compose.sparks.crews.subscribe`, as the window read it), the board's rows, @'s
// handles in this thread and whether the spark sleeps, in; each crew's card, by the crew's id, out. A card hangs under
// its crew's act line in the flow (`transcriptItemsOf`, `ThreadFlowView`); a crew the reading does not name draws no
// card, so its line stands alone (SPE-Q28 (b): it left the record; SR-Q3: its frame has not come yet).
// (red: a skeleton — `crewCardsOf` reads nothing)

/** A member's state on its row, in DESIGN.md's order. */
export type CrewRowState = "starting" | "working" | "needs" | "done" | "ended";

/** One member's row. */
export interface CrewCardRow {
  readonly runtimeRunId: string;
  /** the agent catalog's opaque id: the row's mark (R23) */
  readonly agent: string;
  /** @'s handle while @ offers it; the record's name once it ended; else as VibeField names a session */
  readonly name: string;
  /** its model's label and effort, "Opus 5.5 · high"; null until its row names a model */
  readonly model: string | null;
  /** its state; null while the board cannot be read (the rows keep their names and lose their states) */
  readonly state: CrewRowState | null;
  /** it takes a press: every row but an Ended one */
  readonly pressable: boolean;
  /** its accessible name, "vibe-field·2, Opus 5.5, high, Working" */
  readonly label: string;
}

/** The head's count: "2 of 4 done" and the ring, "All done" with its check, "All ended" alone, or the bound. */
export interface CrewCount {
  readonly words: string;
  /** the ring's fill, the members no longer at work over all; null: no ring */
  readonly ring: number | null;
  /** "All done" wears `check` */
  readonly check: boolean;
}

/** A crew's card. */
export interface CrewCard {
  readonly id: CrewId;
  /** "4 agents", "1 agent", or "Agents" when nothing of its members can be read */
  readonly title: string;
  /** " · Opus 5.5 · high", " · Grok 4", or "" when the members differ or a model is not named yet */
  readonly dim: string;
  readonly count: CrewCount;
  readonly rows: readonly CrewCardRow[];
  /** the foot's one line, the first that holds; null when none does */
  readonly line: string | null;
  /** the group's name, "4 agents · Opus 5.5 · high, 2 of 4 done" */
  readonly label: string;
}

/** DESIGN.md §9 "Chat's words", the crew card's. */
export const CREW_WORDS = {
  agents: (count: number) => `${count} ${count === 1 ? "agent" : "agents"}`,
  unnamed: "Agents",
  done: (done: number, total: number) => `${done} of ${total} done`,
  doneEnded: (done: number, total: number, ended: number) =>
    `${done} of ${total} done · ${ended} ended`,
  allDone: "All done",
  allEnded: "All ended",
  running: (count: number) => `${count} still running`,
  crewsUnreadable: (name: string) => `VibeField can't read ${name}'s crews right now`,
  asleep: (name: string) => `${name} is asleep — it hears these when it wakes`,
  openGodview: "Open in Godview",
} as const;

/** Each state's word, as its row says it. */
export const CREW_STATE_WORDS: Readonly<Record<CrewRowState, string>> = Object.freeze({
  starting: "Starting",
  working: "Working",
  needs: "Needs you",
  done: "Done",
  ended: "Ended",
});

export interface CrewCardInputs {
  /** the crews the flow's act lines name, in their order */
  readonly crews: readonly CrewId[];
  /** the window's reading of the spark's crews */
  readonly reading: CrewsReading;
  /** the board's rows, as Chat's feed holds them */
  readonly rows: BoardRows;
  /** @'s handles in this thread, by run id (`sessionHandlesOf`) */
  readonly handles: ReadonlyMap<string, string>;
  /** the spark's name, as the foot's lines say it */
  readonly name: string;
  /** the spark sleeps (its entry is not awake) */
  readonly asleep: boolean;
}

/** Each named crew's card, by its id. (red: a skeleton) */
export function crewCardsOf(_inputs: CrewCardInputs): ReadonlyMap<CrewId, CrewCard> {
  return new Map();
}

/** A board row's model and effort, as the record keeps a member's (crews.ts's `crewFactsOf`, the window's side). */
export function rowFactsOf(row: AgentFieldRow): {
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
} {
  const model = row.model?.displayName ?? row.model?.id;
  const effort = row.effort?.value;
  return {
    ...(model !== undefined && model !== "" ? { model } : {}),
    ...(effort !== undefined && effort !== "" ? { effort } : {}),
  };
}
