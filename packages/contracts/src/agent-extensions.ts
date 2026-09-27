import { z } from "zod";
import { AgentProfileId, AgentProfileSetId, AgentProviderId } from "./agent-index";
import { TerminalCreateOpenResult } from "./terminal-pipeline";

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
// AR-S4c: a holding carries the acts its agent offers on it — the command as a
// person reads it and what it reaches beyond its cell — and one act runs at a
// time per profile, its output as display text on the same frames. A remote
// server's sign-in is the one act a person answers (the agent's own login
// opens a browser and may ask for a code), so it runs in a terminal on the
// page: `agents.extensions.signIn` answers with the pane, like a profile's
// sign-in, and the receipt follows when the pane ends.
//
// EL7: a server crosses as puppeteer renders it — its target with userinfo,
// query and secret-looking arguments masked — and the NAMES of the variables
// and headers it reads, never a value. A place crosses home-abbreviated
// (`~/.claude.json`), for display: acts name items by id, never by path.
//
// AR-S4d — ADDING ONCE (pass 24, S1): a server can be kept once for the
// profile and turned on for an agent that does not hold it, by that agent's
// own add. What VibeField keeps is the server's DEFINITION (what it runs or
// where it is, and the names of the variables it reads) and each variable's
// value — the value in VibeField's keychain entry for the profile, never in a
// file, and never back on the wire. Each agent's settings name the variable
// in the agent's own syntax; VibeField gives the value when it starts the
// agent. A value crosses exactly once, inward, on the door that keeps it.

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

/** AR-S4c — what a person can ask of one holding (RFC 006 C2); a remote
 * server's sign-in and sign-out beside the switches. AR-S4d — `add` turns a
 * server on for an agent that holds none of it. */
export const AgentExtensionActKind = z.enum([
  "enable",
  "disable",
  "remove",
  "sign-in",
  "sign-out",
  "add",
]);
export type AgentExtensionActKind = z.infer<typeof AgentExtensionActKind>;

/** A variable's name as a server reads it (and an agent's settings name it). */
export const AgentExtensionVariableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
export type AgentExtensionVariableName = z.infer<typeof AgentExtensionVariableName>;

/** AR-S4d — a server as VibeField keeps it and gives it to an agent (puppeteer
 * `McpServerDefinition`): what it runs or where it is, and the NAMES of the
 * variables it reads. A value never rides here. */
export const AgentExtensionServerDefinition = z.discriminatedUnion("transport", [
  z
    .object({
      transport: z.literal("stdio"),
      command: z.string().trim().min(1).max(4096),
      args: z.array(z.string().min(1).max(4096)).max(24),
      env: z.array(AgentExtensionVariableName).min(1).max(12).optional(),
    })
    .passthrough(),
  z.object({ transport: z.literal("http"), url: z.string().trim().min(1).max(4096) }).passthrough(),
  z.object({ transport: z.literal("sse"), url: z.string().trim().min(1).max(4096) }).passthrough(),
]);
export type AgentExtensionServerDefinition = z.infer<typeof AgentExtensionServerDefinition>;

/** What an act changes beyond its one cell, said before it runs. */
export const AgentExtensionReach = z.enum([
  /** The definition goes: turning it back on needs it again. */
  "definition",
  /** A remote server's stored sign-in goes with it. */
  "sign-in",
  /** Every profile of the agent shares it: one config, or one keychain entry, serves them all. */
  "every-profile",
  /** It lives in a folder other profiles, and other agents, read. */
  "shared-folder",
]);
export type AgentExtensionReach = z.infer<typeof AgentExtensionReach>;

/** An act the agent offers on one holding, as its adapter planned it. */
export const AgentExtensionAct = z
  .object({
    act: AgentExtensionActKind,
    /** What runs, as a person reads it: the agent's own command line, or its protocol call. */
    runs: z.string().min(1),
    reaches: z.array(AgentExtensionReach),
    /** It runs in a terminal on the page, which the person answers: a sign-in (`agents.extensions.signIn`). */
    terminal: z.literal(true).optional(),
  })
  .passthrough();
