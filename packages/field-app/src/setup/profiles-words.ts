// The Profiles pane's words (track AO, AO-5; DESIGN.md §8 "The Setup Assistant's
// agent chapter" — Profiles; §9 "The agents' words"). Apart from the pane's
// code, so the Setup Assistant can say them while the pane itself loads.

export const PROFILES_WORDS = {
  eyebrow: "Profiles",
  title: "Every subscription, side by side.",
  voice:
    "A profile holds one sign-in for each agent. This Mac is your first: it uses the accounts your agents are already signed in to.",
  offer: "Another plan, for work or a client? Give it a profile.",
  add: "Add a profile…",
  fact: "Profiles keep their sign-ins apart, so they work at the same time and never sign each other out.",
  /** W3 — where the question went */
  later: "Add one anytime in Settings → Agent Profiles.",
  reading: "Reading who is signed in…",
  signIn: "Sign in…",
  /** the add, one field a step */
  nameLabel: "Name this profile",
  namePlaceholder: "Work, a client, Personal…",
  next: "Next",
  cancel: "Cancel",
  agentTitle: (name: string) => `Sign in to an agent in ${name}`,
  making: "Making…",
  ready: (name: string) =>
    `${name} is ready. It starts with clean settings: its own skills and servers.`,
  /** the sign-in ended before the agent said who: the profile is not kept */
  againTitle: "Sign in again",
  /** Continue waits while a sign-in is open */
  finishFirst: "Finish or cancel the sign-in first.",
} as const;
