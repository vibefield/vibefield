import type {
  BackfillState,
  ContributionRow,
  DayUsageResponse,
  HeatmapDay,
  HourTotal,
  IngestPhase,
  IngestProgress,
  MetaState,
  MetaSubscriptionHandlers,
  ModelDay,
  ParticipantColor,
  ProjectRow,
  RuntimeBackfill,
  RuntimeRow,
  SearchHit,
  SearchReadiness,
  SearchResponse,
  SessionDelegation,
  SessionRole,
  SessionRow,
  StreamState,
  SubscriptionStatus,
  UsageResponse,
} from "@rosetta/protocol";
import type {
  CatalogPort,
  CatalogSearch,
  CatalogStatus,
  FigureWindow,
  HostPort,
  ProjectStats,
  RoomPorts,
} from "@rosetta/room";
import {
  AGENT_CATALOG_READERS,
  INDEX_MESH,
  type IndexCatalogSource,
  IndexSearchResult,
  type IndexSession,
  IndexSessionsResult,
  IndexStatus,
  type IndexThread,
  type IndexThreadDelegation,
  IndexThreadsResult,
  PROJECT_DOORS,
  ProjectChangesDelta,
  ProjectFiguresDayResult,
  ProjectFiguresResult,
  ProjectListResult,
  type ProjectRegrouped,
  type ProjectSummary,
} from "@vibefield/contracts";
import { WorkspaceClient, type WorkspaceClientOptions } from "../workspace/client";
import { type AssetSourceOptions, assetSourceOver, type HistoryAssetSource } from "./asset-source";
import { type HistorySections, historySectionsOf } from "./sections";
import { type HistorySessionPort, type SessionPortOptions, sessionPortOver } from "./session-port";

// THE HISTORY ROOM'S PORTS (AR-8c; thinking-ar-history-room.md §2 — AR-D36,
// AR-D37 (a)). rosetta's room (`@rosetta/room`) dials nothing: it reads four
// ports, and these are VibeField's, pure adapters over this window's fieldd
// client, the way `godview/monitor/doors.ts` adapts puppeteer's views. Two
// lanes, never crossed (EL2):
//   - the CATALOG — who and what exists, the panels' figures, the index's
//     state — rides fieldd's `index.*` doors as control-rate JSON;
//   - the BODIES — one session's transcript, entries, plans, assets — ride the
//     direct plane with a per-session grant (`session-port.ts`,
//     `asset-source.ts`); fieldd carries no transcript byte.
// VibeField records nothing here and keeps nothing: the room draws rosetta's
// record and its own live stream.
//
// PJ-4 (H1 (a), James 2026-10-09 — "we map, the room draws"): History lists
// PROJECTS — VibeField's, the places fieldd groups (PJ-L1) — in the room's own
// shapes: a `ProjectRow` is a `project.list` row (its id the PJ key), and every
// session's `project_id` is the key fieldd joined it to (`projectKey`, A-D4),
// so the room's list, its sessions, its ranking and its search scope follow
// the projects with no room change and no grouping here. The figures are the
// project's merged ones (`project.figures`, H2), the pings `project.subscribe`
// (whose `regrouped` re-keys the room's selection, `onRegrouped`). THE DEVICE
// GUARD (V6, A4.2): the room is device-unaware (A-D9), so nothing of another
// desktop reaches it — no session row whose desktop is not this one, no path
// of a place on another desktop as a project's root — or the room would open
// or resume THIS Mac's same-spelled folder for it. Until the room can say
// where a session ran (PJ-4's second half), History is this desktop's places
// and sessions (H3 (a)), and a project with no place here is not listed.
//
// AR-L1 holds at the seam: the adapters speak contract shapes in and rosetta's
// row shapes out (the package's own types, re-exported), and no agent id is
// compared to a literal — a provider maps to rosetta's kind through the
// catalog's readers (R23b).

/** The calls the ports make of fieldd: the deck's FielddClient, or a test's. */
export interface HistoryDoorClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  subscribe(
    method: string,
    params: Record<string, unknown>,
    onFrame: (payload: unknown, kind?: "snapshot" | "delta") => void,
    opts?: { onReplayFailed?: (error: unknown) => void },
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
  /** The connection's own state (FielddClient's), when the client has one. */
  readonly status?: string;
  onStatusChange?(listener: () => void): () => void;
}

/** The waits between asks the index could not answer YET (its catalog not
 * read, its daemon starting) — the room keeps what it showed meanwhile. */
export const HISTORY_RETRY_MIN_MS = 500;
export const HISTORY_RETRY_MAX_MS = 10_000;
/** How long one `project.figures` answer serves both of the room's asks for
 * the same window — the panel's figures and its usage are ONE door (AR-D39
 * (a)). */
export const PROJECT_FIGURES_SHARE_MS = 10_000;
/** A listing longer than this many pages is refused rather than walked. */
export const HISTORY_LISTING_MAX_PAGES = 200;

