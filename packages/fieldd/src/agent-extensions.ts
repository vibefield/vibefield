import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { SessionExitedEvent } from "@vibecook/ghosttea-client";
import {
  type AgentProfile,
  EXTENSION_SKILL_FOLDER_NAME,
  type ExtensionActPlan,
  type ExtensionFailure,
  type ExtensionInventory,
  type ExtensionItem,
  type ExtensionOrigin,
  type ExtensionProvider,
  type McpServerDefinition,
  type McpServerItem,
  mcpServerDefinition,
  type SkillItem,
} from "@vibecook/puppeteer-core";
import {
  type AgentRuntime,
  type ExtensionActEnd,
  isLaunchValueName,
  type StartedExtensionAct,
} from "@vibecook/puppeteer-runtime";
import {
  AGENT_OPERATION_OUTPUT_BYTES,
  type AgentCatalogReaders,
  type AgentExtensionAct,
  type AgentExtensionChange,
  type AgentExtensionColumn,
  type AgentExtensionHolding,
  type AgentExtensionKeep,
  type AgentExtensionMarketplace,
  type AgentExtensionOffer,
  type AgentExtensionPlugin,
  type AgentExtensionReceipt,
  type AgentExtensionRow,
  type AgentExtensionRun,
  type AgentExtensionServerDefinition,
  type AgentExtensionSupport,
  type AgentsExtensionsActParams,
  type AgentsExtensionsActResult,
  type AgentsExtensionsAddParams,
  type AgentsExtensionsAddResult,
  type AgentsExtensionsAddSkillParams,
  type AgentsExtensionsAddSkillResult,
  type AgentsExtensionsListResult,
  type AgentsExtensionsPlanParams,
  type AgentsExtensionsPlanResult,
  type AgentsExtensionsPlanSkillParams,
  type AgentsExtensionsPlanSkillResult,
  type AgentsExtensionsSignInParams,
  type AgentsExtensionsSignInResult,
  ENV_PREFIXES,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { requireVisible } from "./agent-catalog-gates";
import { displayTail } from "./agent-distribution";
import {
  type AgentExtensionStore,
  changeKey,
  type KeptSkill,
  type SeenAgent,
} from "./agent-extension-store";
import { RpcCallError } from "./native-link";
import type { GrantPrincipal } from "./terminal-grants";

// EXTENSIONS (AR-S4b; the design record's pass 24) — the doors behind the
// profile page's MCP servers and skills, and each agent page's own lists.
//
// The page draws a LENS: for one Agent Profile, every server and every skill
// its agents hold, by name, a cell per agent. Nothing in it is VibeField's:
// puppeteer reads each agent's own stores (RFC 006 C1) and this file only
// groups what came back. A read happens when a page asks and after an act —
// never on a timer — because reading can start a process (Codex answers over
// its app-server) and costs the agents' own listings.
//
// EL7: a holding crosses with puppeteer's masked target and the NAMES of what
// it reads; a place crosses home-abbreviated, for display only. An act names
// its item by the agent's own id, never by a path from here.
//
// ACTS (AR-S4c; RFC 006 C2): each holding carries the acts its agent offers
// on it, as the adapter planned them from the same read (no second read per
// holding). One act runs at a time per profile, through the agent's own
// command or protocol; its output rides the profile's frames as display text,
// and the receipt is puppeteer's second read, never the output. When it
// finishes, the whole profile is read again, so every cell says what the
// agents hold now.
//
// A remote server's SIGN-IN is the act a person answers — the agent's own
// login opens a browser, and may ask for a pasted code — so it runs in a pane
// on the floor, like a profile's sign-in (`agents.profiles.login`): the door
// answers with the caller's ticket, the run rides the frames while the pane
// lives, and when it ends puppeteer reads the agent again for the receipt,
// the husk is closed and the profile is read again. A pane nobody finishes is
// waited on for ten minutes, then settled and left to the person.
//
// ADDING ONCE (AR-S4d; pass 24, S1): a server some agent holds — or one the
// profile keeps — can be turned on for an agent that holds none of it, by
// that agent's own add. Each empty cell carries that add as its offer (or why
// the agent cannot take it), planned from the row's definition: the one the
// profile keeps, else the one its holdings agree on when it hides nothing.
// The profile keeps a definition once it has given it to an agent or taken
// it from one, so turning it on again is one click; each value a server reads
// is kept in the keychain (agent-extension-store.ts), and an agent is given
// only the values of the servers VibeField gave it, when VibeField starts it.
//
// SKILLS KEPT ONCE (AR-S4d2; pass 24): a skill's one copy is in the profile's
// skills folder, and every agent is given a LINK to it where it looks, by
// puppeteer's placing (RFC 006 C2: the runtime makes the link itself). A skill
// that is still one agent's own folder moves into the profile's folder, linked
// back, the first time another agent takes it; one in the shared folder
// (`~/.agents/skills`) is linked from there. Codex reads a person's skills
// only from the shared folder, so turning one on for Codex moves the copy
// there (a link stays in the profile's folder) and turns it off with Codex's
// own switch in the other profiles. Copies are told apart by their real path,
// so a link to a link is still the one copy.
//
// O1: every read is compared with the last one VibeField saw of the profile
// (agent-extension-store.ts keeps it), and a difference no act of VibeField's
// made becomes a line: who changed what, between which reads.

export interface AgentExtensionServiceOptions {
  runtime: Pick<
    AgentRuntime,
    | "profileSet"
    | "profileSets"
    | "profileProviders"
    | "extensionProviders"
    | "extensionInventory"
    | "extensionActPlans"
    | "runExtensionAct"
    | "startExtensionAct"
    | "settleExtensionAct"
  >;
  /** AC-3 — the catalog's readers: a lens has a column only for an agent the
   * catalog shows, and an act runs only for one */
  catalog: AgentCatalogReaders;
  /** The OS user's home, which places are abbreviated against. */
  home: string;
  /** A sign-in's pane on the floor; without one (no terminal floor here) a sign-in is refused. */
  panes?: ExtensionSignInPanes;
  /** AR-S4d — what each profile keeps once; without one, nothing is kept and no value is taken. */
  store?: AgentExtensionStore;
  /** Test seam: how long a sign-in's pane is waited on (production: ten minutes). */
  signInWaitMs?: number;
  now?: () => Date;
  logger?: Logger;
}

/** The floor, as a sign-in needs it: the caller's ticket for its pane, and the pane closed when it is over. */
export interface ExtensionSignInPanes {
  /** The ticket for a pane the runtime just spawned, minted for the caller; throws when the floor did not spawn it. */
  open(sessionId: string, principal: GrantPrincipal): TerminalCreateOpenResult;
  /** The floor forgets the pane and its husk is closed; a pane already gone is not an error. */
  close(sessionId: string): Promise<void>;
}

/** How long a sign-in's pane is waited on before it is settled and left to the person (a profile login's wait). */
const SIGN_IN_WAIT_MS = 10 * 60_000;

type Frame = AgentsExtensionsListResult;

/** A cell lists what the agent holds, the most its own first. */
const ORIGIN_RANK: Record<ExtensionOrigin, number> = {
  own: 0,
  project: 1,
  agent: 2,
  managed: 3,
  bundled: 4,
  plugin: 5,
  borrowed: 6,
};

export function abbreviateHome(path: string, home: string): string {
  if (path === home) return "~";
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`;
  return path.startsWith(prefix) ? `~${sep}${path.slice(prefix.length)}` : path;
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The copy of one server a host can compare: what it runs or reaches, and the names it reads. */
function serverDefinition(item: McpServerItem): string {
  return JSON.stringify([
    item.transport,
    item.target,
    [...(item.env ?? [])].sort(),
    [...(item.headers ?? [])].sort(),
  ]);
}

/**
 * A skill's copy is its folder's real path — a link, or a link to a link, is
 * the folder it ends at — else where the agent keeps it.
 */
function skillDefinition(canonical: ReadonlyMap<string, string>) {
  return (item: SkillItem, provider: string): string =>
    (item.location !== undefined ? canonical.get(item.location) : undefined) ??
    item.linkTarget ??
    item.location ??
    `${provider} ${item.id}`;
}

/** Whether a path is a folder's own or anything below it. */
function within(folder: string, path: string): boolean {
  const inside = relative(folder, path);
  return inside === "" || (!inside.startsWith("..") && !inside.startsWith(sep));
}

/** Where a skill's one copy is, and what another agent is given a link to. */
export interface SkillCopy {
  /** The copy's real path. */
  folder: string;
  /** The folder a link goes to: the profile's folder's entry, the shared copy, or the one elsewhere. */
  from: string;
  /** In the profile's skills folder. */
  kept?: true;
  /** In `~/.agents/skills`, which every profile shares. */
  shared?: true;
  /** Still this agent's own folder: the first other agent moves it to the profile's folder. */
  owner?: string;
}

/** The facts a read gathers about skill folders beside the agents' own reads. */
export interface SkillFolders {
  /** The profile's skills folder, absolute. */
  library: string;
  /** What it keeps. */
  kept: readonly KeptSkill[];
  /** Every skill folder a read names, to its real path. */
  canonical: ReadonlyMap<string, string>;
  /** `~/.agents/skills`, its real path. */
  shared: string;
}

/**
 * Each skill's one copy, by name: the profile's kept one wins; else the one
 * real folder every holding of the profile's own agrees on — in the shared
 * folder, an agent's own (which moves to the profile's folder when another
 * agent takes it), or elsewhere; two of them give none, since which is meant
 * is the person's to say.
 */
export function skillCopies(
  agents: ReadonlyArray<{ provider: string; result: ExtensionInventory | ExtensionFailure }>,
  folders: SkillFolders,
): Map<string, SkillCopy> {
  const real = (path: string) => folders.canonical.get(path) ?? path;
  const own = new Map<string, Array<{ provider: string; item: SkillItem; real: string }>>();
  for (const agent of agents) {
    if (isFailure(agent.result)) continue;
    for (const item of agent.result.items) {
      if (item.kind !== "skill" || item.origin !== "own" || item.location === undefined) continue;
      own.set(item.name, [
        ...(own.get(item.name) ?? []),
        { provider: agent.provider, item, real: real(item.location) },
      ]);
    }
  }
  const copies = new Map<string, SkillCopy>();
  for (const kept of folders.kept) {
    const folder = real(kept.folder);
    copies.set(kept.name, {
      folder,
      from: kept.folder,
      kept: true,
      ...(within(folders.shared, folder) ? { shared: true as const } : {}),
    });
  }
  for (const [name, holdings] of own) {
    if (copies.has(name)) continue;
    const paths = new Set(holdings.map((holding) => holding.real));
    if (paths.size !== 1) continue;
    const [folder] = paths as unknown as [string];
    if (within(folders.shared, folder)) {
      copies.set(name, { folder, from: folder, shared: true });
      continue;
    }
    // the one holding that is the folder itself, not a link to it
    const owner = holdings.find((holding) => holding.item.linkTarget === undefined);
    if (owner === undefined) copies.set(name, { folder, from: folder });
    else if (EXTENSION_SKILL_FOLDER_NAME.test(name)) {
      copies.set(name, { folder, from: join(folders.library, name), owner: owner.provider });
    }
  }
  return copies;
}

/** What one agent holds of the profile's own, as O1 compares reads: names, each on or off. */
function seenOf(result: ExtensionInventory): SeenAgent {
  const seen: SeenAgent = { servers: {}, skills: {} };
  for (const item of result.items) {
    if (item.origin !== "own") continue;
    if (item.kind === "mcp-server") seen.servers[item.name] = item.enabled;
    else if (item.kind === "skill") seen.skills[item.name] = item.enabled;
  }
  return seen;
}

function holdingOf(item: McpServerItem | SkillItem, home: string): AgentExtensionHolding {
  const place = (path: string | undefined) =>
    path === undefined ? undefined : abbreviateHome(path, home);
  const holding: AgentExtensionHolding = {
    id: item.id,
    origin: item.origin,
    enabled: item.enabled,
    ...(item.shared ? { shared: true as const } : {}),
    ...(item.plugin !== undefined ? { plugin: item.plugin } : {}),
    ...(item.lender !== undefined ? { lender: item.lender } : {}),
    ...(item.project !== undefined ? { project: place(item.project) } : {}),
    ...(item.location !== undefined ? { place: place(item.location) } : {}),
  };
  if (item.kind === "skill") {
    return {
      ...holding,
      ...(item.switchable ? { switchable: true as const } : {}),
      ...(item.linkTarget !== undefined ? { linkTarget: place(item.linkTarget) } : {}),
    };
  }
  return {
    ...holding,
    transport: item.transport,
    target: item.target,
    ...(item.env !== undefined && item.env.length > 0 ? { env: [...item.env] } : {}),
    ...(item.headers !== undefined && item.headers.length > 0
      ? { headers: [...item.headers] }
      : {}),
    ...(item.auth !== undefined ? { auth: item.auth } : {}),
  };
}

export interface ExtensionLensAgent {
  provider: string;
  label: string;
  profileId: string;
  support: ExtensionProvider["support"];
  result: ExtensionInventory | ExtensionFailure;
  /** What the adapter answered for each held server and skill, each act (RFC 006 C2). */
  plans?: readonly ExtensionActPlan[];
}

/**
 * The acts a holding offers now: the available plans for it, without the one
 * that would change nothing (turning on what is on, off what is off).
 */
/** Where a skill's steps move its copy, home-abbreviated: the act says so before it runs. */
function movesOf(plan: ExtensionActPlan, home: string): { moves?: string } {
  if (!plan.available || plan.runs.kind !== "files") return {};
  const move = plan.runs.steps.find((step) => step.op === "move");
  return move?.op === "move" ? { moves: abbreviateHome(move.to, home) } : {};
}

/**
 * A skill's add that moves its copy into a folder every profile of the agent
 * reads: the agent reads a person's skills only there (Codex's), and its own
 * switch is what keeps the skill to one profile.
 */
function sharesFolder(act: AgentExtensionAct): boolean {
  return act.moves !== undefined && act.reaches.includes("shared-folder");
}

function actsOf(
  plans: readonly ExtensionActPlan[] | undefined,
  item: McpServerItem | SkillItem,
  home: string,
): AgentExtensionAct[] {
  const acts: AgentExtensionAct[] = [];
  const signedIn = item.kind === "mcp-server" && item.auth === "signed-in";
  for (const plan of plans ?? []) {
    if (!plan.available || plan.act === "add") continue;
    if (plan.target.kind !== item.kind || plan.target.id !== item.id) continue;
    if ((plan.act === "enable" && item.enabled) || (plan.act === "disable" && !item.enabled))
      continue;
    // a sign-in to a server the agent does not load, or is signed in to, changes nothing; a
    // sign-out is offered only where the agent says it is signed in, so the read can say it went
    if (plan.act === "sign-in" && (!item.enabled || signedIn)) continue;
    if (plan.act === "sign-out" && !signedIn) continue;
    acts.push({
      act: plan.act,
      runs: plan.display,
      reaches: [...plan.reaches],
      ...(plan.runs.kind === "terminal" ? { terminal: true as const } : {}),
      ...movesOf(plan, home),
    });
  }
  return acts;
}

/** One agent's column before anything of it is read. */
function emptyColumn(agent: Omit<ExtensionLensAgent, "result">): AgentExtensionColumn {
  const support: AgentExtensionSupport = {};
  for (const key of ["plugins", "marketplaces", "mcpServers", "skills"] as const) {
    const kind = agent.support[key];
    if (kind !== undefined) support[key] = { ...kind };
  }
  return {
    provider: agent.provider,
    label: agent.label,
    profileId: agent.profileId,
    support,
    counts: { plugins: 0, marketplaces: 0, mcpServers: 0, skills: 0 },
  };
}

function isFailure(result: ExtensionInventory | ExtensionFailure): result is ExtensionFailure {
  return "status" in result;
}

function rowsOf<T extends McpServerItem | SkillItem>(
  agents: ReadonlyArray<{ provider: string; items: T[]; plans?: readonly ExtensionActPlan[] }>,
  definition: (item: T, provider: string) => string,
  home: string,
): AgentExtensionRow[] {
  const plansOf = new Map(agents.map((agent) => [agent.provider, agent.plans]));
  const byRowName = new Map<string, Map<string, T[]>>();
  for (const { provider, items } of agents) {
    for (const item of items) {
      const row = byRowName.get(item.name) ?? new Map<string, T[]>();
      byRowName.set(item.name, row);
      row.set(provider, [...(row.get(provider) ?? []), item]);
    }
  }
  const rows: AgentExtensionRow[] = [];
  for (const [name, byAgent] of byRowName) {
    // Versions are numbered in the order the profile's agents first show them.
    const versions = new Map<string, number>();
    for (const { provider } of agents) {
      for (const item of byAgent.get(provider) ?? []) {
        const key = definition(item, provider);
        if (!versions.has(key)) versions.set(key, versions.size);
      }
    }
    const cells: AgentExtensionRow["cells"] = {};
    let description: string | undefined;
    for (const { provider } of agents) {
      const items = byAgent.get(provider);
      if (items === undefined) continue;
      const ordered = [...items].sort(
        (a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] || (a.id < b.id ? -1 : 1),
      );
      cells[provider] = ordered.map((item) => {
        const acts = actsOf(plansOf.get(provider), item, home);
        return {
          ...holdingOf(item, home),
          ...(versions.size > 1 ? { version: versions.get(definition(item, provider))! } : {}),
          ...(acts.length > 0 ? { acts } : {}),
        };
      });
      if (description === undefined) {
        description = ordered.find(
          (item): item is T & SkillItem => item.kind === "skill" && item.description !== undefined,
        )?.description;
      }
    }
    rows.push({
      name,
      ...(description !== undefined ? { description } : {}),
      versions: versions.size,
      cells,
    });
  }
  return rows.sort(byName);
}

/** A definition as the wire carries it: the known fields, nothing a file or a read added. */
function definitionOf(
  definition: McpServerDefinition | AgentExtensionServerDefinition,
): McpServerDefinition {
  return definition.transport === "stdio"
    ? {
        transport: "stdio",
        command: definition.command,
        args: [...definition.args],
        ...(definition.env !== undefined && definition.env.length > 0
          ? { env: [...definition.env] }
          : {}),
      }
    : { transport: definition.transport, url: definition.url };
}

/**
 * AR-S4d — what turning each server on for another agent gives it, by name:
 * the profile's kept definition, else the one its holdings agree on when one
 * of them could travel (puppeteer sets `definition` only on a server that
 * hides nothing). Two versions under one name give none: which is meant is
 * the person's to say.
 */
export function serverDefinitions(
  agents: ReadonlyArray<{ result: ExtensionInventory | ExtensionFailure }>,
  keep?: Pick<AgentExtensionKeep, "servers">,
): Map<string, McpServerDefinition> {
  const byName = new Map<string, { versions: Set<string>; definition?: McpServerDefinition }>();
  for (const agent of agents) {
    if (isFailure(agent.result)) continue;
    for (const item of agent.result.items) {
      if (item.kind !== "mcp-server") continue;
      const entry = byName.get(item.name) ?? { versions: new Set<string>() };
      entry.versions.add(serverDefinition(item));
      if (entry.definition === undefined && item.definition !== undefined)
        entry.definition = item.definition;
      byName.set(item.name, entry);
    }
  }
  const definitions = new Map<string, McpServerDefinition>();
  for (const [name, entry] of byName) {
    if (entry.versions.size === 1 && entry.definition !== undefined)
      definitions.set(name, definitionOf(entry.definition));
  }
  for (const [name, kept] of Object.entries(keep?.servers ?? {}))
    definitions.set(name, definitionOf(kept.definition));
  return definitions;
}

/** An empty cell's offer: the agent's own add, or why it cannot take the server or the skill. */
function offerOf(plan: ExtensionActPlan, home: string): AgentExtensionOffer {
  return plan.available
    ? {
        act: {
          act: "add",
          runs: plan.display,
          reaches: [...plan.reaches],
          ...(plan.runs.kind === "terminal" ? { terminal: true as const } : {}),
          ...movesOf(plan, home),
        },
      }
    : { unavailable: { reason: plan.reason, message: plan.message } };
}

/**
 * The lens for one Agent Profile from its agents' reads, in the profile's own
 * agent order: pure, so the rules — a cell's order, what counts as another
 * version, what stays on an agent's own list — are measured without a runtime.
 */
export function buildExtensionLens(input: {
  set: string;
  readAt: string;
  agents: readonly ExtensionLensAgent[];
  home: string;
  /** AR-S4d — what the profile keeps once: its kept servers and the names it keeps values for. */
  keep?: Pick<AgentExtensionKeep, "servers" | "values">;
  /** AR-S4d2 — the profile's skills folder and the real paths of the skills a read names. */
  skills?: SkillFolders;
  /** AR-S4d2 (O1) — the changes made outside VibeField that reads found. */
  changes?: readonly AgentExtensionChange[];
}): Frame {
  const columns: AgentExtensionColumn[] = [];
  const servers: Array<{
    provider: string;
    items: McpServerItem[];
    plans?: readonly ExtensionActPlan[];
  }> = [];
  const skills: Array<{
    provider: string;
    items: SkillItem[];
    plans?: readonly ExtensionActPlan[];
  }> = [];
  const plugins: Frame["plugins"] = {};
  const marketplaces: Frame["marketplaces"] = {};
  const place = (path: string | undefined) =>
    path === undefined ? undefined : abbreviateHome(path, input.home);

  for (const agent of input.agents) {
    const column = emptyColumn(agent);
    columns.push(column);
    if (isFailure(agent.result)) {
      column.failure = {
        status: agent.result.status,
        message: agent.result.message,
        retryable: agent.result.retryable,
      };
      continue;
    }
    const items: ExtensionItem[] = agent.result.items;
    column.fetchedAt = agent.result.fetchedAt;
    if (agent.result.unread !== undefined && agent.result.unread.length > 0) {
      column.unread = agent.result.unread.map(({ kind, message }) => ({ kind, message }));
    }
    const own = {
      servers: items.filter((item): item is McpServerItem => item.kind === "mcp-server"),
      skills: items.filter((item): item is SkillItem => item.kind === "skill"),
    };
    const plans = agent.plans === undefined ? {} : { plans: agent.plans };
    servers.push({ provider: agent.provider, items: own.servers, ...plans });
    skills.push({ provider: agent.provider, items: own.skills, ...plans });
    const pluginRows: AgentExtensionPlugin[] = [];
    const marketplaceRows: AgentExtensionMarketplace[] = [];
    for (const item of items) {
      if (item.kind === "plugin") {
        pluginRows.push({
          id: item.id,
          name: item.name,
          origin: item.origin,
          enabled: item.enabled,
          ...(item.shared ? { shared: true as const } : {}),
          ...(item.lender !== undefined ? { lender: item.lender } : {}),
          ...(item.version !== undefined ? { version: item.version } : {}),
          ...(item.marketplace !== undefined ? { marketplace: item.marketplace } : {}),
          ...(item.description !== undefined ? { description: item.description } : {}),
          ...(item.location !== undefined ? { place: place(item.location) } : {}),
        });
      } else if (item.kind === "marketplace") {
        marketplaceRows.push({
          id: item.id,
          name: item.name,
          origin: item.origin,
          enabled: item.enabled,
          ...(item.source !== undefined ? { source: item.source } : {}),
          ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
          ...(item.location !== undefined ? { place: place(item.location) } : {}),
        });
      }
    }
    column.counts = {
      plugins: pluginRows.length,
      marketplaces: marketplaceRows.length,
      mcpServers: own.servers.length,
      skills: own.skills.length,
    };
    if (pluginRows.length > 0) plugins[agent.provider] = pluginRows.sort(byName);
    if (marketplaceRows.length > 0) marketplaces[agent.provider] = marketplaceRows.sort(byName);
  }

  const serverRows = rowsOf(servers, serverDefinition, input.home);
  const kept = input.keep?.servers ?? {};
  const values = [...(input.keep?.values ?? [])].sort();
  // a server the profile keeps is its own even while no agent holds it
  for (const name of Object.keys(kept)) {
    if (!serverRows.some((row) => row.name === name))
      serverRows.push({ name, versions: 0, cells: {} });
  }
  const definitions = serverDefinitions(input.agents, input.keep);
  for (const row of serverRows) {
    const definition = definitions.get(row.name);
    if (definition !== undefined) row.definition = definition;
    if (row.name in kept) row.kept = true;
    const needs = (definition?.transport === "stdio" ? (definition.env ?? []) : []).filter(
      (name) => !values.includes(name),
    );
    if (needs.length > 0) row.needs = needs;
    const offers: Record<string, AgentExtensionOffer> = {};
    for (const agent of input.agents) {
      if (isFailure(agent.result) || row.cells[agent.provider] !== undefined) continue;
      const plan = agent.plans?.find(
        (candidate) =>
          candidate.act === "add" &&
          candidate.target.kind === "mcp-server" &&
          candidate.target.id === row.name,
      );
      if (plan !== undefined) offers[agent.provider] = offerOf(plan, input.home);
    }
    if (Object.keys(offers).length > 0) row.offers = offers;
  }

  const skillRows = rowsOf(
    skills,
    skillDefinition(input.skills?.canonical ?? new Map()),
    input.home,
  );
  // a skill the profile keeps is its own even while no agent holds it
  for (const skill of input.skills?.kept ?? []) {
    if (!skillRows.some((row) => row.name === skill.name)) {
      skillRows.push({
        name: skill.name,
        ...(skill.description !== undefined ? { description: skill.description } : {}),
        versions: 0,
        cells: {},
      });
    }
  }
  const copies = input.skills === undefined ? new Map() : skillCopies(input.agents, input.skills);
  for (const row of skillRows) {
    const copy = copies.get(row.name);
    if (copy !== undefined) {
      row.folder = abbreviateHome(copy.folder, input.home);
      if (copy.kept) row.kept = true;
      if (copy.shared) row.shared = true;
      if (copy.owner !== undefined) row.owner = copy.owner;
      if (row.kept) {
        // a folder of an agent's own beside the kept copy is another version: it cannot move where the copy is
        for (const holdings of Object.values(row.cells)) {
          for (const holding of holdings) {
            if (holding.origin !== "own" || holding.linkTarget !== undefined || holding.shared)
              continue;
            const acts = holding.acts?.filter((act) => act.act !== "remove");
            if (acts === undefined || acts.length === 0) delete holding.acts;
            else holding.acts = acts;
          }
        }
      }
    }
    const offers: Record<string, AgentExtensionOffer> = {};
    for (const agent of input.agents) {
      if (isFailure(agent.result) || row.cells[agent.provider] !== undefined) continue;
      const plan = agent.plans?.find(
        (candidate) =>
          candidate.act === "add" &&
          candidate.target.kind === "skill" &&
          candidate.target.id === row.name,
      );
      if (plan !== undefined) offers[agent.provider] = offerOf(plan, input.home);
    }
    if (Object.keys(offers).length > 0) row.offers = offers;
  }

  return {
    set: input.set,
    reading: false,
    readAt: input.readAt,
    agents: columns,
    servers: serverRows.sort(byName),
    skills: skillRows.sort(byName),
    plugins,
    marketplaces,
    ...(values.length > 0 ? { values } : {}),
    ...(input.skills !== undefined
      ? { library: abbreviateHome(input.skills.library, input.home) }
      : {}),
    ...(input.changes !== undefined && input.changes.length > 0
      ? { changes: [...input.changes] }
      : {}),
  };
}

/** A run's output frames coalesce to this tick. */
const RUN_TICK_MS = 16;
/** The raw output kept per run, rendered at projection (as the update runs do). */
const RUN_RAW_BYTES = 4 * AGENT_OPERATION_OUTPUT_BYTES;

interface RunEntry {
  id: string;
  provider: string;
  label: string;
  kind: "mcp-server" | "skill";
  item: string;
  name: string;
  act: AgentExtensionAct["act"];
  runs: string;
  state: "running" | "finished";
  startedAt: string;
  finishedAt?: string;
  raw: string;
  dropped: boolean;
  receipt?: AgentExtensionReceipt;
  /** A sign-in's pane on the floor. */
  sessionId?: string;
}

/** One act as puppeteer takes it, its output riding a run. */
type ActRequest = Omit<Parameters<AgentRuntime["runExtensionAct"]>[0], "onOutput">;

/** Runs an act inside a run; `shows` makes its line the run's own. */
type ActRunner = (
  request: ActRequest,
  options?: { shows?: boolean },
) => Promise<AgentExtensionReceipt>;

/** A sign-in whose pane is open: what settles it when the pane ends. */
interface OpenSignIn {
  setId: string;
  started: StartedExtensionAct;
  entry: RunEntry;
  timer: ReturnType<typeof setTimeout>;
}

function projectRun(entry: RunEntry): AgentExtensionRun {
  const { output, truncated } = displayTail(entry.raw, entry.dropped);
  return {
    id: entry.id,
    provider: entry.provider,
    label: entry.label,
    kind: entry.kind,
    item: entry.item,
    name: entry.name,
    act: entry.act,
    runs: entry.runs,
    state: entry.state,
    startedAt: entry.startedAt,
    ...(entry.finishedAt !== undefined ? { finishedAt: entry.finishedAt } : {}),
    output,
    truncated,
    ...(entry.receipt !== undefined ? { receipt: entry.receipt } : {}),
    // the pane only while it runs: a finished sign-in names none
    ...(entry.sessionId !== undefined && entry.state === "running"
      ? { terminal: { sessionId: entry.sessionId } }
      : {}),
  };
}

function appendRaw(entry: RunEntry, chunk: string): void {
  entry.raw += chunk;
  if (entry.raw.length > RUN_RAW_BYTES) {
    const kept = entry.raw.slice(entry.raw.length - RUN_RAW_BYTES);
    // start on a whole line: never inside an escape, never mid-redraw
    const firstBreak = kept.indexOf("\n");
    entry.raw = firstBreak === -1 ? kept : kept.slice(firstBreak + 1);
    entry.dropped = true;
  }
}

/**
 * The lens per Agent Profile: read on demand, the last read kept, a frame to a
 * profile's subscribers each time one finishes. Concurrent asks for one
 * profile share one read. An act runs one at a time per profile; its run
 * rides every frame of that profile until the next one replaces it.
 */
export class AgentExtensionService {
  private readonly lenses = new Map<string, Frame>();
  private readonly inflight = new Map<string, Promise<Frame>>();
  private readonly subscribers = new Map<string, Set<(frame: Frame) => void>>();
  private readonly runs = new Map<string, RunEntry>();
  /** sign-ins whose pane is open, by the floor's session id */
  private readonly signIns = new Map<string, OpenSignIn>();
  /** sign-ins settled when their wait ran out, whose pane is still the person's, by session id → profile */
  private readonly waitedOut = new Map<string, string>();
  private readonly ticks = new Map<string, ReturnType<typeof setTimeout>>();
  /** AR-S4d — profiles an Add is working through, agent by agent: no other act lands between two */
  private readonly adding = new Map<string, string>();
  /** AR-S4d2 — each profile's skill copies at its last read: what a turn gives an agent a link to */
  private readonly copies = new Map<string, Map<string, SkillCopy>>();
  /** O1 — the cells VibeField turned, per profile, and when: a read does not call their change outside */
  private readonly touched = new Map<string, Map<string, number>>();
  private readonly now: () => Date;
  private readonly logger: Logger;
  private disposed = false;

  constructor(private readonly opts: AgentExtensionServiceOptions) {
    this.now = opts.now ?? (() => new Date());
    this.logger = opts.logger ?? createNoopLogger();
  }

  /** `agents.extensions.list`: the last read, or a new one when there is none or `refresh` asks. */
  async list(setId: string, refresh = false): Promise<Frame> {
    const known = refresh ? undefined : this.lenses.get(setId);
    // a refresh skips the kept read, and still shares one already under way
    return this.frameOf(setId, known ?? (await this.read(setId)));
  }

  /**
   * `agents.extensions.act`: one act on one holding, as its agent offered it
   * in the last read; the profile's output on its frames while it runs, then
   * the whole profile read again. A second act for the profile while one runs
   * is a CONFLICT, never two of the agents' commands racing.
   */
  async act(params: AgentsExtensionsActParams): Promise<AgentsExtensionsActResult> {
    // AC-3 — an agent the catalog does not show is acted on nowhere here
    requireVisible(this.opts.catalog, params.provider, "act on its extensions");
    const setId = params.set;
    this.refuseWhileRunning(setId);
    if (params.act === "add") return await this.turnOn(params);
    if (params.values !== undefined) {
      throw new RpcCallError("PRECONDITION_FAILED", "values are kept only with an add", false, {
        set: setId,
      });
    }
    const { column, found, offered } = await this.offered(setId, params);
    // a read above may have let another act start
    this.refuseWhileRunning(setId);
    // AR-S4d — a server an agent lets go keeps its definition here, so turning it on again is one click
    const letsGo = params.kind === "mcp-server" && params.act === "remove";
    if (letsGo && found.row.definition !== undefined && found.row.kept !== true)
      await this.opts.store?.keep(setId, found.row.name, found.row.definition);
    // AR-S4d2 — a skill that is a folder of the agent's own moves to the profile's folder: the profile keeps it
    const keepsSkill =
      params.kind === "skill" &&
      params.act === "remove" &&
      found.holding.linkTarget === undefined &&
      this.opts.store !== undefined;
    const folder = keepsSkill ? join(this.opts.store!.libraryOf(setId), found.row.name) : undefined;
    const { entry, receipt } = await this.touching(
      setId,
      params.provider,
      params.kind,
      found.row.name,
      () =>
        this.runAct(
          setId,
          {
            provider: params.provider,
            label: column.label,
            kind: params.kind,
            item: params.id,
            name: found.row.name,
            act: params.act,
            runs: offered.runs,
          },
          {
            providerId: params.provider,
            profileId: column.profileId,
            target: { kind: params.kind, id: params.id },
            act: params.act,
            ...(folder !== undefined ? { folder } : {}),
          },
        ),
    );
    if (letsGo && receipt.status === "changed")
      await this.remember(setId, () =>
        this.opts.store?.take(setId, params.provider, found.row.name),
      );
    // every cell says what the agents hold now: a read that began before the act finished cannot
    await this.read(setId, true).catch((error: unknown) => this.readFailed(setId, error));
    return { run: projectRun(entry), receipt };
  }

  /**
   * AR-S4d — an act `add`: the row named `id` turned on for an agent that
   * holds none of it, by that agent's own add, from the row's definition. The
   * values it reads are kept first (those given here, and those kept before);
   * the definition is kept too, so the profile has it whoever lets it go.
   */
  private async turnOn(params: AgentsExtensionsActParams): Promise<AgentsExtensionsActResult> {
    const setId = params.set;
    if (params.kind === "skill") {
      if (params.values !== undefined) {
        throw new RpcCallError("PRECONDITION_FAILED", "a skill reads no values", false, {
          set: setId,
        });
      }
      return await this.turnOnSkill(params);
    }
    const lens = this.lenses.get(setId) ?? (await this.read(setId));
    const column = this.columnIn(lens, setId, params.provider);
    const row = lens.servers.find((candidate) => candidate.name === params.id);
    if (row === undefined) {
      throw new RpcCallError(
        "NOT_FOUND",
        `this Agent Profile has no server named ${params.id}`,
        false,
        {
          set: setId,
        },
      );
    }
    const offer = row.offers?.[params.provider];
    if (row.definition === undefined || offer?.act === undefined) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${column.label} cannot take ${row.name} here${offer?.unavailable !== undefined ? `: ${offer.unavailable.message}` : ""}`,
        false,
        { set: setId, provider: params.provider },
      );
    }
    const definition = definitionOf(row.definition);
    await this.keepValues(setId, row.name, definition, params.values ?? {}, lens.values ?? []);
    this.refuseWhileRunning(setId);
    if (row.kept !== true) await this.opts.store?.keep(setId, row.name, definition);
    const runs = offer.act.runs;
    const { entry, receipt } = await this.touching(
      setId,
      params.provider,
      "mcp-server",
      row.name,
      () =>
        this.runAct(
          setId,
          {
            provider: params.provider,
            label: column.label,
            kind: "mcp-server",
            item: row.name,
            name: row.name,
            act: "add",
            runs,
          },
          {
            providerId: params.provider,
            profileId: column.profileId,
            target: { kind: "mcp-server", id: row.name },
            act: "add",
            definition,
          },
        ),
    );
    if (receipt.status === "changed") await this.gave(setId, params.provider, row.name, definition);
    await this.read(setId, true).catch((error: unknown) => this.readFailed(setId, error));
    return { run: projectRun(entry), receipt };
  }

  /**
   * `agents.extensions.add` (AR-S4d's Add server): the definition kept once for
   * the profile, with the values it reads, then each named agent's own add in
   * turn, one run each on the frames — no other act between two — and the
   * profile read again once at the end.
   */
  async add(params: AgentsExtensionsAddParams): Promise<AgentsExtensionsAddResult> {
    const setId = params.set;
    for (const provider of params.agents)
      requireVisible(this.opts.catalog, provider, "turn on a server for it");
    this.refuseWhileRunning(setId);
    const definition = this.travelling(params.name, params.definition);
    const lens = this.lenses.get(setId) ?? (await this.read(setId));
    if (lens.servers.some((row) => row.name === params.name)) {
      throw new RpcCallError(
        "CONFLICT",
        `this Agent Profile already has a server named ${params.name}`,
        false,
        { set: setId },
      );
    }
    const columns = [...new Set(params.agents)].map((provider) =>
      this.columnIn(lens, setId, provider),
    );
    await this.keepValues(setId, params.name, definition, params.values ?? {}, lens.values ?? []);
    this.refuseWhileRunning(setId);
    await this.opts.store?.keep(setId, params.name, definition);
    this.adding.set(setId, params.name);
    const receipts: AgentsExtensionsAddResult["receipts"] = [];
    try {
      for (const column of columns) {
        const runs = await this.addLine(column, params.name, definition);
        const { receipt } = await this.touching(
          setId,
          column.provider,
          "mcp-server",
          params.name,
          () =>
            this.runAct(
              setId,
              {
                provider: column.provider,
                label: column.label,
                kind: "mcp-server",
                item: params.name,
                name: params.name,
                act: "add",
                // what the agent's own add will run, as a person reads it (puppeteer plans it again as it runs)
                runs,
              },
              {
                providerId: column.provider,
                profileId: column.profileId,
                target: { kind: "mcp-server", id: params.name },
                act: "add",
                definition,
              },
            ),
        );
        receipts.push({ provider: column.provider, receipt });
        if (receipt.status === "changed")
          await this.gave(setId, column.provider, params.name, definition);
      }
    } finally {
      this.adding.delete(setId);
    }
    await this.read(setId, true).catch((error: unknown) => this.readFailed(setId, error));
    return { receipts };
  }

  /**
   * AR-S4d2 — an act `add` on a skill: the row named `id` given to an agent
   * that holds none of it, as a link to its one copy (Codex: the copy moves to
   * the shared folder). A copy that is still another agent's own folder moves
   * to the profile's folder first, linked back, in the same run.
   */
  private async turnOnSkill(params: AgentsExtensionsActParams): Promise<AgentsExtensionsActResult> {
    const setId = params.set;
    const lens = this.lenses.get(setId) ?? (await this.read(setId));
    const column = this.columnIn(lens, setId, params.provider);
    const row = lens.skills.find((candidate) => candidate.name === params.id);
    if (row === undefined) {
      throw new RpcCallError(
        "NOT_FOUND",
        `this Agent Profile has no skill named ${params.id}`,
        false,
        { set: setId },
      );
    }
    const offer = row.offers?.[params.provider];
    const copy = this.copies.get(setId)?.get(row.name);
    if (offer?.act === undefined || copy === undefined) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${column.label} cannot take ${row.name} here${offer?.unavailable !== undefined ? `: ${offer.unavailable.message}` : ""}`,
        false,
        { set: setId, provider: params.provider },
      );
    }
    this.refuseWhileRunning(setId);
    const shares = sharesFolder(offer.act);
    const { entry, receipt } = await this.runActs(
      setId,
      {
        provider: params.provider,
        label: column.label,
        kind: "skill",
        item: row.name,
        name: row.name,
        act: "add",
        runs: offer.act.runs,
      },
      (act, say) => this.giveSkill(setId, lens, row, copy, column, shares, act, say),
    );
    await this.read(setId, true).catch((error: unknown) => this.readFailed(setId, error));
    return { run: projectRun(entry), receipt };
  }

  /**
   * `agents.extensions.addSkill` (AR-S4d2's Add skill): the folder copied into
   * the profile's skills folder under its own name, then each named agent given
   * it in turn, one run each on the frames — no other act between two — and
   * the profile read again once at the end.
   */
  async addSkill(params: AgentsExtensionsAddSkillParams): Promise<AgentsExtensionsAddSkillResult> {
    const setId = params.set;
    for (const provider of params.agents)
      requireVisible(this.opts.catalog, provider, "give it a skill");
    this.refuseWhileRunning(setId);
    const store = this.requireStore(setId);
    const source = await store.inspectSkill(setId, params.from);
    const lens = this.lenses.get(setId) ?? (await this.read(setId));
    if (lens.skills.some((row) => row.name === source.name)) {
      throw new RpcCallError(
        "CONFLICT",
        `this Agent Profile already has a skill named ${source.name}`,
        false,
        { set: setId, reason: "taken" },
      );
    }
    const columns = [...new Set(params.agents)].map((provider) =>
      this.columnIn(lens, setId, provider),
    );
    this.refuseWhileRunning(setId);
    const from = await store.keepSkill(setId, source);
    const copy: SkillCopy = { folder: from, from, kept: true };
    this.adding.set(setId, source.name);
    const receipts: AgentsExtensionsAddSkillResult["receipts"] = [];
    try {
      for (const column of columns) {
        const plan = await this.skillPlan(column, source.name, from);
        const offer = plan === undefined ? undefined : offerOf(plan, this.opts.home).act;
        const { receipt } = await this.runActs(
          setId,
          {
            provider: column.provider,
            label: column.label,
            kind: "skill",
            item: source.name,
            name: source.name,
            act: "add",
            runs: offer?.runs ?? `${column.label}'s link to ${source.name}`,
          },
          (act, say) =>
            this.giveSkill(
              setId,
              lens,
              { name: source.name, cells: {} },
              copy,
              column,
              offer !== undefined && sharesFolder(offer),
              act,
              say,
            ),
        );
        receipts.push({ provider: column.provider, receipt });
      }
    } finally {
      this.adding.delete(setId);
    }
    await this.read(setId, true).catch((error: unknown) => this.readFailed(setId, error));
    return { name: source.name, receipts };
  }

  /**
   * `agents.extensions.planSkill`: the folder a person named, read before
   * anything is copied — its name, what it does, where it would be kept — and
   * what each of the profile's agents would run to take it.
   */
  async planSkill(
    params: AgentsExtensionsPlanSkillParams,
  ): Promise<AgentsExtensionsPlanSkillResult> {
    const setId = params.set;
    const store = this.requireStore(setId);
    const source = await store.inspectSkill(setId, params.from);
    const lens = this.lenses.get(setId) ?? (await this.read(setId));
    if (lens.skills.some((row) => row.name === source.name)) {
      throw new RpcCallError(
        "CONFLICT",
        `this Agent Profile already has a skill named ${source.name}`,
        false,
        { set: setId, reason: "taken" },
      );
    }
    const from = join(store.libraryOf(setId), source.name);
    const offers: AgentsExtensionsPlanSkillResult["offers"] = {};
    await Promise.all(
      lens.agents.map(async (column) => {
        if (column.failure !== undefined) {
          offers[column.provider] = {
            unavailable: { reason: "unread", message: column.failure.message },
          };
          return;
        }
        const plan = await this.skillPlan(column, source.name, from);
        if (plan !== undefined) offers[column.provider] = offerOf(plan, this.opts.home);
      }),
    );
    return {
      name: source.name,
      ...(source.description !== undefined ? { description: source.description } : {}),
      folder: abbreviateHome(from, this.opts.home),
      offers,
    };
  }

  /**
   * `agents.extensions.plan`: what an Add would run on each of the profile's
   * agents — or why an agent cannot take the server — before anything is kept.
   */
  async plan(params: AgentsExtensionsPlanParams): Promise<AgentsExtensionsPlanResult> {
    const setId = params.set;
    const definition = this.travelling(params.name, params.definition);
    const lens = this.lenses.get(setId) ?? (await this.read(setId));
    const row = lens.servers.find((candidate) => candidate.name === params.name);
    const offers: AgentsExtensionsPlanResult["offers"] = {};
    await Promise.all(
      lens.agents.map(async (column) => {
        if (column.failure !== undefined) {
          offers[column.provider] = {
            unavailable: { reason: "unread", message: column.failure.message },
          };
          return;
        }
        if (row?.cells[column.provider] !== undefined) {
          offers[column.provider] = {
            unavailable: {
              reason: "held",
              message: `${column.label} already has a server named ${params.name}`,
            },
          };
          return;
        }
        try {
          const plans = await this.opts.runtime.extensionActPlans(
            column.provider,
            column.profileId,
            [],
            [{ name: params.name, definition }],
          );
          const plan = Array.isArray(plans)
            ? plans.find((candidate) => candidate.act === "add")
            : undefined;
          if (plan !== undefined) offers[column.provider] = offerOf(plan, this.opts.home);
        } catch (error) {
          this.logger.warn("fieldd.agents.extension_plans_failed", "Planning an add failed", {
            provider: column.provider,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
    return { offers };
  }

  /**
   * `agents.extensions.signIn`: the agent's own sign-in to one of its remote
   * servers, as its agent offered it in the last read, in a pane on the floor.
   * The caller gets the pane's ticket; the run rides the profile's frames until
   * the pane ends, then the receipt. One act at a time per profile, this too.
   */
  async signIn(
    params: AgentsExtensionsSignInParams,
    principal: GrantPrincipal,
  ): Promise<AgentsExtensionsSignInResult> {
    requireVisible(this.opts.catalog, params.provider, "sign in to its servers");
    const panes = this.opts.panes;
    if (panes === undefined) {
      throw new RpcCallError(
        "UNAVAILABLE",
        "agent terminals are not hosted: this daemon lends no terminal floor",
        false,
        { service: "agents", state: "no-terminal-host" },
      );
    }
    const setId = params.set;
    this.refuseWhileRunning(setId);
    const request = { ...params, kind: "mcp-server" as const, act: "sign-in" as const };
    const { column, found, offered } = await this.offered(setId, request);
    this.refuseWhileRunning(setId);
    const started = await this.opts.runtime.startExtensionAct({
      providerId: params.provider,
      profileId: column.profileId,
      target: { kind: "mcp-server", id: params.id },
      act: "sign-in",
    });
    if (!("runtimeSessionId" in started)) {
      // puppeteer read the agent again and it no longer offers this, or its login would not start
      throw new RpcCallError(
        started.status === "unavailable" ? "PRECONDITION_FAILED" : "UNAVAILABLE",
        `${column.label}'s sign-in to ${found.row.name} did not start: ${started.message}`,
        started.status !== "unavailable",
        { set: setId, provider: params.provider },
      );
    }
    const sessionId = started.runtimeSessionId;
    let terminal: TerminalCreateOpenResult;
    try {
      terminal = panes.open(sessionId, principal);
    } catch (error) {
      // a pane no ticket can reach is a login nobody could finish: it ends here
      await panes.close(sessionId).catch(() => undefined);
      throw error;
    }
    const entry: RunEntry = {
      id: randomUUID(),
      provider: params.provider,
      label: column.label,
      kind: "mcp-server",
      item: params.id,
      name: found.row.name,
      act: "sign-in",
      runs: offered.runs,
      state: "running",
      startedAt: started.startedAt,
      raw: "",
      dropped: false,
      sessionId,
    };
    const timer = setTimeout(
      () => void this.settleSignIn(sessionId, undefined),
      this.opts.signInWaitMs ?? SIGN_IN_WAIT_MS,
    );
    timer.unref?.();
    this.runs.set(setId, entry);
    this.signIns.set(sessionId, { setId, started, entry, timer });
    this.publishRun(setId);
    this.logger.info("fieldd.agents.extension_sign_in", "A server's sign-in pane opened", {
      set: setId,
      provider: params.provider,
      sessionId,
    });
    return { run: projectRun(entry), terminal };
  }

  /**
   * The floor's exit facts: a sign-in's pane ended (the person finished, or
   * cancelled — `requestedTermination`), or one whose wait ran out finally
   * did. True when the pane was a sign-in's.
   */
  async handleTerminalExit(event: SessionExitedEvent): Promise<boolean> {
    if (this.signIns.has(event.sessionId)) {
      await this.settleSignIn(event.sessionId, {
        exitCode: event.exitCode,
        // the floor names who asked for an end (a Cancel's terminate); a pane that ended itself has none
        stopped: event.requestedTermination !== null,
      });
      return true;
    }
    const setId = this.waitedOut.get(event.sessionId);
    if (setId === undefined) return false;
    this.waitedOut.delete(event.sessionId);
    await this.closePane(event.sessionId);
    // a sign-in finished after its wait ran out: the cells say so now
    await this.read(setId, true).catch((error: unknown) => this.readFailed(setId, error));
    return true;
  }

  /**
   * `agents.extensions.subscribe`: the last read as the snapshot — or, before
   * the first, the profile's agents with `reading: true`, the read under way
   * and its frame to follow.
   */
  async subscribe(
    setId: string,
    emit: (frame: Frame) => void,
  ): Promise<{ snapshot: Frame; dispose: () => void }> {
    const known = this.lenses.get(setId);
    const snapshot = this.frameOf(setId, known ?? (await this.placeholder(setId)));
    const listeners = this.subscribers.get(setId) ?? new Set<(frame: Frame) => void>();
    this.subscribers.set(setId, listeners);
    listeners.add(emit);
    if (known === undefined) this.readInBackground(setId);
    return {
      snapshot,
      dispose: () => {
        listeners.delete(emit);
        if (listeners.size === 0) this.subscribers.delete(setId);
      },
    };
  }

  /**
   * The registry changed: a profile's agents may have. Every kept read is
   * dropped; a profile someone is watching is read again, and one that no
   * longer exists is simply no longer read.
   */
  profilesChanged(): void {
    this.lenses.clear();
    for (const setId of this.subscribers.keys()) this.readInBackground(setId);
  }

  dispose(): void {
    this.disposed = true;
    for (const tick of this.ticks.values()) clearTimeout(tick);
    this.ticks.clear();
    // an open pane outlives fieldd, as a profile login's does; nothing settles it now
    for (const signIn of this.signIns.values()) clearTimeout(signIn.timer);
    this.signIns.clear();
    this.waitedOut.clear();
    this.subscribers.clear();
    this.lenses.clear();
  }

  /** A profile's frame: its lens, and its act while one runs or the last that did. */
  private frameOf(setId: string, lens: Frame): Frame {
    const run = this.runs.get(setId);
    return run === undefined ? lens : { ...lens, run: projectRun(run) };
  }

  /** The holding an act names, and the act its agent offered on it in the last read — or the door's refusal. */
  private async offered(
    setId: string,
    params: {
      provider: string;
      kind: "mcp-server" | "skill";
      id: string;
      act: AgentExtensionAct["act"];
    },
  ): Promise<{
    column: AgentExtensionColumn;
    found: { row: AgentExtensionRow; holding: AgentExtensionHolding };
    offered: AgentExtensionAct;
  }> {
    const lens = this.lenses.get(setId) ?? (await this.read(setId));
    const column = lens.agents.find((candidate) => candidate.provider === params.provider);
    if (column === undefined) {
      throw new RpcCallError(
        "NOT_FOUND",
        `${params.provider} is not in this Agent Profile`,
        false,
        {
          set: setId,
          provider: params.provider,
        },
      );
    }
    const rows = params.kind === "mcp-server" ? lens.servers : lens.skills;
    let found: { row: AgentExtensionRow; holding: AgentExtensionHolding } | undefined;
    for (const row of rows) {
      const holding = row.cells[params.provider]?.find((candidate) => candidate.id === params.id);
      if (holding !== undefined) {
        found = { row, holding };
        break;
      }
    }
    if (found === undefined) {
      throw new RpcCallError(
        "NOT_FOUND",
        `${column.label} does not hold ${params.id} in this Agent Profile`,
        false,
        { set: setId, provider: params.provider },
      );
    }
    const offered = found.holding.acts?.find((candidate) => candidate.act === params.act);
    if (offered === undefined) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${column.label} offers no ${params.act} for ${found.row.name} here`,
        false,
        { set: setId, provider: params.provider },
      );
    }
    return { column, found, offered };
  }

  /**
   * One agent given a skill, inside a run: its copy moved to the profile's
   * folder first when it is still another agent's own (and linked back there),
   * then the agent's link. An agent that reads a person's skills only from a
   * folder every profile shares (Codex) takes the copy there (`shares`), and
   * its own switch then turns it off in the other profiles.
   */
  private async giveSkill(
    setId: string,
    lens: Frame,
    row: Pick<AgentExtensionRow, "name" | "cells">,
    copy: SkillCopy,
    column: AgentExtensionColumn,
    shares: boolean,
    act: ActRunner,
    say: (line: string) => void,
  ): Promise<AgentExtensionReceipt> {
    if (copy.owner !== undefined && copy.kept !== true) {
      const owner = lens.agents.find((candidate) => candidate.provider === copy.owner);
      const holding = row.cells[copy.owner]?.find(
        (candidate) => candidate.origin === "own" && candidate.linkTarget === undefined,
      );
      if (owner === undefined || holding === undefined) {
        return {
          status: "failed",
          message: `${row.name} is no longer where it was`,
          finishedAt: this.now().toISOString(),
        };
      }
      const kept = await this.touching(setId, owner.provider, "skill", row.name, async () => {
        const moved = await act({
          providerId: owner.provider,
          profileId: owner.profileId,
          target: { kind: "skill", id: holding.id },
          act: "remove",
          folder: copy.from,
        });
        if (moved.status !== "changed") return { moved };
        const back = await act({
          providerId: owner.provider,
          profileId: owner.profileId,
          target: { kind: "skill", id: row.name },
          act: "add",
          folder: copy.from,
        });
        return { moved, back };
      });
      if (kept.back === undefined) {
        return {
          ...kept.moved,
          message: `${row.name} could not move to this profile's folder: ${kept.moved.message}`,
        };
      }
      const back = kept.back;
      if (back.status !== "changed") {
        return {
          ...back,
          status: "failed",
          message: `${row.name} is in this profile's folder now, but ${owner.label} lost it: ${back.message}`,
        };
      }
    }
    const given = await this.touching(setId, column.provider, "skill", row.name, () =>
      act(
        {
          providerId: column.provider,
          profileId: column.profileId,
          target: { kind: "skill", id: row.name },
          act: "add",
          folder: copy.from,
        },
        { shows: true },
      ),
    );
    if (shares && given.status === "changed" && copy.shared !== true) {
      await this.offElsewhere(setId, column, row.name, act, say);
    }
    return given;
  }

  /**
   * An agent took a skill to the folder every one of its profiles reads: its
   * own switch turns it off in each other profile with that agent, so it
   * stays this profile's (pass 24). What each one did is said on the run.
   */
  private async offElsewhere(
    setId: string,
    column: AgentExtensionColumn,
    name: string,
    act: ActRunner,
    say: (line: string) => void,
  ): Promise<void> {
    let sets: Awaited<ReturnType<AgentExtensionServiceOptions["runtime"]["profileSets"]>>;
    try {
      sets = await this.opts.runtime.profileSets();
    } catch {
      say(
        `The other profiles could not be read; ${name} is on for ${column.label} in each of them.`,
      );
      return;
    }
    for (const info of sets) {
      if (info.set.id === setId) continue;
      const there = info.profiles.find((profile) => profile.provider === column.provider);
      if (there === undefined) continue;
      const off = await this.touching(info.set.id, column.provider, "skill", name, () =>
        act({
          providerId: column.provider,
          profileId: there.id,
          target: { kind: "skill", id: name },
          act: "disable",
        }),
      );
      say(
        off.status === "changed"
          ? `Off for ${column.label} in ${info.set.label}`
          : `Still on for ${column.label} in ${info.set.label}: ${off.message}`,
      );
    }
  }

  /** The adapter's plan for giving an agent a skill from a folder: pure, so this reads nothing. */
  private async skillPlan(
    column: AgentExtensionColumn,
    name: string,
    from: string,
  ): Promise<ExtensionActPlan | undefined> {
    try {
      const plans = await this.opts.runtime.extensionActPlans(
        column.provider,
        column.profileId,
        [],
        undefined,
        { adds: [{ name, folder: from }] },
      );
      return Array.isArray(plans) ? plans.find((candidate) => candidate.act === "add") : undefined;
    } catch (error) {
      this.logger.warn("fieldd.agents.extension_plans_failed", "Planning a skill failed", {
        provider: column.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private requireStore(setId: string): AgentExtensionStore {
    if (this.opts.store === undefined) {
      throw new RpcCallError("UNAVAILABLE", "this daemon keeps no skills for agents", false, {
        set: setId,
      });
    }
    return this.opts.store;
  }

  /**
   * O1: VibeField turns this cell while `work` runs. No read calls its change
   * one made outside until a read that begins after the turn ended has seen it.
   */
  private async touching<T>(
    setId: string,
    provider: string,
    kind: "mcp-server" | "skill",
    name: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const cells = this.touched.get(setId) ?? new Map<string, number>();
    this.touched.set(setId, cells);
    const key = changeKey(provider, kind, name);
    cells.set(key, Number.POSITIVE_INFINITY);
    try {
      return await work();
    } finally {
      cells.set(key, this.now().getTime());
    }
  }

  /** An add's line for the run card before it runs: the adapter's plan is pure, so this reads nothing. */
  private async addLine(
    column: AgentExtensionColumn,
    name: string,
    definition: McpServerDefinition,
  ): Promise<string> {
    try {
      const plans = await this.opts.runtime.extensionActPlans(
        column.provider,
        column.profileId,
        [],
        [{ name, definition }],
      );
      const plan = Array.isArray(plans)
        ? plans.find((candidate) => candidate.act === "add")
        : undefined;
      if (plan?.available === true) return plan.display;
    } catch {
      // the run says what ran once it has
    }
    return `${column.label}'s own add`;
  }

  /** The profile's column for an agent — or NOT_FOUND, an agent the profile does not have. */
  private columnIn(lens: Frame, setId: string, provider: string): AgentExtensionColumn {
    const column = lens.agents.find((candidate) => candidate.provider === provider);
    if (column === undefined) {
      throw new RpcCallError("NOT_FOUND", `${provider} is not in this Agent Profile`, false, {
        set: setId,
        provider,
      });
    }
    return column;
  }

  /**
   * A definition as the person gave it, checked the way puppeteer checks what
   * may travel: nothing a listing would hide (a key in the command line or the
   * address belongs in a value) and no variable inside itself.
   */
  private travelling(name: string, given: AgentExtensionServerDefinition): McpServerDefinition {
    const definition = definitionOf(given);
    const checked = mcpServerDefinition(
      definition.transport === "stdio"
        ? {
            transport: "stdio",
            command: definition.command,
            args: definition.args,
            env: definition.env,
          }
        : { transport: definition.transport, url: definition.url },
    );
    if (checked === undefined || JSON.stringify(checked) !== JSON.stringify(definition)) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        definition.transport === "stdio"
          ? `${name}'s command carries what looks like a key or a variable: give it as an environment value instead`
          : `${name}'s address carries what looks like a key or a variable: VibeField keeps a key only as a value`,
        false,
        { reason: "hides-a-value" },
      );
    }
    for (const variable of definition.transport === "stdio" ? (definition.env ?? []) : []) {
      if (
        !isLaunchValueName(variable) ||
        ENV_PREFIXES.some((prefix) => variable.startsWith(prefix))
      ) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `${variable} is a name an agent's own environment keeps; a server's value takes another`,
          false,
          { reason: "reserved-name", name: variable },
        );
      }
    }
    return definition;
  }

  /**
   * The values a server reads, kept before an agent is given it: those given
   * now (only names the definition reads), and every name it reads must have
   * one — given now or kept before.
   */
  private async keepValues(
    setId: string,
    name: string,
    definition: McpServerDefinition,
    values: Readonly<Record<string, string>>,
    kept: readonly string[],
  ): Promise<void> {
    const reads = definition.transport === "stdio" ? (definition.env ?? []) : [];
    const stray = Object.keys(values).filter((variable) => !reads.includes(variable));
    if (stray.length > 0) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${name} does not read ${stray.join(", ")}`,
        false,
        { set: setId },
      );
    }
    const missing = reads.filter(
      (variable) => values[variable] === undefined && !kept.includes(variable),
    );
    if (missing.length > 0) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${name} needs a value for ${missing.join(", ")}`,
        false,
        { set: setId, needs: missing },
      );
    }
    if (Object.keys(values).length === 0) return;
    if (this.opts.store === undefined) {
      throw new RpcCallError("UNAVAILABLE", "this daemon keeps no values for agents", false, {
        set: setId,
      });
    }
    await this.opts.store.keepValues(setId, values);
  }

  /** An agent took the server: it is given the values the server reads when VibeField starts it. */
  private async gave(
    setId: string,
    provider: string,
    name: string,
    definition: McpServerDefinition,
  ): Promise<void> {
    await this.remember(setId, () =>
      this.opts.store?.give(
        setId,
        provider,
        name,
        definition.transport === "stdio" ? (definition.env ?? []) : [],
      ),
    );
  }

  /** A note in the profile's keep after an act that already ran: its failure is said, never thrown. */
  private async remember(setId: string, note: () => Promise<void> | undefined): Promise<void> {
    try {
      await note();
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.extension_keep_failed",
        "The profile's keep was not updated",
        {
          set: setId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /** One act through puppeteer, riding the profile's frames: the run, then its receipt. */
  private runAct(
    setId: string,
    run: Pick<RunEntry, "provider" | "label" | "kind" | "item" | "name" | "act" | "runs">,
    request: ActRequest,
  ): Promise<{ entry: RunEntry; receipt: AgentExtensionReceipt }> {
    return this.runActs(setId, run, (act) => act(request, { shows: true }));
  }

  /**
   * Acts through puppeteer riding ONE run on the profile's frames — each act's
   * output and every line `say`s, in order — whose receipt is what `body`
   * answers: a skill given to an agent can move its copy first, and Codex's
   * turns off its switch in the other profiles after.
   */
  private async runActs(
    setId: string,
    run: Pick<RunEntry, "provider" | "label" | "kind" | "item" | "name" | "act" | "runs">,
    body: (act: ActRunner, say: (line: string) => void) => Promise<AgentExtensionReceipt>,
  ): Promise<{ entry: RunEntry; receipt: AgentExtensionReceipt }> {
    const entry: RunEntry = {
      id: randomUUID(),
      ...run,
      state: "running",
      startedAt: this.now().toISOString(),
      raw: "",
      dropped: false,
    };
    this.runs.set(setId, entry);
    this.publishRun(setId);
    const output = (chunk: string) => {
      appendRaw(entry, chunk);
      this.publishRun(setId);
    };
    const act: ActRunner = async (request, options) => {
      const result = await this.opts.runtime.runExtensionAct({ ...request, onOutput: output });
      // what puppeteer ran, as it planned it from the read it made
      if (options?.shows === true && result.display !== undefined) entry.runs = result.display;
      return {
        status: result.status,
        message: result.message,
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
        finishedAt: result.finishedAt,
      };
    };
    let receipt: AgentExtensionReceipt;
    try {
      receipt = await body(act, (line) => output(`${line}\n`));
    } catch (error) {
      this.logger.warn("fieldd.agents.extension_act_failed", "An extension act could not run", {
        set: setId,
        provider: run.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      receipt = {
        status: "failed",
        message: "it could not be run",
        finishedAt: this.now().toISOString(),
      };
    }
    entry.state = "finished";
    entry.finishedAt = receipt.finishedAt;
    entry.receipt = receipt;
    this.logger.info("fieldd.agents.extension_act", "An extension act ran", {
      set: setId,
      provider: run.provider,
      act: run.act,
      status: receipt.status,
    });
    return { entry, receipt };
  }

  /**
   * A sign-in's pane ended, or its wait ran out: puppeteer reads the agent
   * again for the receipt, an ended pane's husk is closed, and the profile is
   * read again. A pane still open when the wait ran out stays the person's;
   * its end, when it comes, reads the profile again.
   */
  private async settleSignIn(sessionId: string, ended: ExtensionActEnd | undefined): Promise<void> {
    const signIn = this.signIns.get(sessionId);
    if (signIn === undefined) return;
    this.signIns.delete(sessionId);
    clearTimeout(signIn.timer);
    const { setId, started, entry } = signIn;
    if (ended === undefined) this.waitedOut.set(sessionId, setId);
    else await this.closePane(sessionId);
    let receipt: AgentExtensionReceipt;
    try {
      const result = await this.opts.runtime.settleExtensionAct(started, ended);
      receipt = {
        status: result.status,
        message: result.message,
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
        finishedAt: result.finishedAt,
      };
    } catch (error) {
      this.logger.warn("fieldd.agents.extension_act_failed", "A sign-in could not be read again", {
        set: setId,
        provider: entry.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      receipt = {
        status: "failed",
        message: "it could not be read again",
        finishedAt: this.now().toISOString(),
      };
    }
    if (this.disposed) return;
    entry.state = "finished";
    entry.finishedAt = receipt.finishedAt;
    entry.receipt = receipt;
    this.logger.info("fieldd.agents.extension_act", "An extension act ran", {
      set: setId,
      provider: entry.provider,
      act: entry.act,
      status: receipt.status,
    });
    await this.read(setId, true).catch((error: unknown) => this.readFailed(setId, error));
  }

  private async closePane(sessionId: string): Promise<void> {
    try {
      await this.opts.panes?.close(sessionId);
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.extension_pane_close_failed",
        "A sign-in's pane could not be closed",
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /** A read after an act failed: the run's end still reaches the page, on the last lens. */
  private readFailed(setId: string, error: unknown): void {
    this.publishRun(setId);
    this.logger.warn(
      "fieldd.agents.extensions_read_failed",
      "Reading an Agent Profile's extensions failed",
      { set: setId, error: error instanceof Error ? error.message : String(error) },
    );
  }

  private refuseWhileRunning(setId: string): void {
    const adding = this.adding.get(setId);
    if (adding !== undefined) {
      throw new RpcCallError(
        "CONFLICT",
        `${adding} is still being turned on in this Agent Profile`,
        true,
        { set: setId },
      );
    }
    const running = this.runs.get(setId);
    if (running?.state === "running") {
      throw new RpcCallError(
        "CONFLICT",
        running.act === "sign-in"
          ? `${running.label} is still signing in to ${running.name} in this Agent Profile`
          : `${running.label} is still changing ${running.name} in this Agent Profile`,
        true,
        { set: setId },
      );
    }
  }

  private emit(setId: string, frame: Frame): void {
    for (const emit of this.subscribers.get(setId) ?? []) {
      try {
        emit(frame);
      } catch (error) {
        this.logger.warn(
          "fieldd.agents.extensions_emit_failed",
          "An extensions frame was not delivered",
          { set: setId, error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
  }

  /** The run's output as it arrives, coalesced to the tick, on the profile's last lens. */
  private publishRun(setId: string): void {
    if (this.disposed || this.ticks.has(setId) || !this.subscribers.has(setId)) return;
    const tick = setTimeout(() => {
      this.ticks.delete(setId);
      const lens = this.lenses.get(setId);
      if (lens !== undefined) this.emit(setId, this.frameOf(setId, lens));
    }, RUN_TICK_MS);
    tick.unref?.();
    this.ticks.set(setId, tick);
  }

  private readInBackground(setId: string): void {
    void this.read(setId).catch((error: unknown) => {
      this.logger.warn(
        "fieldd.agents.extensions_read_failed",
        "Reading an Agent Profile's extensions failed",
        {
          set: setId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    });
  }

  private async profileSet(setId: string) {
    const info = await this.opts.runtime.profileSet(setId);
    if (info === undefined)
      throw new RpcCallError("NOT_FOUND", `unknown Agent Profile: ${setId}`, false);
    return info;
  }

  private labels(): Map<string, string> {
    const labels = new Map<string, string>();
    for (const provider of this.opts.runtime.profileProviders())
      labels.set(provider.id, provider.label);
    for (const provider of this.opts.runtime.extensionProviders())
      labels.set(provider.id, provider.label);
    return labels;
  }

  /** The profile's agents, nothing read yet. */
  private async placeholder(setId: string): Promise<Frame> {
    const info = await this.profileSet(setId);
    return {
      set: setId,
      reading: true,
      agents: this.columnsOf(info.profiles).map(emptyColumn),
      servers: [],
      skills: [],
      plugins: {},
      marketplaces: {},
    };
  }

  private columnsOf(profiles: readonly AgentProfile[]) {
    const labels = this.labels();
    const support = new Map(
      this.opts.runtime.extensionProviders().map((provider) => [provider.id, provider.support]),
    );
    // AC-3 — a sign-in of an agent the catalog does not show has no column: a
    // `declined` id never leaves fieldd through the lens either
    return profiles
      .filter((profile) => this.opts.catalog.isVisible(profile.provider))
      .map((profile) => ({
        provider: profile.provider,
        label: labels.get(profile.provider) ?? profile.provider,
        profileId: profile.id,
        support: support.get(profile.provider) ?? {},
      }));
  }

  /** One read of every agent in the profile; `fresh` never joins a read that began earlier. */
  private read(setId: string, fresh = false): Promise<Frame> {
    const running = this.inflight.get(setId);
    if (running !== undefined && !fresh) return running;
    const request: Promise<Frame> = (async () => {
      const startedAt = this.now().getTime();
      const info = await this.profileSet(setId);
      const reads = await Promise.all(
        this.columnsOf(info.profiles).map(async (column) => ({
          ...column,
          result: await this.opts.runtime.extensionInventory(column.provider, column.profileId),
        })),
      );
      const keep = await this.keepOf(setId);
      // AR-S4d — each empty cell's add is planned from the definition its row would give
      const definitions = serverDefinitions(reads, keep);
      // AR-S4d2 — and each skill's link from its one copy; a folder of an agent's own moves to the profile's
      const folders = await this.skillFolders(setId, reads);
      const copies =
        folders === undefined ? new Map<string, SkillCopy>() : skillCopies(reads, folders);
      const agents = await Promise.all(
        reads.map(async (agent) => ({
          ...agent,
          ...(await this.plansFor(agent, agent.result, definitions, copies, folders?.library)),
        })),
      );
      const readAt = this.now().toISOString();
      const changes = await this.notice(setId, readAt, reads, startedAt);
      const lens = buildExtensionLens({
        set: setId,
        readAt,
        agents,
        home: this.opts.home,
        ...(keep !== undefined ? { keep } : {}),
        ...(folders !== undefined ? { skills: folders } : {}),
        ...(changes !== undefined ? { changes } : {}),
      });
      this.copies.set(setId, copies);
      if (this.disposed) return lens;
      this.lenses.set(setId, lens);
      this.emit(setId, this.frameOf(setId, lens));
      return lens;
    })().finally(() => {
      // a fresh read may have taken the profile over: leave its entry alone
      if (this.inflight.get(setId) === request) this.inflight.delete(setId);
    });
    this.inflight.set(setId, request);
    return request;
  }

  /**
   * AR-S4d2 — the skill folders a read names beside the agents' own reads: the
   * profile's skills folder and what it keeps, and every folder's real path,
   * so a link to a link is still the one copy.
   */
  private async skillFolders(
    setId: string,
    reads: ReadonlyArray<{ result: ExtensionInventory | ExtensionFailure }>,
  ): Promise<SkillFolders | undefined> {
    const store = this.opts.store;
    if (store === undefined) return undefined;
    let kept: KeptSkill[] = [];
    try {
      kept = await store.keptSkills(setId);
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.extension_skills_unreadable",
        "The profile's skills could not be read",
        {
          set: setId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const shared = join(this.opts.home, ".agents", "skills");
    const paths = new Set<string>([shared, ...kept.map((skill) => skill.folder)]);
    for (const read of reads) {
      if (isFailure(read.result)) continue;
      for (const item of read.result.items) {
        if (item.kind === "skill" && item.location !== undefined) paths.add(item.location);
      }
    }
    const canonical = new Map<string, string>();
    await Promise.all(
      [...paths].map(async (path) => {
        canonical.set(path, await realpath(path).catch(() => path));
      }),
    );
    return {
      library: store.libraryOf(setId),
      kept,
      canonical,
      shared: canonical.get(shared) ?? shared,
    };
  }

  /**
   * O1 — this read against the last one VibeField saw: what each agent read
   * now holds of the profile's own, less the cells VibeField turned; a turn
   * that ended before this read began is settled by it.
   */
  private async notice(
    setId: string,
    readAt: string,
    reads: ReadonlyArray<{ provider: string; result: ExtensionInventory | ExtensionFailure }>,
    startedAt: number,
  ): Promise<AgentExtensionChange[] | undefined> {
    const store = this.opts.store;
    if (store === undefined) return undefined;
    const seen: Record<string, SeenAgent> = {};
    for (const read of reads) {
      if (!isFailure(read.result)) seen[read.provider] = seenOf(read.result);
    }
    const cells = this.touched.get(setId) ?? new Map<string, number>();
    try {
      return await store.noticeChanges(setId, readAt, seen, new Set(cells.keys()));
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.extension_keep_failed",
        "The profile's keep was not updated",
        {
          set: setId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    } finally {
      for (const [key, finished] of cells) if (finished <= startedAt) cells.delete(key);
    }
  }

  /** The profile's keep, or nothing when there is no store or it cannot be read. */
  private async keepOf(setId: string): Promise<AgentExtensionKeep | undefined> {
    try {
      return await this.opts.store?.read(setId);
    } catch (error) {
      this.logger.warn(
        "fieldd.agents.extension_keep_unreadable",
        "The profile's keep could not be read",
        {
          set: setId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }

  /**
   * What each held server and skill offers, planned from this same read (no
   * read per holding) — and, AR-S4d, each server the agent holds none of, its
   * add from the row's definition; AR-S4d2, each skill it holds none of, its
   * link from the skill's one copy, and a folder of its own moving to the
   * profile's (`library`) when it lets one go.
   */
  private async plansFor(
    column: { provider: string; profileId: string },
    result: ExtensionInventory | ExtensionFailure,
    definitions: ReadonlyMap<string, McpServerDefinition> = new Map(),
    copies: ReadonlyMap<string, SkillCopy> = new Map(),
    library?: string,
  ): Promise<{ plans?: ExtensionActPlan[] }> {
    if (isFailure(result)) return {};
    const items = result.items.filter(
      (item): item is McpServerItem | SkillItem =>
        item.kind === "mcp-server" || item.kind === "skill",
    );
    const held = new Set(
      result.items.filter((item) => item.kind === "mcp-server").map((item) => item.name),
    );
    const adds = [...definitions]
      .filter(([name]) => !held.has(name))
      .map(([name, definition]) => ({ name, definition }));
    const heldSkills = new Set(
      result.items.filter((item) => item.kind === "skill").map((item) => item.name),
    );
    const skillAdds = [...copies]
      .filter(([name]) => !heldSkills.has(name))
      .map(([name, copy]) => ({ name, folder: copy.from }));
    if (items.length === 0 && adds.length === 0 && skillAdds.length === 0) return {};
    const skills = {
      ...(skillAdds.length > 0 ? { adds: skillAdds } : {}),
      ...(library !== undefined ? { keep: library } : {}),
    };
    try {
      const plans =
        Object.keys(skills).length > 0
          ? await this.opts.runtime.extensionActPlans(
              column.provider,
              column.profileId,
              items,
              adds.length > 0 ? adds : undefined,
              skills,
            )
          : await this.opts.runtime.extensionActPlans(
              column.provider,
              column.profileId,
              items,
              ...(adds.length > 0 ? [adds] : []),
            );
      return Array.isArray(plans) ? { plans } : {};
    } catch (error) {
      // no acts is a safe answer: the cells stay read-only
      this.logger.warn("fieldd.agents.extension_plans_failed", "Planning extension acts failed", {
        provider: column.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }
}
