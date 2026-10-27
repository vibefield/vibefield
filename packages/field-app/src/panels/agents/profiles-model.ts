import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentHolding,
  AgentInstall,
  AgentPersona,
  AgentPlan,
  AgentProfileSet,
  AgentProviderSummary,
  AgentSignInRoute,
  AgentSignInService,
  AgentsProfileSetsListResult,
} from "@vibefield/contracts";
import { planTitle, serviceProduct } from "@vibefield/puppeteer-views";

// Agent Profiles' one model (the design record's R1, pass 16: "Agent Profiles
// are places"). A profile is puppeteer's profile set as fieldd projects it —
// a named place holding one sign-in per agent, one folder under this user, a
// glyph, and at most one of them the default for new sessions; This Mac is
// every agent's own folder. This file only joins the doors' answers (the
// profiles feed, the installs, the usage feed) and words them. AR-L1: no
// vendor is named here — a provider is an id and puppeteer's label for it; a
// service is an id, its company's label, and the views' name for its plans.
//
// AR-S2c (pass 19, P2): a profile's page shows the PLANS it runs on — each
// once, as a card with every usage window — and each agent row wears BADGES,
// the cards in small. Which plans, whose account, and which sign-in each agent
// runs on are puppeteer's reading of the identities (`plans` on the set,
// `holds` on each persona); a plan's usage is the reading of the persona that
// named its account (`namedBy`).

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
  /** the usage reading's state, when there is a reading */
  usageState?: string | undefined;
  /** its folder holds several sign-ins (a harness): its page lists them */
  several: boolean;
  /** what it holds, the one it runs on first; empty when that is unknown */
  holds: AgentHolding[];
  /** the badges on its profile's page: every sign-in, the one it runs on filled */
  badges: PlanBadge[];
  /** said once on the row: the sign-in it runs on names no account */
  unnamed?: string | undefined;
}

/** A badge: a plan card in small (pass 19) — the company's mark and the plan's name. */
export interface PlanBadge {
  key: string;
  /** the card it stands for; absent for a key, which is on no plan */
  planId?: string | undefined;
  service: AgentSignInService;
  title: string;
  /** the one the agent runs on (filled) */
  runsOn: boolean;
  /** a pay-per-use key (dashed) */
  payAsYouGo: boolean;
  /** this agent's own sign-in to the plan lapsed */
  expired: boolean;
}

/** One plan a profile runs on, as its card says it (pass 19, P2). */
export interface PlanCard {
  id: string;
  service: AgentSignInService;
  /** "Claude Max"; the product alone when no agent named the account */
  title: string;
  /** whose: "kim@work.example · Northlight", or "Account not named" */
  account: string;
  named: boolean;
  /** every window of the account's usage, in the adapter's order */
  metrics: AgentAccountUsageMetric[];
  /** in place of the windows: one sentence, its lead in orange when it needs attention */
  sentence?: { attention?: string; text: string } | undefined;
  /** a borrowed sign-in, said above the body */
  note?: string | undefined;
  /** the card's one act */
  act?:
    | {
        /** sign the account's agent in again, or sign the borrower in with its own login */
        kind: "reauth" | "own";
        provider: string;
        label: string;
        description: string;
      }
    | undefined;
  /** the agents that spend it, in the profile's order */
  users: Array<{ provider: string; label: string }>;
  /** "also on This Mac", or empty */
  alsoIn: string;
  /** the persona that named the account, whose usage the card shows */
  namedBy?: string | undefined;
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
  /** every profile, for where else a plan's account is used */
  sets: readonly AgentProfileSet[];
  /** the ways to add a sign-in, per agent whose folder holds several */
  routes: Readonly<Record<string, readonly AgentSignInRoute[]>>;
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
    sets: feed?.sets ?? [],
    routes: feed?.routes ?? {},
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
  /** no agent is installed on this Mac at all (AO-6: the add menu says so) */
  nothingInstalled: boolean;
  /** the hero's fact line */
  facts: string;
  /** the plans it runs on, each once (pass 19): the cards above the agents */
  plans: PlanCard[];
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
  // a folder that can hold several sign-ins lists them (a harness), and says
  // what it holds rather than who it is
  const several =
    persona.identity?.signIns !== undefined || context.routes[persona.provider] !== undefined;
  const label = agentLabel(context, persona.provider);
  const fact =
    state === "signing-in"
      ? "Signing in…"
      : state === "unread"
        ? context.reading
          ? "Checking…"
          : "Not checked yet"
        : state === "signed-out"
          ? several
            ? "Not signed in to anything yet"
            : "Not signed in"
          : state === "expired"
            ? `Sign-in expired${email !== undefined ? ` · ${email}` : ""}`
            : state === "unverifiable"
              ? "Doesn't say who is signed in"
              : (who ?? "Signed in");
  const held = persona.holds ?? [];
  const runsOn = held.find((holding) => holding.runsOn);
  const holds = runsOn === undefined ? held : [runsOn, ...held.filter((h) => h !== runsOn)];
  return {
    provider: persona.provider,
    label,
    persona,
    state,
    fact,
    usage: usage?.state === "available" || usage?.stale === true ? usage.metrics : [],
    usageUnsupported: usage?.state === "unsupported",
    usageState: usage?.state,
    several,
    holds,
    badges: [],
    unnamed:
      several && runsOn !== undefined && !runsOn.key && accountWho(runsOn) === undefined
        ? `${label} doesn't say which account`
        : undefined,
  };
}

