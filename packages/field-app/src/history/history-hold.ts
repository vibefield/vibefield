import type { IndexPhase } from "@vibefield/contracts/agent-index";
// the room's types only, which ride no chunk
import type { ImportSign } from "@vibefield/rosetta-room";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useImportSign } from "../frame/import-sign-door";
import type { HistoryCatalogPort } from "./doors";

// THE FIRST READING'S HOLD (History QA, 2026-11-24; DESIGN.md §8 "History" — before its past, "The first reading
// holds behind the glass"). From Bring in history until fieldd's first projects are listed, the view keeps its glass
// and stands the hold in the card's place, and the room under it is not shown. Until then the room's own cold start
// ended at its first "project", which was its bucket for sessions no place holds yet, so a person saw one project of
// everything, "Unassigned sessions", until fieldd had read the places.
//
// The rule is read off facts the room's ports already hold: the index's phase, and the listing the room was last
// handed (fieldd's projects, this desktop's sessions). The words are the import's own, as the room reads it (R11).

/** After the index is live, how long the hold waits for the first project while sessions are listed and none is
 * placed. The one bound here that is not a fact: places that cannot be read (the files service down) must not keep
 * the room shut. On the QA cut the first projects came 2 s after the index went live. */
export const HISTORY_PLACING_BOUND_MS = 30_000;

/** The phases of a first reading. */
const READING: ReadonlySet<IndexPhase> = new Set<IndexPhase>([
  "discovering",
  "backfilling",
  "metadata_ready",
  "restoring",
  "finalizing",
  "publishing",
]);

/** A restart: the grant's own (`index.enroll` restarts the service), or any other. */
const RESTARTING: ReadonlySet<IndexPhase> = new Set<IndexPhase>([
  "starting",
  "restarting",
  "rebuilding",
]);

export interface HistoryHoldFacts {
  /** the index's phase, as `index.status` last answered it; null before it has */
  readonly phase: IndexPhase | null;
  /** fieldd's projects in the listing the room was last handed; null before the first */
  readonly projects: number | null;
  /** this desktop's sessions in that listing; null before the first */
  readonly sessions: number | null;
  /** this view saw the first reading begin: the index waiting for consent, or reading with no project listed */
  readonly armed: boolean;
  /** how long the index has been live in this view's sight; null while it is not */
  readonly liveForMs: number | null;
}

/** Whether what the view sees arms the hold: the room is before its past, or the index reads and the listing says
 * no project yet. A reading with no listing yet arms nothing: an index that catches up at an ordinary start reads
 * too, and its projects are only not listed YET. */
export function historyHoldArms(phase: IndexPhase | null, projects: number | null): boolean {
  return phase === "awaiting_consent" || (phase !== null && READING.has(phase) && projects === 0);
}

/** Whether the view holds: see the module's head, and DESIGN.md's "When it holds". */
export function historyHolds(facts: HistoryHoldFacts): boolean {
  const { phase, projects, sessions, armed, liveForMs } = facts;
  if (projects !== null && projects > 0) return false;
  if (phase === null) return false;
  if (READING.has(phase) || RESTARTING.has(phase)) return armed;
  if (phase === "live")
    return (
      armed &&
      sessions !== null &&
      sessions > 0 &&
      liveForMs !== null &&
      liveForMs < HISTORY_PLACING_BOUND_MS
    );
  // waiting for consent is the card's; failed, stopped, unconfigured and unknown are the room's own words
  return false;
}

/** What the hold says: one line, and its count under it or nothing. */
export interface HistoryHold {
  /** names the wait, so a new one is a new line to a reader that hears it */
  readonly key: string;
  readonly line: string;
  readonly detail: string | null;
}

/** The room's first step, whose count says the same wait again (its own cold start leaves it out). */
const FINDING = "Finding your history";

/** The hold's words: the import's own step, as the room reads it; "Gathering your projects…" once the reading is
 * done and only the places are still being read. */
export function historyHoldWords(phase: IndexPhase | null, sign: ImportSign | null): HistoryHold {
  if (phase === "live") return { key: "placing", line: "Gathering your projects…", detail: null };
  if (sign === null || sign.tone !== "working" || sign.title === FINDING)
    return { key: "finding", line: `${FINDING}…`, detail: null };
  return { key: `step-${sign.step}`, line: `${sign.title}…`, detail: sign.count };
}

