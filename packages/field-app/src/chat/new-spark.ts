import {
  type AgentModelChoice,
  type AgentModelSelection,
  AgentModelsResult,
  type AgentProfileSet,
  type AgentProviderSummary,
  AgentProvidersResult,
  AgentsProfileSetsListResult,
  ComposeSparksHatchResult,
  type SparkSummary,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";

// THE NEW SPARK SHEET'S MODEL (SP-1c; DESIGN.md §8 "The New spark sheet"; NS-D1 A, NS-D2 B, NS-D5). Pure but for the
// port at its foot: what the sheet suggests, which agents can be a spark, what Create sends, and where a refusal is
// said. Every agent id is the catalog's and opaque (AR-L1): a spark's agent is whichever row of `agent.providers`
// declares the briefing, never a name compared here.

/** The names the sheet suggests, each a star (the Sparks page's list). Each suggestion lands in a different palette
 * from the last on the page; here the face is dealt apart (NS-D2 B), so the list is only names. */
export const STAR_NAMES = [
  "Polaris",
  "Capella",
  "Altair",
  "Deneb",
  "Io",
  "Castor",
  "Maia",
  "Spica",
  "Mira",
  "Kai",
  "Elara",
  "Ariel",
] as const;

/** The first star name no spark holds, compared without case (names are unique per user, `SparkName`). */
export function suggestName(taken: readonly string[]): string {
  const held = new Set(taken.map((name) => name.toLowerCase()));
  return STAR_NAMES.find((name) => !held.has(name.toLowerCase())) ?? `Spark ${taken.length + 1}`;
}

/** A face, dealt: a seed in the engine's 32-bit range (`SparkFace.seed`). ↻ deals another (NS-D2 B). */
export function dealSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0x1_0000_0000) >>> 0;
}

/** One agent as the sheet's menu offers it: one a spark can think with, or one disabled with why. */
export interface SparkAgent {
  readonly id: string;
  readonly label: string;
  readonly takes: boolean;
  /** why it cannot be a spark yet, when it cannot */
  readonly why?: string;
}

/** The words for an agent that cannot take the briefing yet (DESIGN.md §8). */
export const CANNOT_TAKE_TOOLS = "can't take VibeField's tools yet";

/** The agents the sheet lists: every offered agent, a spark's when it declares all three briefing fields and a process
 * the door can name (CP-1d's gate, read from `agent.providers[].briefing`). */
export function sparkAgentsOf(providers: readonly AgentProviderSummary[]): SparkAgent[] {
  return providers.map((provider) => {
    const briefing = provider.briefing;
    const takes =
      briefing?.mcpServers === true &&
      briefing.allowTools === true &&
      briefing.instructions === true &&
      briefing.mcpServerProcess === "terminal";
    return takes
      ? { id: provider.id, label: provider.label, takes }
      : { id: provider.id, label: provider.label, takes, why: CANNOT_TAKE_TOOLS };
  });
}

/** The default Agent Profile: the one marked default, else the first (This Mac on a fresh install). */
export function defaultProfileOf(sets: readonly AgentProfileSet[]): AgentProfileSet | undefined {
  return sets.find((set) => set.default) ?? sets[0];
}

/** What the agent pill says: the agent, and the model and effort once one is chosen (NS-D1 A's "Claude Code · Opus 5.5 ·
 * high"); untouched, the agent alone — it thinks at its own model. */
export function agentLine(
  agent: SparkAgent | undefined,
  model: AgentModelChoice | undefined,
  selection: AgentModelSelection | undefined,
): string {
  if (agent === undefined) return "No agent can be a spark yet";
  if (model === undefined || selection === undefined) return agent.label;
  const effort = model.controls.find((control) => control.role === "effort");
  const value =
    effort === undefined
      ? undefined
      : effort.values.find((candidate) => candidate.id === selection.controls?.[effort.id]);
  return [agent.label, model.label, value?.label].filter(Boolean).join(" · ");
}

/** Where the sheet says a refusal (DESIGN.md §8): under what it asked. */
export type RefusalPlace = "name" | "agent" | "profiles" | "foot";

