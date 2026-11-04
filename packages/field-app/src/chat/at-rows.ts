import {
  type AgentFieldRow,
  type AgentProfileSet,
  type AgentProfileSetId,
  catalogEntry,
  personaSetsOf,
  profileSetOfRun,
  type SparkSummary,
} from "@vibefield/contracts";
import { CANNOT_LIST_AGENTS } from "./new-spark";
import type { BoardRows } from "./sparks-feed";

// @'S ROWS IN CHAT (SP-1d; DESIGN.md §8 "Chat's composer", @'s rows in Chat; CH-D5 A "Agents to start, and sessions
// running"; EW-D4: @ offers only its scope). PURE: the spark, what fieldd answers of its profiles, and the field
// board's rows in; the two groups out, read bottom-up, nearest first. Each lists only what the spark's tools reach:
//
//   - "Start an agent": the list its `agents_available` tool answers (TL-D2; fieldd's compose room) — each agent
//     signed in under one of the spark's profiles, a row per agent and profile, said by the catalog's label as that
//     tool says it (the raw id only for an agent the catalog has no row for);
//   - "Running in its profiles": the sessions its `agent_send` takes (CP-2; fieldd's talk room, `reach` + `his` /
//     `startedBy` + `live`), by that whole rule.
//
// A session is placed as the talk room places it, by the one rule (`profileSetOfRun`, TU-1) over the row's two filing
// keys and the profiles' persona map: the profile its run is filed under (`profileSet`); else This Mac's for a run
// that names no persona; else the profile listing its persona (`profileId`); else none, and @ never offers it.
//
// Without its profiles no row can be placed: the agents are the profiles' own, and a persona's session with no profile
// filed is placed by the profile listing it. So a failed read of them offers none and says the New spark sheet's
// sentence. Without the board no session can be placed, but the agents can: they are the profiles' alone, so a failed
// board leaves them standing, and the sessions' group says in its rows' place that what is running can't be read.
//
// The keyboard's walk over the rows (`atStops`, `atDefaultHot`, `atMove`, `atRow`) came back from the line's model in
// git (`0e2ad08bc:packages/field-app/src/frame/`), its rows re-ruled.

/** A session's one word for what it is doing. */
export type SessionWord = "Working" | "Idle" | "Needs you";

/** An agent the spark can start, under one of its profiles. */
export interface AtAgentRow {
  readonly kind: "agent";
  readonly id: string;
  /** the catalog's id, opaque (AR-L1) — its mark, never compared */
  readonly agent: string;
  /** the catalog's label, as `agents_available` says it */
  readonly label: string;
  /** the profile whose sign-in it starts under */
  readonly profile: { readonly id: string; readonly name: string };
  /** the profile's name, said as the row's pill, when the spark has more than one */
  readonly pill: string | null;
}

/** A session running in the spark's profiles that its `agent_send` takes. */
export interface AtSessionRow {
  readonly kind: "session";
  readonly id: string;
  /** its run's id, the one the spark's tools take — pasted for them, never drawn in Chat's chrome (§9) */
  readonly session: string;
  readonly agent: string;
  readonly label: string;
  /** its folder's name (the board's project), else its agent's label, with @'s ordinal where two share it
   * ("vibe-field·2") */
  readonly handle: string;
  /** its project's name, the ordinal left off; null for a run that names none */
  readonly project: string | null;
  readonly word: SessionWord | null;
}

export type AtRow = AtAgentRow | AtSessionRow;

/** @'s list, as drawn top to bottom: the agents, then the sessions, the nearest last, against the composer. */
export interface AtList {
  readonly agents: readonly AtAgentRow[];
  readonly sessions: readonly AtSessionRow[];
  /** what it offers is still being read */
  readonly reading: boolean;
  /** what is running can't be read (the board refused): the sessions' group says so in its rows' place */
  readonly sessionsFailed: boolean;
  /** the list's word when it holds no row: nothing matches what follows the @, nothing to offer at all, or its
   * profiles can't be read */
  readonly quiet: string | null;
}