/** The account's handle before its email (RFC 006: a view shows it first). */
function accountWho(account: { account?: string | undefined; email?: string | undefined }) {
  return account.account ?? account.email;
}

/** "kim@work.example · Northlight", or undefined when nobody is named. An
 * organisation named after the account itself ("kim@home.example's
 * Organization", a personal Claude account) adds nothing, so it is left out. */
export function accountWords(account: AgentPlan["account"]): string | undefined {
  if (account === undefined) return undefined;
  const who = accountWho(account);
  if (who === undefined) return undefined;
  const organization = account.organization;
  const echoes =
    organization !== undefined &&
    [account.email, account.account].some(
      (name) => name !== undefined && organization.toLowerCase().startsWith(name.toLowerCase()),
    );
  return organization === undefined || echoes ? who : `${who} · ${organization}`;
}

/** The cards: every plan the profile runs on whose agents are on its page. */
function planCards(
  set: AgentProfileSet,
  rows: readonly ProfileAgentRow[],
  context: ProfilesContext,
): PlanCard[] {
  const shown = new Map(rows.map((row) => [row.persona.profileId, row]));
  const cards: PlanCard[] = [];
  for (const plan of set.plans ?? []) {
    const holders = plan.holders
      .map((id) => shown.get(id))
      .filter((row): row is ProfileAgentRow => row !== undefined);
    if (holders.length === 0) continue;
    // the account's agent is on the page, or (This Mac) installed no longer
    const namerPersona = set.personas.find((candidate) => candidate.profileId === plan.namedBy);
    const namer =
      namerPersona === undefined
        ? undefined
        : (shown.get(namerPersona.profileId) ?? agentRow(context, namerPersona));
    const account = accountWords(plan.account);
    const product = serviceProduct(plan.service);
    const labels = holders.map((row) => row.label);
    const elsewhere = plan.alsoIn
      .map((id) => context.sets.find((candidate) => candidate.id === id))
      .filter((other): other is AgentProfileSet => other !== undefined);
    let sentence: PlanCard["sentence"];
    let act: PlanCard["act"];
    let metrics: AgentAccountUsageMetric[] = [];
    if (account === undefined || namer === undefined) {
      sentence = {
        text: `${listWords(labels)} ${labels.length === 1 ? "doesn't" : "don't"} say which ${product} account, and no agent here names one.`,
      };
    } else if (namer.state === "expired") {
      sentence = {
        attention: "Sign-in expired.",
        text: `What is left shows again once ${namer.label} signs in.`,
      };
      act = {
        kind: "reauth",
        provider: namer.provider,
        label: "Sign in again",
        description: `Sign in to ${namer.label} again`,
      };
    } else if (namer.usage.length > 0) {
      metrics = namer.usage;
    } else {
      sentence = {
        text:
          namer.usageState === undefined || namer.usageState === "unsupported"
            ? "Usage isn't reported for this subscription."
            : "Usage couldn't be read just now.",
      };
    }
    let note: string | undefined;
    if (plan.borrowedFrom !== undefined) {
      const same =
        elsewhere.length > 0
          ? `, the same one as ${listWords(elsewhere.map((other) => other.label))}`
          : "";
      // the service's own agent (a vendor's one sign-in) can have its own login here
      const own = holders.find((row) => !row.several);
      if (own !== undefined) {
        note = `No ${product} sign-in of its own here: it runs as ${plan.borrowedFrom}'s account${same}.`;
        act ??= {
          kind: "own",
          provider: own.provider,
          label: `Sign in to ${product}`,
          description: `Sign ${own.label} in with its own login, for ${set.label} alone`,
        };
      } else {
        note = `${listWords(labels)} ${labels.length === 1 ? "runs" : "run"} as ${plan.borrowedFrom}'s account${same}.`;
      }
    }
    cards.push({
      id: plan.id,
      service: plan.service,
      title: planTitle(plan.service, account === undefined ? undefined : plan.account?.plan),
      account: account ?? "Account not named",
      named: account !== undefined,
      metrics,
      sentence,
      note,
      act,
      users: holders.map((row) => ({ provider: row.provider, label: row.label })),
      alsoIn: elsewhere.length > 0 ? `also ${listWords(elsewhere.map(inOnWords))}` : "",
      namedBy: plan.namedBy,
    });
  }
  return cards;
}

