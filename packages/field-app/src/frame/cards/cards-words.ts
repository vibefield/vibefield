import type { FrameView, ScreenshotCaptureError } from "@vibefield/contracts";
import { relativeTime } from "../../format/relative-time";
import type { AgentCard, Card, CardOrigin } from "./cards-model";

/**
 * Every word the hand says (DESIGN.md §8 "The hand", §9's voice): the line of
 * provenance over a reached card, what a place answers under a carried card,
 * the outcome of a play, and the faces' stand-ins while a card from another
 * app is still on its way. PURE — the views and the suite read the same words.
 */

const VIEW_NAMES: Readonly<Record<FrameView | "outside", string>> = {
  canvas: "Canvas",
  godview: "Godview",
  history: "History",
  assistant: "Chat",
  outside: "Another app",
};

const HOW_WORDS: Readonly<Record<CardOrigin["how"], string | null>> = {
  copy: null,
  snapshot: "snapshot",
  paste: "⌘V",
  drag: "dragged in",
};

export function viewName(view: FrameView | "outside"): string {
  return VIEW_NAMES[view];
}

/** Where a card came from, as the line over it says: "Godview · claude·2 ·
 * 2m ago", "Canvas · snapshot · just now", "Another app · ⌘V · just now". */
export function provenance(card: Card, now: number): string {
  const how = HOW_WORDS[card.origin.how];
  return [viewName(card.origin.view), card.origin.place ?? how, relativeTime(card.at, now)]
    .filter((part): part is string => part !== null && part !== undefined && part !== "")
    .join(" · ");
}

/** How long a card's name runs before it is cut, counted by code point. */
const NAME_POINTS = 60;

/** A card's name, as an outcome or an accessible name says it: one line (its runs of white space
 * one space), cut at 60 code points with "…" so a character is never split — "Remove Vela: codex·2
 * wants to push…", never a whole message. */
export function cardName(card: Card): string {
  const flat = fullName(card).replace(/\s+/gu, " ").trim();
  const points = Array.from(flat);
  if (points.length <= NAME_POINTS) return flat;
  return `${points.slice(0, NAME_POINTS).join("").trimEnd()}…`;
}

function fullName(card: Card): string {
  switch (card.kind) {
    case "text":
      return card.title;
    case "file":
      return card.name;
    case "agent":
      return card.handle;
    case "term":
      return card.first;
    case "msg":
      return `${card.speaker}: ${card.words}`;
    case "pict":
      return card.title;
  }
}

/** What a carried card's target says under the pointer, before it is let go. */
export const TARGET_WORDS = {
  pane: (name: string) => `Paste into ${name}`,
  prompt: (name: string) => `Add to your message to ${name}`,
  deskNote: "Place as a note",
  deskPrint: "Place as a print",
  deskRefuses: (card: Card) =>
    card.kind === "agent" ? "The desk can't hold an agent yet" : "The desk can't hold a file yet",
  hand: "Into your hand",
  opening: (view: FrameView) => `Opening ${viewName(view)}`,
  /** HN-L5: a picture plays into a pane as its file's path, as a Finder drop
   * does; a picture with no file has none to give. */
  pictureNoFile: "A picture with no file can't be pasted yet",
  /** The desk cannot take anything now: an object in hand (R14, the create's
   * own words), the pegboard out, a board this window may not write. */
  deskHeld: "Put it down first",
  deskBoardOut: "Close the objects first",
  deskReadOnly: "This board is read-only",
  /** a picture whose pixels this window cannot reach (no bytes, no still door) */
  deskNoPicture: "This picture can't be placed yet",
} as const;

