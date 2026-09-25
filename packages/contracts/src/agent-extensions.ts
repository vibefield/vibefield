import { z } from "zod";
import { AgentProfileId, AgentProfileSetId, AgentProviderId } from "./agent-index";

// ── agents.extensions.* (AR-S4b — Extensions; the design record's pass 24) ──
//
// What each agent in one Agent Profile holds — its MCP servers, skills,
// plugins and marketplaces — read by puppeteer from the agent's own stores and
// protocols (RFC 006 C1), and grouped by fieldd into the LENS the profile page
// draws: servers and skills by name, one cell per agent. Every cell is the
// agent's own evidence; VibeField keeps nothing of its own here yet. A read
// happens when a page asks (the list, a subscription) and after an act, never
// on a timer.
//
// EL7: a server crosses as puppeteer renders it — its target with userinfo,
// query and secret-looking arguments masked — and the NAMES of the variables
// and headers it reads, never a value. A place crosses home-abbreviated
// (`~/.claude.json`), for display: acts name items by id, never by path.

/** Where an item comes from, as the agent keeps it (puppeteer `ExtensionOrigin`). */
export const AgentExtensionOrigin = z.enum([
  "own",
  "project",
  "plugin",
  "bundled",
  "managed",
  "agent",
  "borrowed",
]);
export type AgentExtensionOrigin = z.infer<typeof AgentExtensionOrigin>;

export const AgentExtensionKind = z.enum(["plugin", "marketplace", "mcp-server", "skill"]);
export type AgentExtensionKind = z.infer<typeof AgentExtensionKind>;

/** How an agent keeps one kind (puppeteer `ExtensionKindSupport`): per
 * profile, in one place every profile reads, or some of each; changed by its
 * own command, its protocol, its folders, or only inside its app; and whether
 * the read covers it. */
export const AgentExtensionKindSupport = z
  .object({
    store: z.enum(["profile", "shared", "mixed"]),
    changes: z.enum(["command", "protocol", "folder", "in-app"]),
    read: z.boolean(),
  })
  .passthrough();
export type AgentExtensionKindSupport = z.infer<typeof AgentExtensionKindSupport>;

/** The kinds an agent has; a kind absent is one it lacks. */
export const AgentExtensionSupport = z
  .object({
    plugins: AgentExtensionKindSupport.optional(),
    marketplaces: AgentExtensionKindSupport.optional(),
    mcpServers: AgentExtensionKindSupport.optional(),
    skills: AgentExtensionKindSupport.optional(),
  })
  .passthrough();
export type AgentExtensionSupport = z.infer<typeof AgentExtensionSupport>;

