import type { IndexSession, ProjectSummary } from "@vibefield/contracts";

// PJ-4 — THE DATA FOR H5 (James, 2026-10-09: "Home is a row, and Temporary is
// one folded row at the foot ('Temporary · 6'), with sessions older than 14
// days behind 'Show older'"; J11, PJ-L4). fieldd groups them — each desktop's
// Home is a project of its own (`kind: "home"` on one desktop), Temporary the
// only bucket (`bucket: "temp"`) — and History computes what its list draws of
// them: which rows are Homes, and which of Temporary's sessions show and which
// wait behind "Show older" (PJ-L4's 14 days are the surface's rule, pj1a M2).
//
// The room has no sections yet (PJ-4's second half, the room's R3): until it
// does, each Home and Temporary are ordinary rows in its list, Temporary with
// every one of its sessions, and this is the model they will be drawn from.

/** How long a Temporary session stays in view (PJ-L4). */
export const TEMPORARY_RECENT_MS = 14 * 24 * 60 * 60 * 1000;

export interface HistorySections {
  /** each desktop's Home (J11), as listed — this desktop's only, while
   * History is this desktop's (H3 (a)) */
  readonly home: ReadonlyArray<{ readonly key: string; readonly device: string }>;
  /** Temporary, one folded row at the foot: its key, the sessions that show
   * ("Temporary · n", the newest first) and those older than 14 days, behind
   * "Show older" — or null when this desktop has no Temporary place */
  readonly temporary: {
    readonly key: string;
    readonly recent: readonly string[];
    readonly older: readonly string[];
  } | null;
}

/** A session's last word, as the room orders it: its last recorded activity,
 * else its source's freshness, else its start. */
function lastAt(session: IndexSession): number | undefined {
  return session.activity?.lastAt ?? session.updatedAt ?? session.startedAt;
}

/** H5's model over the listing History read: the projects fieldd grouped and
 * THIS desktop's sessions (`self`; none known, nothing is said). A session
 * with no time to read is older than any window, so it waits behind "Show
 * older" — never shown as recent on a guess. */
export function historySectionsOf(
  projects: readonly ProjectSummary[],
  sessions: readonly IndexSession[],
  self: string | null,
  now: number,
): HistorySections {
  if (self === null) return { home: [], temporary: null };
  const here = (project: ProjectSummary): boolean =>
    project.places.some((place) => place.ref.device === self);
  const home = projects
    .filter((project) => project.kind === "home" && here(project))
    .map((project) => ({ key: project.key, device: self }));
  const bucket = projects.find((project) => project.bucket === "temp" && here(project));
  if (bucket === undefined) return { home, temporary: null };
  const mine = sessions
    .filter(
      (session) =>
        session.projectKey === bucket.key &&
        (session.device === undefined || session.device === self),
    )
    .map((session) => ({ id: session.sessionId, at: lastAt(session) }))
    .sort((a, b) => (b.at ?? Number.NEGATIVE_INFINITY) - (a.at ?? Number.NEGATIVE_INFINITY));
  const since = now - TEMPORARY_RECENT_MS;
  return {
    home,
    temporary: {
      key: bucket.key,
      recent: mine.filter((s) => s.at !== undefined && s.at >= since).map((s) => s.id),
      older: mine.filter((s) => s.at === undefined || s.at < since).map((s) => s.id),
    },
  };
}
