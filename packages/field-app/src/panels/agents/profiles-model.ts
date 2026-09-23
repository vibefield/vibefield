import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentInstall,
  AgentPersona,
  AgentProfileSet,
  AgentProviderSummary,
  AgentsProfileSetsListResult,
} from "@vibefield/contracts";

// Agent Profiles' one model (the design record's R1, pass 16: "Agent Profiles
// are places"). A profile is puppeteer's profile set as fieldd projects it —
// a named place holding one sign-in per agent, one folder under this user, a
// glyph, and at most one of them the default for new sessions; This Mac is
// every agent's own folder. This file only joins the doors' answers (the
// profiles feed, the installs, the usage feed) and words them. AR-L1: no
// vendor is named here — a provider is an id and puppeteer's label for it.

/** A sidebar entry under "Agent Profiles". */
export interface ProfileNavItem {
  id: string;
  label: string;
  kind: "native" | "managed";
  glyph?: string | undefined;
  isDefault: boolean;
}

export function profileNavItems(sets: readonly AgentProfileSet[]): ProfileNavItem[] {
  return sets.map((set) => ({
    id: set.id,
    label: set.label,
    kind: set.kind,
    ...(set.glyph !== undefined ? { glyph: set.glyph } : {}),
    isDefault: set.default,
  }));
}

/** Where a sign-in stands, as its row says it. */
export type SignInState =
  /** the identity read says someone is signed in */
  | "signed-in"
  /** it was signed in, and the account's usage now says it is not */
  | "expired"
  /** read, and nobody is signed in */
  | "signed-out"
  /** its login pane is open */
  | "signing-in"
  /** nothing has been read for it yet */
  | "unread"
  /** its agent signs in in this folder but never says who: whether and as
   * whom is the agent's own login's to know, and the row says only that */
  | "unverifiable";

/** One agent inside one profile. */
export interface ProfileAgentRow {
  provider: string;
  /** puppeteer's label for the agent */
  label: string;
  persona: AgentPersona;
  state: SignInState;
  /** the plan and who, or the state in words — the row's one fact line */
  fact: string;
  /** the account's windows (usage the provider reported), in the adapter's order */
  usage: AgentAccountUsageMetric[];
  /** the provider does not report usage at all */
  usageUnsupported: boolean;
}

export interface ProfilesContext {
  providers: readonly AgentProviderSummary[];
  installs: readonly AgentInstall[];
  usage: readonly AgentAccountUsageEntry[];
  /** providers whose adapter can run a sign-in in a folder (the feed's `signIn`) */
  signIn: readonly string[];
  /** of those, the ones whose adapter reads back who signed in (`identity`) */
  identity: readonly string[];
  /** providers whose adapter signs a folder out with the vendor's command */
  signOut: readonly string[];
  /** fieldd is reading This Mac's sign-ins now */
  reading: boolean;
}

export function emptyProfilesContext(feed?: AgentsProfileSetsListResult | null): ProfilesContext {
  return {
    providers: [],
    installs: [],
    usage: [],
    signIn: feed?.signIn ?? [],
    identity: feed?.identity ?? [],
    signOut: feed?.signOut ?? [],
    reading: feed?.reading ?? false,
  };
}

/** A profile's page. */
export interface ProfilePageModel {
  set: AgentProfileSet;
  /** "on This Mac", "in Work" — the preposition the record uses */
  inOn: string;
  rows: ProfileAgentRow[];
  /** installed agents that can sign in here and are not signed in yet */
  addable: Array<{ provider: string; label: string }>;
  /** the hero's fact line */
  facts: string;
}

const agentLabel = (context: ProfilesContext, provider: string): string =>
  context.providers.find((summary) => summary.id === provider)?.label ?? provider;

const installed = (context: ProfilesContext): Set<string> =>
  new Set(context.installs.map((install) => install.provider));

export function inOnWords(set: AgentProfileSet): string {
  return `${set.kind === "native" ? "on" : "in"} ${set.label}`;
}

/** The account usage reading that belongs to this sign-in: the persona's own
 * row, or — for an agent's own folder — the provider's unkeyed row. */
function usageFor(
  context: ProfilesContext,
  persona: AgentPersona,
): AgentAccountUsageEntry | undefined {
  return context.usage.find(
    (entry) =>
      entry.provider === persona.provider &&
      (entry.profileId === persona.profileId ||
        (persona.kind === "native-default" && entry.profileId === undefined)),
  );
}

export function signInState(
  persona: AgentPersona,
  usage: AgentAccountUsageEntry | undefined,
  readsIdentity = true,
): SignInState {
  if (persona.signingIn !== undefined) return "signing-in";
  if (!readsIdentity) return "unverifiable";
  const identity = persona.identity;
  if (identity === undefined) return "unread";
  if (!identity.loggedIn) return "signed-out";
  return usage?.state === "unauthenticated" ? "expired" : "signed-in";
}

