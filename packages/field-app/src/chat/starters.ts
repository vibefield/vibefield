import type { AgentFieldRow, AgentProviderSummary } from "@vibefield/contracts";
import { AGENT_CATALOG, starterAgent } from "@vibefield/contracts";
import type { BoardRows } from "./sparks-feed";
import { STARTERS, type Starter } from "./thread-items";

// THE STARTERS, FILLED FROM THIS MAC (track ES, ES-4; DESIGN.md §8 "Chat's list", the jobs, "Filled from this Mac";
// §9 "Chat's thread", the hello, as amended; ES-D4 A as James ruled it on the ES page; VF-PM 2026-11-08 09:30Z, 09:33Z).
// Pure: the agents this Mac has and the field board's runs in; the hello's three starters, their slots filled, out.
// - The crew is an agent this Mac has that can be started: the ruled one where it has it, else the catalog's first.
// - The project is the busiest folder on the board (by its name, never its path).
// - The handle is the live run, no spark's own, worked in last, named by its agent and its place among that agent's
//   live runs. The reviewer is an agent this Mac has, the ruled one first, another than the run's own where there is one.
// - An agent slot with nothing to fill keeps its ruled word: a sample, which the person edits before sending (ES-D4 A).
//   Read, no agent slot names an agent this Mac lacks. A project or a run with nothing to fill drops out and the starter
//   reads bare (ES-Q1, James 2026-11-09). The night's jobs and the hello take the one reading.
// - The ruled agents are the catalog's role rows (`starterAgent`; ES-4 role, VF-PM 2026-11-08 23:41Z): which agent a
//   ruled word names is the table's to say, never this file's (AR-L1), and R23b holds it to no agent id literal.

/** The starters as this Mac fills them: held in their places, wordless, while a read is out; then read. */
export type StartersReading =
  | { readonly state: "reading"; readonly starters: readonly Starter[] }
  | { readonly state: "read"; readonly starters: readonly Starter[] };

/** What fills them: this Mac's agents (`agent.providers`), null while they are read and "failed" where they cannot be;
 * and the field board's rows, as the window's feed reads them. */
export interface StarterSources {
  readonly agents: readonly AgentProviderSummary[] | null | "failed";
  readonly rows: BoardRows;
}

/** The agents the ruled words name, as the catalog's role rows say (NS-D4's starters as ruled, §9): the crew's and the
 * reviewer's labels, each its slot's ruled word, and the handle's agent, which the reviewer still steps aside for where
 * no run is named. */
const ruledCrew = starterAgent("crew");
const ruledReviewer = starterAgent("reviewer");
const RULED = {
  crew: { id: ruledCrew?.id, word: ruledCrew?.label },
  runAgent: starterAgent("handle")?.seams.puppeteer?.provider,
  reviewer: { id: ruledReviewer?.id, word: ruledReviewer?.label },
} as const;

const crewWords = (agent: string): string => `Spawn 4 ${agent} agents to research a topic each`;
const folderWords = (folder: string | undefined): string =>
  folder === undefined ? "Keep track of my agents" : `Keep track of my agents in ${folder}`;
const reviewWords = (reviewer: string, run: string | undefined): string =>
  `Have ${reviewer} review ${run === undefined ? "my agents'" : `${run}'s`} work until it's clean`;

const catalogPlace = (id: string): number => {
  const at = AGENT_CATALOG.findIndex((entry) => entry.id === id);
  return at === -1 ? AGENT_CATALOG.length : at;
};
const timeOf = (at: string | undefined): number => {
  const ms = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
};
/** When a run was worked in last, as the board says it. */
const workedAt = (run: AgentFieldRow): number => timeOf(run.lastActivityAt ?? run.stateChangedAt);

/** The starters, filled from what this Mac has, or held while it is read. */
export function startersOf({ agents, rows }: StarterSources): StartersReading {
  if (agents === null || rows === null) return { state: "reading", starters: STARTERS };
  // the agents this Mac has that can be started, in the catalog's order; null where they could not be read
  const here =
    agents === "failed"
      ? null
      : agents
          .filter((agent) => agent.available && agent.offers?.spawn === true)
          .sort((a, b) => catalogPlace(a.id) - catalogPlace(b.id));
  // the person's live runs: never a spark's own, never one that has ended
  const live = rows === "failed" ? [] : rows.filter((run) => run.alive && run.spark === undefined);

  const crew =
    here === null || here.length === 0
      ? RULED.crew.word
      : ((here.find((agent) => agent.id === RULED.crew.id) ?? here[0])?.label ?? RULED.crew.word);

  const folder = busiestFolder(live);

  const last = [...live].sort(
    (a, b) => workedAt(b) - workedAt(a) || b.runtimeRunId.localeCompare(a.runtimeRunId),
  )[0];
  const runAgent = last?.kind ?? RULED.runAgent;
  const handle = last === undefined ? undefined : handleOf(last, live);

  let reviewer: string | undefined = RULED.reviewer.word;
  if (here !== null && here.length > 0) {
    const ruled = here.find((agent) => agent.id === RULED.reviewer.id);
    const other = here.find((agent) => agent.id !== runAgent);
    const pick = ruled !== undefined && ruled.id !== runAgent ? ruled : (other ?? ruled ?? here[0]);
    reviewer = pick?.label ?? RULED.reviewer.word;
  }

  // a role no catalog row holds (the table's own test holds each to one row) keeps the hello's whole ruled sentence
  const [spawn, track, review] = STARTERS;
  return {
    state: "read",
    starters: [
      {
        glyph: spawn?.glyph ?? "agents",
        words: crew === undefined ? (spawn?.words ?? "") : crewWords(crew),
      },
      { glyph: track?.glyph ?? "panes", words: folderWords(folder) },
      {
        glyph: review?.glyph ?? "duplicate",
        words: reviewer === undefined ? (review?.words ?? "") : reviewWords(reviewer, handle),
      },
    ],
  };
}

/** The folder most live runs stand in, by its name; a tie goes to the one worked in last. None, where no live run
 * names its folder. */
function busiestFolder(live: readonly AgentFieldRow[]): string | undefined {
  const folders = new Map<string, { runs: number; last: number }>();
  for (const run of live) {
    const name = run.project?.name;
    if (name === undefined || name === "") continue;
    const held = folders.get(name) ?? { runs: 0, last: 0 };
    folders.set(name, { runs: held.runs + 1, last: Math.max(held.last, workedAt(run)) });
  }
  let best: { readonly name: string; readonly runs: number; readonly last: number } | undefined;
  for (const [name, { runs, last }] of folders)
    if (best === undefined || runs > best.runs || (runs === best.runs && last > best.last))
      best = { name, runs, last };
  return best?.name;
}

/** A run's handle: its agent, and its place among that agent's live runs by their start ("claude", "claude·2"), as
 * the page's fixtures name a run. @ names a run by its folder (`at-rows.ts`); this handle is words the spark reads. */
function handleOf(run: AgentFieldRow, live: readonly AgentFieldRow[]): string {
  const mates = live
    .filter((other) => other.kind === run.kind)
    .sort(
      (a, b) =>
        timeOf(a.createdAt) - timeOf(b.createdAt) || a.runtimeRunId.localeCompare(b.runtimeRunId),
    );
  const place = mates.indexOf(run) + 1;
  return place <= 1 ? run.kind : `${run.kind}·${place}`;
}
