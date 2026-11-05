import {
  type AgentFieldRow,
  type CrewId,
  catalogEntry,
  crewSharedModelOf,
  type SparkCrewMember,
  sessionName,
} from "@vibefield/contracts";
import { AT_WORDS } from "./at-rows";
import type { CrewsReading } from "./crews-port";
import type { BoardRows } from "./sparks-feed";
import type { Flow } from "./transcript-items";

// CHAT'S CREW CARD, AS DATA (SP-1e2's renderer half; DESIGN.md §8 "Chat's crew card", §9 its words). Pure: the crews
// fieldd keeps for the shown spark (`compose.sparks.crews.subscribe`, as the window read it), the board's rows, @'s
// handles in this thread and whether the spark sleeps, in; each crew's card, by the crew's id, out. A card hangs under
// its crew's act line in the flow (`transcriptItemsOf`, `ThreadFlowView`); a crew the reading does not name draws no
// card, so its line stands alone (SPE-Q28 (b): it left the record; SR-Q3: its frame has not come yet). While the crews
// cannot be read the card stands on the board's rows alone, its live members found by their crew; while the board
// cannot be read the rows keep their names and lose their states. Never a blank.

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
  /** the runs this window has seen on the board: a member the board, read, no longer holds is Ended, one it has not
   * held yet is Starting (absent: none seen) */
  readonly seen?: ReadonlySet<string> | undefined;
}

/** The crews the flow's act lines name, in their order: the cards it hangs (Chat's controller and the catalog's). */
export function crewsOfFlow(flow: Flow): CrewId[] {
  return flow.state === "ready"
    ? flow.items.flatMap((item) =>
        item.kind === "act" && item.crew !== undefined ? [item.crew] : [],
      )
    : [];
}

/** One member as the card reads it: the record's, the board's, or both. */
interface Member {
  readonly runtimeRunId: string;
  readonly record: SparkCrewMember | undefined;
  readonly row: AgentFieldRow | undefined;
}

/** Each named crew's card, by its id, in the flow's order. Nothing while the crews are first read. */
export function crewCardsOf(inputs: CrewCardInputs): ReadonlyMap<CrewId, CrewCard> {
  const { reading, rows } = inputs;
  const cards = new Map<CrewId, CrewCard>();
  if (reading.state === "reading") return cards;
  const board = Array.isArray(rows) ? rows : null;
  for (const id of inputs.crews) {
    if (cards.has(id)) continue;
    const ofCrew = board?.filter((row) => row.origin?.crew === id) ?? [];
    let members: Member[];
    if (reading.state === "ready") {
      const crew = reading.frame.crews.find((kept) => kept.id === id);
      if (crew === undefined) continue;
      const listed = new Set(crew.members.map((member) => member.runtimeRunId));
      members = [
        ...crew.members.map((record) => ({
          runtimeRunId: record.runtimeRunId,
          record,
          row: board?.find((row) => row.runtimeRunId === record.runtimeRunId),
        })),
        ...ofCrew
          .filter((row) => !listed.has(row.runtimeRunId))
          .map((row) => ({ runtimeRunId: row.runtimeRunId, record: undefined, row })),
      ];
    } else {
      // the board's rows alone: its live members, by their crew
      members = ofCrew
        .filter((row) => row.alive)
        .map((row) => ({ runtimeRunId: row.runtimeRunId, record: undefined, row }));
    }
    cards.set(id, cardOf(id, members, inputs, board));
  }
  return cards;
}

function cardOf(
  id: CrewId,
  members: readonly Member[],
  inputs: CrewCardInputs,
  board: readonly AgentFieldRow[] | null,
): CrewCard {
  const ready = inputs.reading.state === "ready";
  const waiting = new Map(
    inputs.reading.state === "ready"
      ? (inputs.reading.frame.waiting ?? []).map((w) => [w.runtimeRunId, w.tasks])
      : [],
  );
  const facts = members.map(factsOf);
  const rows = members.map((member, index) =>
    rowOf(member, facts[index] ?? {}, stateOf(member, board, waiting, inputs.seen), inputs),
  );
  const shared = rows.length === 0 ? null : crewSharedModelOf(facts);
  const title = rows.length === 0 ? CREW_WORDS.unnamed : CREW_WORDS.agents(rows.length);
  const dim =
    shared === null
      ? ""
      : shared.effort === undefined
        ? ` · ${shared.model}`
        : ` · ${shared.model} · ${shared.effort}`;
  const count = countOf(rows, ready, board !== null);
  const line =
    inputs.reading.state === "unreadable"
      ? CREW_WORDS.crewsUnreadable(inputs.name)
      : inputs.rows === "failed"
        ? AT_WORDS.sessionsFailed
        : inputs.asleep && rows.some((row) => row.state !== "ended")
          ? CREW_WORDS.asleep(inputs.name)
          : null;
  const head = `${title}${dim}`;
  return {
    id,
    title,
    dim,
    count,
    rows,
    line,
    label: count.words === "" ? head : `${head}, ${count.words}`,
  };
}