export interface AtSources {
  readonly spark: SparkSummary;
  /** what follows the @ */
  readonly query: string;
  /** `agents.profileSets.list`'s answer: null until it is read, "failed" when it could not be */
  readonly sets: readonly AgentProfileSet[] | "failed" | null;
  /** the field board's rows as the window reads them: null until the board is read, "failed" while it can't be */
  readonly rows: BoardRows;
}

/** @'s words (DESIGN.md §9 "Chat's words"). */
export const AT_WORDS = {
  agents: "Start an agent",
  sessions: "Running in its profiles",
  reading: "Reading its agents…",
  none: (query: string) => `Nothing called "${query}"`,
  empty: (name: string) => `Nothing to add from ${name}'s profiles`,
  /** the New spark sheet's own sentence, never a copy */
  failed: CANNOT_LIST_AGENTS,
  /** the sessions' group, in its rows' place, while the board can't be read */
  sessionsFailed: "VibeField can't read what's running right now",
} as const;

/** A session's word: Working, Idle, or Needs you (its run blocked on the person); none for a run not heard yet. */
export function sessionWord(row: AgentFieldRow): SessionWord | null {
  if (row.status === "blocked" || row.blockers.length > 0) return "Needs you";
  if (row.status === "working") return "Working";
  if (row.status === "idle") return "Idle";
  return null;
}

/** The sessions the spark's `agent_send` takes, by its whole rule: live; in one of its profiles; not its own session;
 * and the person's own (no spark's own session, started by you) or one this spark started. Another spark's agents, a
 * flow's runs and an origin word this build does not know are never rows. */
function reachedBy(
  spark: SparkSummary,
  rows: readonly AgentFieldRow[],
  personaSets: ReadonlyMap<string, AgentProfileSetId>,
): AgentFieldRow[] {
  return rows.filter((row) => {
    if (!row.alive || row.runtimeRunId === spark.session?.runtimeRunId) return false;
    const profile = profileSetOfRun(row, personaSets);
    if (profile === undefined || !spark.profiles.includes(profile)) return false;
    const his = row.spark === undefined && (row.origin?.by ?? "you") === "you";
    const started = row.origin?.by === "spark" && row.origin.spark === spark.id;
    return his || started;
  });
}

const timeOf = (at: string | undefined): number => {
  const ms = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
};

/** Each session's handle: its name, with the next ordinal for each after the first by its start that shares it
 * ("vibe-field", "vibe-field·2"), numbered across every session offered, so a row keeps its handle while the query
 * filters. */
function handlesOf(rows: readonly AgentFieldRow[]): Map<string, string> {
  const handles = new Map<string, string>();
  const seen = new Map<string, number>();
  const byStart = [...rows].sort(
    (a, b) =>
      timeOf(a.createdAt) - timeOf(b.createdAt) || a.runtimeRunId.localeCompare(b.runtimeRunId),
  );
  for (const row of byStart) {
    const name = row.project?.name ?? row.label;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    handles.set(row.runtimeRunId, count === 1 ? name : `${name}·${count}`);
  }
  return handles;
}

/** No handles: one empty map, made once, for readers' defaults. */
export const NO_HANDLES: ReadonlyMap<string, string> = new Map();

/** The sessions `spark`'s agent_send takes and the handles @ gives them: the one place the set is chosen and
 * numbered. Empty while the profiles or the board are not read, or can't be. */
function offeredOf(
  spark: SparkSummary,
  rows: BoardRows,
  sets: AtSources["sets"],
): { readonly reached: AgentFieldRow[]; readonly handles: ReadonlyMap<string, string> } {
  if (!Array.isArray(rows) || !Array.isArray(sets)) return { reached: [], handles: NO_HANDLES };
  const reached = reachedBy(spark, rows, personaSetsOf(sets));
  return { reached, handles: handlesOf(reached) };
}

