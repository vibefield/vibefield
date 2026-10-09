import { useSyncExternalStore } from "react";

// WHAT GODVIEW LENDS THE LINE (One Frame FR-2; DESIGN.md §8 "The line").
// The line is the frame's and Godview is a view below it, but two of the
// line's acts only Godview can do: its create — a new terminal, as the swarm's
// hold makes one — and the interim send's paste into an aimed pane. Both live
// where a pane and its session meet, which is the deck, so the deck publishes
// this door and the line's controller reads it.
//
// A module store (view-state.ts's shape, for the same reason): the publisher
// sits deep inside the cover and the reader in the frame above it, and
// threading a prop between them through ChromeLayer would make ChromeLayer a
// second owner of something it never reads. Verbs and plain facts only — no
// runtime, no workspace, no session object ever crosses (GT-D17's rule).

/** A pane the deck shows, as the line's @ list names it. */
export interface LinePane {
  /** The floor session the pane shows: what an aim holds. */
  readonly sessionId: string;
  /** As the swarm names its body — the agent's project, else the folder. */
  readonly name: string;
  /** What runs there: the agent's provider, or "shell". */
  readonly runs: string;
  /** The agent's state; null for a shell, which has none to say. */
  readonly state: "working" | "idle" | "blocked" | null;
  /** The deck's active pane, which the list puts nearest. */
  readonly active: boolean;
}

/** What a new terminal came to — the door's own outcomes (SB-3's words). */
export type NewTerminalOutcome =
  | { readonly state: "opened" }
  | { readonly state: "refused"; readonly reason: string };

export interface LineViewDoor {
  /** The panes in the deck, the active one first. */
  readonly panes: readonly LinePane[];
  /** Whether the deck is on screen — a paste lands only where it can be seen. */
  readonly onScreen: boolean;
  /** A fresh shell in the active pane, which shows its launcher: what the
   * swarm's hold does without a spot to land on. */
  newTerminal(): Promise<NewTerminalOutcome>;
  /** Paste `text` into the input of the pane showing `sessionId` — the road ⌘V
   * takes, so the pane brackets it and nothing presses Return. True when the
   * pane took it. */
  paste(sessionId: string, text: string): boolean;
  /** AR-8c — whether `place` can mount now: the deck has its door. */
  readonly canPlace: boolean;
  /** AR-8c — History's Resume lands here: the create ticket `agent.resume`
   * answered with (plain data, the same ticket a shell birth carries), adopted
   * by the deck and mounted in the ACTIVE pane — the pane the swarm's open uses
   * (GT-D17; the session it showed is detached, never killed). */
  place(terminal: unknown): Promise<NewTerminalOutcome>;
  /** P3 — History's Jump to lands here: the pane showing floor session
   * `sessionId` becomes the active one, or, when no pane shows it, it is
   * mounted in the active pane through the door's serialized mount (AR-4b). */
  reveal(sessionId: string): Promise<NewTerminalOutcome>;
}

let godview: LineViewDoor | null = null;
const listeners = new Set<() => void>();

/** The deck's side: publish on change, null when the deck goes away. */
export function publishGodviewLineDoor(next: LineViewDoor | null): void {
  if (next === godview) return;
  godview = next;
  for (const fn of listeners) fn();
}