/* ── rows: the contract's shapes in, rosetta's out ──────────────────────── */

const INGEST_PHASES: ReadonlySet<string> = new Set<IngestPhase>([
  "discovering",
  "awaiting_consent",
  "backfilling",
  "metadata_ready",
  "restoring",
  "finalizing",
  "publishing",
  "live",
]);
const BACKFILL_STATES: ReadonlySet<string> = new Set<BackfillState>([
  "queued",
  "skimming",
  "streaming",
  "preparing",
  "applying",
  "done",
]);
const STREAM_STATES: ReadonlySet<string> = new Set<StreamState>([
  "pending",
  "streaming",
  "indexed",
]);
const SESSION_ROLES: ReadonlySet<string> = new Set<SessionRole>(["main", "subagent", "team"]);
const PARTICIPANT_COLORS: ReadonlySet<string> = new Set<ParticipantColor>([
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
  "red",
]);
const SEARCH_READINESS: ReadonlySet<string> = new Set<SearchReadiness>([
  "ready",
  "building",
  "catching-up",
  "stale",
  "failed",
]);

/** The runtime a session is filed under, as the room joins it. The catalog's
 * listing names each session's AGENT (the catalog id), not rosetta's runtime
 * row, so the room's runtimes are one per agent kind — rosetta's kind, read
 * through the catalog — and a session no catalog row maps is `unknown`. */
export function runtimeKindOf(provider: string | undefined): string {
  return (
    (provider === undefined ? undefined : AGENT_CATALOG_READERS.kindFor(provider)) ?? "unknown"
  );
}

/** The device guard (V6, A4.2): whether a row is THIS desktop's — its own
 * `device`, or none named (a listing scoped to this desktop names it). With no
 * desktop known yet, a row that names one is not trusted. */
export function isThisDesktops(
  row: { readonly device?: string | undefined },
  self: string | null,
): boolean {
  return row.device === undefined || (self !== null && row.device === self);
}

/** The repository the room may open: the project's identity remote, by the
 * normalized key fieldd groups on (`remote:github.com/acme/app` — a spelling
 * the room opens as `https://…`, R9), never a remote that is a local path. */
function repositoryOf(project: ProjectSummary): string | null {
  const remote = project.anchors.find(
    (anchor) => anchor.startsWith("remote:") && !anchor.startsWith("remote:local:"),
  );
  return remote === undefined ? null : remote.slice("remote:".length);
}

/** One PJ project (`project.list`) as rosetta's `ProjectRow` (H1): its key is
 * the room's id; its name is fieldd's (§4.3 — yours, the repository's, the
 * folder's; "Home", "Temporary"), with the parent folder that tells two alike
 * apart; its roots are THIS desktop's places only (the device guard — a
 * remote place's path would open this Mac's same-spelled folder), newest
 * first as fieldd lists them; its repository the identity remote's key. */
export function projectRowOf(project: ProjectSummary, self: string | null): ProjectRow {
  return {
    id: project.key,
    name:
      project.disambiguation !== undefined
        ? `${project.name} · ${project.disambiguation}`
        : project.name,
    root_paths:
      self === null
        ? []
        : project.places.flatMap((place) =>
            place.ref.device === self && place.path !== undefined ? [place.path] : [],
          ),
    git_repo: repositoryOf(project),
  };
}

/** One top-level session of the catalog's listing as rosetta's `SessionRow`.
 * The listing holds ROOTS only — a delegated child arrives through
 * `index.threads` (`threadRowOf`) — so every row is its own root, `main`, with
 * no parent and no delegation; a column the listing does not carry is the
 * honest null (`summary`, `cwd`, …) or, where rosetta's row requires a number,
 * the nearest fact the catalog does carry: a session's start is its first
 * recorded activity when the catalog has no start, and its freshness its last.
 * PJ-4: its project is the PJ key fieldd joined it to (`projectKey`, A-D4) —
 * none yet (a folder no place holds) is rosetta's own unassigned bucket. */
export function sessionRowOf(row: IndexSession): SessionRow {
  return roomRowOf(row, row.projectKey ?? null, {
    parent_session_id: null,
    delegation: null,
    root_session_id: row.rootSessionId,
    role: "main",
  });
}

/** One delegated thread (`index.threads`, AR-8 L1) as rosetta's `SessionRow`:
 * where it hangs — its parent and the root it rolls up to — its role (a word
 * the room does not draw is a subagent: a child it is) and its delegation, in
 * rosetta's spelling again, the native evidence the room places its subthread
 * by. A colour outside rosetta's eight is no colour. PJ-4: its project is its
 * ROOT's (fieldd tags it so; `rootKey` is the root's key as the roots were
 * read, for a thread read a moment before its root was keyed). */
export function threadRowOf(row: IndexThread, rootKey?: string | null): SessionRow {
  return roomRowOf(row, row.projectKey ?? rootKey ?? null, {
    parent_session_id: row.parentSessionId,
    delegation: row.delegation === null ? null : delegationOf(row.delegation),
    root_session_id: row.rootSessionId,
    role:
      row.role !== undefined && SESSION_ROLES.has(row.role)
        ? (row.role as SessionRole)
        : "subagent",
  });
}

