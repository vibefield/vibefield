import { useSyncExternalStore } from "react";
import type { DeckPlaced } from "../godview/deck-placement";

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

/** What a new terminal came to — the door's own outcomes (SB-3's words).
 * `placement` (GV-D4): how the deck's rule placed it — beside the focused
 * pane, in its place, or its own pane focused — when the deck says. */
export type NewTerminalOutcome =
  | { readonly state: "opened"; readonly placement?: DeckPlaced }
  | { readonly state: "refused"; readonly reason: string };

export interface LineViewDoor {
  /** The panes in the deck, the active one first. */
  readonly panes: readonly LinePane[];
  /** Whether the deck is on screen — a paste lands only where it can be seen. */
  readonly onScreen: boolean;
  /** A fresh shell, which shows its launcher: what the swarm's hold does
   * without a spot to land on — beside the focused pane while fewer than three
   * panes show, in its place after (GV-D4). */
  newTerminal(): Promise<NewTerminalOutcome>;
  /** Paste `text` into the input of the pane showing `sessionId` — the road ⌘V
   * takes, so the pane brackets it and nothing presses Return. True when the
   * pane took it; false, with nothing handed to the pane, while its input is
   * closed (a paste there would be dropped), and the line copies instead. */
  paste(sessionId: string, text: string): boolean;
  /** AR-8c — whether `place` can mount now: the deck has its door. */
  readonly canPlace: boolean;
  /** AR-8c — History's Resume lands here: the create ticket `agent.resume`
   * answered with (plain data, the same ticket a shell birth carries), adopted
   * by the deck and placed as the swarm's open places a session with no pane
   * (GV-D4: beside the focused pane, or in its place with three showing — the
   * session it showed is detached, never killed). */
  place(terminal: unknown): Promise<NewTerminalOutcome>;
  /** P3 — History's Jump to lands here: the pane showing floor session
   * `sessionId` becomes the active one, or, when no pane shows it, it is
   * placed by the same rule through the door's serialized mount (AR-4b). */
  reveal(sessionId: string): Promise<NewTerminalOutcome>;
  /** W7 (GV-D5) — the deck is asking the person something before it can
   * place anything: the restore question a launch's first call can bring up
   * (last time's panes, some ended). An act racing the deck (`deckAnswerWithin`)
   * reads it: its bound waits while the person decides. Absent: no one. */
  readonly waitsOnPerson?: boolean;
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
 * (useMonitorAgents' createAt), so the two doors to one act speak alike. Where
 * it opened follows the deck's rule (GV-D4): a new pane beside the one the
 * person was in, or — with three showing — the active pane itself. */
export function newTerminalNote(outcome: NewTerminalOutcome): string {
  if (outcome.state !== "opened") return `Terminal could not be opened — ${outcome.reason}`;
  return outcome.placement === "beside"
    ? "Terminal opened in a new pane"
    : "Terminal opened in the active pane";
}

/** Test seam. */
export function resetGodviewLineDoorForTest(): void {
  godview = null;
  listeners.clear();
}

/** What the deck answered an act (`place`, `reveal`) within its bound, or
 * `late`: nothing yet. Its mounts wait their turn (AR-4b), and a turn that
 * never ends is said by the act that waited on it, never waited on without
 * end (2026-10-11 — New agent's run started and the line said nothing). */
export type DeckAnswer = NewTerminalOutcome | { readonly state: "late" };

/** What the line says while an act waits on the person's answer in Godview
 * (W7): the restore question's own two buttons, "restore" and "start clean". */
export const WAITING_ON_PERSON_NOTE =
  "Waiting in Godview — restore last time's panes, or start clean";

/** The deck's answer, or `late` once `timeoutMs` pass. A throw is the act's.
 *
 * W7 (GV-D5): the bound is the DECK'S time, never the person's. While the
 * published deck waits on the person (`waitsOnPerson` — the restore question a
 * launch's first call can bring up), its clock stands, and the line says once
 * what the act is waiting for (`onWaiting`, default: `WAITING_ON_PERSON_NOTE`
 * on the line); answered, the clock runs on from where it stood. */
export async function deckAnswerWithin(
  answer: Promise<NewTerminalOutcome>,
  timeoutMs: number,
  onWaiting: () => void = () => {
    sayOnLine(WAITING_ON_PERSON_NOTE);
  },
): Promise<DeckAnswer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = (): void => undefined;
  try {
    return await Promise.race([
      answer,
      new Promise<DeckAnswer>((resolve) => {
        let left = timeoutMs;
        let since = 0;
        let said = false;
        const read = (): void => {
          if (godview?.waitsOnPerson === true) {
            if (timer !== undefined) {
              clearTimeout(timer);
              timer = undefined;
              left -= Date.now() - since;
            }
            if (!said) {
              said = true;
              onWaiting();
            }
          } else if (timer === undefined) {
            since = Date.now();
            timer = setTimeout(() => resolve({ state: "late" }), Math.max(0, left));
          }
        };
        stop = subscribe(read);
        read();
      }),
    ]);
  } finally {
    stop();
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** How a `late` is said (DESIGN.md §8 "History"): "no pane took it in 20 s"
 * for a pane placed, "no pane showed it in 20 s" for one revealed. */
export function lateReason(verb: "took" | "showed", timeoutMs: number): string {
  return `no pane ${verb} it in ${Math.round(timeoutMs / 1_000)} s`;
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
  | {
      readonly state: "resumed";
      readonly placement?: DeckPlaced;
      /** PJ-6 (Q4) — fieldd's words for a session launched at a model whose
       * agent resumed it at its own ("at OpenCode's own model — it can't start
       * a resumed session at a chosen one") */
      readonly own?: string | undefined;
    }
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
  /** Resume the chosen session in its own agent, placed as the swarm's open
   * places a session with no pane (GV-D4), and show it (the frame moves to
   * Godview). */
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
    case "resumed": {
      // GV-D4: a new pane beside the focused one, or the active pane itself
      const where =
        outcome.placement === "beside" ? "Resumed in a new pane" : "Resumed in the active pane";
      // PJ-6 (Q4): a launch model the agent's resume could not take is said
      return outcome.own === undefined ? where : `${where}, ${outcome.own}`;
    }
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
  historySaid = null;
  saidListeners.clear();
}

// PJ-4 — WHAT HISTORY'S OWN ACTS CAME TO. The room now holds acts of its own
// (a session row's Resume or Jump to, ②'s New agent, a project's acts — the
// host's inputs, R4/R5, H4), pressed in the room, not on the line; their
// outcome is said on the line all the same, where the create's is, in the
// same words. A fresh `seq` per thing said, so the same words twice are said
// twice.
let historySaid: { readonly seq: number; readonly text: string } | null = null;
let saidSeq = 0;
const saidListeners = new Set<() => void>();

/** History's side: say this on the line. */
export function sayOnHistoryLine(text: string): void {
  saidSeq += 1;
  historySaid = { seq: saidSeq, text };
  for (const fn of [...saidListeners]) fn();
}

function subscribeSaid(fn: () => void): () => void {
  saidListeners.add(fn);
  return () => {
    saidListeners.delete(fn);
  };
}

function getHistorySaid(): { readonly seq: number; readonly text: string } | null {
  return historySaid;
}

/** The line's side: the newest thing History's acts said, or null. */
export function useHistorySaid(): { readonly seq: number; readonly text: string } | null {
  return useSyncExternalStore(subscribeSaid, getHistorySaid, getHistorySaid);
}

// ── WHAT THE FRAME SAYS ON THE LINE (P2) ────────────────────────────────────
// The line's note is where an act's outcome is said (its create's, Jump to's).
// An act started elsewhere in the frame — a live row the Peek opened, whose
// popup folded at the pick — says its outcome there too, in the same words, so
// a run that could not be shown is never only a log line (the honest-states
// rule). The line's controller hears; anyone in the frame may speak.

const lineHearers = new Set<(text: string) => void>();

/** Say `text` in the line's note. False when no line is mounted to hear it. */
export function sayOnLine(text: string): boolean {
  for (const hear of lineHearers) hear(text);
  return lineHearers.size > 0;
}

/** The line's side: hear what the frame says. */
export function hearLineSays(hear: (text: string) => void): () => void {
  lineHearers.add(hear);
  return () => {
    lineHearers.delete(hear);
  };
}
