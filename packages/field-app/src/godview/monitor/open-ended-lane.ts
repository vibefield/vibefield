import type { MonitorEndedRow } from "@vibecook/puppeteer-view-sdk/model";
import { AgentProviderId } from "@vibefield/contracts";
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
// The answer opens only while the person is still in Godview. They clicked,
// then went elsewhere: History must not pull them back, and a refusal is not
// said to someone who is no longer looking. Such an answer is dropped, with a
// debug line and no notice.
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
//
// The view side's contract (puppeteer `dce6adb`): a view reads the command's
// PRESENCE once, when it mounts — so the function exists from the first render,
// before any past does, and is never swapped — and calls it synchronously from
// its own pointerup, keydown or click, catching nothing. So it returns at once
// and NEVER throws, whatever it is handed: a fault in here is logged and stops
// here, before the answer and after it.

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
  /** the index holds no session for the lane's native id, or the lane's id carries none */
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

/** The provider an ended lane's id names, for a lane that does not name one
 * itself. `AgentProviderId`'s grammar (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, the
 * contract's, mirrored from puppeteer's) holds no colon, so the provider part
 * ends at the FIRST colon after the prefix, exactly — nothing is guessed. A
 * part that is no provider id is none. */
function providerIn(id: string): string | undefined {
  const end = id.indexOf(":", ENDED_LANE_PREFIX.length);
  if (end < 0) return undefined;
  const part = id.slice(ENDED_LANE_PREFIX.length, end);
  return AgentProviderId.safeParse(part).success ? part : undefined;
}

/** What the index is asked about a lane: its native session id, read off its id
 * by the lane's OWN provider when it names one — and an id that is not that
 * provider's is not read — else by the provider its id names (`providerIn`).
 * Whatever follows the provider's colon is the native id, colons and all: the
 * id is never split on a later one. Undefined when nothing follows it, or no
 * provider can be read. */
function recordOf(lane: MonitorEndedRow): { native: string; provider: string } | undefined {
  const provider = lane.provider?.id ?? providerIn(lane.id);
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

/** Said first, then logged: the sentence stands even where the log does not. */
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

/** A fault in here, logged — and where the log is what failed, there is nowhere
 * left to say it: the caller still must not hear it. */
function fault(lane: unknown, cause: unknown): void {
  try {
    getRendererLogger()
      .child({ component: "godview" })
      .error("renderer.godview.ended_lane_fault", "opening an ended lane failed", cause, {
        lane: String(lane),
      });
  } catch {
    // nothing may leave
  }
}

/** The person went elsewhere while the door was asked: the answer is theirs no
 * longer. Read when the answer lands — whichever monitor view Godview shows. */
function leftGodview(lane: string): boolean {
  if (getActiveView() === "godview") return false;
  getRendererLogger()
    .child({ component: "godview" })
    .debug(
      "renderer.godview.ended_lane_left",
      "an ended lane's answer came after Godview was left",
      { lane },
    );
  return true;
}

/** One pick, as far as its ask (`openEndedLane` is the door a view calls). */
function pick(id: string): void {
  if (typeof id !== "string" || !id.startsWith(ENDED_LANE_PREFIX)) {
    // Not an ended lane's id by the SDK's own grammar (`past:…`, "never a model
    // row's id"): no ended lane was pressed, so there is no run to say anything
    // of on the line — "no longer in the timeline" would be false of a live
    // row. A view that sends one has a bug: logged, and nothing moves, not the
    // ask in flight either.
    getRendererLogger()
      .child({ component: "godview" })
      .warn(
        "renderer.godview.ended_lane_not_a_lane",
        "openEndedLane was handed an id that is not an ended lane's",
        { id: typeof id === "string" ? id : typeof id },
      );
    return;
  }
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
  new Promise<readonly RecordedSessionRow[]>((resolve) => resolve(port.sessions([native])))
    .then(
      (rows) => {
        if (mine !== asked) return;
        asking = null;
        if (leftGodview(id)) return;
        let session: RecordedSessionRow | undefined;
        try {
          session = sessionFor(rows, native, provider);
        } catch {
          // an answer that cannot be read as rows is a door that could not be read
          refuse("unread", id);
          return;
        }
        if (session === undefined) {
          refuse("unrecorded", id);
          return;
        }
        // the Peek's past pick from Godview, call for call (`FramePeek.openPast`):
        // the place, then the view — the frame is in Godview here, so it is always asked
        openHistoryAt({ sessionId: session.sessionId });
        void requestView("history");
      },
      (cause: unknown) => {
        if (mine !== asked) return;
        asking = null;
        if (leftGodview(id)) return;
        refuse("unread", id, wordsOf(cause));
      },
    )
    // after the answer too: a rejection nobody handles is nobody's to catch
    .catch((cause: unknown) => fault(id, cause));
}

/**
 * Open an ended lane's session in History (the view contract's `openEnded`).
 * Stable: one function from the first render, reading what the hook lends when
 * it is called. It returns at once and never throws (the caller is a view's own
 * handler). One ask at a time: the same lane again while its ask is in flight
 * is not a second ask, and a newer pick wins — an older ask's late answer opens
 * nothing. Nor does an answer that lands after the person left Godview.
 */
export function openEndedLane(id: string): void {
  try {
    pick(id);
  } catch (cause) {
    fault(id, cause);
  }
}

/** Test seam: nothing lent, no ask in flight. */
export function resetOpenEndedLaneForTest(): void {
  lent = null;
  asked += 1;
  asking = null;
}
