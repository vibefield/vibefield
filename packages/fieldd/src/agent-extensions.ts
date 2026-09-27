import { randomUUID } from "node:crypto";
import { sep } from "node:path";
import type { SessionExitedEvent } from "@vibecook/ghosttea-client";
import {
  type AgentProfile,
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
  type AgentsExtensionsListResult,
  type AgentsExtensionsPlanParams,
  type AgentsExtensionsPlanResult,
  type AgentsExtensionsSignInParams,
  type AgentsExtensionsSignInResult,
  ENV_PREFIXES,
  type TerminalCreateOpenResult,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { requireVisible } from "./agent-catalog-gates";
import { displayTail } from "./agent-distribution";
import type { AgentExtensionStore } from "./agent-extension-store";
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

export interface AgentExtensionServiceOptions {
  runtime: Pick<
    AgentRuntime,
    | "profileSet"
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

/** A skill's copy is its folder: where a link points, else where the agent keeps it. */
function skillDefinition(item: SkillItem, provider: string): string {
  return item.linkTarget ?? item.location ?? `${provider} ${item.id}`;
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
function actsOf(
  plans: readonly ExtensionActPlan[] | undefined,
  item: McpServerItem | SkillItem,
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
        const acts = actsOf(plansOf.get(provider), item);
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

/** An empty cell's offer: the agent's own add, or why it cannot take the server. */
function offerOf(plan: ExtensionActPlan): AgentExtensionOffer {
  return plan.available
    ? {
        act: {
          act: "add",
          runs: plan.display,
          reaches: [...plan.reaches],
          ...(plan.runs.kind === "terminal" ? { terminal: true as const } : {}),
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
      if (plan !== undefined) offers[agent.provider] = offerOf(plan);
    }
    if (Object.keys(offers).length > 0) row.offers = offers;
  }

  return {
    set: input.set,
    reading: false,
    readAt: input.readAt,
    agents: columns,
    servers: serverRows.sort(byName),
    skills: rowsOf(skills, skillDefinition, input.home),
    plugins,
    marketplaces,
    ...(values.length > 0 ? { values } : {}),
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
    const { entry, receipt } = await this.runAct(
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
      },
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
    if (params.kind !== "mcp-server") {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "only a server is turned on from its definition",
        false,
        {
          set: setId,
        },
      );
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
    const { entry, receipt } = await this.runAct(
      setId,
      {
        provider: params.provider,
        label: column.label,
        kind: "mcp-server",
        item: row.name,
        name: row.name,
        act: "add",
        runs: offer.act.runs,
      },
      {
        providerId: params.provider,
        profileId: column.profileId,
        target: { kind: "mcp-server", id: row.name },
        act: "add",
        definition,
      },
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
        const { receipt } = await this.runAct(
          setId,
          {
            provider: column.provider,
            label: column.label,
            kind: "mcp-server",
            item: params.name,
            name: params.name,
            act: "add",
            // what the agent's own add will run, as a person reads it (puppeteer plans it again as it runs)
            runs: await this.addLine(column, params.name, definition),
          },
          {
            providerId: column.provider,
            profileId: column.profileId,
            target: { kind: "mcp-server", id: params.name },
            act: "add",
            definition,
          },
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
          if (plan !== undefined) offers[column.provider] = offerOf(plan);
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
  private async runAct(
    setId: string,
    run: Pick<RunEntry, "provider" | "label" | "kind" | "item" | "name" | "act" | "runs">,
    request: Omit<
      Parameters<AgentExtensionServiceOptions["runtime"]["runExtensionAct"]>[0],
      "onOutput"
    >,
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
    let receipt: AgentExtensionReceipt;
    try {
      const result = await this.opts.runtime.runExtensionAct({
        ...request,
        onOutput: (chunk) => {
          appendRaw(entry, chunk);
          this.publishRun(setId);
        },
      });
      receipt = {
        status: result.status,
        message: result.message,
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
        finishedAt: result.finishedAt,
      };
      // what puppeteer ran, as it planned it from the read it made
      if (result.display !== undefined) entry.runs = result.display;
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
      const agents = await Promise.all(
        reads.map(async (agent) => ({
          ...agent,
          ...(await this.plansFor(agent, agent.result, definitions)),
        })),
      );
      const lens = buildExtensionLens({
        set: setId,
        readAt: this.now().toISOString(),
        agents,
        home: this.opts.home,
        ...(keep !== undefined ? { keep } : {}),
      });
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
   * add from the row's definition.
   */
  private async plansFor(
    column: { provider: string; profileId: string },
    result: ExtensionInventory | ExtensionFailure,
    definitions: ReadonlyMap<string, McpServerDefinition> = new Map(),
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
    if (items.length === 0 && adds.length === 0) return {};
    try {
      const plans = await this.opts.runtime.extensionActPlans(
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
