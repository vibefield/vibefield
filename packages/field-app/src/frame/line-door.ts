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
