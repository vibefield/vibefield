import type {
  MonitorHistoryPort,
  MonitorRecordedActivity,
  MonitorRecordedRun,
  MonitorRecordedSession,
} from "@vibecook/puppeteer-monitor";
import {
  type AgentCatalogReaders,
  INDEX_ACTIVITY,
  type IndexActivityResult,
  type IndexActivitySession,
  type IndexCatalogSession,
} from "@vibefield/contracts";
import type { IndexCatalog, IndexCatalogPhase } from "./index-catalog";
import { RpcCallError } from "./native-link";

// TL (docket v9, RULED 2026-10-09) — the record's sessions and turns in a
// window, for Godview's timeline: `index.activity`'s reader, and the monitor
// backend's history port over it (B-D6 (a): the backend joins and derives;
// fieldd only reads and translates).
//
// ONLY ROSETTA READS TRANSCRIPTS (the 10-03 law). This reader never pages
// `index.timeline` to build spans. It asks rosettad's own route (T4,
// `/api/activity`, protocol 27): every top-level session active in the window
// with its tree's turns and the silences inside them, which rosetta computes
// from its own message table — `fidelity: "turns"`. When the route cannot
// answer (the daemon is not ready, or an older one has no route) it answers
// from what fieldd already holds: the catalog's sessions, each with its
// recorded bounds (`activity {firstAt, lastAt}`), which is T5's floor —
// `fidelity: "bounds"`, one band per ended run — and says `partial`.
//
// The catalog's tables are this desktop's own sessions, top-level only (a
// delegated thread is transcript structure), kept across a lost stream
// (DS-L8): a stream that is down answers the last snapshot and says `partial`.
// A catalog that has not read the index this boot refuses UNAVAILABLE, never an
// empty day a reader would draw as "nothing happened".

/** What `index.activity` and the history port ask. */
export interface ActivityAsk {
  readonly sinceMs: number;
  readonly untilMs: number;
  /** rosetta's canonical ids to narrow to */
  readonly sessions?: readonly string[] | undefined;
  /** the cut for a turn's silences (the route's; the floor reads none) */
  readonly silenceMs?: number | undefined;
}

export interface ActivityReader {
  read(ask: ActivityAsk): Promise<IndexActivityResult>;
}

/** The catalog's phase as a person would hear it: why the past cannot be read. */
export function activityUnreadWords(phase: IndexCatalogPhase | string): string {
  switch (phase) {
    case "unconfigured":
      return "No agent index runs on this desktop";
    case "waiting":
    case "connecting":
      return "The agent index is starting";
    case "refused":
    case "incompatible":
      return "The agent index cannot be read";
    default:
      return "The agent index is not answering";
  }
}

function touches(row: IndexCatalogSession, ask: ActivityAsk): boolean {
  const activity = row.activity;
  return activity !== null && activity.lastAt >= ask.sinceMs && activity.firstAt <= ask.untilMs;
}

function projectSession(row: IndexCatalogSession): IndexActivitySession {
  return {
    sessionId: row.sessionId,
    nativeSessionId: row.nativeSessionId,
    ...(row.kind !== undefined ? { kind: row.kind } : {}),
    ...(row.provider !== undefined ? { provider: row.provider } : {}),
    ...(row.projectId !== undefined ? { projectId: row.projectId } : {}),
    ...(row.cwd !== undefined ? { cwd: row.cwd } : {}),
    ...(row.title !== undefined ? { title: row.title } : {}),
    ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
    activity:
      row.activity === null ? null : { firstAt: row.activity.firstAt, lastAt: row.activity.lastAt },
  };
}

/** T5's floor: the catalog's sessions whose recorded bounds touch the window,
 * newest activity first. */
export function activityFromCatalog(
  catalog: Pick<IndexCatalog, "ready" | "phase" | "sessions">,
  ask: ActivityAsk,
): IndexActivityResult {
  if (!catalog.ready)
    throw new RpcCallError("UNAVAILABLE", activityUnreadWords(catalog.phase), true, {
      service: "index",
      state: catalog.phase,
    });
  const wanted = ask.sessions === undefined ? undefined : new Set(ask.sessions);
  const sessions = catalog.sessions
    .rows()
    .filter((row) => (wanted === undefined || wanted.has(row.sessionId)) && touches(row, ask))
    .sort((a, b) => (b.activity?.lastAt ?? 0) - (a.activity?.lastAt ?? 0))
    .map(projectSession);
  // the tables outlive a lost stream (DS-L8): the last snapshot, said so
  const stale = catalog.phase !== "live";
  return {
    sinceMs: ask.sinceMs,
    untilMs: ask.untilMs,
    fidelity: "bounds",
    partial: stale,
    ...(stale
      ? { detail: "The agent index's stream is down; these are the sessions it last listed." }
      : {}),
    sessions,
  };
}

/** The route's reader as this module asks it (`IndexService.activity`). */
export interface ActivityRoute {
  activity(params: {
    sinceMs: number;
    untilMs: number;
    sessions?: readonly string[] | undefined;
    silenceMs: number;
  }): Promise<IndexActivityResult>;
}