/** That the view holds, and in which phase: what the controller hands the view. It changes only when the hold
 * begins, ends or the index changes phase, never with the import's counts, so the controller and the room under it
 * are not drawn again at each count. The words are read where they are drawn (`useHistoryHoldWords`). */
export interface HistoryHolding {
  readonly phase: IndexPhase | null;
}

/** Whether the view holds now: the controller's reading of its catalog port. */
export function useHistoryHolding(catalog: HistoryCatalogPort): HistoryHolding | null {
  const phase = useSyncExternalStore(
    useCallback((listener: () => void) => catalog.onWordsChange(listener), [catalog]),
    () => catalog.indexPhase(),
  );
  const listing = useSyncExternalStore(
    useCallback((listener: () => void) => catalog.onListing(() => listener()), [catalog]),
    () => catalog.listing(),
  );
  const projects = listing === null ? null : listing.projects.length;
  const sessions = listing === null ? null : listing.sessions.length;

  // The latch and the clock are this view's own sight, kept across renders. A project listed ends the reading for
  // good; the bound's lapse ends it too (below).
  const armed = useRef(false);
  const liveSince = useRef<number | null>(null);
  if (projects !== null && projects > 0) armed.current = false;
  else if (historyHoldArms(phase, projects)) armed.current = true;
  if (phase !== "live") liveSince.current = null;
  else if (liveSince.current === null) liveSince.current = performance.now();
  const holds = historyHolds({
    phase,
    projects,
    sessions,
    armed: armed.current,
    liveForMs: liveSince.current === null ? null : performance.now() - liveSince.current,
  });

  // the bound is the one thing no event announces: look again when it lapses
  const [, look] = useState(0);
  useEffect(() => {
    if (!holds || liveSince.current === null) return undefined;
    const left = HISTORY_PLACING_BOUND_MS - (performance.now() - liveSince.current);
    const timer = setTimeout(() => {
      armed.current = false;
      look((n) => n + 1);
    }, Math.max(0, left) + 16);
    return () => clearTimeout(timer);
  }, [holds]);

  return useMemo(() => (holds ? { phase } : null), [holds, phase]);
}

/** How long the hold may outlast the listing while the room draws it (DESIGN.md §8 "When it lets go"). */
export const HISTORY_REVEAL_BOUND_MS = 1_500;

/** Whether the room has drawn its projects: more than one row in its list. One row may be the room's own bucket
 * for sessions no place holds, which is what the hold exists to keep out of sight. The class is the room's
 * (rosetta-room `ProjectListItem`), read here as its sheet is styled in `history-room-glass.css`. */
export function roomHasDrawnProjects(room: ParentNode): boolean {
  return room.querySelectorAll(".ah-project-list-item").length > 1;
}

/**
 * The hold, kept until the room has drawn what ended it. A project listed is not yet a project drawn: the room
 * draws its list a moment after the catalog hands it over, and a view that let go at the listing showed the one
 * bucket for that moment. So when the controller's hold ends, the view keeps its last one until the room's list
 * shows its projects, or the bound has passed. `room` is the element the room is mounted in.
 */
export function useHeldUntilDrawn(
  holding: HistoryHolding | null,
  room: RefObject<HTMLElement | null>,
): HistoryHolding | null {
  // the last hold, kept through the commit in which the controller's ends (derived in render, so the view never
  // commits once without it)
  const [kept, setKept] = useState<HistoryHolding | null>(holding);
  if (holding !== null && kept !== holding) setKept(holding);
  useEffect(() => {
    if (holding !== null || kept === null) return undefined;
    const element = room.current;
    if (element === null || roomHasDrawnProjects(element)) {
      setKept(null);
      return undefined;
    }
    const release = (): void => setKept(null);
    const observer = new MutationObserver(() => {
      if (roomHasDrawnProjects(element)) release();
    });
    observer.observe(element, { childList: true, subtree: true });
    const timer = setTimeout(release, HISTORY_REVEAL_BOUND_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [holding, kept, room]);
  return holding ?? kept;
}

/** The hold's words as they stand now: the import's sign is read here, by what draws them. */
export function useHistoryHoldWords(holding: HistoryHolding): HistoryHold {
  return historyHoldWords(holding.phase, useImportSign());
}