export interface SheetRefusal {
  readonly at: RefusalPlace;
  readonly words: string;
}

/** A hatch's refusal, placed by fieldd's reason (`compose.sparks.hatch`: `name-taken`, `no-sign-in`,
 * `unknown-profile`) and said in the sheet's words; anything else under the foot, in fieldd's. */
export function refusalOf(
  error: unknown,
  ask: { readonly name: string; readonly agent?: string; readonly profile?: string },
): SheetRefusal {
  const details = (error as { details?: { reason?: unknown } } | null)?.details;
  const reason = typeof details?.reason === "string" ? details.reason : undefined;
  const message = error instanceof Error ? error.message : String(error);
  switch (reason) {
    case "name-taken":
      return { at: "name", words: `${ask.name} is taken` };
    case "no-sign-in":
      return {
        at: "agent",
        words:
          ask.profile !== undefined && ask.agent !== undefined
            ? `${ask.profile} has no ${ask.agent} sign-in`
            : message,
      };
    case "unknown-profile":
      return { at: "profiles", words: "That profile is gone" };
    default:
      return { at: "foot", words: message };
  }
}

/** An agent's own picker as the menu holds it: being read, read (`agent.models`' answer), or why the read failed. */
export type ModelsReading =
  | { readonly state: "reading" }
  | { readonly state: "read"; readonly answer: AgentModelsResult }
  | { readonly state: "failed"; readonly words: string };

/** One row of the agent menu: an agent's head, a model of its picker, or a word in place of the picker. */
export type AgentMenuRow =
  | {
      readonly kind: "agent";
      readonly agent: SparkAgent;
      /** the profile whose sign-in it thinks under, on that agent's head */
      readonly under?: string;
    }
  | {
      readonly kind: "model";
      readonly id: string | null;
      readonly label: string;
      readonly on: boolean;
    }
  | { readonly kind: "note"; readonly words: string };

/** The agent menu (DESIGN.md §8): every agent's head, disabled with why when it cannot be a spark; under the chosen
 * one, its own model first, then its picker's models, or a word while they are read or why they could not be. `under`
 * is the profile it thinks under, said on the chosen agent's head once there is more than This Mac. */
export function agentMenuOf(
  agents: readonly SparkAgent[],
  chosen: string | undefined,
  picker: ModelsReading | undefined,
  selection: AgentModelSelection | undefined,
  under?: string,
): AgentMenuRow[] {
  return agents.flatMap((agent): AgentMenuRow[] => {
    const mine = agent.takes && agent.id === chosen;
    const head: AgentMenuRow = {
      kind: "agent",
      agent,
      ...(mine && under !== undefined ? { under } : {}),
    };
    if (!mine) return [head];
    const rows: AgentMenuRow[] = [
      { kind: "model", id: null, label: "Its own model", on: selection === undefined },
    ];
    if (picker === undefined || picker.state === "reading")
      rows.push({ kind: "note", words: `Reading ${agent.label}'s models…` });
    else if (picker.state === "failed") rows.push({ kind: "note", words: picker.words });
    else if (picker.answer.catalog === undefined)
      rows.push({
        kind: "note",
        words: picker.answer.failure?.message ?? `${agent.label} lists no models`,
      });
    else
      for (const choice of picker.answer.catalog.models)
        rows.push({
          kind: "model",
          id: choice.id,
          label: choice.label,
          on: selection?.modelId === choice.id,
        });
    return [head, ...rows];
  });
}

/** The chosen model's Effort, as the menu's segmented control. */
export interface EffortChoice {
  readonly label: string;
  readonly values: readonly { readonly id: string; readonly label: string; readonly on: boolean }[];
}

/** The Effort a chosen model offers; none until a model is chosen, since untouched it thinks at its agent's own. */
export function effortOf(
  model: AgentModelChoice | undefined,
  selection: AgentModelSelection | undefined,
): EffortChoice | undefined {
  const control = model?.controls.find((candidate) => candidate.role === "effort");
  if (control === undefined || selection === undefined) return undefined;
  const value = selection.controls?.[control.id] ?? control.defaultValue;
  return {
    label: control.label,
    values: control.values.map((choice) => ({
      id: choice.id,
      label: choice.label,
      on: choice.id === value,
    })),
  };
}

