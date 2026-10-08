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
  type IndexCatalogProject,
  IndexProjectDayResult,
  IndexProjectResult,
  IndexProjectsResult,
  IndexSearchResult,
  type IndexSession,
  IndexSessionsResult,
  IndexStatus,
  type IndexThread,
  type IndexThreadDelegation,
  IndexThreadsResult,
} from "@vibefield/contracts";
import { WorkspaceClient, type WorkspaceClientOptions } from "../workspace/client";
import { type AssetSourceOptions, assetSourceOver, type HistoryAssetSource } from "./asset-source";
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
/** How long one `index.project` answer serves both of the room's asks for the
 * same window — the panel's figures and its usage are ONE door (AR-D39 (a)). */
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

/** One project of the catalog (DS-6's row) as rosetta's `ProjectRow`. */
export function projectRowOf(row: IndexCatalogProject): ProjectRow {
  return {
    id: row.projectId,
    name: row.name,
    root_paths: [...row.rootPaths],
    git_repo: row.gitRepo ?? null,
  };
}

/** One top-level session of the catalog's listing as rosetta's `SessionRow`.
 * The listing holds ROOTS only — a delegated child arrives through
 * `index.threads` (`threadRowOf`) — so every row is its own root, `main`, with
 * no parent and no delegation; a column the listing does not carry is the
 * honest null (`summary`, `cwd`, …) or, where rosetta's row requires a number,
 * the nearest fact the catalog does carry: a session's start is its first
 * recorded activity when the catalog has no start, and its freshness its last. */
