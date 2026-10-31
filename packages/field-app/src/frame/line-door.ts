import { useSyncExternalStore } from "react";
import { sizeWords } from "../format/bytes";
import type { DeckPlaced } from "../godview/deck-placement";
import type { RoutedInputRefusal } from "../terminal/pool";

// WHAT GODVIEW LENDS THE FRAME (One Frame FR-2; DESIGN.md §8 "The line").
// The line is the frame's and Godview is a view below it, but some of the
// frame's acts only Godview can do: the line's create — a new terminal, as the
// swarm's hold makes one, in Godview and (in the folder of the project the room
// shows, HN-7) in History — History's Resume and Jump to, and a paste into a
// pane (a card played onto it, HN-D4; the interim send that pasted from the
// line's draft left with the draft, LN-D3). They live where a pane and its
// session meet, which is the deck, so the deck publishes this door and the
// frame reads it.
//
// A module store (view-state.ts's shape, for the same reason): the publisher
// sits deep inside the cover and the reader in the frame above it, and
// threading a prop between them through ChromeLayer would make ChromeLayer a
// second owner of something it never reads. Verbs and plain facts only — no
// runtime, no workspace, no session object ever crosses (GT-D17's rule).

/** A pane the deck shows, as the frame names it — in the line's note, and to a
 * card carried over it. */
export interface LinePane {
  /** The pane itself (the workspace's id, `[data-pane-id]` in the DOM): what a
   * card played onto it is pasted into (HN-4), since two panes may show one
   * session. */
  readonly paneId: string;
  /** The floor session the pane shows: what a paste is aimed at. */
  readonly sessionId: string;
  /** As the swarm names its body — the agent's project, else the folder. */
  readonly name: string;
  /** What runs there: the agent's provider, or "shell". */
  readonly runs: string;
  /** The agent's state; null for a shell, which has none to say. */
  readonly state: "working" | "idle" | "blocked" | null;
  /** The deck's active pane — the one the person was in. */
  readonly active: boolean;
}

/** What a new terminal came to — the door's own outcomes (SB-3's words).
 * `placement` (GV-D4): how the deck's rule placed it — in the focused pane
 * (`replace`), or there already (`focus`) — when the deck says. */
export type NewTerminalOutcome =
  | { readonly state: "opened"; readonly placement?: DeckPlaced }
  | { readonly state: "refused"; readonly reason: string };

/** HN-7 — where a new terminal is asked to open. */
export interface NewTerminalOptions {
  /** The folder its shell is born in: History's New terminal asks for the
   * folder of the project the room shows (LN-D2). Absent: the focused pane's,
   * as Godview's create opens one. */
  readonly cwd?: string;
}

