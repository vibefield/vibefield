import { sep } from "node:path";
import type {
  AgentProfile,
  ExtensionFailure,
  ExtensionInventory,
  ExtensionItem,
  ExtensionOrigin,
  ExtensionProvider,
  McpServerItem,
  SkillItem,
} from "@vibecook/puppeteer-core";
import type { AgentRuntime } from "@vibecook/puppeteer-runtime";
import type {
  AgentExtensionColumn,
  AgentExtensionHolding,
  AgentExtensionMarketplace,
  AgentExtensionPlugin,
  AgentExtensionRow,
  AgentExtensionSupport,
  AgentsExtensionsListResult,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
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
// it reads; a place crosses home-abbreviated, for display only. The acts
// (S4c) will name items by the agent's own id, never by a path from here.

export interface AgentExtensionServiceOptions {
  runtime: Pick<
    AgentRuntime,
    "profileSet" | "profileProviders" | "extensionProviders" | "extensionInventory"
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
  agents: ReadonlyArray<{ provider: string; items: T[] }>,
  definition: (item: T, provider: string) => string,
  home: string,
): AgentExtensionRow[] {
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
      cells[provider] = ordered.map((item) => ({
        ...holdingOf(item, home),
        ...(versions.size > 1 ? { version: versions.get(definition(item, provider))! } : {}),
      }));
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
  const servers: Array<{ provider: string; items: McpServerItem[] }> = [];
  const skills: Array<{ provider: string; items: SkillItem[] }> = [];
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
    servers.push({ provider: agent.provider, items: own.servers });
    skills.push({ provider: agent.provider, items: own.skills });
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

/**
 * The lens per Agent Profile: read on demand, the last read kept, a frame to a
 * profile's subscribers each time one finishes. Concurrent asks for one
 * profile share one read.
 */
export class AgentExtensionService {
  private readonly lenses = new Map<string, Frame>();
  private readonly inflight = new Map<string, Promise<Frame>>();
  private readonly subscribers = new Map<string, Set<(frame: Frame) => void>>();
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
    return known ?? (await this.read(setId));
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
    const snapshot = known ?? (await this.placeholder(setId));
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
    this.subscribers.clear();
    this.lenses.clear();
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

  private read(setId: string): Promise<Frame> {
    const running = this.inflight.get(setId);
    if (running !== undefined) return running;
    const request = (async () => {
      const info = await this.profileSet(setId);
      const agents = await Promise.all(
        this.columnsOf(info.profiles).map(async (column) => ({
          ...column,
          result: await this.opts.runtime.extensionInventory(column.provider, column.profileId),
        })),
      );
      const lens = buildExtensionLens({
        set: setId,
        readAt: this.now().toISOString(),
        agents,
        home: this.opts.home,
      });
      if (this.disposed) return lens;
      this.lenses.set(setId, lens);
      for (const emit of this.subscribers.get(setId) ?? []) {
        try {
          emit(lens);
        } catch (error) {
          this.logger.warn(
            "fieldd.agents.extensions_emit_failed",
            "An extensions frame was not delivered",
            {
              set: setId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
      return lens;
    })().finally(() => this.inflight.delete(setId));
    this.inflight.set(setId, request);
    return request;
  }
}
