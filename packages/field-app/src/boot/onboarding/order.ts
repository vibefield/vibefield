import type { FieldUserProfile } from "../../host";

// The Setup Assistant's order (UA-3w; spec §6; track AO, AO-D1/AO-D2/AO-D13 —
// draft/thinking-agent-onboarding.md §8). Pure: which pane comes next, and
// where a resuming wizard enters (W6). Each pane's controller lives in panes/
// and its face in views/, one owner per file — this list is the one line two
// tracks share (AO's agent chapter and TS's Connect pane), so it stays short.
//
// The questions run name → the agent chapter (Agents and Profiles since AO-5,
// History since AO-3) → Connect → Setting up. The sync question left setup at
// TS-6 (TS-D13): the first new field after connecting asks it (`Head.tsx`).
// A chapter pane with nothing to
// decide moves on by itself (AO-L2). Setting up is
// not a question: it reports the work the answers started, shows the desk
// opening beneath it, and becomes Ready in place (AO-D2).

export type Pane =
  | "welcome"
  | "welcome-back"
  | "field"
  /** AO-5 — "Your agents are ready.": the agents on this Mac. */
  | "agents"
  /** AO-5 — "Every subscription, side by side.": This Mac, and a profile more. */
  | "profiles"
  /** AO-3 — "Bring in your past sessions.": whose history is read. */
  | "history"
  | "connect"
  /** The end of every path: the answers are recorded, the desk opens beneath
   * the glass, and the pane becomes Ready (a second user's has no welcome). */
  | "setting-up"
  /** The users chooser (§6.2; DESIGN.md §8) — where a second user's Back leads.
   * By then this user exists, so going back means choosing who to enter. */
  | "users";

/** UA-5 §6.2 — who this wizard is setting up. A field a version-skewed writer
 * set, never a schema field (host.ts). */
export type SetupVariant = "fresh" | "second-user" | "migrated";

export function variantOf(profile: FieldUserProfile): SetupVariant {
  if (profile.setupVariant === "migrated") return "migrated";
  if (profile.setupVariant === "second-user") return "second-user";
  return "fresh";
}

/** W6, before anything is asked of the daemon. A record with no face never
 * finished the name pane (mint never writes one — UA-D17), so the wizard starts
 * at the top; a pre-v0.3 record's `color` proves the same thing. "The top" is
 * variant-specific: a second user starts AT the name pane, because the field
 * it is joining needs no welcome. Null: the record answered the name pane, and
 * where to resume depends on facts the daemon holds (`entryAfterName`). */
export function entryBeforeAsking(profile: FieldUserProfile): Pane | null {
  if (profile.face !== undefined || profile.color !== undefined) return null;
  const variant = variantOf(profile);
  if (variant === "migrated") return "welcome-back";
  if (variant === "second-user") return "field";
  return "welcome";
}

/** W6, once the link and the ledger have answered (or their bounded wait ran
 * out): the first thing still unanswered. Migration's only remaining step
 * after the name is the end — its link, if there is one, is acknowledged
 * rather than re-asked (spec §6, migration); its history is History's own
 * pane's to ask (AO-D12). The agent chapter's steps are the ledger's rows
 * (AO-2); a linked user has nothing left to answer here (TS-6). */
export function entryAfterName(
  variant: SetupVariant,
  facts: {
    linked: boolean;
    agentsAnswered: boolean;
    profilesAnswered: boolean;
    historyAnswered: boolean;
  },
): Pane {
  if (variant === "migrated") return "setting-up";
  if (!facts.agentsAnswered) return "agents";
  if (!facts.profilesAnswered) return "profiles";
  if (!facts.historyAnswered) return "history";
  return facts.linked ? "setting-up" : "connect";
}

/** Where each question goes once it is answered or put off: the same place
 * either way, since TS-6 took the sync question (Connect's follower) out of
 * setup — the first new field after connecting asks it (TS-D13). */
export function nextPane(
  from: Exclude<Pane, "setting-up" | "users">,
  facts: { variant: SetupVariant },
): Pane {
  switch (from) {
    case "welcome":
    case "welcome-back":
      return "field";
    case "field":
      return facts.variant === "migrated" ? "setting-up" : "agents";
    case "agents":
      return "profiles";
    case "profiles":
      return "history";
    case "history":
      return "connect";
    case "connect":
      return "setting-up";
  }
}
