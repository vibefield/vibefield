import type { FindAgent, HistoryPort } from "@vibefield/puppeteer-views";
import { useSyncExternalStore } from "react";

// WHAT GODVIEW LENDS THE PEEK (P2; DESIGN.md §8 "Search — the Peek"; One Frame
// §23, GV-D3/D8/D9). The Peek is the frame's and Godview is a view below it,
// but Live now's rows are Godview's: the window's live runs, each joined with
// this desktop's native session id and mirror clocks (`find-agents.ts`), cut
// to the desktop and the profile the view shows. So the monitor publishes this
// door and the Peek reads it, as the deck publishes the line's
// (`line-door.ts`, the same module-store shape for the same reason: the
// publisher sits deep inside the cover and the reader in the frame above it).
// Plain facts and verbs only — no runtime, no workspace, no session object.

/** Where a live run runs: the model's desktop, in the views' four OS words. */
export interface LiveDesk {
  readonly id: string;
  readonly name: string;
  readonly os: "macos" | "windows" | "linux" | "unknown";
  /** the desktop this window is on */
  readonly self: boolean;
}

/** A live run as the Peek lists it: Find's row (`FindAgent`, which puppeteer's
 * find model reads) plus where it runs and, for this desktop's runs, the floor
 * session its terminal is — what the live peek watches and Jump to reveals. */
export interface LiveFindAgent extends FindAgent {
  readonly desk: LiveDesk;
  /** this desktop's floor session for the run's terminal; absent for a peer's */
  readonly floorSessionId?: string;
}

/** A desktop the scope row's first dropdown offers (DS-3's choices). */
export interface LiveDeskChoice {
  readonly id: string;
  readonly name: string;
  readonly os: LiveDesk["os"];
  readonly here: boolean;
  /** what the menu says beside the name: its agents, or its standing */
  readonly note: string;
  /** not answering, asleep or another version: drawn quiet */
  readonly quiet: boolean;
}

/** An Agent Profile the scope row's second dropdown offers (AR-S5's tabs). */
export interface LiveProfileChoice {
  readonly id: string;
  readonly label: string;
  readonly glyph?: string | undefined;
  readonly kind?: "native" | "managed" | undefined;
  /** the profile new sessions use: its glyph is drawn filled */
  readonly isDefault?: boolean | undefined;
  /** a session under it waits on you: one orange dot */
  readonly blocked?: boolean | undefined;
}

/** GV-D3 — the view's filters, which search's Live now carries (they filter
 * the view too). Each list is empty when there is no choice to make: one
 * desktop, or This Mac as the only profile. */
export interface LiveFilters {
  readonly desks: readonly LiveDeskChoice[];
  /** the chosen desktop's id; null is every desktop */
  readonly desk: string | null;
  readonly profiles: readonly LiveProfileChoice[];
  /** the chosen profile's id; null is every profile */
  readonly profile: string | null;
  /** TS-4 (TS-D7) — this Mac is not connected: the desktop filter ends on a
   * ghost row, Your other devices · Connect…; absent or false, no row */
  readonly connect?: boolean;
}

export const NO_LIVE_FILTERS: LiveFilters = Object.freeze({
  desks: Object.freeze([]),
  desk: null,
  profiles: Object.freeze([]),
  profile: null,
});

export interface GodviewFindDoor {
  /** The live runs the view shows (its filters applied), in the window's
   * order: the SAME array until a run's searchable facts move — never rebuilt
   * per model publish — and null until they are first computed. The monitor
   * computes them only while someone listens (`subscribeRows`: the Peek open
   * on Live now), so a closed Peek costs the stage nothing (MV's after-MV
   * list: "Find re-renders on every publish"). */
  rows(): readonly LiveFindAgent[] | null;
  subscribeRows(listener: () => void): () => void;
  /** rosetta's words, through the deck's door (`historyPortOver`) — Find's
   * port, named for what it reads; not `MonitorCapabilities.history`. */
  readonly transcripts: HistoryPort;
  /** What a row's pick does in Godview: the view's own select — a local run's
   * PTY placed by the deck's rule (GV-D4: in the focused pane, mirrored there
   * when another pane shows it), a peer's attached the same way. */
  select(rowId: string): void;
  readonly filters: LiveFilters;
  setDesk(id: string | null): void;
  setProfile(id: string | null): void;
  /** QL-D2: while the Peek is open over Godview the stage holds the keys —
   * its Escape is the Peek's, never a fresh pane's launcher's. Answers the
   * release (idempotent). */
  holdKeys(): () => void;
  /** SB-3: the mounted view holds every key (a spawn bloom with the
   * keyboard) — read at event time; the frame's ⌘F yields while it does. */
  viewHoldsKeys(): boolean;
}

