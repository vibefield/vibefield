import {
  AGENT_OFFERED_STATUSES,
  AGENT_VISIBLE_STATUSES,
  AgentCatalogStatus,
  type AgentOffers,
  type AgentPersona,
  type AgentProviderSummary,
  catalogEntry,
} from "@vibefield/contracts";

/**
 * THE PICKER'S ROWS (AC-4, thinking-ar-agent-catalog.md §5.3) — the catalog's
 * decision, as the deck's provider picker draws it.
 *
 * An `agent.providers` row can carry the catalog's decision about its agent:
 * `status` (supported · preview · deprecated), `offers` (what VibeField
 * claims for the agent, at most what the pins implement) and `history` (the
 * index's state for the agent on this device). This module is the picker's
 * reading of those three. It is pure, so every rule is testable without a
 * stage, and it is ONE place: the chrome's SPAWN, the views' own create
 * gesture and the persona choice all ask it, so no two of them can disagree
 * about what a row offers.
 *
 * Five rules, each a decision:
 *
 *   · A row WITHOUT a status is drawn exactly as before. A daemon before AC-3
 *     answers from puppeteer's composed list and decides nothing, and absence
 *     is not `supported` — it is no claim. No badge, no refusal, no guess.
 *   · The badge is the decision's WORD, and only where it changes what the
 *     user can expect: `preview` (offered, not yet witnessed live here) and
 *     `deprecated` (no new sessions). `supported` is the quiet default.
 *   · A word this build never heard of is CARRIED, never refused (the tolerant
 *     reader; AC-3 opened `status` and `history` on the wire for exactly
 *     this): an unknown status is listed with its own word and offers
 *     nothing; an unknown history state is said as sent.
 *   · Verbs follow the row's claims, never its id: a new session only under a
 *     status that admits one (`AGENT_OFFERED_STATUSES`) and where the row does
 *     not deny `spawn`; a persona only where it claims `personas`. Resume stays
 *     with the door's own `resumable` (AC-3 folds `offers.resume` into it), so
 *     nothing here re-derives it.
 *   · No literal agent id (AR-L1, R23b). A label fallback reads the catalog
 *     (`catalogEntry`); nothing here keeps a table of names.
 */

/**
 * What the picker reads off one door row. STRUCTURAL rather than the
 * contract's `AgentProviderSummary`, because two wire shapes must both fit: a
 * daemon before AC-3 sends no decision at all, and from AC-3 `status` and
 * `offers` are required while `status` and `history` are OPEN words.
 */
export interface PickerRow {
  id: string;
  label: string;
  available: boolean;
  personas: readonly AgentPersona[];
  status?: string | undefined;
  /** the contract's own shape — partial to a reader (a key this build adds
   * later is one an older daemon's row lacks), absent = not claimed */
  offers?: AgentProviderSummary["offers"];
  history?: string | undefined;
}

/**
 * DESIGN.md §9's voice for the two decisions worth a badge: one word, sentence
 * case, no marketing. `supported` is quiet, and `declined` never reaches a
 * surface (it never leaves fieldd). Keyed by the contract's own enum, so a
 * status added there is a type error here rather than a silent blank.
 */
const BADGE: Readonly<Record<AgentCatalogStatus, string | null>> = {
  supported: null,
  preview: "Preview",
  deprecated: "Deprecated",
  declined: null,
};

/** puppeteer's name for the native-default profile (the runtime's
 * `NATIVE_DEFAULT_PROFILE_LABEL`), for a door that did not list that persona. */
const NATIVE_DEFAULT_LABEL = "Default";

const within = (statuses: readonly string[], status: string): boolean => statuses.includes(status);

/** The status word as the contract names it, or undefined for a word this
 * build never heard of (the contract's own reader, not a second list). */
function knownStatus(word: string): AgentCatalogStatus | undefined {
  const parsed = AgentCatalogStatus.safeParse(word);
  return parsed.success ? parsed.data : undefined;
}

/** The row's badge word, or null: nothing for `supported`, nothing at all for
 * a row that carries no status, and a word this build never heard of in its
 * own spelling, sentence-cased like the badges it sits among. */
