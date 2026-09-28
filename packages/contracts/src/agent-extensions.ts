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
//
// AR-S4d2 — SKILLS KEPT ONCE (pass 24): one folder for the profile — its
// skills folder, under this user — and each agent gets a LINK to the skill
// there, where the agent's docs say skills go, so an edit is made once. A
// skill that is still one agent's own folder moves there (and is linked back)
// the first time another agent takes it. Codex reads a person's skills only
// from `~/.agents/skills`, one folder every profile shares: turning one on
// for Codex moves the copy there (a link stays in the profile's folder) and
// turns it off with Codex's own switch in the other profiles. A CHANGE MADE
// OUTSIDE VibeField (O1) is followed: the cell shows what the agent holds
// now, and one line says who changed what, between which two reads.
//
// AR-S4e — A PLUGIN AN AGENT HOLDS (pass 23, D1): plugins stay with their
// agent, and each has a page — what it brings, its version, where it came
// from — whose acts are the agent's own: its switch, its update, its removal
// keeping the plugin's data or with it. What the agent offers none of says
// why, in the agent's words (only inside its app; no command for it; it
// comes with your organization).
//
// AR-S4e2 — BROWSE AND INSTALL (pass 23, B1): what an agent could install —
// the plugins its marketplaces list — read from the catalogs the agent already
// fetched (never a fetch of VibeField's own), one list, each plugin with the
// agent's own install or why not. Installing is one click unless the agent
// asks something first (its look, a command that fetches it, consent for what
// it may do): then the plugin's page is that look. A marketplace is the
// agent's own too: added from a source, its catalog fetched again, removed.
// "Check for updates" runs the agent's own fetch of each catalog, then reads
// them again; nothing is updated by it. An agent without marketplaces takes a
// source (a package, a repository, a folder) in its own words.

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
    /** AR-S4e — the agent's own word for the kind, where it has one: Pi's "Packages". */
    label: z.string().min(1).max(64).optional(),
    /** AR-S4e — sessions VibeField starts don't load them: the agent loads
     * them only when a person runs it (OpenCode's hosted sessions run `--pure`). */
    hostedSkips: z.literal(true).optional(),
    /** AR-S4e2 — what the agent takes as a source, in its words: for plugins,
     * what it installs one from (a package, a repository, a folder); for
     * marketplaces, where it adds a catalog from. Absent: it takes none. */
    sources: z.string().min(1).max(256).optional(),
    /** AR-S4e2 — for plugins: the agent lists plugins it could install in
     * catalogs VibeField can read (`agents.extensions.catalog`). */
    catalog: z.literal(true).optional(),
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
 * server on for an agent that holds none of it. AR-S4e — a plugin's `update`
 * (the agent's own, to the newest its marketplace has) and `purge` (its
 * removal with the data it keeps; `remove` keeps that data where the agent
 * can). AR-S4e2 — `install` (a plugin its catalog lists, or one from a
 * source), and a marketplace's `add` (from a source), `update` (its catalog
 * fetched again) and `remove`. */
