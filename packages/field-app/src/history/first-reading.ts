import { type IndexRuntimeBackfill, IndexStatus } from "@vibefield/contracts/agent-index";
import { useSubscription } from "@vibefield/fieldd-client/react";
import { useMemo } from "react";

// History's first reading, as the desk tells it (track AO, AO-4b; DESIGN.md §6
// "the arc", §8 "The Setup Assistant's agent chapter"). The room draws the
// reading itself from its own reads; outside History two places say it is
// under way — the views track's History cell (the arc) and Setting up's History
// line — and both hear `index.status` pushed (`index.status.subscribe`), never
// polled at the room's pace. The rules here are the room's own, read off the
// same status (`history/doors.ts` `catalogStatusOf` folds it for the room; this
// module is boot-reachable, so it reads the leaf contract instead).

/** The status as pushed: undefined while the first frame is coming, null when
 * the push cannot be had (a refusal, an older daemon) — never a guess. */
export function useIndexStatus(): IndexStatus | null | undefined {
  const feed = useSubscription<unknown>("index.status.subscribe");
  return useMemo(() => {
    if (feed.data === null) return feed.status === "loading" ? undefined : null;
    const parsed = IndexStatus.safeParse(feed.data);
    return parsed.success ? parsed.data : null;
  }, [feed]);
}

const ROOM_READINESS: ReadonlySet<string> = new Set([
  "ready",
  "building",
  "catching-up",
  "stale",
  "failed",
]);

/** Whether History is importing as its room says it: the first-run panel is up
 * and still at work (reading, organizing, publishing, or preparing search once
 * the archive is browsable). Not while it waits for consent or is paused, not
 * once the archive is ready or search needs attention, and not for the routine
 * catch-up after an import, which the room keeps its panel closed for too. */
export function historyImporting(status: IndexStatus | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  switch (status.phase) {
    case "discovering":
    case "backfilling":
    case "restoring":
    case "finalizing":
    case "publishing":
      return true;
    case "live": {
      // `catalogStatusOf`'s folds: a canonical projection is assumed of a live
      // index that does not say, and an unheard-of readiness reads as building
      const canonical = status.search?.canonicalReady ?? true;
      const said = status.search?.readiness;
      const readiness = said !== undefined && ROOM_READINESS.has(said) ? said : "building";
      const stage = status.search?.progress?.stage;
      const progress = stage !== undefined && stage !== "unknown";
      if (readiness === "failed") return false;
      if (canonical && readiness === "ready") return false;
      if (canonical && !progress && (readiness === "catching-up" || readiness === "stale"))
        return false;
      return true;
    }
    default:
      return false;
  }
}

/** One agent's skim has landed. rosetta returns a skimmed runtime to `queued`
 * until it streams (`health.rs`, `ingest_skim_done`), with its counts frozen, so
 * a queued runtime is skimmed once its count has landed — or had nothing to
 * skim. A state this build has never heard of is not believed to be past it. */
function skimmed(backfill: IndexRuntimeBackfill): boolean {
  switch (backfill.state) {
    case "queued":
      return backfill.filesSkimmed >= backfill.filesTotal || backfill.sessionsTotal > 0;
    case "streaming":
    case "preparing":
    case "applying":
    case "done":
      return true;
    default:
      return false;
  }
}

/** Whether History's first pass is done: every brought-in agent skimmed, so
 * every session is listed (the room's step 1). Setting up waits for it. */
export function firstPassDone(status: IndexStatus): boolean {
  switch (status.phase) {
    case "metadata_ready":
    case "finalizing":
    case "publishing":
    case "live":
      return true;
    case "backfilling":
    case "restoring": {
      const reading = status.runtimes.filter((runtime) => runtime.watched);
      return (
        reading.length > 0 &&
        reading.every((runtime) => runtime.backfill !== undefined && skimmed(runtime.backfill))
      );
    }
    default:
      return false;
  }
}

/** What the first pass has found: the sessions every brought-in agent listed,
 * the files checked so far, and the projects History will show them in (null
 * until the fold has settled — the count is then said without them). */
export function firstPassCounts(status: IndexStatus): {
  readonly files: number;
  readonly sessions: number;
  readonly projects: number | null;
} {
  let files = 0;
  let sessions = 0;
  for (const runtime of status.runtimes) {
    if (!runtime.watched || runtime.backfill === undefined) continue;
    files += runtime.backfill.filesSkimmed;
    sessions += runtime.backfill.sessionsTotal;
  }
  const keyed = status.projects?.filter((row) => row.key !== null).length ?? 0;
  return { files, sessions, projects: keyed > 0 ? keyed : null };
}

/** Whether this person brought any history in: the record consents to a kind
 * or files a persona's root. */
export function historyBroughtIn(status: IndexStatus): boolean {
  return status.enrollment.enabledKinds.length > 0 || status.enrollment.runtimes.length > 0;
}
