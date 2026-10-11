import type { MonitorEndedRow } from "@vibecook/puppeteer-view-sdk/model";
import { type StatusNotice, sayStatus } from "../../frame/status-line";
import { getActiveView, requestView } from "../../frame/view-state";
import { openHistoryAt } from "../../history/open-at";
import { getRendererLogger } from "../../logging";

// TV-8 (RULED 2026-10-11) — AN ENDED LANE OPENS ITS SESSION IN HISTORY: the
// host's half. A view names the lane by its `past:` id (`MonitorEndedRow.id`),
// and History opens by ROSETTA's session id, which the lane does not carry. So
// this asks the index which session the lane's native id is (`index.sessions`'
// lookup, through the door the past was read by) and opens History there as
// the Peek's past pick does (`FramePeek.openPast`): the place, then the view.
//
// A module store beside the hook (find-door.ts's shape, for the same reason):
// `useMonitorHistory` lends here what it lends the view — the same ended
// lanes, and its door — and `openEndedLane` reads that at the moment it is
// called. So it is ONE function for the window's life: a view's commands hold
// it across every re-read of the past, and nothing rebuilds for it.
//
// Honest states: a pick that cannot open is SAID on the status line (DESIGN.md
// §8 "The status line"), each sentence once, in the Peek's pattern for a pick
// that could not be shown ("Could not jump — ‹why›") — and logged.

/** One of the index's rows for a native session id, as an opening reads it
 * (`IndexSession`'s join columns). */
export interface RecordedSessionRow {
  /** rosetta's canonical session id: what History opens by */
  readonly sessionId: string;
  readonly nativeSessionId: string;
  /** `== sessionId` for a top-level session; a delegated child names its root */
  readonly rootSessionId: string;
  /** the catalog's id for what ran it; a lookup's rows leave it out today */
  readonly provider?: string | undefined;
}

/** The index's lookup, as an opening asks it. A refusal propagates. */
export interface RecordedSessionsPort {
  sessions(nativeSessionIds: readonly string[]): Promise<readonly RecordedSessionRow[]>;
}

/** What the past's hook lends an opening: the ended lanes the view is drawing
 * now, and the door to ask about one. */
export interface EndedLanesLent {
  readonly ended: readonly MonitorEndedRow[];
  readonly port: RecordedSessionsPort;
}

/** `MonitorEndedRow.id` is `past:<provider id>:<native session id>` (the view
 * SDK's contract; minted by the backend). */
const ENDED_LANE_PREFIX = "past:";

const SAYS = {
  /** the timeline does not lend this lane now: it left the day, or the past did */
  gone: "Could not open — this run is no longer in the timeline",
  /** the index's door refused the lookup */
  unread: "Could not open — the record cannot be read now",
  /** the index holds no session for the lane's native id, or the lane names none */
  unrecorded: "Could not open — no session is recorded for this run",
} as const;
type Refusal = keyof typeof SAYS;

let lent: EndedLanesLent | null = null;
/** the asks, numbered: only the newest pick's answer lands */
let asked = 0;
/** the lane whose ask is in flight */
let asking: string | null = null;

/** The hook's side: lend what the view is lent. Answers the withdrawal, which
 * takes back only what this call lent. */
export function lendEndedLanes(next: EndedLanesLent): () => void {
  lent = next;
  return () => {
    if (lent === next) lent = null;
  };
}

/** What the index is asked about a lane: its native session id, read off its id
 * by the lane's OWN provider — a native id may hold a colon, so the id is never
 * split. Undefined when the lane does not name what ran it, or its id is not
 * that provider's. */
function recordOf(lane: MonitorEndedRow): { native: string; provider: string } | undefined {
  const provider = lane.provider?.id;
  if (provider === undefined) return undefined;
  const head = `${ENDED_LANE_PREFIX}${provider}:`;
  return lane.id.startsWith(head) && lane.id.length > head.length
    ? { native: lane.id.slice(head.length), provider }
    : undefined;
}

/** The row an opening follows. Only this native id's rows are this ask's (the
 * index reads its parameter as a selector list). A row that names its provider
 * is the lane's or it is not this run's — the lane's `provider.id` and the
 * row's `provider` are both the catalog's id, said by fieldd with one reader —
 * and it is kept before a row that names none. Among equals, the thread's root
 * before a delegated child: the row a reader navigates to (fieldd's own rule). */
function sessionFor(
  rows: readonly RecordedSessionRow[],
  native: string,
  provider: string,
): RecordedSessionRow | undefined {
  const ours = rows.filter(
    (row) =>
      row.nativeSessionId === native && (row.provider === undefined || row.provider === provider),
  );
  const named = ours.filter((row) => row.provider !== undefined);
  const kept = named.length > 0 ? named : ours;
  return kept.find((row) => row.rootSessionId === row.sessionId) ?? kept[0];
}

/** A door's refusal in its own words (fieldd's message), or none. */
function wordsOf(cause: unknown): string | undefined {
  const words = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return words.trim() === "" ? undefined : words.trim();
}

function refuse(why: Refusal, lane: string, detail?: string): void {
  const notice: StatusNotice = {
    id: `ended-lane:${why}`,
    text: SAYS[why],
    ...(detail === undefined ? {} : { detail }),
  };
  sayStatus(notice);
  getRendererLogger()
    .child({ component: "godview" })
    .info("renderer.godview.ended_lane_unopened", "an ended lane was not opened in History", {
      lane,
      why,
      ...(detail === undefined ? {} : { detail }),
    });
}

/**
 * Open an ended lane's session in History (the view contract's `openEnded`).
 * Stable: one function, reading what the hook lends when it is called. One ask
 * at a time: the same lane again while its ask is in flight is not a second
 * ask, and a newer pick wins — an older ask's late answer opens nothing.
 */
export function openEndedLane(id: string): void {
  if (asking === id) return;
  asked += 1;
  const mine = asked;
  asking = null;
  const lane = lent?.ended.find((entry) => entry.id === id);
  if (lent === null || lane === undefined) {
    refuse("gone", id);
    return;
  }
  const record = recordOf(lane);
  if (record === undefined) {
    refuse("unrecorded", id);
    return;
  }
  const { native, provider } = record;
  const { port } = lent;
  asking = id;
  // inside a promise, so a door that throws before it answers refuses like one that rejects
  new Promise<readonly RecordedSessionRow[]>((resolve) => resolve(port.sessions([native]))).then(
    (rows) => {
      if (mine !== asked) return;
      asking = null;
      const session = sessionFor(rows, native, provider);
      if (session === undefined) {
        refuse("unrecorded", id);
        return;
      }
      // the Peek's past pick, call for call (`FramePeek.openPast`)
      openHistoryAt({ sessionId: session.sessionId });
      if (getActiveView() !== "history") void requestView("history");
    },
    (cause: unknown) => {
      if (mine !== asked) return;
      asking = null;
      refuse("unread", id, wordsOf(cause));
    },
  );
}

/** Test seam: nothing lent, no ask in flight. */
export function resetOpenEndedLaneForTest(): void {
  lent = null;
  asked += 1;
  asking = null;
}