/** @'s handles, by run id: the one rule, for every reader that names a session as @ does. */
export function sessionHandlesOf(
  spark: SparkSummary,
  rows: BoardRows,
  sets: AtSources["sets"],
): ReadonlyMap<string, string> {
  return offeredOf(spark, rows, sets).handles;
}

function matches(query: string, ...words: readonly (string | null)[]): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return words.some((word) => word?.toLowerCase().includes(needle) === true);
}

/** @'s list for the spark's thread. */
export function atRowsOf(sources: AtSources): AtList {
  const { spark, query, sets, rows } = sources;
  if (sets === "failed")
    return {
      agents: [],
      sessions: [],
      reading: false,
      sessionsFailed: false,
      quiet: AT_WORDS.failed,
    };
  const sessionsFailed = rows === "failed";
  if (sets === null || rows === null)
    return { agents: [], sessions: [], reading: true, sessionsFailed, quiet: null };
  const mine = sets.filter((set) => spark.profiles.includes(set.id));
  const many = spark.profiles.length > 1;
  const offeredAgents = mine.flatMap((set) =>
    [
      ...new Set(
        set.personas
          .filter((persona) => persona.identity?.loggedIn === true)
          .map((persona) => persona.provider),
      ),
    ].map(
      (provider): AtAgentRow => ({
        kind: "agent",
        id: `agent:${provider}:${set.id}`,
        agent: provider,
        label: catalogEntry(provider)?.label ?? provider,
        profile: { id: set.id, name: set.label },
        pill: many ? set.label : null,
      }),
    ),
  );
  const { reached, handles } = offeredOf(spark, rows, sets);
  const offeredSessions = reached
    .sort(
      (a, b) =>
        timeOf(a.lastActivityAt ?? a.stateChangedAt) - timeOf(b.lastActivityAt ?? b.stateChangedAt),
    )
    .map(
      (row): AtSessionRow => ({
        kind: "session",
        id: `session:${row.runtimeRunId}`,
        session: row.runtimeRunId,
        agent: row.kind,
        label: row.label,
        handle: handles.get(row.runtimeRunId) ?? row.label,
        project: row.project?.name ?? null,
        word: sessionWord(row),
      }),
    );
  const agents = offeredAgents.filter((row) => matches(query, row.label, row.pill));
  const sessions = offeredSessions.filter((row) =>
    matches(query, row.handle, row.project, row.label),
  );
  const offered = offeredAgents.length + offeredSessions.length;
  // without the board what is running is not known, so "nothing to add" is never said then; what follows the @
  // matching none of what is offered is said as ever
  const quiet =
    offered === 0 && !sessionsFailed
      ? AT_WORDS.empty(spark.name)
      : query !== "" && agents.length + sessions.length === 0
        ? AT_WORDS.none(query)
        : null;
  return { agents, sessions, reading: false, sessionsFailed, quiet };
}

/** The rows a hot highlight can stop on, top to bottom as drawn. */
export function atStops(list: AtList): AtRow[] {
  return [...list.agents, ...list.sessions];
}

/** The row a Return takes before anything is pointed at: the nearest. */
export function atDefaultHot(list: AtList): string | null {
  const stops = atStops(list);
  return stops[stops.length - 1]?.id ?? null;
}

/** ↑ goes away from the composer, ↓ toward it; both stop at the ends. */
export function atMove(list: AtList, hot: string | null, direction: "up" | "down"): string | null {
  const stops = atStops(list);
  if (stops.length === 0) return null;
  const at = stops.findIndex((row) => row.id === hot);
  if (at === -1) return atDefaultHot(list);
  const next = direction === "up" ? Math.max(0, at - 1) : Math.min(stops.length - 1, at + 1);
  return stops[next]?.id ?? null;
}

export function atRow(list: AtList, id: string | null): AtRow | null {
  if (id === null) return null;
  return atStops(list).find((row) => row.id === id) ?? null;
}
