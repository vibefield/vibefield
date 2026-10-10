import type {
  MonitorHistoryPort,
  MonitorRecordedActivity,
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
// `index.timeline` to build spans. It answers from what fieldd already holds:
// the catalog's sessions, each with its recorded bounds (`activity {firstAt,
// lastAt}`), which is T5's floor — `fidelity: "bounds"`, one band per ended
// run. rosettad's turns (T4, its `/api/activity` route) join at the rosetta
// pin that carries the route.
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

export function createActivityReader(opts: {
  catalog: Pick<IndexCatalog, "ready" | "phase" | "sessions">;
}): ActivityReader {
  return {
    read: async (ask) => activityFromCatalog(opts.catalog, ask),
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

/** The monitor backend's history port over the reader: the record's answer in
 * the port's words, and a refusal as a person's sentence (the past's
 * `unavailable`). */
export function monitorHistoryPort(
  reader: ActivityReader,
  catalog: Pick<AgentCatalogReaders, "entry">,
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
      const activity: MonitorRecordedActivity = {
        fidelity: result.fidelity,
        partial: result.partial,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
        sessions,
      };
      return activity;
    },
  };
}