function delegationOf(delegation: IndexThreadDelegation): SessionDelegation {
  const color = delegation.color;
  return {
    parent_tool_native_id: delegation.parentToolNativeId ?? null,
    workflow_run_id: delegation.workflowRunId ?? null,
    team: delegation.team ?? null,
    color:
      color !== undefined && PARTICIPANT_COLORS.has(color) ? (color as ParticipantColor) : null,
    configured_model: delegation.configuredModel ?? null,
  };
}

/** The columns a root and a thread share, its project, and where it hangs. */
function roomRowOf(
  row: IndexSession | IndexThread,
  project: string | null,
  place: Pick<SessionRow, "parent_session_id" | "delegation" | "root_session_id" | "role">,
): SessionRow {
  const startedAt = row.startedAt ?? row.activity?.firstAt ?? row.updatedAt ?? 0;
  return {
    id: row.sessionId,
    native_session_id: row.nativeSessionId,
    runtime_id: runtimeKindOf(row.provider),
    project_id: project,
    cwd: row.cwd ?? null,
    ...place,
    title: row.title ?? null,
    summary: row.summary ?? null,
    started_at: startedAt,
    updated_at: row.updatedAt ?? row.activity?.lastAt ?? startedAt,
    activity:
      row.activity === null
        ? null
        : { first_at: row.activity.firstAt, last_at: row.activity.lastAt },
    // rosetta's open vocabulary: a word this build never heard of is read as
    // indexed — the session's own stream is the authority on what it holds
    stream_state: STREAM_STATES.has(row.streamState) ? (row.streamState as StreamState) : "indexed",
  };
}

/** The room's whole topology from the catalog's listings — the roots and,
 * since AR-8 (L1), the delegated threads beside them, which the room builds
 * its subthreads and its search grouping from: the runtimes are one per agent
 * kind the sessions are filed under (see `runtimeKindOf`).
 *
 * PJ-4: the projects are fieldd's (`project.list`) with a place on THIS
 * desktop, and only this desktop's sessions pass (the device guard, H3 (a));
 * `self` is this desktop's id as the listings name it (their `sources`), and
 * with none known nothing that names a desktop is handed over. */
export function metaStateOf(
  projects: readonly ProjectSummary[],
  sessions: readonly IndexSession[],
  threads: readonly IndexThread[] = [],
  self: string | null = null,
): MetaState {
  const roots = sessions.filter((row) => isThisDesktops(row, self));
  const rootKeys = new Map(roots.map((row) => [row.sessionId, row.projectKey ?? null]));
  const sessionRows = [
    ...roots.map(sessionRowOf),
    ...threads.map((row) => threadRowOf(row, rootKeys.get(row.rootSessionId))),
  ];
  const kinds = [...new Set(sessionRows.map((row) => row.runtime_id))].sort();
  return {
    runtimes: kinds.map(
      (kind): RuntimeRow => ({
        id: kind,
        kind,
        data_root: "",
        enabled: true,
        account: null,
        config: null,
        skills: null,
        versions_seen: null,
        discovered_at: 0,
      }),
    ),
    projects: projects
      .filter(
        (project) => self !== null && project.places.some((place) => place.ref.device === self),
      )
      .map((project) => projectRowOf(project, self)),
    sessions: sessionRows,
  };
}

/** This desktop's id as a listing names it (its `self` source), or null. */
export function selfOf(sources: readonly IndexCatalogSource[] | undefined): string | null {
  return sources?.find((source) => source.self)?.device ?? null;
}

/** `index.status` as the room's `CatalogStatus` — or null when the index is
 * not up (the supervisor's own phase: unconfigured, starting, restarting,
 * failed, stopped), which the port answers as a refusal in fieldd's words. */
export function catalogStatusOf(status: IndexStatus): CatalogStatus | null {
  if (!INGEST_PHASES.has(status.phase)) return null;
  const runtimes: RuntimeBackfill[] = [];
  for (const runtime of status.runtimes) {
    const backfill = runtime.backfill;
    if (backfill === undefined || !BACKFILL_STATES.has(backfill.state)) continue;
    runtimes.push({
      kind: runtime.kind,
      runtime_id: runtime.runtimeId,
      label: runtime.label ?? null,
      state: backfill.state as BackfillState,
      files_total: backfill.filesTotal,
      bytes_total: backfill.bytesTotal,
      files_skimmed: backfill.filesSkimmed,
      bytes_streamed: backfill.bytesStreamed,
      sessions_total: backfill.sessionsTotal,
      records: backfill.records,
    });
  }
  const ingest: IngestProgress = { phase: status.phase as IngestPhase, runtimes, projects: [] };
  const readiness = status.search?.readiness;
  return {
    canonicalReady: status.search?.canonicalReady ?? status.phase === "live",
    searchReadiness:
      readiness !== undefined && SEARCH_READINESS.has(readiness)
        ? (readiness as SearchReadiness)
        : "building",
    // fieldd projects the search build's counters without rosetta's stage;
    // the room reads them only in its search sheet — which did not ship here
    // until the search interim (2026-10-04): it does now, and with no counters
    // a build draws the sheet's fixed sliver of a meter and its own words
    // ("search is being prepared")
    searchProgress: null,
    ingest,
    // fieldd's projection names the daemon's phase and pid, not its clock
    startedAt: null,
    uptimeMs: 0,
  };
}