export const AgentExtensionActKind = z.enum([
  "enable",
  "disable",
  "remove",
  "sign-in",
  "sign-out",
  "add",
  "update",
  "purge",
  "install",
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
  /** AR-S4e2 — the plugins installed from a marketplace change with it: its
   * removal takes them, its fetch updates them. */
  "plugins",
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
    /** AR-S4d2 — a skill's copy moves here, home-abbreviated: into the folder
     * every profile shares (Codex reads a person's skills only there), or into
     * the profile's skills folder (an agent's own, when it lets it go). */
    moves: z.string().optional(),
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

/** AR-S4d2 — a change made outside VibeField (pass 24, O1): one agent holds
 * something of the profile's own differently than at VibeField's last read,
 * and no act of VibeField's made it. The cell shows what the agent holds now;
 * this says who changed what, between which two reads. */
export const AgentExtensionChange = z
  .object({
    provider: AgentProviderId,
    kind: z.enum(["mcp-server", "skill"]),
    /** The row's name. */
    name: z.string().min(1),
    change: z.enum(["removed", "added", "off", "on"]),
    /** The last read that saw it as it was. */
    since: z.string(),
    /** The read that found it changed. */
    at: z.string(),
  })
  .passthrough();
export type AgentExtensionChange = z.infer<typeof AgentExtensionChange>;

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
    /** AR-S4d2 — a skill's one copy, home-abbreviated: in the profile's skills
     * folder (`kept`), in the folder every profile shares (`shared`), or still
     * one agent's own folder (`owner`). Two copies under one name give none. */
    folder: z.string().optional(),
    /** The skill's copy is in `~/.agents/skills`, which every profile, Codex,
     * and the agents that read it share. */
    shared: z.literal(true).optional(),
    /** The skill is still this agent's own folder: the first other agent
     * turned on moves it to the profile's folder and links it back. */
    owner: AgentProviderId.optional(),
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
    /** AR-S4e2 — when "Check for updates" last fetched this agent's catalogs
     * here, and read them again; absent: not since fieldd started. */
    checkedAt: z.string().optional(),
  })
  .passthrough();
export type AgentExtensionColumn = z.infer<typeof AgentExtensionColumn>;

/** An act an agent does not offer on a plugin it holds, and why, in the
 * agent's own words (puppeteer's reason: `in-app`, `no-command`, `not-own`,
 * `unsupported`, …): the plugin page's sentences. */
export const AgentExtensionActUnavailable = z
  .object({
    act: AgentExtensionActKind,
    reason: z.string().min(1),
    message: z.string().min(1),
  })
  .passthrough();
export type AgentExtensionActUnavailable = z.infer<typeof AgentExtensionActUnavailable>;

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
    /** AR-S4e — who made it, as its manifest says. */
    author: z.string().min(1).optional(),
    /** AR-S4e — its homepage or repository, an address with nothing secret in it. */
    homepage: z.string().min(1).optional(),
    /** AR-S4e — what it brings beside its servers and skills (which are
     * holdings of their own, from the plugin): names only. */
    brings: z
      .object({
        commands: z.array(z.string().min(1)).optional(),
        agents: z.array(z.string().min(1)).optional(),
        hooks: z.array(z.string().min(1)).optional(),
      })
      .passthrough()
      .optional(),
    /** AR-S4e — the acts its agent offers on it now. */
    acts: z.array(AgentExtensionAct).optional(),
    /** AR-S4e — the acts its agent offers none of, with why. */
    unavailable: z.array(AgentExtensionActUnavailable).optional(),
    /** AR-S4e2 — its marketplace lists a newer one than the agent holds, as the
     * last read of the agent's catalog found it: what Update would take. */
    newer: z
      .object({ version: z.string().min(1).optional() })
      .passthrough()
      .optional(),
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
    /** AR-S4e2 — every profile of the agent reads it from one place. */
    shared: z.literal(true).optional(),
    /** AR-S4e2 — the agent whose marketplace this one reads (origin `borrowed`). */
    lender: AgentProviderId.optional(),
    source: z.string().optional(),
    updatedAt: z.string().optional(),
    place: z.string().optional(),
    /** AR-S4e2 — the agent's own acts on it: its catalog fetched again, its removal. */
    acts: z.array(AgentExtensionAct).optional(),
    /** AR-S4e2 — the acts its agent offers none of, with why. */
    unavailable: z.array(AgentExtensionActUnavailable).optional(),
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
    kind: z.enum(["mcp-server", "skill", "plugin", "marketplace"]),
    /** The holding's id in the agent's own read; for an install, the catalog's
     * key or the source given; for a marketplace's add, its source. */
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
    /** A pane while it runs — a sign-in's, or any act the person answers in a
     * terminal (AR-S4e2): the page that asked shows it; any other can end it. */
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

/** A source a person gives an agent: a package, a repository, a folder, a
 * marketplace's address. One line; puppeteer refuses a flag, and an address
 * carrying a sign-in or a query, before anything runs. */