export function createActivityReader(opts: {
  catalog: Pick<IndexCatalog, "ready" | "phase" | "sessions">;
  /** rosettad's route; absent: the floor alone */
  route?: ActivityRoute | undefined;
}): ActivityReader {
  return {
    async read(ask) {
      const route = opts.route;
      if (route === undefined) return activityFromCatalog(opts.catalog, ask);
      try {
        return await route.activity({
          sinceMs: ask.sinceMs,
          untilMs: ask.untilMs,
          ...(ask.sessions !== undefined ? { sessions: ask.sessions } : {}),
          silenceMs: ask.silenceMs ?? INDEX_ACTIVITY.SILENCE_MS,
        });
      } catch (error) {
        // the turns could not be read: the catalog's bounds stand in, said so
        // (and a catalog that has not read the index refuses in its own turn)
        if (
          !(error instanceof RpcCallError) ||
          (error.kind !== "UNAVAILABLE" && error.kind !== "NOT_FOUND")
        )
          throw error;
        const floor = activityFromCatalog(opts.catalog, ask);
        return {
          ...floor,
          partial: true,
          detail: "The agent index's turns could not be read; these are its sessions' bounds.",
        };
      }
    },
  };
}

/** `index.activity`'s answer cut for a tailnet caller (SP-D13): the newest
 * `limit` sessions, `clipped` saying so. A window's answer is whole. */
export function clipActivity(
  result: IndexActivityResult,
  limit: number | undefined,
): IndexActivityResult {
  if (limit === undefined) return result;
  const clipped = result.sessions.length > limit;
  return {
    ...result,
    sessions: clipped ? result.sessions.slice(0, limit) : result.sessions,
    clipped,
  };
}

/** One session as the backend's port reads it; undefined for a session the
 * backend cannot draw — no catalog row maps its agent (the catalog decides
 * support, AC), or nothing was recorded. */
function recordedSession(
  session: IndexActivitySession,
  catalog: Pick<AgentCatalogReaders, "entry">,
): MonitorRecordedSession | undefined {
  if (session.provider === undefined || session.activity === null) return undefined;
  const label = catalog.entry(session.provider)?.label ?? session.provider;
  return {
    // the catalog id IS puppeteer's provider id (AC-D2): the join's first half
    provider: { id: session.provider, label },
    nativeSessionId: session.nativeSessionId,
    ...(session.startedAt !== undefined ? { startedAt: session.startedAt } : {}),
    firstAt: session.activity.firstAt,
    lastAt: session.activity.lastAt,
    // a live run is keyed by its workspace's root, the record's session by its
    // own cwd: the same folder for a run VibeField launched there
    ...(session.cwd !== undefined && session.cwd !== "" ? { projectKey: session.cwd } : {}),
    ...(session.title !== undefined && session.title !== "" ? { title: session.title } : {}),
    ...(session.turns !== undefined
      ? {
          turns: session.turns.map((turn) => ({
            firstAt: turn.firstAt,
            lastAt: turn.lastAt,
            ...(turn.silences !== undefined
              ? { silences: turn.silences.map((s) => ({ from: s.fromMs, to: s.toMs })) }
              : {}),
          })),
        }
      : {}),
  };
}

/** One run this runtime ran, as the host's records keep it (`AgentRuntimeService.recordedRuns`). */
export interface HostRecordedRun {
  /** the catalog id (= puppeteer's provider id) */
  provider: string;
  nativeSessionId: string;
  runtimeRunId: string;
  createdAt?: number | undefined;
  profileSet?: string | undefined;
  projectKey?: string | undefined;
  title?: string | undefined;
}

/** The monitor backend's history port over the reader and this runtime's run
 * records: the record's answer in the port's words, beside the runs the
 * backend may join it to (TIMELINE SHAPES v2 item 7 — only those are lanes), and
 * a refusal as a person's sentence (the past's `unavailable`). Fast by
 * construction: a daemon or a catalog that is not up refuses at once. */
export function monitorHistoryPort(
  reader: ActivityReader,
  catalog: Pick<AgentCatalogReaders, "entry">,
  runs: () => readonly HostRecordedRun[],
): MonitorHistoryPort {
  return {
    async read(window, options) {
      let result: IndexActivityResult;
      try {
        result = await reader.read({
          sinceMs: window.sinceMs,
          untilMs: window.untilMs,
          silenceMs: Math.min(
            INDEX_ACTIVITY.MAX_SILENCE_MS,
            Math.max(INDEX_ACTIVITY.MIN_SILENCE_MS, options.silenceMs),
          ),
        });
      } catch (error) {
        if (error instanceof RpcCallError && error.kind === "UNAVAILABLE") {
          const state = (error.details as { state?: unknown } | undefined)?.state;
          throw new Error(activityUnreadWords(typeof state === "string" ? state : ""));
        }
        throw error;
      }
      const sessions: MonitorRecordedSession[] = [];
      for (const session of result.sessions) {
        const recorded = recordedSession(session, catalog);
        if (recorded !== undefined) sessions.push(recorded);
      }
      // only the runs a session of this answer could be: the join needs no more
      const wanted = new Set(sessions.map((session) => session.nativeSessionId));
      const ours: MonitorRecordedRun[] = runs()
        .filter((run) => wanted.has(run.nativeSessionId))
        .map((run) => ({
          provider: { id: run.provider, label: catalog.entry(run.provider)?.label ?? run.provider },
          nativeSessionId: run.nativeSessionId,
          runtimeRunId: run.runtimeRunId,
          ...(run.createdAt !== undefined ? { createdAt: run.createdAt } : {}),
          ...(run.profileSet !== undefined ? { profileSet: run.profileSet } : {}),
          ...(run.projectKey !== undefined ? { projectKey: run.projectKey } : {}),
          ...(run.title !== undefined ? { title: run.title } : {}),
        }));
      const activity: MonitorRecordedActivity = {
        fidelity: result.fidelity,
        partial: result.partial,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
        sessions,
        runs: ours,
      };
      return activity;
    },
  };
}