/** The six usage figures, back into rosetta's spelling. */
function figures(row: {
  tokens: number;
  costMicroUsd: number | null;
  billedMicroUsd: number | null;
  unpricedTokens: number;
  unrecordedOutput: number;
  reportedCostAdjustmentMicroUsd: number;
}) {
  return {
    tokens: row.tokens,
    cost_micro_usd: row.costMicroUsd,
    billed_micro_usd: row.billedMicroUsd,
    unpriced_tokens: row.unpricedTokens,
    unrecorded_output: row.unrecordedOutput,
    reported_cost_adjustment_micro_usd: row.reportedCostAdjustmentMicroUsd,
  };
}

/** `project.figures`' heatmap and contribution (H2: summed over every
 * desktop and rosetta project the project's sessions are filed under): the
 * room's `projectStats`. */
export function projectStatsOf(result: ProjectFiguresResult): ProjectStats {
  return {
    heat: result.heatmap.map((day): HeatmapDay => ({ day: day.day, ...figures(day) })),
    contribution: result.contribution.map(
      (row): ContributionRow => ({
        session_id: row.sessionId,
        project_id: row.projectId,
        commits: row.commits,
        edits: row.edits,
        loc: row.loc,
        messages: row.messages,
        ...figures(row),
      }),
    ),
  };
}

/** `project.figures`' usage: the room's `usage`. */
export function usageOf(result: ProjectFiguresResult): UsageResponse {
  return {
    models: result.usage.models.map(
      (row): ModelDay => ({ day: row.day, model: row.model, ...figures(row) }),
    ),
    hours: result.usage.hours.map((row): HourTotal => ({ hour: row.hour, ...figures(row) })),
  };
}

/** `project.figuresDay`: the room's `dayUsage`. */
export function dayUsageOf(result: ProjectFiguresDayResult): DayUsageResponse {
  return {
    day: result.day,
    models: result.models.map((row) => ({ hour: row.hour, model: row.model, tokens: row.tokens })),
  };
}

/* ── words: the index's state as the frame says it ──────────────────────── */

/** A refusal fieldd expressed by throwing, read structurally. */
function refusalOf(cause: unknown): {
  kind?: unknown;
  retryable?: unknown;
  message?: unknown;
  details?: Record<string, unknown> | undefined;
} {
  return typeof cause === "object" && cause !== null ? (cause as never) : {};
}

function sentence(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/** The index not up, in fieldd's own words (its UNAVAILABLE message is the
 * same: `the agent index is <phase>[: <detail>]`), in sentence case. */
export function statusWords(status: IndexStatus): string {
  const detail = status.rosettad.detail;
  return sentence(`the agent index is ${status.rosettad.phase}${detail ? `: ${detail}` : ""}`);
}

/** A door's refusal in fieldd's own words, with the state it named. */
export function refusalWords(cause: unknown): string {
  const refusal = refusalOf(cause);
  const message =
    cause instanceof Error && cause.message
      ? cause.message
      : typeof refusal.message === "string"
        ? refusal.message
        : String(cause);
  const state = refusal.details?.["state"];
  return sentence(typeof state === "string" && state !== "" ? `${message} (${state})` : message);
}

/** Whether asking again may be answered: fieldd's own `retryable`, and a
 * connection that is not up (the client says so without a kind). */
function askAgain(cause: unknown): boolean {
  const refusal = refusalOf(cause);
  return refusal.retryable === true || refusal.kind === undefined;
}

function aborted(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The read was cancelled", "AbortError");
}

/** A door's answer that a caller may stop waiting for (the request itself
 * still runs to its end: the client has no cancel). */
function withSignal<T>(answer: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return answer;
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const stop = (): void => reject(aborted(signal));
    signal.addEventListener("abort", stop, { once: true });
    answer.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(cause);
      },
    );
  });
}

/* ── the catalog port ───────────────────────────────────────────────────── */

/** The two parts of the room's meta a read fetches: the roots (`project.list`
 * + `index.sessions`) and the delegated threads (`index.threads`). */
interface MetaParts {
  readonly roots: boolean;
  readonly threads: boolean;
}
const ALL_PARTS: MetaParts = { roots: true, threads: true };
const NO_PARTS: MetaParts = { roots: false, threads: false };

/** The parts a change ping says moved, read from its `tables` hint (AR-8 L1;
 * `project.subscribe` carries it since PJ-4): a ping that names no table — the
 * grouping or a standing moved — or one this build does not know moves both. */