/** One thing one agent holds under a row's name. */
export const AgentExtensionHolding = z
  .object({
    /** The agent's own key for it, unique per kind in that agent's read. */
    id: z.string().min(1),
    origin: AgentExtensionOrigin,
    /** Whether the agent loads it, after its own switches. */
    enabled: z.boolean(),
    /** Every profile of the agent reads it from one place. */
    shared: z.literal(true).optional(),
    /** The plugin that brought it (origin `plugin`). */
    plugin: z.string().optional(),
    /** The agent whose own it is (origin `borrowed`). */
    lender: AgentProviderId.optional(),
    /** The project it belongs to (origin `project`), home-abbreviated. */
    project: z.string().optional(),
    /** Where the agent keeps it, home-abbreviated. */
    place: z.string().optional(),
    /** A skill the agent can switch on and off by itself, for this profile. */
    switchable: z.literal(true).optional(),
    /** A skill whose folder is a link: where it points, home-abbreviated. */
    linkTarget: z.string().optional(),
    // a server's definition, as the agent holds it
    transport: z.enum(["stdio", "http", "sse", "ws"]).optional(),
    target: z.string().optional(),
    env: z.array(z.string()).optional(),
    headers: z.array(z.string()).optional(),
    /** What the agent says about signing in to it; absent: not known without a session. */
    auth: z.enum(["signed-in", "needs-sign-in"]).optional(),
    /** Which of the row's definitions this is, when the row has more than one (0-based). */
    version: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type AgentExtensionHolding = z.infer<typeof AgentExtensionHolding>;

/** One server or skill name across the profile's agents. */
export const AgentExtensionRow = z
  .object({
    name: z.string().min(1),
    /** A skill's description, from the first holding that has one. */
    description: z.string().optional(),
    /** How many different definitions the holdings are: a server's masked
     * target with the names it reads, a skill's folder. More than one is
     * "two versions". */
    versions: z.number().int().nonnegative(),
    /** Per agent, what it holds under this name, the most its own first; an
     * agent absent here holds none. */
    cells: z.record(AgentProviderId, z.array(AgentExtensionHolding)),
  })
  .passthrough();
export type AgentExtensionRow = z.infer<typeof AgentExtensionRow>;

/** puppeteer `ExtensionFailure`, mirrored: why one agent could not be read. */
export const AgentExtensionFailure = z
  .object({
    status: z.enum(["unsupported", "unavailable", "not-found", "invalid"]),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .passthrough();
export type AgentExtensionFailure = z.infer<typeof AgentExtensionFailure>;

/** One agent of the profile: a column of the lens, and its own lists' counts. */
export const AgentExtensionColumn = z
  .object({
    provider: AgentProviderId,
    label: z.string().min(1),
    /** The sign-in read: the profile's for this agent, or its own folder in This Mac. */
    profileId: AgentProfileId,
    support: AgentExtensionSupport,
    counts: z
      .object({
        plugins: z.number().int().nonnegative(),
        marketplaces: z.number().int().nonnegative(),
        mcpServers: z.number().int().nonnegative(),
        skills: z.number().int().nonnegative(),
      })
      .passthrough(),
    /** Kinds this read could not cover, each with why; the rest are complete. */
    unread: z
      .array(z.object({ kind: AgentExtensionKind, message: z.string().min(1) }).passthrough())
      .optional(),
    /** Set when the agent could not be read at all; its cells and lists are empty. */
    failure: AgentExtensionFailure.optional(),
    /** When the agent answered. */
    fetchedAt: z.string().optional(),
  })
  .passthrough();
export type AgentExtensionColumn = z.infer<typeof AgentExtensionColumn>;

/** A plugin on one agent's own list (plugins stay with their agent). */
export const AgentExtensionPlugin = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    origin: AgentExtensionOrigin,
    enabled: z.boolean(),
    shared: z.literal(true).optional(),
    lender: AgentProviderId.optional(),
    version: z.string().optional(),
    marketplace: z.string().optional(),
    description: z.string().optional(),
    place: z.string().optional(),
  })
  .passthrough();
export type AgentExtensionPlugin = z.infer<typeof AgentExtensionPlugin>;

/** A marketplace on one agent's own list. */
export const AgentExtensionMarketplace = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    origin: AgentExtensionOrigin,
    enabled: z.boolean(),
    source: z.string().optional(),
    updatedAt: z.string().optional(),
    place: z.string().optional(),
  })
  .passthrough();
export type AgentExtensionMarketplace = z.infer<typeof AgentExtensionMarketplace>;

/** `agents.extensions.list` — the lens for one Agent Profile. `refresh: true`
 * reads every agent again; otherwise the last read answers when there is one. */
export const AgentsExtensionsListParams = z
  .object({ set: AgentProfileSetId, refresh: z.boolean().optional() })
  .passthrough();
export type AgentsExtensionsListParams = z.infer<typeof AgentsExtensionsListParams>;

/** `agents.extensions.subscribe` — the same lens as frames: the last read (or
 * the profile's agents with `reading: true` before the first), then a frame
 * each time a read of this profile finishes. */
export const AgentsExtensionsSubscribeParams = z.object({ set: AgentProfileSetId }).passthrough();
export type AgentsExtensionsSubscribeParams = z.infer<typeof AgentsExtensionsSubscribeParams>;

export const AgentsExtensionsListResult = z
  .object({
    set: AgentProfileSetId,
    /** A read of this profile is under way; the next frame carries it. */
    reading: z.boolean(),
    /** When the lens was built; absent before the first read. */
    readAt: z.string().optional(),
    /** The profile's agents, in its own order. */
    agents: z.array(AgentExtensionColumn),
    /** MCP servers by name, in name order. */
    servers: z.array(AgentExtensionRow),
    /** Skills by name, in name order. */
    skills: z.array(AgentExtensionRow),
    /** What stays on each agent's own list. */
    plugins: z.record(AgentProviderId, z.array(AgentExtensionPlugin)),
    marketplaces: z.record(AgentProviderId, z.array(AgentExtensionMarketplace)),
  })
  .passthrough();
export type AgentsExtensionsListResult = z.infer<typeof AgentsExtensionsListResult>;
