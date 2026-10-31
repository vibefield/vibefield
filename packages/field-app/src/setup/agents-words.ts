// The Agents pane's words (track AO, AO-5; DESIGN.md §8 "The Setup Assistant's
// agent chapter" — Agents; §9 "The agents' words"). Apart from the pane's code,
// so the Setup Assistant can say them while the pane itself loads.

export const AGENTS_WORDS = {
  eyebrow: "Agents",
  title: "Your agents are ready.",
  /** while the inventory has not answered, or could not: no claim yet */
  plainTitle: "Your agents.",
  voice:
    "VibeField found these on this Mac. It runs them as they are, with your settings and sign-ins, and keeps them up to date.",
  /** nothing installed */
  firstTitle: "Add your first agent.",
  firstVoice:
    "VibeField runs the coding agents you install, as they are, with your settings and sign-ins, and keeps them up to date.",
  /** Settings → Agents' own sentence, until Get (AO-7) */
  firstFact: "Install one, and it appears here.",
  lookAgain: "Look again",
  lookingAgain: "Looking…",
  ready: "Ready",
  /** a supported agent this Mac does not have; Get takes its place (AO-7) */
  missing: "Not on this Mac",
  more: "More agents",
  /** W3 — where the question went */
  later: "Add agents anytime in Settings → Agents.",
  /** the page's §10 states table, word for word */
  looking: "Looking on this Mac…",
  unavailable: "VibeField couldn't read the agents on this Mac.",
  tryAgain: "Try again",
} as const;

/** The face of the pane's look on the Setup Assistant's glass (FG-4b): the hold
 * while the pane's code arrives and the pane's own look are one load, so the
 * frame carries the one into the other without a fade. */
export const AGENTS_LOOKING_FACE = "agents:looking";