export function pingParts(payload: unknown): MetaParts {
  const tables =
    typeof payload === "object" && payload !== null
      ? (payload as { tables?: unknown }).tables
      : undefined;
  if (!Array.isArray(tables) || tables.length === 0) return ALL_PARTS;
  let roots = false;
  let threads = false;
  for (const table of tables) {
    if (table === "projects" || table === "sessions") roots = true;
    else if (table === "threads") threads = true;
    else return ALL_PARTS;
  }
  return { roots, threads };
}

/** The root sessions a new listing files under another project than the
 * last one did (a regroup moved them). */
function refiledSessions(before: MetaState, after: MetaState): Set<string> {
  const was = new Map(
    before.sessions
      .filter((row) => row.parent_session_id === null)
      .map((row) => [row.id, row.project_id] as const),
  );
  const out = new Set<string>();
  for (const row of after.sessions) {
    if (row.parent_session_id !== null) continue;
    const previous = was.get(row.id);
    if (previous !== undefined && previous !== row.project_id) out.add(row.id);
  }
  return out;
}

export interface CatalogPortOptions {
  readonly now?: () => number;
}

/** A regroup the room has been handed (PJ-4): the key moves the pings
 * carried (`regrouped`, D9) and the sessions now filed under another key — a
 * selection on one of them is re-keyed by the host (`openAt`), since the room
 * lets go of a project id it no longer holds. */
export interface HistoryRegroup {
  readonly moves: readonly ProjectRegrouped[];
  readonly sessions: ReadonlySet<string>;
}

/** The catalog port, and what its host asks of it beyond the room. */
export interface HistoryCatalogPort extends CatalogPort {
  /** PJ-4 — after the room has been handed a regrouped listing. */
  onRegrouped(listener: (regroup: HistoryRegroup) => void): () => void;
  /** PJ-4 (H5) — Home and Temporary as the last listing read them, or null
   * before the first: what the room's sections will draw (PJ-4's second
   * half); until then both are ordinary rows. */
  sections(): HistorySections | null;
  /** Whether the History view is showing. While it is not, the catalog's
   * pings are noted and the listing is read again when it shows. */
  setActive(active: boolean): void;
  /** The index's state in the frame's words while it cannot answer, or null:
   * what the room says under "rosettad is not answering". */
  words(): string | null;
  onWordsChange(listener: () => void): () => void;
  dispose(): void;
}