/** A row's badges: each sign-in it holds, named as its card is. */
function badgesFor(row: ProfileAgentRow, cards: ReadonlyMap<string, PlanCard>): PlanBadge[] {
  return row.holds.map((held, index) => {
    const card = held.planId === undefined ? undefined : cards.get(held.planId);
    return {
      key: `${held.service.id}:${index}`,
      planId: held.key ? undefined : held.planId,
      service: held.service,
      title: held.key
        ? `${held.service.label} API key`
        : (card?.title ?? planTitle(held.service, held.plan)),
      runsOn: held.runsOn,
      payAsYouGo: held.key,
      expired: card?.namedBy === row.persona.profileId && row.state === "expired",
    };
  });
}

/** One sign-in on a harness's own page (pass 17's Sign-ins list, P2's words). */
export interface SignInLine {
  key: string;
  service: AgentSignInService;
  title: string;
  inUse: boolean;
  fact: string;
  /** its plan's windows, when this sign-in is the one that named the account */
  metrics: AgentAccountUsageMetric[];
  planId?: string | undefined;
}

export function signInLines(row: ProfileAgentRow, plans: readonly PlanCard[]): SignInLine[] {
  const cards = new Map(plans.map((card) => [card.id, card]));
  return row.holds.map((held, index) => {
    const card = held.planId === undefined ? undefined : cards.get(held.planId);
    const own = accountWords(held);
    const parts: string[] = [];
    if (held.key) parts.push("API key · pay as you go");
    else {
      if (held.borrowedFrom !== undefined) parts.push(`Through ${held.borrowedFrom}`);
      else if (held.subscription === true) parts.push("Subscription");
      parts.push(own ?? `${row.label} doesn't say which account`);
    }
    return {
      key: `${held.service.id}:${index}`,
      service: held.service,
      title: held.key
        ? `${held.service.label} API key`
        : (card?.title ?? planTitle(held.service, held.plan)),
      inUse: held.inUse === true,
      fact: parts.join(" · "),
      metrics:
        card !== undefined && card.namedBy === row.persona.profileId && own !== undefined
          ? card.metrics
          : [],
      planId: held.key ? undefined : held.planId,
    };
  });
}

