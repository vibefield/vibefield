import {
  type AgentCatalogEntry,
  catalogEntry,
  type IndexRecentSession,
  type IndexSearchHit,
  type IndexSearchResult,
  visibleCatalog,
} from "@vibefield/contracts";
import {
  parseSnippet,
  type SnippetSegment,
  whenLabel,
  whoSaidIt,
} from "@vibefield/puppeteer-views";

// THE PEEK'S MODEL (DESIGN.md §8 "Search — the Peek"; One Frame §23, GV-D8):
// everything the popup decides without a DOM — the rows an answer groups into,
// the line a row opens at, the foot's sentence, the window it fits — so the
// view draws props and the tests read numbers. The words lane's helpers are
// puppeteer views' own (`find-model.ts`: the snippet's marks, who said it,
// when), reused as they are; nothing here dials anything.

/** The two scopes the segment offers: Live now, Godview's own, and
 * Everything, History's (GV-D9). Live now's rows are `peek-live.ts`'s. */
export type PeekScope = "live" | "everything";

/** Which side of the conversation a search reads (`IndexSearchParams.kind`). */
export type PeekKind = "any" | "user" | "agent";

/** What the scope row's dropdowns narrow Everything to; null is "every". */
export interface PeekFilters {
  readonly project: string | null;
  readonly kind: PeekKind;
  readonly agent: string | null;
}

export const NO_PEEK_FILTERS: PeekFilters = { project: null, kind: "any", agent: null };

/** A place the room opens at (the room's own `RoomTarget`, structurally). */
export interface PeekTarget {
  readonly sessionId: string;
  readonly timelineId?: string | null;
}

/** One line that matched: who said it and the words, its matches marked. */
export interface PeekLine {
  /** `session/timeline` — unique within an answer */
  readonly id: string;
  /** the hit's OWN session: a delegated child's, when the line is in a thread */
  readonly sessionId: string;
  readonly timelineId: string;
  readonly who: string;
  /** cut for a one-line row: the first match among its first words */
  readonly row: readonly SnippetSegment[];
  /** whole, for the peek */
  readonly whole: readonly SnippetSegment[];
  readonly at: number | undefined;
}

/** A row is a SESSION — the root a reader lands in — with the lines that
 * matched under it as evidence, newest first. */
export interface PeekRow {
  /** the root's id (`rootSessionId ?? sessionId`) */
  readonly id: string;
  readonly title: string;
  readonly when: string;
  /** the folder the root ran in, by its last name */
  readonly folder: string | null;
  /** the catalog's label for the root's agent */
  readonly agent: string | null;
  /** the root's PJ project (its key, PJ-4): what "Every project" narrows by */
  readonly projectId: string | null;
  readonly provider: string | null;
  readonly lines: readonly PeekLine[];
  /** a latest-session row's summary, said in the peek when no line matched */
  readonly summary: string | null;
  /** where Open lands: the newest matched line, or the session's head */
  readonly target: PeekTarget;
}

/** How many matched lines a row shows under its title (the kit's three). */
export const PEEK_ROW_LINES = 3;

/** What one search asks for: the index's own default page. */
export const PEEK_SEARCH_LIMIT = 300;

/** How many latest sessions the empty Everything lists. */
export const PEEK_LATEST_LIMIT = 40;

/** A row's title when the index has none. */
export const UNTITLED = "Untitled session";

/* ── the words ─────────────────────────────────────────────────────────── */

/** The folder's last name: `/Users/a/Projects/rosetta` → `rosetta`. Either
 * separator, a trailing one ignored; null for no folder. */
export function folderName(cwd: string | null | undefined): string | null {
  if (cwd === null || cwd === undefined) return null;
  const parts = cwd.split(/[\\/]+/u).filter((part) => part !== "");
  return parts.at(-1) ?? null;
}

/** The catalog's name for an agent id; null for none, the id itself for one
 * this build has no row for (shown, never selectable). */
export function agentLabel(provider: string | null | undefined): string | null {
  if (provider === null || provider === undefined) return null;
  return catalogEntry(provider)?.label ?? provider;
}

/** The agents Everything can narrow to: every visible row with a history. */
export function peekAgents(): readonly AgentCatalogEntry[] {
  return visibleCatalog("desktop").filter((row) => row.offers.history);
}

/** Who said a line, in the Peek's 40 column: you, agent, or the kind itself. */
export function peekWho(kind: string): string {
  return whoSaidIt(kind, "agent");
}

/** Characters a row's line may lead its first match by before it is cut. */
const ROW_LEAD = 24;
/** Characters a row's line runs to before it is cut at a word. */
const ROW_REACH = 96;