export function catalogPortOver(
  client: HistoryDoorClient,
  options: CatalogPortOptions = {},
): HistoryCatalogPort {
  const now = options.now ?? (() => Date.now());
  let active = true;
  /** The index's state in words, by who said it last: fieldd's connection, the
   * status door, the listing. The first that has words is what the room says. */
  const said: Record<"connection" | "status" | "listing", string | null> = {
    connection: null,
    status: null,
    listing: null,
  };
  const currentWords = (): string | null => said.connection ?? said.status ?? said.listing;
  /** The newest topology a listing answered — for search's filters. */
  let lastMeta: MetaState | null = null;
  let lastSections: HistorySections | null = null;
  const wordsListeners = new Set<() => void>();
  const activeListeners = new Set<() => void>();
  const connectionListeners = new Set<() => void>();
  const regroupListeners = new Set<(regroup: HistoryRegroup) => void>();
  const figures = new Map<string, { at: number; answer: Promise<ProjectFiguresResult> }>();
  const feeds = new Set<{ close(): void }>();
  let disposed = false;

  const say = (slot: keyof typeof said, words: string | null): void => {
    if (said[slot] === words) return;
    const before = currentWords();
    said[slot] = words;
    if (currentWords() === before) return;
    for (const listener of [...wordsListeners]) listener();
    for (const listener of [...connectionListeners]) listener();
  };

  /** Page a whole listing at the door's own page ceiling: `project.list`
   * (every project this desktop groups), `index.sessions` (this desktop's own,
   * `scope: "local"` — H3 (a)), `index.threads` (this desktop's by
   * construction). The last page's `sources` say which desktop is this one. */
  async function listAll<T>(
    method: string,
    parse: (answer: unknown) => {
      rows: T[];
      cursor?: string | undefined;
      sources?: IndexCatalogSource[] | undefined;
    },
    params: Record<string, unknown>,
    limit: number,
  ): Promise<{ rows: T[]; sources: IndexCatalogSource[] | undefined }> {
    const rows: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < HISTORY_LISTING_MAX_PAGES; page += 1) {
      const answer = parse(
        await client.request(method, {
          ...params,
          limit,
          ...(cursor !== undefined ? { cursor } : {}),
        }),
      );
      rows.push(...answer.rows);
      cursor = answer.cursor;
      if (cursor === undefined) return { rows, sources: answer.sources };
    }
    throw new Error(`${method} answered more than ${HISTORY_LISTING_MAX_PAGES} pages`);
  }

  /** What the last read answered: the roots (the projects and this desktop's
   * sessions, with which desktop is this one) and the threads, each read again
   * only when a ping names its tables (AR-8 L1 — a root's rename does not
   * re-page every subagent this desktop ever ran). */
  let held: {
    roots: { projects: ProjectSummary[]; sessions: IndexSession[]; self: string | null } | null;
    threads: IndexThread[] | null;
  } = { roots: null, threads: null };

  async function readRoots(): Promise<{
    projects: ProjectSummary[];
    sessions: IndexSession[];
    self: string | null;
  }> {
    const [projects, sessions] = await Promise.all([
      listAll(
        "project.list",
        (answer) => ProjectListResult.parse(answer),
        {},
        PROJECT_DOORS.PAGE_MAX_LIMIT,
      ),
      listAll(
        "index.sessions",
        (answer) => IndexSessionsResult.parse(answer),
        { scope: "local" },
        INDEX_MESH.PAGE_MAX_LIMIT,
      ),
    ]);
    return {
      projects: projects.rows,
      sessions: sessions.rows,
      self: selfOf(sessions.sources) ?? selfOf(projects.sources),
    };
  }

  async function readMeta(want: MetaParts): Promise<MetaState> {
    const [roots, threads] = await Promise.all([
      want.roots || held.roots === null ? readRoots() : held.roots,
      want.threads || held.threads === null
        ? listAll(
            "index.threads",
            (answer) => IndexThreadsResult.parse(answer),
            {},
            INDEX_MESH.PAGE_MAX_LIMIT,
          ).then((answer) => answer.rows)
        : held.threads,
    ]);
    held = { roots, threads };
    const meta = metaStateOf(roots.projects, roots.sessions, threads, roots.self);
    lastSections = historySectionsOf(roots.projects, roots.sessions, roots.self, now());
    return meta;
  }

  /** One `project.figures` flight per project and window, shared by the
   * panel's figures and its usage; a failure is never kept. */
  function projectFigures(key: string, window: FigureWindow): Promise<ProjectFiguresResult> {
    const sinceMs = Math.max(0, Math.floor(window.sinceMs));
    const offsetMinutes = Math.max(-840, Math.min(840, Math.round(window.offsetMinutes)));
    const shared = `${key}\u0000${sinceMs}\u0000${offsetMinutes}`;
    const at = now();
    const held = figures.get(shared);
    if (held !== undefined && at - held.at < PROJECT_FIGURES_SHARE_MS) return held.answer;
    for (const [stale, entry] of figures) {
      if (at - entry.at >= PROJECT_FIGURES_SHARE_MS) figures.delete(stale);
    }
    const answer = client
      .request("project.figures", { key, sinceMs, offsetMinutes })
      .then((value) => ProjectFiguresResult.parse(value));
    figures.set(shared, { at, answer });
    answer.catch(() => {
      if (figures.get(shared)?.answer === answer) figures.delete(shared);
    });
    return answer;
  }

  function subscribeMeta(handlers: MetaSubscriptionHandlers): { close(): void } {
    let closed = false;
    let loaded = false;
    let status: SubscriptionStatus | null = null;
    let pending: "snapshot" | "mutation" | null = null;
    /** what the pending read must fetch again */
    let stale: MetaParts = NO_PARTS;
    let running = false;
    let noted = false;
    /** PJ-4 — the key moves heard since the room was last handed a listing */
    let moves: ProjectRegrouped[] = [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = HISTORY_RETRY_MIN_MS;
    let unsubscribe: (() => void) | null = null;

    const setStatus = (next: SubscriptionStatus): void => {
      if (closed || status === next) return;
      status = next;
      handlers.onStatus?.(next);
    };

    const retry = (ask: () => void): void => {
      if (closed || retryTimer !== null) return;
      if (!loaded) setStatus("connecting");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        ask();
      }, retryDelay);
      retryDelay = Math.min(HISTORY_RETRY_MAX_MS, retryDelay * 2);
    };

    /** A refusal said in fieldd's words; asked again when fieldd says it may
     * be answered, else the feed is closed with it. */
    const fail = (cause: unknown, ask: () => void): void => {
      say("listing", refusalWords(cause));
      // an index this desktop does not run is not one that is coming: the room
      // says "rosettad is not answering", not "Connecting to rosettad"
      const unconfigured = refusalOf(cause).details?.["state"] === "unconfigured";
      if (askAgain(cause) && !unconfigured) {
        retry(ask);
        return;
      }
      setStatus("closed");
      handlers.onError?.({ code: "internal", message: refusalWords(cause) });
    };

    /** Read the listing again: a `snapshot` (the first, and the replay after a
     * reconnect — baseline data, no promotion: every part) or a `mutation` (a
     * ping: the parts its tables name). */
    const request = (kind: "snapshot" | "mutation", parts: MetaParts = ALL_PARTS): void => {
      if (closed) return;
      pending = pending === "snapshot" || kind === "snapshot" ? "snapshot" : "mutation";
      const want = kind === "snapshot" ? ALL_PARTS : parts;
      stale = { roots: stale.roots || want.roots, threads: stale.threads || want.threads };
      if (!active && loaded) {
        noted = true;
        return;
      }
      if (running) return;
      void drain();
    };

    const drain = async (): Promise<void> => {
      running = true;
      try {
        while (pending !== null && !closed) {
          const kind = pending;
          const want = stale;
          pending = null;
          stale = NO_PARTS;
          const heard = moves;
          moves = [];
          try {
            const meta = await readMeta(want);
            if (closed) return;
            const before = lastMeta;
            lastMeta = meta;
            retryDelay = HISTORY_RETRY_MIN_MS;
            say("listing", null);
            const source = loaded ? kind : "snapshot";
            loaded = true;
            handlers.onChange?.(meta, source);
            setStatus("live");
            // PJ-4 — the room lets go of a project id it no longer holds, so
            // a regroup that re-filed sessions tells the host which, after
            // the room has the listing that files them anew
            const refiled = before === null ? new Set<string>() : refiledSessions(before, meta);
            if (heard.length > 0 || refiled.size > 0)
              for (const listener of [...regroupListeners])
                listener({ moves: heard, sessions: refiled });
          } catch (cause) {
            if (closed) return;
            // the moves are kept for the read that does land
            moves = [...heard, ...moves];
            fail(cause, () => request(kind, want));
          }
        }
      } finally {
        running = false;
      }
    };

    // PJ-4 — the projects' pings (`project.subscribe`): every catalog move on
    // any desktop and every regroup, the tables hint when only tables moved,
    // and the key moves (`regrouped`) the room's selection follows
    const onPing = (payload: unknown, kind?: "snapshot" | "delta"): void => {
      if (kind === "snapshot") {
        request("snapshot");
        return;
      }
      const delta = ProjectChangesDelta.safeParse(payload);
      if (delta.success && delta.data.regrouped !== undefined) moves.push(...delta.data.regrouped);
      request("mutation", pingParts(payload));
    };
    const openPings = (): void => {
      void client
        .subscribe("project.subscribe", {}, onPing, {
          onReplayFailed: (cause) => {
            if (closed) return;
            unsubscribe = null;
            fail(cause, openPings);
          },
        })
        .then((subscription) => {
          if (closed) {
            subscription.unsubscribe();
            return;
          }
          unsubscribe = subscription.unsubscribe;
          request("snapshot");
        })
        .catch((cause: unknown) => {
          if (!closed) fail(cause, openPings);
        });
    };

    // The connection's own state: the room hears "connecting" while fieldd is
    // away (it keeps the rows it holds), and the client's replay of the pings
    // after a reconnect reads the listing again as a fresh baseline.
    const stopConnection = client.onStatusChange?.(() => {
      if (client.status === undefined) return;
      if (client.status === "ready") {
        say("connection", null);
        return;
      }
      setStatus("connecting");
      say("connection", `Fieldd is not answering (${client.status})`);
    });
    const onActive = (): void => {
      if (active && noted) {
        noted = false;
        request(pending ?? "mutation", stale);
      }
    };
    activeListeners.add(onActive);

    setStatus("connecting");
    openPings();

    const feed = {
      close() {
        if (closed) return;
        closed = true;
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
        unsubscribe?.();
        unsubscribe = null;
        stopConnection?.();
        activeListeners.delete(onActive);
        feeds.delete(feed);
      },
    };
    feeds.add(feed);
    return feed;
  }

  return {
    subscribeMeta,

    async status(signal) {
      let status: IndexStatus;
      try {
        status = IndexStatus.parse(await withSignal(client.request("index.status", {}), signal));
      } catch (cause) {
        if (signal?.aborted !== true)
          say("status", `Fieldd is not answering — ${refusalWords(cause)}`);
        throw cause;
      }
      const answer = catalogStatusOf(status);
      if (answer === null) {
        const words = statusWords(status);
        say("status", words);
        throw new Error(words);
      }
      say("status", null);
      return answer;
    },

    onConnectionChange(listener) {
      connectionListeners.add(listener);
      const stop = client.onStatusChange?.(listener);
      return () => {
        connectionListeners.delete(listener);
        stop?.();
      };
    },

    unavailable: currentWords,

    // PJ-4 (H2) — the room's project id IS the PJ key: its figures are the
    // project's merged ones, every desktop and rosetta project it holds
    async projectStats(key, window, signal) {
      return projectStatsOf(await withSignal(projectFigures(key, window), signal));
    },

    async usage(key, window, signal) {
      return usageOf(await withSignal(projectFigures(key, window), signal));
    },

    async dayUsage(key, day, offsetMinutes, signal) {
      return dayUsageOf(
        ProjectFiguresDayResult.parse(
          await withSignal(
            client.request("project.figuresDay", {
              key,
              day,
              offsetMinutes: Math.max(-840, Math.min(840, Math.round(offsetMinutes))),
            }),
            signal,
          ),
        ),
      );
    },

    async search(request: CatalogSearch, signal): Promise<SearchResponse> {
      const q = request.q.trim();
      const result = IndexSearchResult.parse(
        await withSignal(
          client.request("index.search", {
            q: q.slice(0, 512),
            limit: Math.max(1, Math.min(INDEX_MESH.PAGE_MAX_LIMIT, request.limit)),
            ...(request.kind === "user" || request.kind === "agent" ? { kind: request.kind } : {}),
          }),
          signal,
        ),
      );
      // Unanswered, never "no matches": the room keeps what it showed.
      if (!result.answered) {
        throw new Error(result.state.detail ?? "The agent index had no answer");
      }
      // The door filters by words and side; the project and the agent are the
      // catalog's facts about each hit's root, read from the listing.
      const rows = new Map((lastMeta?.sessions ?? []).map((row) => [row.id, row]));
      const hits: SearchHit[] = [];
      for (const hit of result.hits) {
        const root = rows.get(hit.rootSessionId ?? hit.sessionId);
        if (request.project !== null && root?.project_id !== request.project) continue;
        if (request.agent !== null && root?.runtime_id !== request.agent) continue;
        hits.push({
          timeline_id: hit.timelineId,
          session_id: hit.sessionId,
          kind: hit.kind,
          at: hit.at ?? null,
          snippet: hit.snippet,
          score: 0,
        });
      }
      const readiness = result.state.readiness;
      return {
        state: {
          readiness: SEARCH_READINESS.has(readiness) ? (readiness as SearchReadiness) : "building",
          progress: null,
          projection_epoch: null,
          revision: null,
        },
        hits,
      };
    },

    setActive(next) {
      if (active === next) return;
      active = next;
      for (const listener of [...activeListeners]) listener();
    },

    onRegrouped(listener) {
      regroupListeners.add(listener);
      return () => {
        regroupListeners.delete(listener);
      };
    },

    sections: () => lastSections,

    words: currentWords,

    onWordsChange(listener) {
      wordsListeners.add(listener);
      return () => {
        wordsListeners.delete(listener);
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const feed of [...feeds]) feed.close();
      wordsListeners.clear();
      connectionListeners.clear();
      regroupListeners.clear();
      figures.clear();
    },
  };
}