export function getGodviewLineDoor(): LineViewDoor | null {
  return godview;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The line's side. */
export function useGodviewLineDoor(): LineViewDoor | null {
  return useSyncExternalStore(subscribe, getGodviewLineDoor, getGodviewLineDoor);
}

/** The words a new terminal's outcome is said in — the swarm's own sentences
 * (useMonitorAgents' createAt), so the two doors to one act speak alike. */
export function newTerminalNote(outcome: NewTerminalOutcome): string {
  return outcome.state === "opened"
    ? "Terminal opened in the active pane"
    : `Terminal could not be opened — ${outcome.reason}`;
}

/** Test seam. */
export function resetGodviewLineDoorForTest(): void {
  godview = null;
  listeners.clear();
}

/** Wait (bounded) for a deck that can place — History's Resume (and Jump to)
 * asks the frame for Godview, whose deck mounts on its first open and
 * publishes its door a moment later. Null when none came in `timeoutMs`. */
export function whenGodviewCanPlace(timeoutMs: number): Promise<LineViewDoor | null> {
  const ready = (): LineViewDoor | null => (godview?.canPlace === true ? godview : null);
  const now = ready();
  if (now !== null) return Promise.resolve(now);
  return new Promise((resolve) => {
    const stop = subscribe(() => {
      const door = ready();
      if (door === null) return;
      stop();
      clearTimeout(timer);
      resolve(door);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(ready());
    }, timeoutMs);
  });
}

// ── WHAT HISTORY LENDS THE LINE (AR-8c; DESIGN.md §8 "History — Resume") ────
// History's create is Resume: it continues the session the room has chosen —
// or, while that session runs on this desktop, Jump to (P3): it shows the pane
// the run is in. The room is rosetta's and reports its selection to History's
// controller, which publishes this door; the line reads it the way it reads
// Godview's.

/** What a Resume came to, said on the line. `running`: the session runs here,
 * so nothing was resumed — Jump to is the act (P3). */
export type ResumeOutcome =
  | { readonly state: "resumed" }
  | { readonly state: "running" }
  | { readonly state: "refused"; readonly reason: string };

/** What a Jump to came to. `ended`: the session stopped running before the
 * press, so nothing was shown — Resume is the act again. */
export type JumpOutcome =
  | { readonly state: "jumped" }
  | { readonly state: "ended" }
  | { readonly state: "refused"; readonly reason: string };

export interface HistoryLineDoor {
  /** The chosen session (rosetta's id), or null while none is chosen. */
  readonly chosen: string | null;
  /** Why Resume waits for the chosen session — the launcher's own words (its
   * folder is gone, an agent that cannot resume here) — or null. */
  readonly waits: string | null;
  /** P3 — the chosen session runs on this desktop, by the last `agent.list`
   * answer (kept while a new one is on its way): the create is Jump to. */
  readonly live: boolean;
  /** Resume the chosen session in its own agent, in the pane the swarm's open
   * uses, and show it (the frame moves to Godview). */
  resume(): Promise<ResumeOutcome>;
  /** P3 — show the pane the chosen session runs in (the frame moves to
   * Godview, whose deck reveals it). */
  jump(): Promise<JumpOutcome>;
}

let history: HistoryLineDoor | null = null;
const historyListeners = new Set<() => void>();

/** History's side: publish on change, null when the view goes away. */
export function publishHistoryLineDoor(next: HistoryLineDoor | null): void {
  if (next === history) return;
  history = next;
  for (const fn of historyListeners) fn();
}

export function getHistoryLineDoor(): HistoryLineDoor | null {
  return history;
}

function subscribeHistory(fn: () => void): () => void {
  historyListeners.add(fn);
  return () => {
    historyListeners.delete(fn);
  };
}

/** The line's side. */
export function useHistoryLineDoor(): HistoryLineDoor | null {
  return useSyncExternalStore(subscribeHistory, getHistoryLineDoor, getHistoryLineDoor);
}

/** The words a Resume is said in, as a new terminal's are (above). */
export function resumeNote(outcome: ResumeOutcome): string {
  switch (outcome.state) {
    case "resumed":
      return "Resumed in the active pane";
    case "running":
      return "This session is running — Jump to it";
    case "refused":
      return `Could not resume — ${outcome.reason}`;
  }
}

/** The words a Jump to is said in (P3). */
export function jumpNote(outcome: JumpOutcome): string {
  switch (outcome.state) {
    case "jumped":
      return "Jumped to its pane";
    case "ended":
      return "This session has ended — Resume it";
    case "refused":
      return `Could not jump — ${outcome.reason}`;
  }
}

/** Why History's create waits, or null when it can be pressed. Jump to never
 * waits on the launcher's reading: a running session is shown even where it
 * could not be resumed. */
export function historyCreateWaits(door: HistoryLineDoor | null): string | null {
  if (door === null || door.chosen === null) return "choose a session first";
  return door.live ? null : door.waits;
}

/** Test seam. */
export function resetHistoryLineDoorForTest(): void {
  history = null;
  historyListeners.clear();
}
