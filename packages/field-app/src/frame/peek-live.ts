import type { FindRow, HistorySearchStatus } from "@vibecook/puppeteer-views";
import type { LiveDesk, LiveFindAgent } from "./find-door";
import { linesOf, type PeekLine, type PeekRow } from "./peek-model";

// LIVE NOW, THE PEEK'S LIVE HALF (P2; DESIGN.md §8 "Search — the Peek"; One
// Frame §23, GV-D9: "Find's model: live runs joined to rosetta's words"). The
// rows are puppeteer's find model's (`createFindRows` over `liveScope`, in
// `use-live-find.ts`); this turns them into the Peek's one row shape and says
// the foot's and the empty body's sentences, in the kit's words. Pure: the
// view draws what this returns, and the tests read it.

/** A live run's state, as its dot and its word say it: a bare terminal is a shell. */
export type LiveState = "blocked" | "working" | "idle" | "shell";

/** The words at a live row's right end, where a past row says its time. */
export const LIVE_STATE_WORDS: Readonly<Record<LiveState, string>> = {
  blocked: "waiting",
  working: "working",
  idle: "idle",
  shell: "a shell",
};

/** The kit's order among rows that matched alike: waiting first, a shell last. */
const STATE_ORDER: Readonly<Record<LiveState, number>> = {
  blocked: 0,
  working: 1,
  idle: 2,
  shell: 3,
};

/** A live run as the Peek lists it: one shape with a past row's (`PeekRow`) —
 * the state's dot and word where a past row has none and its time, and where
 * it runs when that is another desktop (K10). */
export interface PeekLiveRow {
  readonly kind: "live";
  /** the model's row id: what Godview's select takes */
  readonly id: string;
  readonly title: string;
  readonly state: LiveState;
  readonly when: string;
  /** the folder it runs in, by its last name */
  readonly folder: string | null;
  /** the agent's label, or "shell" for a bare terminal */
  readonly agent: string | null;
  /** another desktop's run: where it runs (no mirror until DS-4, K10) */
  readonly remote: Pick<LiveDesk, "name" | "os"> | null;
  /** the lines that matched, newest first */
  readonly lines: readonly PeekLine[];
  /** this desktop's floor session: what the live peek watches */
  readonly floorSessionId: string | null;
  /** the run itself, for the pick */
  readonly run: LiveFindAgent;
}

/** A row in either scope. */
export type PeekListRow = PeekRow | PeekLiveRow;

export function isLiveRow(row: PeekListRow): row is PeekLiveRow {
  return (row as PeekLiveRow).kind === "live";
}

function stateOf(run: LiveFindAgent): LiveState {
  return run.agent === undefined ? "shell" : run.status;
}

function liveRowOf(row: FindRow<LiveFindAgent>): PeekLiveRow {
  const run = row.agent;
  const state = stateOf(run);
  const folder = run.project === "" ? null : run.project;
  return {
    kind: "live",
    id: run.id,
    title: row.title ?? folder ?? (state === "shell" ? "Terminal" : "Untitled session"),
    state,
    when: LIVE_STATE_WORDS[state],
    folder,
    agent: run.agent?.provider.label || (state === "shell" ? "shell" : null),
    remote: run.desk.self ? null : { name: run.desk.name, os: run.desk.os },
    lines: linesOf(row.hits),
    floorSessionId: run.floorSessionId ?? null,
    run,
  };
}

/** Find's rows as the Peek's (the kit's `results`, live half): with words,
 * the runs whose facts or transcript hold every word, by how many lines
 * matched, then waiting → working → idle → shell, find's own rank breaking the
 * rest; without words, every live session — find's model lists the agents and
 * the bare shells join them last, as the kit draws them. */
export function peekLiveRows(
  found: readonly FindRow<LiveFindAgent>[],
  runs: readonly LiveFindAgent[],
  query: string,
): PeekLiveRow[] {
  const rows = found.map(liveRowOf);
  if (query.trim() === "") {
    const listed = new Set(rows.map((row) => row.id));
    for (const run of runs) {
      if (run.agent !== undefined || listed.has(run.id)) continue;
      rows.push(
        liveRowOf({ agent: run, factsScore: 0, matched: [], hits: [], score: 0, lastActiveMs: 0 }),
      );
    }
  }
  // a stable sort: find's rank stands among rows the kit's order calls equal
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (left, right) =>
        right.row.lines.length - left.row.lines.length ||
        STATE_ORDER[left.row.state] - STATE_ORDER[right.row.state] ||
        left.index - right.index,
    )
    .map(({ row }) => row);
}

/** Where the rows Live now lists stand: Godview's own (always read while it
 * shows), or History's own feed (PK5), asking or refused. */
export type LiveFeedState =
  | { readonly kind: "live" }
  | { readonly kind: "connecting" }
  | { readonly kind: "unavailable"; readonly reason: string };

/** What the transcript search can say about itself, in the foot's words; null
 * when it is ready and has nothing to add. */
export function liveIndexWords(status: HistorySearchStatus | undefined): string | null {
  if (status === undefined) return null;
  if (!status.reachable) return `transcript search off — ${status.detail ?? "no daemon"}`;
  switch (status.readiness) {
    case "building":
      return status.progress !== undefined && status.progress.total > 0
        ? `indexing · ${Math.floor((100 * status.progress.done) / status.progress.total)}%`
        : "the index is being prepared";
    case "catching-up":
      return "catching up";
    case "stale":
    case "failed":
      return "transcript search unavailable";
    default:
      return null;
  }
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

export interface LiveFootInput {
  readonly feed: LiveFeedState;
  readonly query: string;
  readonly rows: readonly PeekLiveRow[];
  readonly status: HistorySearchStatus | undefined;
  /** words are being asked and nothing has answered them yet */
  readonly searching: boolean;
  /** the last ask was answered (an unanswered one keeps the rows it had) */
  readonly answered: boolean;
  readonly clipped: boolean;
}

/** The foot's one sentence for Live now (the kit's `footHtml`, live half). */
export function liveFoot(input: LiveFootInput): string {
  const { feed, rows } = input;
  if (feed.kind === "connecting") return "Asking what runs…";
  if (feed.kind === "unavailable") return `What runs could not be read — ${feed.reason}`;
  const index = liveIndexWords(input.status);
  if (input.query.trim() === "") {
    const said =
      rows.length === 0
        ? "Nothing runs right now"
        : `${plural(rows.length, "live session")}, waiting first`;
    return index === null ? said : `${said} · ${index}`;
  }
  const lines = rows.reduce((sum, row) => sum + row.lines.length, 0);
  const parts = [`${plural(rows.length, "session")} · ${plural(lines, "line")} matched`];
  if (input.searching && !input.answered) parts.push("searching");
  else if (!input.answered) parts.push("the words were not searched");
  if (input.clipped) parts.push("the first page only — narrow the search");
  if (index !== null) parts.push(index);
  return parts.join(" · ");
}

/** The empty body's sentence for Live now, or null while the feed is asked. */
export function liveNone(feed: LiveFeedState, query: string, filtered: boolean): string | null {
  if (feed.kind === "connecting") return null;
  if (feed.kind === "unavailable") return "What runs could not be read.";
  const words = query.trim();
  if (words === "") {
    return filtered ? "Nothing the filters keep runs right now." : "Nothing runs right now.";
  }
  return filtered
    ? `No live session the filters keep holds every word of “${words}”.`
    : `No live session holds every word of “${words}”.`;
}