/* ── the host port ──────────────────────────────────────────────────────── */

/** What the room asks a desktop, answered honestly for this one: the platform
 * from the preload; the home directory from the window's bootstrap (AR-8 L2 —
 * the room writes a path under it as `~/…`, and every path in full when it is
 * null: a browser or catalog harness); no "open in browser" (no file door on
 * the desktop yet); no site icons (the room draws its globe). The worktree
 * guest is `historyPortsOver`'s to add.
 *
 * *Corrected 2026-10-08 (AR-8, build-hf.md §2):* slice 1 said "no home
 * directory (fieldd tells the renderer only home-abbreviated paths, so the
 * room shows full ones)". False: the catalog carries rosetta's ABSOLUTE
 * `root_paths` and `cwd` (fieldd `index-catalog.ts`, `#projectRow` and
 * `#sessionRow`), so the room showed every path in full for want of a home,
 * not by design. It also said the worktree guest stays ABSENT until AR-8d —
 * FS-1b hands the room the files service's `WorkspaceClient` as its guest. */
export function hostPortOver(platform: string | null, homeDir: string | null): HostPort {
  return {
    homeDir,
    platform,
    openInBrowser: async () => false,
    favicon: async () => null,
  };
}

/* ── the four, together ─────────────────────────────────────────────────── */

