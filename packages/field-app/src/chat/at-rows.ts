import type {
  AgentFieldRow,
  AgentProfileSet,
  AgentProviderSummary,
  SparkSummary,
} from "@vibefield/contracts";

// @'S ROWS IN CHAT (SP-1d; DESIGN.md §8 "Chat's composer", @'s rows in Chat; CH-D5 A "Agents to start, and sessions
// running"; EW-D4: @ offers only its scope). PURE: the spark, what fieldd answers of its agents and profiles, and the
// field board's rows in; the two groups out, read bottom-up, nearest first. Each lists only what the spark's own tools
// reach, so @ never offers a row they would refuse:
//
//   - "Start an agent": the list its `agents_available` tool answers (TL-D2; fieldd's compose room) — each agent
//     signed in under one of the spark's profiles, a row per agent and profile;
//   - "Running in its profiles": the sessions its `agent_send` takes (CP-2; fieldd's talk room, `reach` + `his` /
//     `startedBy` + `live`), by that whole rule.
//
// The board's row names its persona (`profileId`), not the profile its run was filed under, so a session's profile is
// read as the talk room's own fallback reads it: its persona's profile, or This Mac's when it names none. The one
// parity left: a run fieldd filed under a profile other than its persona's is placed by its persona here.
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
  /** its name as the swarm names its body, with @'s ordinal where two share it ("vibe-field·2") */
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
  /** the list's word when it holds no row: nothing matches what follows the @, or nothing to offer at all */
  readonly quiet: string | null;
}

export interface AtSources {
  readonly spark: SparkSummary;
  /** what follows the @ */
  readonly query: string;
  /** `agent.providers`' answer, or null until it is read */
  readonly providers: readonly AgentProviderSummary[] | null;
  /** `agents.profileSets.list`'s answer, or null until it is read */
  readonly sets: readonly AgentProfileSet[] | null;
  /** the field board's rows, or null until the board is read */
  readonly rows: readonly AgentFieldRow[] | null;
}

/** @'s words (DESIGN.md §9 "Chat's words"). */
export const AT_WORDS = {
  agents: "Start an agent",
  sessions: "Running in its profiles",
  reading: "Reading its agents…",
  none: (query: string) => `Nothing called "${query}"`,
  empty: (name: string) => `Nothing to add from ${name}'s profiles`,
} as const;

/** A session's word: Working, Idle, or Needs you (its run blocked on the person); none for a run not heard yet. */
export function sessionWord(row: AgentFieldRow): SessionWord | null {
  if (row.status === "blocked" || row.blockers.length > 0) return "Needs you";
  if (row.status === "working") return "Working";
  if (row.status === "idle") return "Idle";
  return null;
}

/** The profile a run belongs to, as the talk room's fallback reads it: its persona's profile, or This Mac's when it
 * names no persona; undefined for a persona no profile holds. */
function profileOfRow(row: AgentFieldRow, sets: readonly AgentProfileSet[]): string | undefined {
  if (row.profileId === undefined) return sets.find((set) => set.kind === "native")?.id;
  return sets.find((set) => set.personas.some((persona) => persona.profileId === row.profileId))
    ?.id;
}

/** The sessions the spark's `agent_send` takes, by its whole rule: live; in one of its profiles; not its own session;
 * and the person's own (no spark's own session, started by you) or one this spark started. Another spark's agents, a
 * flow's runs and an origin word this build does not know are never rows. */
function reachedBy(
  spark: SparkSummary,
  rows: readonly AgentFieldRow[],
  sets: readonly AgentProfileSet[],
): AgentFieldRow[] {
  return rows.filter((row) => {
    if (!row.alive || row.runtimeRunId === spark.session?.runtimeRunId) return false;
    const profile = profileOfRow(row, sets);
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

function matches(query: string, ...words: readonly (string | null)[]): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return words.some((word) => word?.toLowerCase().includes(needle) === true);
}

/** @'s list for the spark's thread. */
export function atRowsOf(sources: AtSources): AtList {
  const { spark, query, providers, sets, rows } = sources;
  if (providers === null || sets === null || rows === null) {
    return { agents: [], sessions: [], reading: true, quiet: null };
  }
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
        label: providers.find((entry) => entry.id === provider)?.label ?? provider,
        profile: { id: set.id, name: set.label },
        pill: many ? set.label : null,
      }),
    ),
  );
  const reached = reachedBy(spark, rows, sets);
  const handles = handlesOf(reached);
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
  const quiet =
    offered === 0
      ? AT_WORDS.empty(spark.name)
      : agents.length + sessions.length === 0
        ? AT_WORDS.none(query)
        : null;
  return { agents, sessions, reading: false, quiet };
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