export function sessionRowOf(row: IndexSession): SessionRow {
  return roomRowOf(row, {
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
 * by. A colour outside rosetta's eight is no colour. */
export function threadRowOf(row: IndexThread): SessionRow {
  return roomRowOf(row, {
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

/** The columns a root and a thread share, and where the row hangs. */
function roomRowOf(
  row: IndexSession | IndexThread,
  place: Pick<SessionRow, "parent_session_id" | "delegation" | "root_session_id" | "role">,
): SessionRow {
  const startedAt = row.startedAt ?? row.activity?.firstAt ?? row.updatedAt ?? 0;
  return {
    id: row.sessionId,
    native_session_id: row.nativeSessionId,
    runtime_id: runtimeKindOf(row.provider),
    project_id: row.projectId ?? null,
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
 * kind the sessions are filed under (see `runtimeKindOf`). */
export function metaStateOf(
  projects: readonly IndexCatalogProject[],
  sessions: readonly IndexSession[],
  threads: readonly IndexThread[] = [],
): MetaState {
  const sessionRows = [...sessions.map(sessionRowOf), ...threads.map(threadRowOf)];
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
    projects: projects.map(projectRowOf),
    sessions: sessionRows,
  };
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

/** `index.project`'s heatmap and contribution: the room's `projectStats`. */
export function projectStatsOf(result: IndexProjectResult): ProjectStats {
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

/** `index.project`'s usage: the room's `usage`. */
export function usageOf(result: IndexProjectResult): UsageResponse {
  return {
    models: result.usage.models.map(
      (row): ModelDay => ({ day: row.day, model: row.model, ...figures(row) }),
    ),
    hours: result.usage.hours.map((row): HourTotal => ({ hour: row.hour, ...figures(row) })),
  };
}

/** `index.projectDay`: the room's `dayUsage`. */
export function dayUsageOf(result: IndexProjectDayResult): DayUsageResponse {
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

/** The two parts of the room's meta a read fetches: the roots (`index.projects`
 * + `index.sessions`) and the delegated threads (`index.threads`). */
interface MetaParts {
  readonly roots: boolean;
  readonly threads: boolean;
}
const ALL_PARTS: MetaParts = { roots: true, threads: true };
const NO_PARTS: MetaParts = { roots: false, threads: false };

/** The parts a change ping says moved, read from its `tables` hint (AR-8 L1):
 * a ping that names no table — a phase moved — or one this build does not know
 * moves both. */
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

export interface CatalogPortOptions {
  readonly now?: () => number;
}

/** The catalog port, and what its host asks of it beyond the room. */
export interface HistoryCatalogPort extends CatalogPort {
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
  const wordsListeners = new Set<() => void>();
  const activeListeners = new Set<() => void>();
  const connectionListeners = new Set<() => void>();
  const figures = new Map<string, { at: number; answer: Promise<IndexProjectResult> }>();
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

  /** Page a whole listing (`index.projects` or `index.sessions`), this
   * desktop's own (`scope: "local"`, one desktop first — PJ's grouping is the
   * second slice), at the door's own page ceiling. `index.threads` is this
   * desktop's by construction and is asked with no scope. */
  async function listAll<T>(
    method: string,
    parse: (answer: unknown) => { rows: T[]; cursor?: string | undefined },
    scope: { scope?: "local" } = { scope: "local" },
  ): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < HISTORY_LISTING_MAX_PAGES; page += 1) {
      const answer = parse(
        await client.request(method, {
          ...scope,
          limit: INDEX_MESH.PAGE_MAX_LIMIT,
          ...(cursor !== undefined ? { cursor } : {}),
        }),
      );
      rows.push(...answer.rows);
      cursor = answer.cursor;
      if (cursor === undefined) return rows;
    }
    throw new Error(`${method} answered more than ${HISTORY_LISTING_MAX_PAGES} pages`);
  }

  /** What the last read answered: the roots (both listings) and the threads,
   * each read again only when a ping names its tables (AR-8 L1 — a root's
   * rename does not re-page every subagent this desktop ever ran). */
  let held: {
    roots: { projects: IndexCatalogProject[]; sessions: IndexSession[] } | null;
    threads: IndexThread[] | null;
  } = { roots: null, threads: null };

  async function readRoots(): Promise<{
    projects: IndexCatalogProject[];
    sessions: IndexSession[];
  }> {
    const [projects, sessions] = await Promise.all([
      listAll("index.projects", (answer) => IndexProjectsResult.parse(answer)),
      listAll("index.sessions", (answer) => IndexSessionsResult.parse(answer)),
    ]);
    return { projects, sessions };
  }

  async function readMeta(want: MetaParts): Promise<MetaState> {
    const [roots, threads] = await Promise.all([
      want.roots || held.roots === null ? readRoots() : held.roots,
      want.threads || held.threads === null
        ? listAll("index.threads", (answer) => IndexThreadsResult.parse(answer), {})
        : held.threads,
    ]);
    held = { roots, threads };
    return metaStateOf(roots.projects, roots.sessions, threads);
  }

  /** One `index.project` flight per project and window, shared by the panel's
   * figures and its usage; a failure is never kept. */
  function projectFigures(projectId: string, window: FigureWindow): Promise<IndexProjectResult> {
    const sinceMs = Math.max(0, Math.floor(window.sinceMs));
    const offsetMinutes = Math.max(-840, Math.min(840, Math.round(window.offsetMinutes)));
    const key = `${projectId}\u0000${sinceMs}\u0000${offsetMinutes}`;
    const at = now();
    const held = figures.get(key);
    if (held !== undefined && at - held.at < PROJECT_FIGURES_SHARE_MS) return held.answer;
    for (const [stale, entry] of figures) {
      if (at - entry.at >= PROJECT_FIGURES_SHARE_MS) figures.delete(stale);
    }
    const answer = client
      .request("index.project", { projectId, sinceMs, offsetMinutes })
      .then((value) => IndexProjectResult.parse(value));
    figures.set(key, { at, answer });
    answer.catch(() => {
      if (figures.get(key)?.answer === answer) figures.delete(key);
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
          try {
            const meta = await readMeta(want);
            if (closed) return;
            lastMeta = meta;
            retryDelay = HISTORY_RETRY_MIN_MS;
            say("listing", null);
            const source = loaded ? kind : "snapshot";
            loaded = true;
            handlers.onChange?.(meta, source);
            setStatus("live");
          } catch (cause) {
            if (closed) return;
            fail(cause, () => request(kind, want));
          }
        }
      } finally {
        running = false;
      }
    };

    const openPings = (): void => {
      void client
        .subscribe(
          "index.changes.subscribe",
          { scope: "local" },
          (payload, kind) =>
            kind === "snapshot" ? request("snapshot") : request("mutation", pingParts(payload)),
          {
            onReplayFailed: (cause) => {
              if (closed) return;
              unsubscribe = null;
              fail(cause, openPings);
            },
          },
        )
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

    async projectStats(projectId, window, signal) {
      return projectStatsOf(await withSignal(projectFigures(projectId, window), signal));
    },

    async usage(projectId, window, signal) {
      return usageOf(await withSignal(projectFigures(projectId, window), signal));
    },

    async dayUsage(projectId, day, offsetMinutes, signal) {
      return dayUsageOf(
        IndexProjectDayResult.parse(
          await withSignal(
            client.request("index.projectDay", {
              projectId,
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