export interface LineViewDoor {
  /** The panes in the deck, the active one first. */
  readonly panes: readonly LinePane[];
  /** Whether the deck is on screen — a paste lands only where it can be seen. */
  readonly onScreen: boolean;
  /** A fresh shell, which shows its launcher: what the swarm's hold does
   * without a spot to land on — in the focused pane, whose session runs on
   * (GV-D4, re-ruled 2026-10-18). Asked for in a folder (HN-7), it is born
   * there, never a waiting shell reused: one sits in another folder. */
  newTerminal(options?: NewTerminalOptions): Promise<NewTerminalOutcome>;
  /** HN-4 — paste `text` into ONE pane, the pane a card is let go on (DESIGN.md
   * §8 "The hand", where cards go): the road ⌘V takes, so the pane brackets it
   * and nothing presses Return. True when the pane took it; false, with nothing
   * handed to the pane, while its session's input is closed (a paste there would
   * be dropped). D6: a paste too large for the pane's terminal is claimed and
   * then refused INSIDE this call — heard through `hearTerminalInputRefusals`;
   * true alone never says the paste arrived. */
  pasteInto(paneId: string, text: string): boolean;
  /** HN-4 — a card spring-loaded into Godview lands while the pane's routed input
   * may still be reopening after the change of view (ghosttea drops input while
   * it is): resolves true once that pane's session takes input, false when it has
   * not within `timeoutMs` (or the pane is gone). */
  whenInputOpen(paneId: string, timeoutMs: number): Promise<boolean>;
  /** AR-8c — whether `place` can mount now: the deck has its door. */
  readonly canPlace: boolean;
  /** AR-8c — History's Resume lands here: the create ticket `agent.resume`
   * answered with (plain data, the same ticket a shell birth carries), adopted
   * by the deck and placed as the swarm's open places a session (GV-D4: in
   * the focused pane — the session it showed is detached, never killed). */
  place(terminal: unknown): Promise<NewTerminalOutcome>;
  /** P3 — History's Jump to lands here: floor session `sessionId` shown in
   * the focused pane by the same rule, through the door's serialized mount
   * (AR-4b) — mirrored there when another pane shows it (GV-D4, re-ruled
   * 2026-10-18), nothing moved when the focused pane does. */
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
 * (useMonitorAgents' createAt), so the two doors to one act speak alike. It
 * opened where the deck's rule puts every session (GV-D4, re-ruled
 * 2026-10-18): the active pane — the one the person was in. */
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

/** What the deck answered an act (`place`, `reveal`) within its bound, or
 * `late`: nothing yet. Its mounts wait their turn (AR-4b), and a turn that
 * never ends is said by the act that waited on it, never waited on without
 * end (2026-10-11 — New agent's run started and the line said nothing). */
export type DeckAnswer = NewTerminalOutcome | { readonly state: "late" };

/** What the line says while an act waits on the person's answer in Godview
 * (W7): the restore question's own two buttons, "Restore" and "Start clean"
 * (LR, 2026-10-15: the question is the last run's now, not the deck's panes). */
export const WAITING_ON_PERSON_NOTE = "Waiting in Godview — restore the last run, or start clean";

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
 * publishes its door a moment later. Null when none came in `timeoutMs`; 0
 * reads the deck up now (History's New terminal asks it first, HN-7). */
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

// ── WHAT HISTORY LENDS THE FRAME (AR-8c, HN-7; DESIGN.md §8 "History") ──────
// History's create is New terminal (LN-D2, HN-7): a fresh shell in the folder
// of the project the room shows, opened by Godview's deck and shown there. The
// chosen session's act is Resume: it continues the session the room has chosen
// — or, while that session runs on this desktop, Jump to (P3): it shows the
// pane the run is in. It was the line's create until HN-7, and is the palette's
// History row since (`runChosenSession`), with the same reading and the same
// words. The room is rosetta's and reports what it shows to History's
// controller, which publishes this door; the frame reads it the way it reads
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
   * answer (kept while a new one is on its way): its act is Jump to. */
  readonly live: boolean;
  /** Resume the chosen session in its own agent, placed as the swarm's open
   * places a session (GV-D4: in the focused pane), and show it (the frame
   * moves to Godview). */
  resume(): Promise<ResumeOutcome>;
  /** P3 — show the chosen session where it runs (the frame moves to Godview,
   * whose deck shows it in the focused pane). */
  jump(): Promise<JumpOutcome>;
  /** HN-7 — the project the room shows, by its name ("vibe-field"), or null
   * while it shows none: the create's tooltip names it. */
  readonly project: string | null;
  /** HN-7 (LN-D2) — History's create: a fresh shell in the folder of the
   * project the room shows, found as New agent finds it, placed as Godview's
   * create places one (GV-D4: in the focused pane), the frame moving to Godview
   * to show it — once it opened, when the deck was up and asked first; with no
   * project shown, as Godview's create opens one. A folder not mounted or gone
   * is refused in New agent's words, one on another desktop by the desktop it
   * is on ("vibe-field is on Mac mini"), and the frame stays. */
  newTerminal(): Promise<NewTerminalOutcome>;
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
      // GV-D4 (re-ruled 2026-10-18): the focused pane — the active one
      const where = "Resumed in the active pane";
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

/** Why the chosen session's act waits, or null when it can run. Jump to never
 * waits on the launcher's reading: a running session is shown even where it
 * could not be resumed. */
export function chosenSessionWaits(door: HistoryLineDoor | null): string | null {
  if (door === null || door.chosen === null) return "choose a session first";
  return door.live ? null : door.waits;
}

/** The chosen session's act — Resume, or Jump to while it runs here (P3) — as
 * the palette's History row runs it (HN-7; the line's create ran it until
 * then): waiting, it says why in Resume's words; run, it says what came of it.
 * Said where History's acts say theirs — centred over the create, in History or
 * in Godview once the frame has moved there to show the pane (PJ-4). */
export async function runChosenSession(
  door: HistoryLineDoor | null = getHistoryLineDoor(),
): Promise<void> {
  const waits = chosenSessionWaits(door);
  if (door === null || waits !== null) {
    sayOnHistoryLine(resumeNote({ state: "refused", reason: waits ?? "choose a session first" }));
    return;
  }
  sayOnHistoryLine(door.live ? jumpNote(await door.jump()) : resumeNote(await door.resume()));
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

// ── WHAT A TERMINAL COULD NOT TAKE (D6) ─────────────────────────────────────
// A paste (⌘V in a pane) or typed text that the terminal refused because it is
// larger than the link to it carries (`terminal/routed/encode-input.ts`). The
// runtime says nothing of an input it was never handed, so the line does, in
// the note an act's outcome is said in (DESIGN.md §8 "The line"): what
// happened, with its numbers — which are what to do instead — in under 70
// characters beside the pane's name, so it is read before the note fades.

/** Why a terminal refused an input, in numbers: its size, and how much of it
 * one paste (or typed text) carries — both the text's own bytes, so "of it":
 * the second is this text's, its escapes counted, not a fixed figure. */
export function inputRefusalWhy(refusal: RoutedInputRefusal): string {
  const size = sizeWords(refusal.bytes, Math.ceil);
  const fits = sizeWords(refusal.limitBytes, Math.floor);
  const what = refusal.kind === "paste" ? "one paste" : "typed text";
  return `${size}, and ${what} carries ${fits} of it`;
}

/** What the line says of a refused input, naming the pane as the deck names it
 * (`name`; absent — no pane of the deck shows that session — "the terminal"). */
export function inputRefusalNote(refusal: RoutedInputRefusal, name?: string): string {
  const into = name ?? "the terminal";
  const verb = refusal.kind === "text" ? "typed" : "pasted";
  return `Not ${verb} into ${into} — ${inputRefusalWhy(refusal)}`;
}

// A paste the frame makes ITSELF into a pane — a card played from the hand
// (HN-4) — says its own outcome, its refusal included, so the refusal is said
// once (HN-L5): while that paste runs, the line's hearer leaves every refusal
// to the paste's outcome. Every one, whatever its session: a refusal is
// announced INSIDE the input call that caused it (encode-input.ts, through the
// pool's hearers), so a refusal heard while the frame's paste runs is that
// paste's — and the session a pane shows can change while a card waits for its
// input to open (⌘T, a Resume), so a claim kept to the session the card was
// aimed at would miss it, and the refusal would be said twice.
let claims = 0;

/** Run `paste` — a paste the frame makes into a pane — with every refusal heard
 * while it runs claimed for its own outcome. */
export function claimingRefusals<T>(paste: () => T): T {
  claims += 1;
  try {
    return paste();
  } finally {
    claims -= 1;
  }
}

/** The line's hearer asks: is a paste the frame makes itself running now — one that says its own
 * refusal? */
export function refusalClaimed(): boolean {
  return claims > 0;
}