export function profilePage(set: AgentProfileSet, context: ProfilesContext): ProfilePageModel {
  const here = installed(context);
  // This Mac lists every installed agent in its own folder, whatever that
  // folder's sign-in says (and one whose login pane is open); a profile lists
  // every sign-in it holds, whatever state it is in — a place shows what is in it.
  const listed = set.personas
    .filter((persona) =>
      set.kind === "native" ? here.has(persona.provider) || persona.signingIn !== undefined : true,
    )
    .map((persona) => agentRow(context, persona));
  const plans = planCards(set, listed, context);
  const cards = new Map(plans.map((card) => [card.id, card]));
  const rows = listed.map((row) => ({ ...row, badges: badgesFor(row, cards) }));
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
  return {
    set,
    inOn: inOnWords(set),
    rows,
    addable,
    nothingInstalled: here.size === 0,
    facts,
    plans,
  };
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

export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function signOutWords(
  set: AgentProfileSet,
  label: string,
  /** what an agent whose folder holds several holds: it signs out of all of them */
  holds?: readonly AgentHolding[],
): { title: string; description: string; question: string; what: string } {
  const companies = [...new Set((holds ?? []).map((held) => held.service.label))];
  return {
    title: holds === undefined ? "Sign out" : `Sign out of everything in ${label}`,
    description:
      set.kind === "native"
        ? `Signs ${label} out of its own folder on This Mac, with its own command. The subscription itself isn't touched.`
        : holds !== undefined
          ? `Deletes ${label}'s folder in ${set.label}${
              holds.length > 0
                ? `, with ${holds.length === 1 ? "its sign-in" : `its ${holds.length} sign-ins`} — ${listWords(companies)}`
                : ""
            }. The subscriptions themselves aren't touched.`
          : `Removes this sign-in from ${set.label}. The subscription itself isn't touched.`,
    question: `Sign out of ${label} ${inOnWords(set)}?`,
    what:
      set.kind === "native"
        ? `Sessions running now keep going until they end. To come back, sign in again from ${set.label}’s page.`
        : `Sessions running now keep going until they end. To come back, add ${label} again from ${set.label}’s page.`,
  };
}

/** The sign-in terminal's note: where the sign-in lands. */
export function signInNote(set: Pick<AgentProfileSet, "kind" | "label">, label: string): string {
  return set.kind === "native"
    ? `This runs in ${label}’s own folder, so the sign-in lands there.`
    : `This runs in ${set.label}’s folder, so the sign-in lands there and nowhere else.`;
}

// ── the C1 timeline (pass 10, chosen): a window's time as the track ──

/** One usage window as the timeline draws it. */
export interface UsageLine {
  id: string;
  /** the adapter's own short label ("5H", "7D", "CR" for a credit budget);
   * under a heading, the window alone ("7D" beneath "Fable only") */
  label: string;
  /** the part of the plan it meters when not the whole plan, in the
   * provider's words (pass 20): lines sharing an id sit under one heading */
  group?: { id: string; label: string };
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

// ── Line · Glow · Halo (pass 22, chosen 2026-09-24) ──

/** The now line: 2 px, its four corners opened into 2 px quarter circles, so
 * it is the space between two rounded ends that almost touch. */
export const USAGE_NOW_WIDTH = 2;
export const USAGE_NOW_FLARE = 2;
/** How far back from the fill's head the light reaches (the CSS gradient's
 * 10 px); the figure inside the fill stops 2 px short of it. */
export const USAGE_GLOW = 10;
/** The figure's gap from the head, after it, and the line's reach toward the figure. */
const FIGURE_GAP = 5;
const LINE_CLEARANCE = 3;

/** The now line's outline in a box `USAGE_NOW_WIDTH + 2 × USAGE_NOW_FLARE`
 * wide: a bar whose four corners open into quarter circles, meeting the
 * track's top and bottom edges wider than it runs through the middle — the
 * space between two rounded ends that almost touch. A `clip-path` path. */
export function usageNowPath(height: number): string {
  const w = USAGE_NOW_WIDTH;
  const r = USAGE_NOW_FLARE;
  const c = w + 2 * r;
  const h = height;
  return `M0 0A${r} ${r} 0 0 1 ${r} ${r}L${r} ${h - r}A${r} ${r} 0 0 1 0 ${h}L${c} ${h}A${r} ${r} 0 0 1 ${r + w} ${h - r}L${r + w} ${r}A${r} ${r} 0 0 1 ${c} 0Z`;
}

/** Where the % sits, in pixels, and whether the now line gives way to it. */
export interface UsageFigurePlace {
  /** the figure's left edge, from the track's start */
  x: number;
  /** inside the fill, short of its lit head; otherwise just after the head */
  inside: boolean;
  /** the now line comes within 3 px of the figure: its middle gives way
   * across the digits and its flared ends stay */
  lineGives: boolean;
}

/**
 * Pass 22's halo: the figure keeps its place at the head — inside the fill
 * when the fill holds it short of the light, else 5 px after the head — and
 * never moves for the now line. Where the line comes within 3 px of it, the
 * line gives way instead, so the two can never touch. In pixels, because the
 * rule it replaces reached 12 points of the track, which a 21 px figure
 * outgrows on a narrow track (pass 21: 185 of 10,201 used × time pairs put
 * the line on the figure at 218 px).
 */
export function usageFigurePlace(input: {
  /** the track's width */
  track: number;
  /** the figure's width */
  figure: number;
  used: number;
  elapsed?: number | undefined;
}): UsageFigurePlace {
  const { track, figure } = input;
  const head = (track * Math.min(100, Math.max(0, input.used))) / 100;
  const inner = head - (USAGE_GLOW + 2) - figure;
  const inside = inner >= 3;
  // on a track too short for either place the figure stays on the track
  const x = Math.max(0, Math.min(inside ? inner : head + FIGURE_GAP, track - figure));
  let lineGives = false;
  if (input.elapsed !== undefined) {
    const now = (track * Math.min(100, Math.max(0, input.elapsed))) / 100;
    const reach = USAGE_NOW_WIDTH / 2 + LINE_CLEARANCE;
    lineGives = now >= x - reach && now <= x + figure + reach;
  }
  return { x, inside, lineGives };
}

/** A window's own name from its length: "5H", "7D" (what a line under a heading shows). */
export function usageWindowLabel(minutes: number | undefined): string | undefined {
  if (minutes === undefined || !Number.isSafeInteger(minutes) || minutes <= 0) return undefined;
  if (minutes % 1440 === 0) return `${minutes / 1440}D`;
  if (minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}M`;
}

/** A standby allowance (drawn on only once the plan's own limits run out)
 * stays out of sight until it is in play: some of it used, or one of the
 * plan's own windows spent (pass 20, PZ2 — as ChatGPT shows Luna Reserve). */
function inPlay(metric: AgentAccountUsageMetric, all: readonly AgentAccountUsageMetric[]): boolean {
  const group = metric.group;
  if (group?.standby !== true) return true;
  if (all.some((other) => other.group?.id === group.id && other.usedPercent > 0)) return true;
  return all.some(
    (other) => other.group === undefined && other.kind !== "budget" && other.usedPercent >= 100,
  );
}

export function usageLines(metrics: readonly AgentAccountUsageMetric[], now: Date): UsageLine[] {
  return metrics
    .filter((metric) => inPlay(metric, metrics))
    .map((metric) => {
      const resetsAt = metric.resetsAt === undefined ? undefined : new Date(metric.resetsAt);
      const validReset = resetsAt !== undefined && !Number.isNaN(resetsAt.getTime());
      let elapsed: number | undefined;
      if (metric.durationMinutes !== undefined && validReset) {
        const window = metric.durationMinutes * 60_000;
        const left = resetsAt.getTime() - now.getTime();
        elapsed = Math.min(100, Math.max(0, (1 - left / window) * 100));
      }
      const budget = metric.kind === "budget";
      const group = metric.group;
      const line: UsageLine = {
        id: metric.id,
        label:
          (group !== undefined ? usageWindowLabel(metric.durationMinutes) : undefined) ??
          metric.label,
        usedPercent: metric.usedPercent,
        resets: !budget && validReset,
        hot: isHot(metric.usedPercent, elapsed),
      };
      if (group !== undefined) line.group = { id: group.id, label: group.label };
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