export const AgentExtensionSource = z.string().min(1).max(1024);

/** `agents.extensions.act` — run one act; its output arrives on the subscription.
 * A sign-in is not one of them: it runs in a terminal (`agents.extensions.signIn`).
 * AR-S4d — `add` turns the row named `id` on for an agent that holds none of
 * it, from the row's definition; `values` first keeps what the row `needs`.
 * AR-S4e — a plugin on the agent's own list, by its id: its switch, `update`,
 * `remove`, `purge`. AR-S4e2 — `install`: a plugin the agent's catalog lists,
 * by the catalog's key, or — with `source` — one from a source (`id` is the
 * same string); a marketplace on the agent's list: `update` (its catalog
 * fetched again), `remove`; and `add` with `source` (`id` the same string).
 * An act whose plan runs in a terminal runs on `agents.extensions.terminal`. */
export const AgentsExtensionsActParams = z
  .object({
    set: AgentProfileSetId,
    provider: AgentProviderId,
    kind: z.enum(["mcp-server", "skill", "plugin", "marketplace"]),
    /** The holding's id, as the lens gave it; for `add`, the row's name. */
    id: z.string().min(1).max(1024),
    act: AgentExtensionActKind.exclude(["sign-in"]),
    values: AgentExtensionValues.optional(),
    source: AgentExtensionSource.optional(),
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

/** `agents.extensions.terminal` — AR-S4e2: an act whose plan runs in a
 * terminal the person answers — an install that asks first (values, consent,
 * a command to accept), an update that asks again — in a pane on the page, as
 * a sign-in's does; the same fields as `agents.extensions.act`. The receipt
 * arrives on the subscription when the pane ends and the profile has been read
 * again. */
export const AgentsExtensionsTerminalParams = AgentsExtensionsActParams.omit({ values: true });
export type AgentsExtensionsTerminalParams = z.infer<typeof AgentsExtensionsTerminalParams>;

export const AgentsExtensionsTerminalResult = AgentsExtensionsSignInResult;
export type AgentsExtensionsTerminalResult = AgentsExtensionsSignInResult;

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

/** A skill folder on this Mac, as a person gives it: absolute, or from `~/`. */
export const AgentExtensionSkillSource = z.string().min(1).max(4096);

/** `agents.extensions.addSkill` — AR-S4d2's Add skill: the folder copied into
 * the profile's skills folder under its own name, then each named agent given
 * it in turn (a link where it looks; Codex, the move to the shared folder),
 * one run each on the subscription. A name the profile's lens already shows
 * is a CONFLICT. */
export const AgentsExtensionsAddSkillParams = z
  .object({
    set: AgentProfileSetId,
    from: AgentExtensionSkillSource,
    /** The agents to turn it on for, in the profile; none keeps it only. */
    agents: z.array(AgentProviderId).max(16),
  })
  .passthrough();
export type AgentsExtensionsAddSkillParams = z.infer<typeof AgentsExtensionsAddSkillParams>;

export const AgentsExtensionsAddSkillResult = z
  .object({
    /** The name it is kept under: its folder's. */
    name: z.string().min(1),
    receipts: z.array(
      z.object({ provider: AgentProviderId, receipt: AgentExtensionReceipt }).passthrough(),
    ),
  })
  .passthrough();
export type AgentsExtensionsAddSkillResult = z.infer<typeof AgentsExtensionsAddSkillResult>;

/** `agents.extensions.planSkill` — the folder read before anything is copied:
 * the name it would be kept under, what it says it does, where it would be
 * kept, and what each of the profile's agents would run: the form's "Runs". */
export const AgentsExtensionsPlanSkillParams = z
  .object({ set: AgentProfileSetId, from: AgentExtensionSkillSource })
  .passthrough();
export type AgentsExtensionsPlanSkillParams = z.infer<typeof AgentsExtensionsPlanSkillParams>;

export const AgentsExtensionsPlanSkillResult = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    /** Where it would be kept, home-abbreviated: the profile's skills folder. */
    folder: z.string().min(1),
    offers: z.record(AgentProviderId, AgentExtensionOffer),
  })
  .passthrough();
