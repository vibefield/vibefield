// The History pane's words (track AO, AO-3; DESIGN.md §8 "The Setup Assistant's
// agent chapter" — History; §9 "The agents' words"). Apart from the pane's
// code, so the Setup Assistant can say them while the pane itself loads.

export const HISTORY_WORDS = {
  eyebrow: "History",
  title: "Bring in your past sessions.",
  voice: "Find your agents' past conversations on this Mac and pick up where you left off.",
  bringIn: "Bring in history",
  without: "Continue without history",
  notNow: "Not now",
  /** W3 — where the question went */
  later: "Bring it in anytime from History.",
  looking: "Looking for past sessions…",
  unavailable: "History isn't available right now. You can bring sessions in later from History.",
  /** HG-2 (DESIGN.md §9) — inside History its later is no later at all: the first sentence alone, as Settings says it */
  unavailableHere: "History isn't available right now.",
  /** HG-D6 — the act, named while its press runs (§7's running press) */
  bringingIn: "Bringing in…",
  /** HG-D4 — under the act, while the room behind the card is the sample */
  sample: "The room behind this card is a sample. Yours takes its place.",
  /** HG-D4, with nothing to bring in: there is no "yours" to take its place yet */
  sampleShort: "The room behind this card is a sample.",
  /** HG-2 — a census with nothing to bring in, never a dead end */
  emptyTitle: "Your history starts here.",
  emptyVoice:
    "When you work with an agent on this Mac, its sessions appear here, by project, ready to pick up again.",
  lookAgain: "Look again",
  privacy: "Your history stays on your devices. Nothing is uploaded.",
  /** AO-6b — a new agent with a past, at History's head, once per agent */
  newAgent: (label: string) => `${label} has history on this Mac.`,
  bringItIn: "Bring it in",
} as const;

/** The face of the pane's look on the Setup Assistant's glass (FG-4b): the hold
 * while the pane's code arrives and the census's own look are one load, so the
 * frame carries the one into the other without a fade. */
export const HISTORY_LOOKING_FACE = "history:looking";