export function providerBadge(provider: Pick<PickerRow, "status">): string | null {
  const word = provider.status;
  if (word === undefined) return null;
  const known = knownStatus(word);
  if (known !== undefined) return BADGE[known];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Whether the picker lists the row: every status a surface may SHOW
 * (`AGENT_VISIBLE_STATUSES` — a deprecated agent's sessions and history stay),
 * every row that carries no decision, and every word this build never heard
 * of (carried). A `declined` row is not offered, so a picker whose whole
 * purpose is choosing what to start does not list it. */
export function providerListed(provider: Pick<PickerRow, "status">): boolean {
  const word = provider.status;
  if (word === undefined) return true;
  const known = knownStatus(word);
  return known === undefined || within(AGENT_VISIBLE_STATUSES, known);
}

/** Whether the row offers a NEW session: its status admits one and it does
 * not deny `spawn`. A row with no decision offers what it always did; a word
 * this build never heard of offers nothing. */
export function providerStartsSessions(provider: Pick<PickerRow, "status" | "offers">): boolean {
  if (provider.status !== undefined && !within(AGENT_OFFERED_STATUSES, provider.status)) {
    return false;
  }
  return provider.offers?.spawn !== false;
}

/** The name the picker shows: the door's label — the catalog's since AC-3
 * answers from the catalog (AC-D4) — and, for a row whose wire label is blank,
 * the catalog's own, then the id. The same rule as `providerLabel` for a
 * session row, with the one catalog read between the two that R23b allows. */
export function providerPickerLabel(provider: Pick<PickerRow, "id" | "label">): string {
  if (provider.label.trim() !== "") return provider.label;
  return catalogEntry(provider.id)?.label ?? provider.id;
}

/**
 * One row of the picker, as its option says it.
 *
 * The picker is a native select, and an option can carry nothing but text:
 * the OS draws the menu. So the badge is the decision's word in the row's own
 * text ("Grok · Preview"), and because a closed select's face IS the chosen
 * option's text, the face wears the same word — one statement of the decision
 * wherever the row is read, and no second chip repeating it beside the face.
 * " · " is DESIGN.md's separator for a fact about a thing; "not installed"
 * keeps the parenthesis it has always had.
 */
export function providerOptionText(
  provider: Pick<PickerRow, "id" | "label" | "available" | "status">,
): string {
  const label = providerPickerLabel(provider);
  const badge = providerBadge(provider);
  const named = badge === null ? label : `${label} · ${badge}`;
  return provider.available ? named : `${named} (not installed)`;
}

/**
 * Why the chosen row starts no new session, in the acknowledgement's words —
 * or null when it does. A view's create gesture cannot be withdrawn (the
 * views package always draws its own), so this is what that gesture hears
 * instead of a spawn.
 */
export function newSessionRefusal(
  provider: Pick<PickerRow, "id" | "label" | "status" | "offers">,
): string | null {
  if (providerStartsSessions(provider)) return null;
  const label = providerPickerLabel(provider);
  if (provider.status !== undefined && !within(AGENT_OFFERED_STATUSES, provider.status)) {
    return `${label} is ${provider.status} — it starts no new sessions`;
  }
  return `${label} starts no new sessions here`;
}

/** The provider chosen when the list arrives: the first that starts sessions
 * and is installed, then the first that starts sessions, then the first. */
export function defaultProviderId(
  providers: readonly Pick<PickerRow, "id" | "available" | "status" | "offers">[],
): string | null {
  return (
    providers.find((p) => providerStartsSessions(p) && p.available)?.id ??
    providers.find((p) => providerStartsSessions(p))?.id ??
    providers[0]?.id ??
    null
  );
}

/**
 * Whether the row CLAIMS personas (`offers.personas` true): the one reading
 * behind the persona choice below and the stage's own sign-in refusal under a
 * profile tab (AR-S5), so the two cannot disagree. Absence is no claim — a
 * daemon before AC-3 decides nothing — and neither is `false` (ACP), whose
 * agent takes no sign-in anywhere: advice to add one would be impossible.
 */
export function providerClaimsPersonas(provider: Pick<PickerRow, "offers">): boolean {
  return provider.offers?.personas === true;
}

/** One identity a new session can be born as. `value` is the persona's
 * `profileId`, or "" for the native default — the spawn then carries no
 * `profileId` at all. */
export interface PersonaChoice {
  value: string;
  label: string;
}

/**
 * THE PERSONA CHOICE (AC-4) — which identity a new session is born as.
 *
 * The deck had no persona control before AC-4 — `LocalSpawnRequest.profileId`
 * was plumbed at AR-3 and never chosen — so this is the one verb here that is
 * new rather than withdrawn, and it appears only where the row CLAIMS it:
 * the row starts sessions, `offers.personas` is true, and it lists at least
 * one managed persona beside the native default (a list of one is no choice).
 * A row that does not claim personas never shows one, whatever its list holds
 * — ACP by decision, and every row from a daemon before AC-3, which claims
 * nothing and so is drawn exactly as it was.
 *
 * The native default comes first, as the door orders it, and is the empty
 * value: a spawn under it is byte for byte the request the picker always sent,
 * so nothing a run is keyed by moves for the ordinary case.
 */
export function personaChoices(
  provider: Pick<PickerRow, "status" | "offers" | "personas">,
): readonly PersonaChoice[] {
  if (!providerStartsSessions(provider) || !providerClaimsPersonas(provider)) return [];
  const managed = provider.personas.filter((persona) => persona.kind === "managed");
  if (managed.length === 0) return [];
  const native = provider.personas.find((persona) => persona.kind === "native-default");
  return [
    { value: "", label: native?.label ?? NATIVE_DEFAULT_LABEL },
    ...managed.map((persona) => ({ value: persona.profileId, label: persona.label })),
  ];
}

/**
 * The index's state for the chosen agent, in the words of the deck's degraded
 * idiom — or null when there is nothing to say. `indexed` is the routine state
 * (DESIGN.md §8: the chrome never flickers with the healthy case); an absent
 * word is a daemon before AC-3 (no facts, no claim); and a row that does not
 * claim `history` has no index to be degraded (ACP — a protocol, not a ledger).
 * A state this build never heard of is said as sent, in the same idiom:
 * swallowing it would draw a degraded index as a healthy one.
 */
export function providerHistoryClaim(
  provider: Pick<PickerRow, "history" | "offers">,
): string | null {
  if (provider.offers?.history === false) return null;
  switch (provider.history) {
    case undefined:
    case "indexed":
      return null;
    case "unindexed":
      return "history not indexed";
    case "unavailable":
      return "history unavailable";
    default:
      return `history ${provider.history}`;
  }
}