/** A snippet cut for a one-line row, the kit's rule: the first match among
 * its first words — the lead before it cut at a word's edge behind an
 * ellipsis — and the tail cut at a word past `reach`. Never inside a word. */
export function rowSegments(
  segments: readonly SnippetSegment[],
  lead = ROW_LEAD,
  reach = ROW_REACH,
): SnippetSegment[] {
  const out = segments.map((segment) => ({ ...segment }));
  const first = out.findIndex((segment) => segment.match);
  if (first > 0) {
    const before = out.slice(0, first).reduce((n, segment) => n + segment.text.length, 0);
    if (before > lead) {
      // drop whole leading text down to the segment just before the match,
      // then cut that one at a word so the match starts within `lead`
      out.splice(0, first - 1);
      const head = out[0];
      if (head !== undefined && !head.match) {
        const from = head.text.length - lead;
        const space = head.text.indexOf(" ", Math.max(0, from));
        head.text = `…${space < 0 ? "" : head.text.slice(space + 1)}`;
      }
    }
  }
  let length = 0;
  for (let i = 0; i < out.length; i += 1) {
    const segment = out[i];
    if (segment === undefined) break;
    if (length + segment.text.length <= reach) {
      length += segment.text.length;
      continue;
    }
    if (segment.match) {
      out.length = i + 1;
      out.push({ text: "…", match: false });
      break;
    }
    // cut at the last word's edge that fits; a word that does not fit at all
    // goes whole, behind the ellipsis
    const cut = segment.text.lastIndexOf(" ", reach - length);
    segment.text = cut > 0 ? `${segment.text.slice(0, cut)}…` : "…";
    out.length = i + 1;
    break;
  }
  return out.filter((segment) => segment.text !== "");
}

/* ── the rows ──────────────────────────────────────────────────────────── */

/** What a line is read from: an index hit (Everything's) or a find hit (Live
 * now's, puppeteer's `HistorySearchHit`) — the fields both carry. */
type LineHit = Pick<IndexSearchHit, "sessionId" | "timelineId" | "kind" | "at" | "snippet">;

function lineOf(hit: LineHit): PeekLine {
  const whole = parseSnippet(hit.snippet);
  return {
    id: `${hit.sessionId}/${hit.timelineId}`,
    sessionId: hit.sessionId,
    timelineId: hit.timelineId,
    who: peekWho(hit.kind),
    row: rowSegments(whole),
    whole,
    at: hit.at,
  };
}

const newestFirst = (left: PeekLine, right: PeekLine): number =>
  (right.at ?? Number.NEGATIVE_INFINITY) - (left.at ?? Number.NEGATIVE_INFINITY);

/** A run's matched lines, newest first, each once (Live now's rows). */
export function linesOf(hits: readonly LineHit[]): PeekLine[] {
  const seen = new Set<string>();
  const lines: PeekLine[] = [];
  for (const hit of hits) {
    const line = lineOf(hit);
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    lines.push(line);
  }
  return lines.sort(newestFirst);
}

/** An answer's hits as the Peek's rows: grouped by root in the index's own
 * order (its first hit decides a row's place), each row's lines newest
 * first, narrowed by the project and agent filters (the side is the
 * index's, asked). */
export function peekRows(
  hits: readonly IndexSearchHit[],
  filters: PeekFilters,
  nowMs: number,
): PeekRow[] {
  const groups = new Map<string, { first: IndexSearchHit; lines: PeekLine[] }>();
  for (const hit of hits) {
    if (filters.project !== null && hit.projectKey !== filters.project) continue;
    if (filters.agent !== null && hit.provider !== filters.agent) continue;
    const root = hit.rootSessionId ?? hit.sessionId;
    const group = groups.get(root);
    if (group === undefined) groups.set(root, { first: hit, lines: [lineOf(hit)] });
    else if (!group.lines.some((line) => line.id === `${hit.sessionId}/${hit.timelineId}`))
      group.lines.push(lineOf(hit));
  }
  return [...groups].map(([id, { first, lines }]) => {
    lines.sort(newestFirst);
    const newest = lines[0];
    return {
      id,
      title: first.title ?? UNTITLED,
      when: whenLabel(newest?.at, nowMs),
      folder: folderName(first.cwd),
      agent: agentLabel(first.provider),
      projectId: first.projectKey ?? null,
      provider: first.provider ?? null,
      lines,
      summary: null,
      target:
        newest === undefined
          ? { sessionId: id }
          : { sessionId: newest.sessionId, timelineId: newest.timelineId },
    };
  });
}

/** Your latest sessions — Everything before a word is typed — as rows with
 * no lines, narrowed by the project and agent filters. */