/** A member's model and effort: its board row's, else as the record kept them. */
function factsOf(member: Member): { readonly model?: string; readonly effort?: string } {
  if (member.row !== undefined) {
    const named = rowFactsOf(member.row);
    if (named.model !== undefined) return named;
  }
  const model = member.record?.model;
  const effort = member.record?.effort;
  return {
    ...(model !== undefined ? { model } : {}),
    ...(model !== undefined && effort !== undefined ? { effort } : {}),
  };
}

/** A member's state, in DESIGN.md's order: Ended by the record or the board; Starting until its first turn; Needs
 * you while it waits on you; Working, or idle with a task waiting (SPE-Q32 (a)); Done. Null while the board is not
 * read, or for a run not heard yet. */
function stateOf(
  member: Member,
  board: readonly AgentFieldRow[] | null,
  waiting: ReadonlyMap<string, number>,
  seen: ReadonlySet<string> | undefined,
): CrewRowState | null {
  if (member.record?.endedAt !== undefined) return "ended";
  if (board === null) return null;
  const row = member.row;
  if (row === undefined) return seen?.has(member.runtimeRunId) === true ? "ended" : "starting";
  if (!row.alive) return "ended";
  if (row.turnedAt === null) return "starting";
  if (row.status === "blocked" || row.blockers.length > 0) return "needs";
  if (row.status === "working") return "working";
  if (row.status === "idle") return (waiting.get(row.runtimeRunId) ?? 0) > 0 ? "working" : "done";
  return null;
}

function rowOf(
  member: Member,
  facts: { readonly model?: string; readonly effort?: string },
  state: CrewRowState | null,
  inputs: CrewCardInputs,
): CrewCardRow {
  const agent = member.record?.agent ?? member.row?.kind ?? "";
  const named = sessionName({
    label: member.row?.label ?? catalogEntry(agent)?.label,
    folder: member.record?.folder ?? member.row?.project?.name,
    id: member.runtimeRunId,
  });
  const name =
    state === "ended"
      ? (member.record?.name ?? named)
      : (inputs.handles.get(member.runtimeRunId) ?? named);
  const model =
    facts.model === undefined
      ? null
      : facts.effort === undefined
        ? facts.model
        : `${facts.model} · ${facts.effort}`;
  const label = [
    name,
    facts.model,
    facts.effort,
    state === null ? undefined : CREW_STATE_WORDS[state],
  ]
    .filter((part) => part !== undefined)
    .join(", ");
  return {
    runtimeRunId: member.runtimeRunId,
    agent,
    name,
    model,
    state,
    pressable: state !== "ended",
    label,
  };
}

/** The head's count (SPE-Q31 (a)): the members done, those ended, "All done", "All ended"; the bound while the
 * crews cannot be read; nothing while the board cannot (the line says why). */
function countOf(rows: readonly CrewCardRow[], ready: boolean, boardRead: boolean): CrewCount {
  if (!ready)
    return rows.length === 0
      ? { words: "", ring: null, check: false }
      : { words: CREW_WORDS.running(rows.length), ring: null, check: false };
  const ended = rows.filter((row) => row.state === "ended").length;
  if (rows.length > 0 && ended === rows.length)
    return { words: CREW_WORDS.allEnded, ring: null, check: false };
  if (!boardRead || rows.length === 0) return { words: "", ring: null, check: false };
  const done = rows.filter((row) => row.state === "done").length;
  if (done > 0 && done + ended === rows.length)
    return { words: CREW_WORDS.allDone, ring: null, check: true };
  return {
    words:
      ended > 0
        ? CREW_WORDS.doneEnded(done, rows.length, ended)
        : CREW_WORDS.done(done, rows.length),
    ring: (done + ended) / rows.length,
    check: false,
  };
}

/** A board row's model and effort, as the record keeps a member's (crews.ts's `crewFactsOf`, the window's side). */
export function rowFactsOf(row: AgentFieldRow): {
  readonly model?: string;
  readonly effort?: string;
} {
  const model = row.model?.displayName ?? row.model?.id;
  const effort = row.effort?.value;
  return {
    ...(model !== undefined && model !== "" ? { model } : {}),
    ...(effort !== undefined && effort !== "" ? { effort } : {}),
  };
}