export type AgentsExtensionsPlanSkillResult = z.infer<typeof AgentsExtensionsPlanSkillResult>;

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
    /** AR-S4d2 (O1) — what each agent held of the profile's own at the last
     * read: server and skill names, each with whether it was on. */
    seen: z
      .object({
        at: z.string(),
        agents: z.record(
          z.string(),
          z
            .object({
              servers: z.record(z.string(), z.boolean()),
              skills: z.record(z.string(), z.boolean()),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .optional(),
    /** The changes made outside VibeField that reads found, newest last. */
    changes: z.array(AgentExtensionChange).optional(),
  })
  .passthrough();
export type AgentExtensionKeep = z.infer<typeof AgentExtensionKeep>;

/* ── AR-S4e2 — catalogs: what an agent could install ──────────────────────── */

/** What a listed plugin asks, or has its agent do, before its code runs
 * (puppeteer `CatalogAsk`): its look (`look`), a command it accepts first
 * (`command`), a package manager's fetch (`fetch`), values by name
 * (`values`), consent for what it may do (`consent`), a scan (`scan`), the
 * apps that ask for a sign-in when first used (`sign-in`). */
export const AgentExtensionCatalogAsk = z
  .object({
    kind: z.enum(["look", "command", "fetch", "values", "consent", "scan", "sign-in"]),
    command: z.string().min(1).optional(),
    names: z.array(z.string().min(1)).optional(),
    capabilities: z.array(z.string().min(1)).optional(),
    apps: z.array(z.string().min(1)).optional(),
  })
  .passthrough();
export type AgentExtensionCatalogAsk = z.infer<typeof AgentExtensionCatalogAsk>;

/** One plugin a marketplace lists, as a person browses it, with the agent's
 * own install or why not. */
export const AgentExtensionCatalogPlugin = z
  .object({
    /** The catalog's key: what an install names. */
    id: z.string().min(1),
    name: z.string().min(1),
    /** The marketplace that lists it. */
    marketplace: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
    category: z.string().optional(),
    /** The version the catalog lists. */
    version: z.string().optional(),
    /** Its homepage or repository, an address with nothing secret in it. */
    homepage: z.string().optional(),
    /** Names only, as its listing says, before it is installed. */
    brings: z
      .object({
        commands: z.array(z.string().min(1)).optional(),
        agents: z.array(z.string().min(1)).optional(),
        hooks: z.array(z.string().min(1)).optional(),
        servers: z.array(z.string().min(1)).optional(),
        skills: z.array(z.string().min(1)).optional(),
        tools: z.array(z.string().min(1)).optional(),
      })
      .passthrough()
      .optional(),
    featured: z.literal(true).optional(),
    asks: z.array(AgentExtensionCatalogAsk).optional(),
    /** Why the agent won't install it here — its organization's policy — in its words. */
    blocked: z.string().min(1).optional(),
    /** The plugin the agent holds from it, by its id on the agent's own list: it is installed. */
    held: z.string().min(1).optional(),
    /** The agent holds an older one than the catalog lists. */
    newer: z.literal(true).optional(),
    /** The agent's own install, as its adapter planned it. */
    install: AgentExtensionAct.optional(),
    /** Why the agent offers no install here, in its words. */
    unavailable: z
      .object({ reason: z.string().min(1), message: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type AgentExtensionCatalogPlugin = z.infer<typeof AgentExtensionCatalogPlugin>;

/** One catalog the agent knows. Its acts (fetch again, remove) are on the
 * lens's marketplace row of the same id. */
export const AgentExtensionCatalogMarketplace = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: z.string().optional(),
    /** When the agent last fetched it. */
    updatedAt: z.string().optional(),
    origin: AgentExtensionOrigin,
    lender: AgentProviderId.optional(),
    shared: z.literal(true).optional(),
    /** Its catalog could not be read, and why: none of its plugins are listed. */
    unread: z.string().min(1).optional(),
    /** How many plugins it lists. */
    count: z.number().int().nonnegative(),
  })
  .passthrough();
export type AgentExtensionCatalogMarketplace = z.infer<typeof AgentExtensionCatalogMarketplace>;

/** A marketplace the agent adds by itself the first time it runs in a profile,
 * which this one lacks yet: said, and — with its agent's own add — addable now. */
export const AgentExtensionCatalogSuggestion = z
  .object({
    name: z.string().min(1),
    source: z.string().min(1).optional(),
    message: z.string().min(1),
    add: AgentExtensionAct.optional(),
  })
  .passthrough();
export type AgentExtensionCatalogSuggestion = z.infer<typeof AgentExtensionCatalogSuggestion>;

/** `agents.extensions.catalog` — what one agent of the profile could install,
 * read from the catalogs it already fetched (a read; nothing is fetched). */
export const AgentsExtensionsCatalogParams = z
  .object({ set: AgentProfileSetId, provider: AgentProviderId })
  .passthrough();
export type AgentsExtensionsCatalogParams = z.infer<typeof AgentsExtensionsCatalogParams>;

export const AgentsExtensionsCatalogResult = z
  .object({
    set: AgentProfileSetId,
    provider: AgentProviderId,
    label: z.string().min(1),
    /** When fieldd read it; absent with a failure. */
    readAt: z.string().optional(),
    /** The agent's catalogs could not be read at all. */
    failure: AgentExtensionFailure.optional(),
    marketplaces: z.array(AgentExtensionCatalogMarketplace),
    plugins: z.array(AgentExtensionCatalogPlugin),
    suggested: z.array(AgentExtensionCatalogSuggestion).optional(),
    /** When "Check for updates" last ran here for this agent. */
    checkedAt: z.string().optional(),
  })
  .passthrough();
export type AgentsExtensionsCatalogResult = z.infer<typeof AgentsExtensionsCatalogResult>;

/** `agents.extensions.check` — "Check for updates": the agent's own fetch of
 * each of its catalogs, one run on the subscription, then the profile and the
 * catalogs read again. Nothing is installed or updated by VibeField here. */
export const AgentsExtensionsCheckParams = z
  .object({ set: AgentProfileSetId, provider: AgentProviderId })
  .passthrough();
export type AgentsExtensionsCheckParams = z.infer<typeof AgentsExtensionsCheckParams>;

export const AgentsExtensionsCheckResult = z
  .object({
    run: AgentExtensionRun,
    receipt: AgentExtensionReceipt,
    /** How many plugins it holds the catalogs now list newer. */
    updates: z.number().int().nonnegative(),
  })
  .passthrough();
export type AgentsExtensionsCheckResult = z.infer<typeof AgentsExtensionsCheckResult>;

/** `agents.extensions.planSource` — what the agent would run for a source a
 * person is typing: an install from it (`plugin`), or a marketplace's add
 * (`marketplace`); the form's "Runs". A read. */
export const AgentsExtensionsPlanSourceParams = z
  .object({
    set: AgentProfileSetId,
    provider: AgentProviderId,
    kind: z.enum(["plugin", "marketplace"]),
    source: AgentExtensionSource,
  })
  .passthrough();
export type AgentsExtensionsPlanSourceParams = z.infer<typeof AgentsExtensionsPlanSourceParams>;

export const AgentsExtensionsPlanSourceResult = z
  .object({ offer: AgentExtensionOffer })
  .passthrough();
export type AgentsExtensionsPlanSourceResult = z.infer<typeof AgentsExtensionsPlanSourceResult>;

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
    /** AR-S4d2 — the profile's skills folder, home-abbreviated. */
    library: z.string().optional(),
    /** AR-S4d2 (O1) — changes made outside VibeField that reads found, newest last. */
    changes: z.array(AgentExtensionChange).optional(),
  })
  .passthrough();
export type AgentsExtensionsListResult = z.infer<typeof AgentsExtensionsListResult>;