export function latestRows(
  sessions: readonly IndexRecentSession[],
  filters: PeekFilters,
  nowMs: number,
): PeekRow[] {
  return sessions
    .filter((session) => filters.project === null || session.projectKey === filters.project)
    .filter((session) => filters.agent === null || session.provider === filters.agent)
    .map((session) => ({
      id: session.sessionId,
      title: session.title ?? UNTITLED,
      when: whenLabel(session.activity?.lastAt ?? session.updatedAt, nowMs),
      folder: folderName(session.cwd),
      agent: agentLabel(session.provider),
      projectId: session.projectKey ?? null,
      provider: session.provider ?? null,
      lines: [],
      summary: session.summary ?? null,
      target: { sessionId: session.sessionId },
    }));
}

/* ── the query ─────────────────────────────────────────────────────────── */

/** A quote still open: rosetta refuses an unterminated phrase, so nothing is
 * asked until it closes. */
export function hasOpenQuote(query: string): boolean {
  return ((query.match(/"/gu) ?? []).length & 1) === 1;
}

/* ── the foot ──────────────────────────────────────────────────────────── */

/** Where the popup's answer stands, for the foot and the empty body. */
export type PeekPhase =
  /** the latest sessions are asked, or were answered */
  | { readonly kind: "latest"; readonly answered: boolean; readonly failed?: string }
  /** a quote is open, so nothing is asked */
  | { readonly kind: "open-quote" }
  /** words are being searched and nothing has answered them yet */
  | { readonly kind: "searching" }
  /** the index answered (or said it could not) */
  | { readonly kind: "answer"; readonly result: IndexSearchResult }
  /** the door refused */
  | { readonly kind: "failed"; readonly reason: string };

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** Why the index did not answer, in words — its own sentence when it gave
 * one, its build's progress while it builds. */
export function unansweredWords(result: IndexSearchResult): string {
  const { progress, readiness, detail } = result.state;
  if (readiness === "building" && progress !== undefined && progress.total > 0) {
    return `the index is being built · ${Math.floor((100 * progress.done) / progress.total)}%`;
  }
  return detail ?? `the index's search is ${readiness}`;
}

/** Everything's foot: one sentence (the kit's `footHtml`, in VibeField's
 * numbers). Live now's is `peek-live.ts`'s `liveFoot`. */
export function peekFoot(phase: PeekPhase, rows: readonly PeekRow[]): string {
  switch (phase.kind) {
    case "latest":
      if (phase.failed !== undefined)
        return `Your latest sessions could not be read — ${phase.failed}`;
      return "Your latest sessions · every word you type must match";
    case "open-quote":
      return "Close the quote to search for the phrase";
    case "searching":
      return "Searching your past…";
    case "failed":
      return `Search could not ask the index — ${phase.reason}`;
    case "answer": {
      const { result } = phase;
      if (!result.answered) return `No answer yet — ${unansweredWords(result)}`;
      const lines = rows.reduce((sum, row) => sum + row.lines.length, 0);
      const said = `${plural(rows.length, "session")} · ${plural(lines, "line")} matched`;
      return result.clipped ? `${said} · the first page only — narrow the search` : said;
    }
  }
}

/** The empty body's sentence, for an answer with no rows. */
export function peekNone(query: string, filtered: boolean): string {
  const words = query.trim();
  return filtered
    ? `Nothing the filters keep holds every word of “${words}”. Try fewer words, or a phrase in quotes.`
    : `Nothing in your past holds every word of “${words}”. Try fewer words, or a phrase in quotes.`;
}

/* ── the window it fits (K6) ───────────────────────────────────────────── */

/** The Peek as drawn (GV-D8): 900 × 560, the list 380 wide. */
export const PEEK_SIZE = { width: 900, height: 560, list: 380 } as const;
/** Clear of each side of the window. */
export const PEEK_SIDE_CLEAR = 24;
/** Clear of the window's top and foot: the line's 72 (its 52 at 20 from the
 * foot), and 24 — so the popup never covers the head or the line. */
export const PEEK_END_CLEAR = 96;
/** Below this the list and a useful peek cannot both fit: the peek folds. */
export const PEEK_FOLD_BELOW = 680;

export interface PeekLayout {
  readonly width: number;
  readonly height: number;
  /** the peek folded; the list fills the popup */
  readonly folded: boolean;
}

/** The popup's size in a window (or a plate) of this size (K6). */
export function peekLayout(width: number, height: number): PeekLayout {
  const w = Math.max(0, Math.min(PEEK_SIZE.width, width - 2 * PEEK_SIDE_CLEAR));
  const h = Math.max(0, Math.min(PEEK_SIZE.height, height - 2 * PEEK_END_CLEAR));
  return { width: w, height: h, folded: w < PEEK_FOLD_BELOW };
}