/** One chip of the profiles row (NS-D5). */
export interface ProfileChip {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  /** the one it thinks under: always checked, never unchecked */
  readonly home: boolean;
}

/** The profiles row: every profile, the chosen ones checked, and the one it thinks under checked and locked. */
export function profileChipsOf(
  sets: readonly AgentProfileSet[],
  chosen: readonly string[],
  thinksUnder: string | undefined,
): ProfileChip[] {
  return sets.map((set) => ({
    id: set.id,
    label: set.label,
    checked: chosen.includes(set.id) || set.id === thinksUnder,
    home: set.id === thinksUnder,
  }));
}

/** The agents a spark of these profiles can start: each one signed in under one of them, by its label. */
export function startsOf(
  sets: readonly AgentProfileSet[],
  chosen: readonly string[],
  thinksUnder: string | undefined,
  agents: readonly SparkAgent[],
): string[] {
  const providers = sets
    .filter((set) => chosen.includes(set.id) || set.id === thinksUnder)
    .flatMap((set) => set.personas.filter((persona) => persona.identity?.loggedIn === true))
    .map((persona) => persona.provider);
  return [...new Set(providers)].map(
    (provider) => agents.find((agent) => agent.id === provider)?.label ?? provider,
  );
}

/** How many of the person's live sessions these profiles let a spark see, from the field board's tally by persona:
 * each profile's personas, and a native profile's agents' own folders too. Null until the board is read. */
export function sessionsSeenOf(
  tally: ReadonlyMap<string | null, number> | null,
  sets: readonly AgentProfileSet[],
  chosen: readonly string[],
): number | null {
  if (tally === null) return null;
  const seen = sets.filter((set) => chosen.includes(set.id));
  const personas = new Set(seen.flatMap((set) => set.personas.map((persona) => persona.profileId)));
  let count = seen.some((set) => set.kind === "native") ? (tally.get(null) ?? 0) : 0;
  for (const profile of personas) count += tally.get(profile) ?? 0;
  return count;
}

/** The line under the chips (DESIGN.md §8): how many of the person's sessions its profiles let it see, then what it
 * can start. The count waits for the field board's first reading. */
export function reachOf(sessions: number | null, starts: readonly string[]): string {
  const start =
    starts.length === 0
      ? "starts no agent yet: none of these profiles holds a sign-in"
      : `starts ${listWords(starts)}`;
  if (sessions === null) return `${start.charAt(0).toUpperCase()}${start.slice(1)}`;
  return `Sees ${sessions} ${sessions === 1 ? "session" : "sessions"} · ${start}`;
}

/** "Claude Code", "Claude Code and Codex", "Claude Code, Codex and Grok". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** What the sheet asks of fieldd, through the window's client in the product and a fixture in the catalog. */
export interface NewSparkPort {
  providers(): Promise<readonly AgentProviderSummary[]>;
  profileSets(): Promise<readonly AgentProfileSet[]>;
  /** the agent's own picker, under a profile's sign-in (`agent.models`) */
  models(provider: string, profileSet: string): Promise<AgentModelsResult>;
  hatch(params: {
    readonly name: string;
    readonly face: { readonly seed: number };
    readonly agent: string;
    readonly modelSelection?: AgentModelSelection;
    readonly profiles: readonly string[];
    readonly thinksUnder: string;
  }): Promise<SparkSummary>;
}

export function newSparkPortOver(client: FielddClient): NewSparkPort {
  return {
    providers: async () =>
      AgentProvidersResult.parse(await client.request("agent.providers", {})).providers,
    profileSets: async () =>
      AgentsProfileSetsListResult.parse(await client.request("agents.profileSets.list", {})).sets,
    models: async (provider, profileSet) =>
      AgentModelsResult.parse(await client.request("agent.models", { provider, profileSet })),
    hatch: async (params) =>
      ComposeSparksHatchResult.parse(await client.request("compose.sparks.hatch", params)).spark,
  };
}