export type AgentExtensionAct = z.infer<typeof AgentExtensionAct>;

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
    /** The acts the agent offers on it now (none: it changes only where it comes from, or in the app). */
    acts: z.array(AgentExtensionAct).optional(),
  })
  .passthrough();
export type AgentExtensionHolding = z.infer<typeof AgentExtensionHolding>;

/** AR-S4d — turning a server on for an agent that holds none of it: the
 * agent's own add, or why the agent cannot take it (puppeteer's reason and
 * words: `in-app`, `unsupported`, `held`, …). */
export const AgentExtensionOffer = z
  .object({
    act: AgentExtensionAct.optional(),
    unavailable: z
      .object({ reason: z.string().min(1), message: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type AgentExtensionOffer = z.infer<typeof AgentExtensionOffer>;

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
    /** AR-S4d — what turning it on for another agent gives: the profile's kept
     * definition, else its one version's when that one hides nothing. */
    definition: AgentExtensionServerDefinition.optional(),
    /** VibeField keeps its definition for this profile: added here, or kept
     * when an agent let it go. A kept row no agent holds still shows. */
    kept: z.literal(true).optional(),
    /** Names its definition reads that VibeField keeps no value for here: a
     * turn asks for them first. */
    needs: z.array(AgentExtensionVariableName).optional(),
    /** Per agent that holds none of it: its own add, or why it cannot take it. */
    offers: z.record(AgentProviderId, AgentExtensionOffer).optional(),
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

/** An act's outcome: decided by reading the agent again, never by its output.
 * `unconfirmed`: the agent ran it and says whether it took only inside a
 * session (a sign-in it keeps where no read looks). */
export const AgentExtensionReceipt = z
  .object({
    status: z.enum(["changed", "unchanged", "failed", "unavailable", "unconfirmed"]),
    message: z.string().min(1),
    exitCode: z.number().int().optional(),
    finishedAt: z.string(),
  })
  .passthrough();
export type AgentExtensionReceipt = z.infer<typeof AgentExtensionReceipt>;

/** The profile's act running, or the last one finished: the run card under the lists. */
export const AgentExtensionRun = z
  .object({
    id: z.string().min(1),
    provider: AgentProviderId,
    /** The agent's name, for the words. */
    label: z.string().min(1),
    kind: z.enum(["mcp-server", "skill"]),
    /** The holding's id in the agent's own read. */
    item: z.string().min(1),
    /** The row's name. */
    name: z.string().min(1),
    act: AgentExtensionActKind,
    runs: z.string().min(1),
    state: z.enum(["running", "finished"]),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    /** The act's own output, as a terminal would show it: display text, never parsed. */
    output: z.string(),
    truncated: z.boolean(),
    receipt: AgentExtensionReceipt.optional(),
    /** A sign-in's pane while it runs: the page that asked shows it; any other can end it. */
    terminal: z
      .object({ sessionId: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type AgentExtensionRun = z.infer<typeof AgentExtensionRun>;

/** Values for the names a server reads, kept in VibeField's keychain entry
 * for the profile before an agent's add runs. Never echoed, logged or audited. */
export const AgentExtensionValues = z.record(
  AgentExtensionVariableName,
  z.string().min(1).max(32768),
);
export type AgentExtensionValues = z.infer<typeof AgentExtensionValues>;

/** `agents.extensions.act` — run one act; its output arrives on the subscription.
 * A sign-in is not one of them: it runs in a terminal (`agents.extensions.signIn`).
 * AR-S4d — `add` turns the row named `id` on for an agent that holds none of
 * it, from the row's definition; `values` first keeps what the row `needs`. */
export const AgentsExtensionsActParams = z
  .object({
    set: AgentProfileSetId,
    provider: AgentProviderId,
    kind: z.enum(["mcp-server", "skill"]),
    /** The holding's id, as the lens gave it; for `add`, the row's name. */
    id: z.string().min(1).max(512),
    act: AgentExtensionActKind.exclude(["sign-in"]),
    values: AgentExtensionValues.optional(),
  })
  .passthrough();
export type AgentsExtensionsActParams = z.infer<typeof AgentsExtensionsActParams>;

export const AgentsExtensionsActResult = z
  .object({ run: AgentExtensionRun, receipt: AgentExtensionReceipt })
  .passthrough();
export type AgentsExtensionsActResult = z.infer<typeof AgentsExtensionsActResult>;

/** `agents.extensions.signIn` — the agent's own sign-in to one of its remote
 * servers, in a pane on the page: the run (on the subscription too) and the
 * caller's ticket for the pane. The receipt arrives on the subscription when
 * the pane ends and the profile has been read again. */
export const AgentsExtensionsSignInParams = z
  .object({
    set: AgentProfileSetId,
    provider: AgentProviderId,
    /** The server's id in that agent's read, as the lens gave it. */
    id: z.string().min(1).max(512),
  })
  .passthrough();
export type AgentsExtensionsSignInParams = z.infer<typeof AgentsExtensionsSignInParams>;

export const AgentsExtensionsSignInResult = z
  .object({ run: AgentExtensionRun, terminal: TerminalCreateOpenResult })
  .passthrough();
export type AgentsExtensionsSignInResult = z.infer<typeof AgentsExtensionsSignInResult>;

/** `agents.extensions.add` — AR-S4d's Add server: the definition kept once for
 * the profile (and the values for the names it reads), then each named
 * agent's own add in turn, one run each on the subscription. A name the
 * profile's lens already shows is a CONFLICT. */
export const AgentsExtensionsAddParams = z
  .object({
    set: AgentProfileSetId,
    /** How the agents and the person call it: letters, digits, `_` and `-`. */
    name: z
      .string()
      .regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/)
      .max(64),
    definition: AgentExtensionServerDefinition,
    values: AgentExtensionValues.optional(),
    /** The agents to turn it on for, in the profile; none keeps it only. */
    agents: z.array(AgentProviderId).max(16),
  })
  .passthrough();
export type AgentsExtensionsAddParams = z.infer<typeof AgentsExtensionsAddParams>;

export const AgentsExtensionsAddResult = z
  .object({
    /** Each agent's receipt, in the order they ran. */
    receipts: z.array(
      z.object({ provider: AgentProviderId, receipt: AgentExtensionReceipt }).passthrough(),
    ),
  })
  .passthrough();
export type AgentsExtensionsAddResult = z.infer<typeof AgentsExtensionsAddResult>;

/** `agents.extensions.plan` — what an Add would run on each of the profile's
 * agents, before anything is kept: the form's "Runs". */
export const AgentsExtensionsPlanParams = z
  .object({
    set: AgentProfileSetId,
    name: z
      .string()
      .regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/)
      .max(64),
    definition: AgentExtensionServerDefinition,
  })
  .passthrough();
export type AgentsExtensionsPlanParams = z.infer<typeof AgentsExtensionsPlanParams>;

export const AgentsExtensionsPlanResult = z
  .object({ offers: z.record(AgentProviderId, AgentExtensionOffer) })
  .passthrough();
export type AgentsExtensionsPlanResult = z.infer<typeof AgentsExtensionsPlanResult>;

/** AR-S4d — what one Agent Profile keeps once for its agents, as fieldd
 * writes it (`LAYOUT.AGENT_EXTENSIONS_DIR/<set>.json`, 0600): each kept
 * server's definition by name, the names it keeps a value for (the values are
 * in the OS keychain, never here), and the names it gave each agent with each
 * server it added there. */
export const AgentExtensionKeep = z
  .object({
    version: z.literal(1),
    servers: z.record(
      z.string(),
      z.object({ definition: AgentExtensionServerDefinition, keptAt: z.string() }).passthrough(),
    ),
    values: z.array(AgentExtensionVariableName),
    /** provider → server name → the names given it with that server */
    given: z.record(z.string(), z.record(z.string(), z.array(AgentExtensionVariableName))),
  })
  .passthrough();
export type AgentExtensionKeep = z.infer<typeof AgentExtensionKeep>;

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
    /** AR-S4c — the act running for this profile, or the last one finished. */
    run: AgentExtensionRun.optional(),
    /** AR-S4d — the names VibeField keeps a value for in this profile (in its
     * keychain entry); never a value. */
    values: z.array(AgentExtensionVariableName).optional(),
  })
  .passthrough();
export type AgentsExtensionsListResult = z.infer<typeof AgentsExtensionsListResult>;
