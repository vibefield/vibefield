import { randomUUID } from "node:crypto";
import { sep } from "node:path";
import type {
  AgentProfile,
  ExtensionActPlan,
  ExtensionFailure,
  ExtensionInventory,
  ExtensionItem,
  ExtensionOrigin,
  ExtensionProvider,
  McpServerItem,
  SkillItem,
} from "@vibecook/puppeteer-core";
import type { AgentRuntime } from "@vibecook/puppeteer-runtime";
import {
  AGENT_OPERATION_OUTPUT_BYTES,
  type AgentExtensionAct,
  type AgentExtensionColumn,
  type AgentExtensionHolding,
  type AgentExtensionMarketplace,
  type AgentExtensionPlugin,
  type AgentExtensionReceipt,
  type AgentExtensionRow,
  type AgentExtensionRun,
  type AgentExtensionSupport,
  type AgentsExtensionsActParams,
  type AgentsExtensionsActResult,
  type AgentsExtensionsListResult,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { displayTail } from "./agent-distribution";
import { RpcCallError } from "./native-link";

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

export interface AgentExtensionServiceOptions {
  runtime: Pick<
    AgentRuntime,
    | "profileSet"
    | "profileProviders"
    | "extensionProviders"
    | "extensionInventory"
    | "extensionActPlans"
    | "runExtensionAct"
  >;
  /** The OS user's home, which places are abbreviated against. */
  home: string;
  now?: () => Date;
  logger?: Logger;
}

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
  for (const plan of plans ?? []) {
    if (!plan.available || plan.target.kind !== item.kind || plan.target.id !== item.id) continue;
    if ((plan.act === "enable" && item.enabled) || (plan.act === "disable" && !item.enabled))
      continue;
    acts.push({ act: plan.act, runs: plan.display, reaches: [...plan.reaches] });
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

  return {
    set: input.set,
    reading: false,
    readAt: input.readAt,
    agents: columns,
    servers: rowsOf(servers, serverDefinition, input.home),
    skills: rowsOf(skills, skillDefinition, input.home),
    plugins,
    marketplaces,
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
  private readonly ticks = new Map<string, ReturnType<typeof setTimeout>>();
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
    const setId = params.set;
    this.refuseWhileRunning(setId);
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
    // a read above may have let another act start
    this.refuseWhileRunning(setId);
    const entry: RunEntry = {
      id: randomUUID(),
      provider: params.provider,
      label: column.label,
      kind: params.kind,
      item: params.id,
      name: found.row.name,
      act: params.act,
      runs: offered.runs,
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
        providerId: params.provider,
        profileId: column.profileId,
        target: { kind: params.kind, id: params.id },
        act: params.act,
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
    } catch (error) {
      this.logger.warn("fieldd.agents.extension_act_failed", "An extension act could not run", {
        set: setId,
        provider: params.provider,
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
      provider: params.provider,
      act: params.act,
      status: receipt.status,
    });
    // every cell says what the agents hold now: a read that began before the act finished cannot
    try {
      await this.read(setId, true);
    } catch (error) {
      this.publishRun(setId);
      this.logger.warn(
        "fieldd.agents.extensions_read_failed",
        "Reading an Agent Profile's extensions failed",
        { set: setId, error: error instanceof Error ? error.message : String(error) },
      );
    }
    return { run: projectRun(entry), receipt };
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
    this.subscribers.clear();
    this.lenses.clear();
  }

  /** A profile's frame: its lens, and its act while one runs or the last that did. */
  private frameOf(setId: string, lens: Frame): Frame {
    const run = this.runs.get(setId);
    return run === undefined ? lens : { ...lens, run: projectRun(run) };
  }

  private refuseWhileRunning(setId: string): void {
    const running = this.runs.get(setId);
    if (running?.state === "running") {
      throw new RpcCallError(
        "CONFLICT",
        `${running.label} is still changing ${running.name} in this Agent Profile`,
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
    return profiles.map((profile) => ({
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
      const agents = await Promise.all(
        this.columnsOf(info.profiles).map(async (column) => {
          const result = await this.opts.runtime.extensionInventory(
            column.provider,
            column.profileId,
          );
          return { ...column, result, ...(await this.plansFor(column, result)) };
        }),
      );
      const lens = buildExtensionLens({
        set: setId,
        readAt: this.now().toISOString(),
        agents,
        home: this.opts.home,
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

  /** What each held server and skill offers, planned from this same read (no read per holding). */
  private async plansFor(
    column: { provider: string; profileId: string },
    result: ExtensionInventory | ExtensionFailure,
  ): Promise<{ plans?: ExtensionActPlan[] }> {
    if (isFailure(result)) return {};
    const items = result.items.filter(
      (item): item is McpServerItem | SkillItem =>
        item.kind === "mcp-server" || item.kind === "skill",
    );
    if (items.length === 0) return {};
    try {
      const plans = await this.opts.runtime.extensionActPlans(
        column.provider,
        column.profileId,
        items,
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