let door: GodviewFindDoor | null = null;
const listeners = new Set<() => void>();

/** The monitor's side: publish on change, null when it goes away. */
export function publishGodviewFindDoor(next: GodviewFindDoor | null): void {
  if (next === door) return;
  door = next;
  for (const fn of listeners) fn();
}

export function getGodviewFindDoor(): GodviewFindDoor | null {
  return door;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The Peek's side. */
export function useGodviewFindDoor(): GodviewFindDoor | null {
  return useSyncExternalStore(subscribe, getGodviewFindDoor, getGodviewFindDoor);
}

/** Wait (bounded) for Godview's monitor to publish — History's Live now asks
 * the frame for Godview to open a peer's run there, and the monitor mounts
 * with the view. Null when none came in `timeoutMs`. */
export function whenGodviewFindDoor(timeoutMs: number): Promise<GodviewFindDoor | null> {
  if (door !== null) return Promise.resolve(door);
  return new Promise((resolve) => {
    const stop = subscribe(() => {
      if (door === null) return;
      stop();
      clearTimeout(timer);
      resolve(door);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(door);
    }, timeoutMs);
  });
}

/** Test seam. */
export function resetGodviewFindDoorForTest(): void {
  door = null;
  listeners.clear();
}

// ── HISTORY'S OWN LIVE NOW (docket PK5 (a), 2026-10-09) ────────────────────
// In History the monitor is not mounted, so nothing publishes the door above.
// The Peek opens a feed of its own instead — the monitor's model board over
// this window's fieldd client — only while its Live now shows, and closes it
// on a change of scope, on the popup's close and on unmount. Godview itself
// still asks nothing while closed (PF6): this feed is the Peek's, not Godview's.

/** What History's feed says, as Live now reads it. */
export interface LiveFeedSnapshot {
  readonly runs: readonly LiveFindAgent[];
  readonly state:
    | { readonly kind: "live" }
    | { readonly kind: "connecting" }
    | { readonly kind: "unavailable"; readonly reason: string };
}

export interface LiveFeed {
  read(): LiveFeedSnapshot;
  /** hears the runs or the state move */
  subscribe(listener: () => void): () => void;
  /** rosetta's words over the same client */
  readonly history: HistoryPort;
  dispose(): void;
}

/** What History's feed asks of a fieldd client (the deck's door client's
 * shape, `monitor/doors.ts`): one request door and one subscription door. */
export interface LiveFeedClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  subscribe(
    method: string,
    params: Record<string, unknown>,
    onFrame: (payload: unknown, kind?: "snapshot" | "delta") => void,
    opts?: { onReplayFailed?: (error: unknown) => void },
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
}

/** Opens History's feed over a client: one subscription, held until `dispose`. */
export type OpenLiveFeed = (client: LiveFeedClient) => LiveFeed;

/** GV-D3 — the words the search button wears while a filter is on (the kit's
 * token: "studio · Work"), or null for none. A filtered view never looks
 * unfiltered. */
export function filterToken(
  filters: LiveFilters,
): { desk: LiveDeskChoice | null; profile: LiveProfileChoice | null } | null {
  const desk =
    filters.desk === null
      ? null
      : (filters.desks.find((entry) => entry.id === filters.desk) ?? null);
  const profile =
    filters.profile === null
      ? null
      : (filters.profiles.find((entry) => entry.id === filters.profile) ?? null);
  return desk === null && profile === null ? null : { desk, profile };
}