/** What a play says once it is done (the status line's note). */
export const OUTCOME_WORDS = {
  pasted: (name: string) => `Pasted into ${name}`,
  added: (name: string) => `Added to your message to ${name}`,
  placedNote: "Placed as a note",
  placedPrint: "Placed as a print",
  already: "Already in your hand",
  /** the pane's input did not open in time (a spring-loaded drop), or closed */
  notTaking: (name: string) => `Not pasted — ${name}'s pane is not taking input`,
  /** the pane let go on is gone by the time the card plays */
  paneGone: "Not pasted — that pane has closed",
  /** main no longer keeps the still a snapshot's card shows (its ring moved on) */
  printGone: "Not placed — that snapshot is no longer kept",
  /** …and so a pane is not handed its path, which names nothing now */
  pasteGone: "Not pasted — that snapshot is no longer kept",
  /** the desk refused the object (the reason is in the log) */
  notPlaced: "Not placed — the desk could not take it",
} as const;

/** A drag from another app is a card before the system says what it holds
 * (HN-D2): its face says only its kind until it is let go. */
export const WAITING_WORDS = {
  text: "Text from another app",
  image: "An image",
  file: "A file",
  files: (n: number) => `${n} files`,
  letGo: "Let go to see it",
} as const;

/** The raised hand and a card picked up (HN-D5). */
export const HAND_WORDS = {
  raise: "Your hand  ⇧⌘V",
  remove: "Remove",
  done: "Done",
  empty: "Nothing in your hand yet",
  removeKey: "Remove  ⌫",
  /** Done's key, said and never printed (FR-5) */
  doneKey: "Done  Esc",
  /** the ×'s name, for a reader that hears it */
  removeCard: (name: string) => `Remove ${name}`,
  /** the hand's own name, for a reader: the fan, and the raised hand's list */
  name: "Your hand",
  /** a card of the raised hand, for a reader: its name, then where it came from */
  option: (name: string, from: string) => `${name} — ${from}`,
  /** the product chord's row (Settings → Terminal → Keyboard says it) */
  chord: "Your hand",
} as const;

/** An agent's card says its state at its foot (the swarm's states, in the card's words). */
export const AGENT_STATE_WORDS: Readonly<Record<NonNullable<AgentCard["state"]>, string>> = {
  working: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  ended: "Ended",
};

/** A snapshot that did not come back, said on the line's note: the line's own words for it. */
export const CAPTURE_WORDS = {
  failed: (message: string) => `Not captured — ${message}`,
} as const;

/** A capture the tool refused, in the honest words the clipboard tray's Snap tile said (SNAP-3;
 * they moved to the line's snapshot with the door, HN-2): what a person can act on first, the
 * tool's own reason otherwise. */
export function captureRefusal(error: ScreenshotCaptureError): string {
  switch (error.code) {
    case "permission-denied":
      return "Screen Recording is off — System Settings › Privacy & Security";
    case "helper-missing":
    case "unsupported-platform":
      return "Not captured — no capture helper on this platform";
    case "busy":
      return "Not captured — one capture at a time";
    default:
      return CAPTURE_WORDS.failed(error.message);
  }
}

/** The desk's Copy when it deals no card (HN-D3), said on the line: a picture needs the desk to draw what is copied. */
export const COPY_WORDS = {
  offScreen: "Not copied — it is off the screen",
  notDrawn: "Not copied — the desk could not draw it",
} as const;

/** HN-5 — a copy the system clipboard did not take deals no card (copy-door.ts), and says why
 * after "Not copied —", as the desk's Copy says its own. A refusal of main's picture door comes
 * in main's words, the clipboard read's voice (item 102), "the clipboard is written only for the
 * focused window"; these are the rest. */
export const COPY_DOOR_WORDS = {
  /** the host's copy door, or the page's own clipboard, did not take the words */
  words: "the clipboard did not take the words",
  /** the page's own clipboard did not take the picture (no host: the browser catalog) */
  picture: "the clipboard did not take the picture",
  /** a refusal as the line says it */
  refused: (reason: string) => `Not copied — ${reason}`,
} as const;

/** HN-5 — the place a copy was made when it is a sheet over the view, not the view's own
 * surface: its card's provenance names it after the view under it ("Canvas · Settings · just
 * now"). History's own copies name History alone. */
export const COPY_PLACES = {
  settings: "Settings",
  setup: "Setup Assistant",
} as const;