/** The plan and who, as the row says it ("Max · kim@example.com"). */
export function whoWords(persona: AgentPersona): string | undefined {
  const identity = persona.identity;
  if (identity === undefined || !identity.loggedIn) return undefined;
  const parts = [identity.plan, identity.email ?? identity.organization].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function agentRow(context: ProfilesContext, persona: AgentPersona): ProfileAgentRow {
  const usage = usageFor(context, persona);
  const state = signInState(persona, usage, context.identity.includes(persona.provider));
  const who = whoWords(persona);
  const email = persona.identity?.email ?? persona.identity?.organization;
  const fact =
    state === "signing-in"
      ? "Signing in…"
      : state === "unread"
        ? context.reading
          ? "Checking…"
          : "Not checked yet"
        : state === "signed-out"
          ? "Not signed in"
          : state === "expired"
            ? `Sign-in expired${email !== undefined ? ` · ${email}` : ""}`
            : state === "unverifiable"
              ? "Doesn't say who is signed in"
              : (who ?? "Signed in");
  return {
    provider: persona.provider,
    label: agentLabel(context, persona.provider),
    persona,
    state,
    fact,
    usage: usage?.state === "available" || usage?.stale === true ? usage.metrics : [],
    usageUnsupported: usage?.state === "unsupported",
  };
}

export function profilePage(set: AgentProfileSet, context: ProfilesContext): ProfilePageModel {
  const here = installed(context);
  // This Mac lists every installed agent in its own folder, whatever that
  // folder's sign-in says (and one whose login pane is open); a profile lists
  // every sign-in it holds, whatever state it is in — a place shows what is in it.
  const rows = set.personas
    .filter((persona) =>
      set.kind === "native" ? here.has(persona.provider) || persona.signingIn !== undefined : true,
    )
    .map((persona) => agentRow(context, persona));
  const inProfile = new Set(rows.map((row) => row.provider));
  const addable = context.signIn
    .filter((provider) => here.has(provider) && !inProfile.has(provider))
    .map((provider) => ({ provider, label: agentLabel(context, provider) }));
  const count = rows.length;
  const facts = [
    count === 0 ? "No agents yet" : plural(count, "agent"),
    ...(set.kind === "native" ? ["each in its own folder"] : []),
    ...(set.default ? ["default for new sessions"] : []),
  ].join(" · ");
  return { set, inOn: inOnWords(set), rows, addable, facts };
}

/** Where one agent is signed in, profile by profile (the Agents page's
 * "Signed in under"): a profile's sign-in for it in any state, This Mac's only
 * when its own folder is signed in — the same rule a profile's page lists by. */
export function signedInUnder(
  sets: readonly AgentProfileSet[],
  provider: string,
  context: ProfilesContext,
): Array<{ set: AgentProfileSet; row: ProfileAgentRow }> {
  const found: Array<{ set: AgentProfileSet; row: ProfileAgentRow }> = [];
  for (const set of sets) {
    const persona = set.personas.find((candidate) => candidate.provider === provider);
    if (persona === undefined) continue;
    if (set.kind === "native" && persona.identity?.loggedIn !== true) continue;
    found.push({ set, row: agentRow(context, persona) });
  }
  return found;
}

// ── words (the record's, pass 16) ──

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The empty profile's two lines. */
export function emptyProfileWords(set: AgentProfileSet): { title: string; description: string } {
  return {
    title: `No agents ${inOnWords(set)} yet`,
    description:
      set.kind === "native"
        ? "An agent you install appears here, in its own folder. To keep work and personal apart, make another agent profile."
        : `Add an agent and sign in. It gets its own folder in ${set.label}; your other profiles stay as they are.`,
  };
}

export function defaultSwitchWords(isDefault: boolean): string {
  return isDefault
    ? "New sessions start here. To change that, turn this on in another profile."
    : "Spawns and the Godview launcher start here";
}

/** Why a profile can or cannot be deleted, and what deleting it takes. */
export function deleteWords(page: ProfilePageModel): {
  blocked: boolean;
  description: string;
  question: string;
  what: string;
} {
  const { set, rows } = page;
  const name = set.label;
  const names = rows.map((row) => row.label);
  return {
    blocked: set.default,
    description: set.default
      ? `${name} is the default for new sessions. Make another profile the default first.`
      : rows.length > 0
        ? `Deletes ${name}’s folder and the ${plural(rows.length, "sign-in")} in it.`
        : `Deletes ${name}’s folder. Nothing is signed in there.`,
    question: `Delete ${name}?`,
    what: `${set.folder !== undefined ? `Its folder, ${set.folder},` : "Its folder"} is deleted${
      names.length > 0 ? `, with the sign-ins for ${listWords(names)}` : ""
    }. Sessions running under ${name} stop first. Your subscriptions themselves aren’t touched.`,
  };
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function signOutWords(
  set: AgentProfileSet,
  label: string,
): { description: string; question: string; what: string } {
  return {
    description:
      set.kind === "native"
        ? `Signs ${label} out of its own folder on This Mac, with its own command. The subscription itself isn't touched.`
        : `Removes this sign-in from ${set.label}. The subscription itself isn't touched.`,
    question: `Sign out of ${label} ${inOnWords(set)}?`,
    what:
      set.kind === "native"
        ? `Sessions running now keep going until they end. To come back, sign in again from ${set.label}’s page.`
        : `Sessions running now keep going until they end. To come back, add ${label} again from ${set.label}’s page.`,
  };
}

/** The sign-in terminal's note: where the sign-in lands. */
export function signInNote(set: AgentProfileSet, label: string): string {
  return set.kind === "native"
    ? `This runs in ${label}’s own folder, so the sign-in lands there.`
    : `This runs in ${set.label}’s folder, so the sign-in lands there and nowhere else.`;
}

// ── the C1 timeline (pass 10, chosen): a window's time as the track ──

/** One usage window as the timeline draws it. */
export interface UsageLine {
  id: string;
  /** the adapter's own short label ("5H", "7D", "CR" for a credit budget) */
  label: string;
  /** used, as a percentage; the fill is clamped at 100, the words are not */
  usedPercent: number;
  /** how much of the window has passed — where "now" sits — when the adapter
   * reports the window's length; absent, no now line is drawn */
  elapsedPercent?: number;
  /** the reset, in words: "2h 10m", "Thu 09:00", or a budget's "$12 / $50" */
  reset?: string;
  /** a reset closes the track (a window, not a budget) */
  resets: boolean;
  /** ahead of pace, over the budget, or near the limit when pace is unknown */
  hot: boolean;
}

/** The record's rule (pass 8/9, `isHot`): orange when projected to run out
 * before the reset, over 100, or — with no pace to judge — at 80 or more. */
export function isHot(used: number, elapsed: number | undefined): boolean {
  if (used >= 100) return true;
  if (elapsed === undefined) return used >= 80;
  return elapsed > 0 && used > 40 && used / elapsed > 1.05;
}

/** How far from the fill's head, in the track's percent, the % label reaches:
 * the record's 8, widened so the label clears the line on a narrow track too. */
const PERCENT_REACH = 12;

/** Where the % sits (pass 16, `tl16`): inside the fill against its head once
 * the fill can hold it, just after the head before then — and stepped to the
 * free side of the now line whenever the two would touch. `edge` is the percent
 * the label keeps 5px from: its end when inside, its start when outside. */
export function percentPlace(
  used: number,
  elapsed: number | undefined,
): { inside: boolean; edge: number } {
  const head = Math.min(100, Math.max(0, used));
  const inside = head >= 22;
  if (elapsed === undefined) return { inside, edge: head };
  const touches = inside
    ? elapsed < head && elapsed >= head - PERCENT_REACH
    : elapsed > head && elapsed <= head + PERCENT_REACH;
  return { inside, edge: touches ? elapsed : head };
}

export function usageLines(metrics: readonly AgentAccountUsageMetric[], now: Date): UsageLine[] {
  return metrics.map((metric) => {
    const resetsAt = metric.resetsAt === undefined ? undefined : new Date(metric.resetsAt);
    const validReset = resetsAt !== undefined && !Number.isNaN(resetsAt.getTime());
    let elapsed: number | undefined;
    if (metric.durationMinutes !== undefined && validReset) {
      const window = metric.durationMinutes * 60_000;
      const left = resetsAt.getTime() - now.getTime();
      elapsed = Math.min(100, Math.max(0, (1 - left / window) * 100));
    }
    const budget = metric.kind === "budget";
    const line: UsageLine = {
      id: metric.id,
      label: metric.label,
      usedPercent: metric.usedPercent,
      resets: !budget && validReset,
      hot: isHot(metric.usedPercent, elapsed),
    };
    if (elapsed !== undefined) line.elapsedPercent = elapsed;
    if (validReset && !budget) line.reset = resetWords(resetsAt, now);
    return line;
  });
}

/** "2h 10m" under a day, "Thu 09:00" from a day on (pass 11's time rules). */
export function resetWords(at: Date, now: Date): string {
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const day = at.toLocaleDateString([], { weekday: "short" });
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${time}`;
}
