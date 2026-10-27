import type { AgentProfileSet } from "@vibefield/contracts";
import {
  type ProfileAgentRow,
  type ProfilesContext,
  profilePage,
} from "../panels/agents/profiles-model";

// The Profiles pane, as the Setup Assistant draws it (track AO, AO-5; DESIGN.md
// §8 "The Setup Assistant's agent chapter" — Profiles). Pure: This Mac in the
// person's own sign-ins — each agent, who it is signed in as and the plan it
// runs on, by name — the profiles made beside it, and the agents a new profile
// can sign in to. The rows are Agent Profiles' own (`profilePage`), so the
// pane and Settings never say a sign-in two ways.

/** One agent on This Mac's card. */
export interface ThisMacRow {
  readonly provider: string;
  readonly profileId: string;
  readonly label: string;
  /** who it is signed in as ("Signed in as kim@example.com"), or where it stands */
  readonly fact: string;
  /** the plan it runs on, by its product name, when one is known */
  readonly plan?: string;
  /** its own login can run in the pane: never signed in (`first`), or lapsed
   * (`again`); absent while signed in */
  readonly signIn?: "first" | "again";
}

/** A profile made beside This Mac. */
export interface OtherProfile {
  readonly id: string;
  readonly label: string;
  readonly glyph?: string;
  /** its agents' labels, in its order */
  readonly agents: readonly string[];
}

export interface ProfilesPaneModel {
  /** This Mac's set; null until the feed names it */
  readonly thisMac: { readonly id: string; readonly rows: readonly ThisMacRow[] } | null;
  readonly others: readonly OtherProfile[];
  /** the agents on this Mac a new profile can sign in to */
  readonly addable: ReadonlyArray<{ readonly provider: string; readonly label: string }>;
  /** fieldd is still reading This Mac's sign-ins */
  readonly reading: boolean;
}

/** "Signed in as kim@example.com" for a sign-in that named its account; the
 * row's own words for every other state. */
export function thisMacFact(row: ProfileAgentRow): string {
  if (row.state !== "signed-in") return row.fact;
  const identity = row.persona.identity;
  const who = identity?.email ?? identity?.account ?? identity?.organization;
  return who === undefined ? "Signed in" : `Signed in as ${who}`;
}

function thisMacRow(row: ProfileAgentRow): ThisMacRow {
  const plan = row.badges.find((badge) => badge.runsOn && !badge.payAsYouGo)?.title;
  return {
    provider: row.provider,
    profileId: row.persona.profileId,
    label: row.label,
    fact: thisMacFact(row),
    ...(plan !== undefined ? { plan } : {}),
    ...(row.state === "signed-out"
      ? { signIn: "first" as const }
      : row.state === "expired"
        ? { signIn: "again" as const }
        : {}),
  };
}

export function profilesPaneModel(context: ProfilesContext): ProfilesPaneModel {
  const native = context.sets.find((set) => set.kind === "native");
  const page = native === undefined ? undefined : profilePage(native, context);
  const labelOf = (provider: string): string =>
    context.providers.find((summary) => summary.id === provider)?.label ?? provider;
  const installed = new Set(context.installs.map((install) => install.provider));
  return {
    thisMac:
      native === undefined || page === undefined
        ? null
        : { id: native.id, rows: page.rows.map(thisMacRow) },
    others: context.sets
      .filter((set): set is AgentProfileSet => set.kind === "managed")
      .map((set) => ({
        id: set.id,
        label: set.label,
        ...(set.glyph !== undefined ? { glyph: set.glyph } : {}),
        agents: set.personas.map((persona) => labelOf(persona.provider)),
      })),
    addable: context.signIn
      .filter((provider) => installed.has(provider))
      .map((provider) => ({ provider, label: labelOf(provider) })),
    reading: context.reading,
  };
}

/** AO-L2 — the pane shows only where there is something to explain: an agent
 * on this Mac, in This Mac's own folders. */
export function profilesPaneShows(model: ProfilesPaneModel): boolean {
  return model.thisMac !== null && model.thisMac.rows.length > 0;
}