export interface HistoryPorts extends RoomPorts {
  readonly catalog: HistoryCatalogPort;
  readonly sessions: HistorySessionPort;
  readonly assets: HistoryAssetSource;
  readonly host: HostPort;
  /** Let go of every lease, URL and feed (the view unmounting). */
  dispose(): void;
}

export interface HistoryPortsOptions {
  readonly platform: string | null;
  /** The OS user's home, as the window's bootstrap states it
   * (`terminalBootstrapHome()`); absent or null when the window has none. */
  readonly home?: string | null;
  readonly catalog?: CatalogPortOptions;
  readonly sessions?: SessionPortOptions;
  readonly assets?: AssetSourceOptions;
  readonly workspace?: WorkspaceClientOptions;
}

/** The room's ports over one fieldd client. */
export function historyPortsOver(
  client: HistoryDoorClient,
  options: HistoryPortsOptions,
): HistoryPorts {
  const catalog = catalogPortOver(client, options.catalog);
  const sessions = sessionPortOver(client, options.sessions);
  const assets = assetSourceOver(sessions, options.assets);
  const workspace = new WorkspaceClient(client, options.workspace);
  return {
    catalog,
    sessions,
    assets,
    host: { ...hostPortOver(options.platform, options.home ?? null), worktree: workspace },
    dispose() {
      workspace.dispose();
      catalog.dispose();
      assets.dispose();
      sessions.dispose();
    },
  };
}
