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
} as const;
