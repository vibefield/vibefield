// The History pane's words (track AO, AO-3; DESIGN.md §8 "The Setup Assistant's
// agent chapter" — History; §9 "The agents' words"). Apart from the pane's
// code, so the Setup Assistant can say them while the pane itself loads.

export const HISTORY_WORDS = {
  eyebrow: "History",
  title: "Bring in your past sessions.",
  voice:
    "Search everything your agents did on this Mac, and pick up any session where it left off.",
  bringIn: "Bring in history",
  without: "Continue without history",
  notNow: "Not now",
  /** W3 — where the question went */
  later: "Bring it in anytime from History.",
  looking: "Looking for past sessions…",
  unavailable: "History isn't available right now. You can bring sessions in later from History.",
  privacy: "Your history stays on your devices. VibeField reads it here and never uploads it.",
  /** AO-6b — a new agent with a past, at History's head, once per agent */
  newAgent: (label: string) => `${label} has history on this Mac.`,
  bringItIn: "Bring it in",
} as const;

/** The face of the pane's look on the Setup Assistant's glass (FG-4b): the hold
 * while the pane's code arrives and the census's own look are one load, so the
 * frame carries the one into the other without a fade. */
export const HISTORY_LOOKING_FACE = "history:looking";
