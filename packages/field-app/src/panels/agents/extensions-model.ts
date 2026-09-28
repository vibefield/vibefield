import type {
  AgentExtensionAct,
  AgentExtensionChange,
  AgentExtensionColumn,
  AgentExtensionHolding,
  AgentExtensionOffer,
  AgentExtensionOrigin,
  AgentExtensionPlugin,
  AgentExtensionRow,
  AgentExtensionRun,
  AgentExtensionServerDefinition,
  AgentsExtensionsListResult,
} from "@vibefield/contracts";

// Extensions' model (AR-S4b; the design record's pass 24, L2): the lens
// fieldd sends — every server and skill a profile's agents hold, by name, a
// cell per agent — worded for the grid. Pure, so the catalog and the tests
// draw the shipping words from fixtures.
//
// A row is a name some agent holds as its own; a name only a plugin, a
// project, an app or another agent brings stays on that agent's own list and
// is counted beneath the grid. A cell reads what its agent holds under the
// row's name, in pass 24's states: on and off; `fixed` (on, and nothing here
// can switch it); `plugin` (the agent has one of its own under the name, from a
// plugin, a project — the folder glyph — its app or its organization);
// `lent` (loaded from another agent); `app` (changed only inside the agent's
// app); `none` (the agent has no such kind, or VibeField does not read it);
// `unread` (this read could not cover it). Every state carries its sentence:
// the grid is read-only in this slice, so the sentence is the whole answer.
//
// AR-S4d: a server the profile keeps is a row too, though no agent holds it;
// an empty cell carries the agent's own add (fieldd's offer, from the row's
// definition), or why the agent cannot take the server.
//
// AR-S4d2: skills too — a skill's one copy is kept in the profile's skills
// folder and an empty cell gives its agent a link to it (Codex: the copy
// moves to the folder every profile shares, after a confirm that names who
// else loads it). O1: a change made outside VibeField marks its cell with a
// grey dot, and one line above the list says who changed what.
//
// AR-S4e: a plugin on an agent's own list opens its page (pass 23's D1): who
// made it, what it brings, its version, and its agent's own acts — its
// switch, its update, its removal keeping its data or with it — or, where the
// agent offers none, why, in the agent's words. A row of an agent's own list
// opens its page; a kind the agent calls by a word of its own (Pi's
// "Packages") is called that.
//
// AR-S4e2: an install and a marketplace's acts are the agent's own too; their
// words are here with the rest (the Browse page's model is browse-model.ts).

export type ExtensionKindKey = "servers" | "skills";

const WORDS = {
  servers: {
    title: "MCP servers",
    one: "server",
    many: "servers",
    support: "mcpServers",
    kind: "mcp-server",
    column: "Server",
    other: "comes with a plugin, an app or one project; it stays on its agent’s own list",
    others: "come with a plugin, an app or one project; they stay on each agent’s own list",
  },
  skills: {
    title: "Skills",
    one: "skill",
    many: "skills",
    support: "skills",
    kind: "skill",
    column: "Skill",
    other:
      "is built into an agent, or comes with a plugin or your organization; it stays on its agent’s own list",
    others:
      "are built into an agent, or come with a plugin or your organization; they stay on each agent’s own list",
  },
} as const;

export const extensionKindTitle = (key: ExtensionKindKey): string => WORDS[key].title;

export type ExtensionCell =
  | { s: "on"; attn: boolean; why: string }
  | { s: "off"; why: string }
  | { s: "fixed"; why: string }
  | { s: "plugin"; glyph: "plugin" | "folder"; why: string }
  | { s: "lent"; from: string; why: string }
  | { s: "app"; on: boolean; why: string }
  | { s: "none"; why: string }
  | { s: "unread"; why: string };

export interface ExtensionColumnHead {
  provider: string;
  label: string;
  /** A word under the name: what is particular about this agent's column. */
  caveat: string;
  /** The whole sentence behind the caveat, for the header's title. */
  why: string;
}

export interface ExtensionGridRow {
  name: string;
  /** Under the name: the server's target and what it reads, or the skill's description. */
  fact: string;
  /** The fact's parts: what is typed (a target, a folder) set as code, and the prose. */
  factCode: string;
  factText: string;
  /** Held two different ways under one name. */
  twoVersions: boolean;
  /** AR-S4d — some agent holds it; a server only the profile keeps holds none. */
  held: boolean;
  /** A server at an address (globe) or a program on this Mac (prompt); a skill. */
  glyph: "globe" | "prompt" | "snippets";
  cells: Array<{
    provider: string;
    cell: ExtensionCell;
    act: ExtensionCellAct | null;
    /** AR-S4d2 (O1) — changed outside VibeField since the read before: the sentence that says so. */
    changed: string | null;
  }>;
}

export interface ExtensionGridModel {
  key: ExtensionKindKey;
  title: string;
  columnTitle: string;
  heads: ExtensionColumnHead[];
  rows: ExtensionGridRow[];
  /** What the agents hold of this kind that is not a row's: "3 more come with…". */
  more: string | null;
  /** The profile's agents all lack the kind, or none could be read. */
  empty: string | null;
}

const MINE = new Set(["own", "agent"]);

const listWords = (names: readonly string[], joiner = "and"): string =>
  names.length < 3
    ? names.join(` ${joiner} `)
    : `${names.slice(0, -1).join(", ")} ${joiner} ${names[names.length - 1]}`;

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

function labelOf(agents: readonly AgentExtensionColumn[], provider: string): string {
  return agents.find((column) => column.provider === provider)?.label ?? provider;
}

/** The kind as this agent keeps it, or why the column has nothing to say. */
function columnState(
  column: AgentExtensionColumn,
  key: ExtensionKindKey,
):
  | { kind: "none" | "unread"; why: string }
  | { kind: "read"; inApp: boolean; shared: boolean; partial?: string } {
  const words = WORDS[key];
  if (column.failure !== undefined) {
    return column.failure.status === "unsupported"
      ? { kind: "none", why: `VibeField does not read ${column.label}’s ${words.many} yet` }
      : { kind: "unread", why: `${column.label} could not be read: ${column.failure.message}` };
  }
  const support = column.support[words.support];
  if (support === undefined) {
    return { kind: "none", why: `${column.label} has no ${words.title}` };
  }
  if (!support.read) {
    return { kind: "unread", why: `VibeField does not read ${column.label}’s ${words.many} yet` };
  }
  // A kind this read covered only in part: what was read shows, the rest is a question.
  const unread = column.unread?.find((entry) => entry.kind === words.kind);
  return {
    kind: "read",
    inApp: support.changes === "in-app",
    shared: support.store === "shared",
    ...(unread !== undefined
      ? { partial: `Not all of ${column.label}’s ${words.many} could be read: ${unread.message}` }
      : {}),
  };
}

/** One agent's hold on one row: pass 24's states, each with its sentence. */
export function extensionCell(
  lens: AgentsExtensionsListResult,
  key: ExtensionKindKey,
  row: AgentExtensionRow,
  column: AgentExtensionColumn,
): ExtensionCell {
  const state = columnState(column, key);
  if (state.kind !== "read") return { s: state.kind, why: state.why };
  const words = WORDS[key];
  const label = column.label;
  const holding = row.cells[column.provider]?.[0];
  if (holding === undefined && state.partial !== undefined)
    return { s: "unread", why: state.partial };
  if (holding === undefined) {
    const offer = row.offers?.[column.provider];
    // an agent that changes its servers only in its app may still take one by its own add
    if (state.inApp && offer?.act === undefined)
      return { s: "app", on: false, why: `Off · changed in ${label}` };
    const unavailable = offer?.unavailable;
    return { s: "off", why: unavailable === undefined ? "Off" : `Off · ${unavailable.message}` };
  }
  switch (holding.origin) {
    case "borrowed": {
      const from = holding.lender ?? "";
      return {
        s: "lent",
        from,
        why: `${label} loads ${labelOf(lens.agents, from)}’s ${row.name} from This Mac, in every profile`,
      };
    }
    case "project":
      return {
        s: "plugin",
        glyph: "folder",
        why: `${label} has a ${row.name} of its own for one project${holding.project === undefined ? "" : `, ${holding.project}`}`,
      };
    case "plugin":
      return {
        s: "plugin",
        glyph: "plugin",
        why: `${label} has its own ${row.name}, from the ${holding.plugin ?? "a"} plugin`,
      };
    case "bundled":
      return { s: "plugin", glyph: "plugin", why: `${label} already has a ${row.name}, built in` };
    case "managed":
      return {
        s: "plugin",
        glyph: "plugin",
        why: `${label} has a ${row.name} its app or your organization added; it changes with them`,
      };
    default:
      break;
  }
  if (state.inApp) {
    return {
      s: "app",
      on: holding.enabled,
      why: `${holding.enabled ? "On" : "Off"} · changed in ${label}`,
    };
  }
  if (key === "skills" && holding.shared === true && holding.switchable !== true) {
    return holding.enabled
      ? {
          s: "fixed",
          why: `On · ${label} loads everything in the shared folder and has no switch for one skill`,
        }
      : { s: "off", why: `Off · ${label}’s own settings leave it out` };
  }
  if (!holding.enabled) return { s: "off", why: `Off · ${label} keeps its settings` };
  const other =
    key === "servers" && row.versions > 1 && holding.version !== undefined && holding.version > 0;
  if (other)
    return { s: "on", attn: true, why: `On · a different ${words.one} under the same name` };
  if (holding.auth === "needs-sign-in")
    return { s: "on", attn: true, why: "On · asks you to sign in" };
  return { s: "on", attn: false, why: holding.auth === "signed-in" ? "On · signed in" : "On" };
}

function headOf(
  lens: AgentsExtensionsListResult,
  key: ExtensionKindKey,
  column: AgentExtensionColumn,
): ExtensionColumnHead {
  const state = columnState(column, key);
  const base = { provider: column.provider, label: column.label };
  if (state.kind !== "read") {
    return { ...base, caveat: state.kind === "none" ? "none" : "not read", why: state.why };
  }
  if (state.partial !== undefined) return { ...base, caveat: "partly read", why: state.partial };
  if (state.inApp) {
    return {
      ...base,
      caveat: "in the app",
      why: `${column.label} changes its ${WORDS[key].many} only inside its app`,
    };
  }
  if (state.shared) {
    return {
      ...base,
      caveat: "shared",
      why: `${column.label} keeps its ${WORDS[key].many} in one place every profile reads`,
    };
  }
  const rows = key === "servers" ? lens.servers : lens.skills;
  const lenders = [
    ...new Set(
      rows.flatMap((row) =>
        (row.cells[column.provider] ?? [])
          .filter((holding) => holding.origin === "borrowed" && holding.lender !== undefined)
          .map((holding) => holding.lender!),
      ),
    ),
  ];
  if (lenders.length > 0) {
    const names = lenders.map((lender) => labelOf(lens.agents, lender));
    return {
      ...base,
      caveat: `+ ${names[0]}’s`,
      why: `${column.label} also loads ${listWords(names)}’s, from This Mac`,
    };
  }
  return { ...base, caveat: "", why: "" };
}

/** A definition's target as the grid shows one: the command line, or the address. */
export const definitionTarget = (definition: AgentExtensionServerDefinition): string =>
  definition.transport === "stdio"
    ? [definition.command, ...definition.args]
        .map((part) => (/[\s"'\\]/u.test(part) ? JSON.stringify(part) : part))
        .join(" ")
    : definition.url;

function factOf(key: ExtensionKindKey, row: AgentExtensionRow): { code: string; text: string } {
  const holdings = Object.values(row.cells).flat();
  if (key === "servers" && holdings.length === 0 && row.definition !== undefined) {
    const env = row.definition.transport === "stdio" ? (row.definition.env ?? []) : [];
    return {
      code: [definitionTarget(row.definition), env.join(" ")].filter(Boolean).join(" · "),
      text: "",
    };
  }
  if (key === "skills") {
    const shared = row.shared === true || holdings.some((holding) => holding.shared === true);
    return { code: shared ? "~/.agents/skills" : "", text: row.description ?? "" };
  }
  const first = holdings.find((holding) => holding.target !== undefined);
  if (row.versions > 1) return { code: first?.target ?? "", text: "" };
  const env = first?.env ?? [];
  return { code: [first?.target ?? "", env.join(" ")].filter(Boolean).join(" · "), text: "" };
}

const factLine = (twoVersions: boolean, fact: { code: string; text: string }): string =>
  [twoVersions ? "Two versions" : "", fact.code, fact.text].filter(Boolean).join(" · ");

/** One kind's grid for one profile's lens. */
export function extensionGrid(
  lens: AgentsExtensionsListResult,
  key: ExtensionKindKey,
): ExtensionGridModel {
  const words = WORDS[key];
  const source = key === "servers" ? lens.servers : lens.skills;
  const listed = source.filter(
    (row) =>
      row.kept === true ||
      Object.values(row.cells).some((holdings) =>
        holdings.some((holding) => MINE.has(holding.origin)),
      ),
  );
  const heads = lens.agents.map((column) => headOf(lens, key, column));
  const changed = changesOf(lens, key);
  const rows: ExtensionGridRow[] = listed.map((row) => {
    const first = Object.values(row.cells)
      .flat()
      .find((holding) => holding.transport !== undefined);
    return {
      name: row.name,
      ...(() => {
        const fact = factOf(key, row);
        const two = key === "servers" && row.versions > 1;
        return { fact: factLine(two, fact), factCode: fact.code, factText: fact.text };
      })(),
      twoVersions: key === "servers" && row.versions > 1,
      held: Object.keys(row.cells).length > 0,
      glyph:
        key === "skills"
          ? "snippets"
          : (first?.transport ?? row.definition?.transport) === "stdio"
            ? "prompt"
            : "globe",
      cells: lens.agents.map((column) => {
        const change = changed.find(
          (candidate) => candidate.provider === column.provider && candidate.name === row.name,
        );
        return {
          provider: column.provider,
          cell: extensionCell(lens, key, row, column),
          act: cellAct(key, row, column),
          changed: change === undefined ? null : `${changeSentence(lens, [change])}`,
        };
      }),
    };
  });
  // What else the agents hold of this kind, under a name with no row: a row's
  // other holdings already show as its cells' marks.
  const others = source
    .filter((row) => !listed.includes(row))
    .reduce((count, row) => count + Object.values(row.cells).flat().length, 0);
  const readable = lens.agents.filter((column) => columnState(column, key).kind === "read");
  return {
    key,
    title: words.title,
    columnTitle: words.column,
    heads,
    rows,
    more: others > 0 ? `${others} more ${others === 1 ? words.other : words.others}.` : null,
    empty:
      rows.length > 0
        ? null
        : readable.length === 0
          ? `None of these agents’ ${words.many} could be read here.`
          : `None of these agents has ${words.one === "server" ? "an MCP server" : "a skill"} of its own.`,
  };
}

/* ── O1: a change made outside VibeField (pass 24) ───────────────────────────
   A read that finds an agent holding something of the profile's own
   differently than the read before, when no act of VibeField's made it, says
   so: the cell shows what the agent holds now, with a grey dot, and one line
   above the list says who changed what, and when it was noticed. Nothing to
   settle: turning the cell is one click, and that settles the line. */

const changesOf = (
  lens: AgentsExtensionsListResult,
  key: ExtensionKindKey,
): AgentExtensionChange[] =>
  (lens.changes ?? []).filter((change) => change.kind === WORDS[key].kind);

const CHANGED: Record<AgentExtensionChange["change"], (agents: string, name: string) => string> = {
  removed: (agents, name) => `${agents} dropped ${name} outside VibeField`,
  added: (agents, name) => `${agents} took ${name} outside VibeField`,
  off: (agents, name) => `${name} was turned off in ${agents} outside VibeField`,
  on: (agents, name) => `${name} was turned on in ${agents} outside VibeField`,
};

/** One or more agents' same change to one name, in a sentence. */
function changeSentence(
  lens: AgentsExtensionsListResult,
  changes: readonly AgentExtensionChange[],
): string {
  const [first] = changes;
  if (first === undefined) return "";
  const agents = listWords([
    ...new Set(changes.map((change) => labelOf(lens.agents, change.provider))),
  ]);
  return CHANGED[first.change](agents, first.name);
}

/** When a read noticed it, in the page's words: "just now", "4 minutes ago", "yesterday"… */
function noticedWords(at: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return "noticed just now";
  if (minutes < 60) return `noticed ${plural(minutes, "minute", "minutes")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `noticed ${plural(hours, "hour", "hours")} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "noticed yesterday" : `noticed ${plural(days, "day", "days")} ago`;
}

export interface ExtensionChangeLine {
  /** "Codex dropped linear outside VibeField" */
  text: string;
  /** What the cell says now. */
  now: string;
  /** "noticed 4 minutes ago" */
  when: string;
}

/**
 * The lines above one list: each change made outside VibeField, one line per
 * name and kind of change, the agents that made it named together.
 */
export function changeLines(
  lens: AgentsExtensionsListResult,
  key: ExtensionKindKey,
  now: Date,
): ExtensionChangeLine[] {
  const groups = new Map<string, AgentExtensionChange[]>();
  for (const change of changesOf(lens, key)) {
    const group = `${change.name}\u0000${change.change}`;
    groups.set(group, [...(groups.get(group) ?? []), change]);
  }
  return [...groups.values()].map((changes) => {
    const agents = listWords([
      ...new Set(changes.map((change) => labelOf(lens.agents, change.provider))),
    ]);
    const last = changes.reduce((latest, change) => (change.at > latest.at ? change : latest));
    const state = { removed: "off", added: "on", off: "off", on: "on" }[last.change];
    return {
      text: changeSentence(lens, changes),
      now: `It shows ${state} for ${agents} now.`,
      when: noticedWords(last.at, now),
    };
  });
}

/**
 * The profile's agents that read the folder every profile shares for skills
 * (`~/.agents/skills`), and have no switch to leave one out — beside `except`,
 * the agent a skill is moving there for.
 */
export function sharedFolderReaders(
  lens: AgentsExtensionsListResult,
  except: string,
): Array<{ provider: string; label: string }> {
  return lens.agents
    .filter(
      (column) =>
        column.provider !== except &&
        column.failure === undefined &&
        (column.support.skills?.store === "mixed" || column.support.skills?.store === "shared"),
    )
    .map((column) => ({ provider: column.provider, label: column.label }));
}

/**
 * The I1 line: the lists are built from what the agents already hold, and
 * reading them changed nothing — with the names held two ways.
 */
export function builtFromWords(
  lens: AgentsExtensionsListResult,
  profile: string,
): { text: string; twoVersions: string[] } | null {
  // what the agents have: a server only the profile keeps is not built from them
  const servers = extensionGrid(lens, "servers").rows.filter((row) => row.held);
  const skills = extensionGrid(lens, "skills").rows;
  if (servers.length === 0 && skills.length === 0) return null;
  return {
    text: `Built from what ${profile}’s agents already have: ${plural(servers.length, "server", "servers")} and ${plural(skills.length, "skill", "skills")}. Nothing in the agents changed.`,
    twoVersions: servers.filter((row) => row.twoVersions).map((row) => row.name),
  };
}

/** One agent's holding, in words: where it comes from and where it lives. */
export function holdingWords(
  lens: AgentsExtensionsListResult,
  holding: AgentExtensionHolding,
): { origin: string; detail: string; place?: string } {
  const origin = {
    // AR-S4d2 — a skill's link, placed where the agent looks, to the copy the profile keeps
    own:
      holding.linkTarget !== undefined
        ? "A link in its skills folder"
        : holding.shared === true
          ? "Its own, in a folder every profile reads"
          : "Its own",
    project: `For one project${holding.project === undefined ? "" : `, ${holding.project}`}`,
    plugin: `From the ${holding.plugin ?? ""} plugin`,
    bundled: "Built in",
    managed: "Added by its app or your organization",
    agent: "Written by the agent itself",
    borrowed: `Loaded from ${labelOf(lens.agents, holding.lender ?? "")}, on This Mac`,
  }[holding.origin];
  const parts = [
    holding.enabled ? "on" : "off",
    holding.target ?? "",
    holding.env !== undefined && holding.env.length > 0 ? `reads ${holding.env.join(", ")}` : "",
    holding.headers !== undefined && holding.headers.length > 0
      ? `sends ${holding.headers.join(", ")}`
      : "",
    holding.auth === "signed-in"
      ? "signed in"
      : holding.auth === "needs-sign-in"
        ? "needs a sign-in"
        : "",
  ].filter(Boolean);
  return {
    origin,
    detail: parts.join(" · "),
    ...(holding.place !== undefined ? { place: holding.place } : {}),
  };
}

/** The line beneath a grid: when the lens was read, or that it is being read. */
export function readWords(lens: AgentsExtensionsListResult, now: Date): string {
  if (lens.reading) return "Reading the agents…";
  if (lens.readAt === undefined) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(lens.readAt)) / 60_000));
  return minutes < 1 ? "Read just now" : `Read ${plural(minutes, "minute", "minutes")} ago`;
}

/* ── one agent: its Extensions rows and its own lists (pass 23) ──────────────
   An agent's page in a profile has three rows — Plugins, MCP servers, Skills —
   each counting what the agent holds, what it borrows included, with a fact
   line only for an exception; each opens the agent's own list, grouped by
   where each item comes from. A kind the agent lacks has no row: one sentence
   beneath says so (N1). Read-only here, like the grid. */

export type AgentListKey = "plugins" | "servers" | "skills";

const LISTS = {
  plugins: { title: "Plugins", many: "plugins", support: "plugins", kind: "plugin" },
  servers: { title: "MCP servers", many: "servers", support: "mcpServers", kind: "mcp-server" },
  skills: { title: "Skills", many: "skills", support: "skills", kind: "skill" },
} as const;

const LIST_ORDER: readonly AgentListKey[] = ["plugins", "servers", "skills"];

export const agentListTitle = (key: AgentListKey): string => LISTS[key].title;

/** "MCP servers" stays as it is; "Plugins" reads "plugins" inside a sentence. */
const lowerTitle = (title: string): string =>
  title.replace(/^[A-Z][a-z]/u, (head) => head.toLowerCase());

/** One thing an agent holds of one kind. */
interface Held {
  name: string;
  description?: string | undefined;
  origin: AgentExtensionOrigin;
  enabled: boolean;
  lender?: string | undefined;
  /** a server's or a skill's holding */
  holding?: AgentExtensionHolding;
  /** a plugin */
  plugin?: AgentExtensionPlugin;
}

function heldOf(lens: AgentsExtensionsListResult, provider: string, key: AgentListKey): Held[] {
  if (key === "plugins") {
    return (lens.plugins[provider] ?? []).map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      origin: plugin.origin,
      enabled: plugin.enabled,
      lender: plugin.lender,
      plugin,
    }));
  }
  const rows = key === "servers" ? lens.servers : lens.skills;
  return rows.flatMap((row) =>
    (row.cells[provider] ?? []).map((holding) => ({
      name: row.name,
      description: row.description,
      origin: holding.origin,
      enabled: holding.enabled,
      lender: holding.lender,
      holding,
    })),
  );
}

/** Why an agent that could not be read has nothing to show. */
function failureWords(column: AgentExtensionColumn): string | null {
  if (column.failure === undefined) return null;
  return column.failure.status === "unsupported"
    ? `VibeField doesn’t read ${column.label}’s plugins, servers and skills yet.`
    : `${column.label}’s plugins, servers and skills couldn’t be read: ${column.failure.message}`;
}

export interface AgentExtensionsRowModel {
  key: AgentListKey;
  title: string;
  glyph: "plugin" | "globe" | "snippets";
  /** How many it holds, what it borrows included, or "None"; empty when unread. */
  value: string;
  /** What wants a look, set apart: a server that asks for a sign-in. */
  attention: string;
  /** The other exceptions, in words; empty when there are none. */
  fact: string;
  /** VibeField can't read this kind of the agent yet: the row opens nothing. */
  unread: boolean;
}

export interface AgentExtensionsModel {
  label: string;
  rows: AgentExtensionsRowModel[];
  /** Above the rows: the agent keeps every kind in one place. */
  sub: string | null;
  /** Beneath the rows: the kinds the agent has none of (N1). */
  lacks: string | null;
  /** The agent could not be read at all. */
  failure: string | null;
}

/** An agent's Extensions rows on its page in a profile; null when the lens has no such agent. */
export function agentExtensions(
  lens: AgentsExtensionsListResult,
  provider: string,
): AgentExtensionsModel | null {
  const column = lens.agents.find((candidate) => candidate.provider === provider);
  if (column === undefined) return null;
  const { label } = column;
  const failure = failureWords(column);
  if (failure !== null) return { label, rows: [], sub: null, lacks: null, failure };
  const has = LIST_ORDER.filter((key) => column.support[LISTS[key].support] !== undefined);
  const missing = LIST_ORDER.filter((key) => !has.includes(key));
  const allShared =
    has.length > 0 && has.every((key) => column.support[LISTS[key].support]?.store === "shared");
  const rows = has.map((key): AgentExtensionsRowModel => {
    const words = LISTS[key];
    const support = column.support[words.support];
    const glyph = key === "plugins" ? "plugin" : key === "servers" ? "globe" : "snippets";
    if (support?.read !== true) {
      return {
        key,
        title: words.title,
        glyph,
        value: "",
        attention: "",
        fact: "VibeField can’t read these yet",
        unread: true,
      };
    }
    const held = heldOf(lens, provider, key);
    const lent = held.filter((item) => item.origin === "borrowed");
    // what is built into the agent is not counted: it comes with the app (pass 23)
    const counted = held.filter(
      (item) => item.origin !== "borrowed" && !(key === "skills" && item.origin === "bundled"),
    );
    const asking = held.find(
      (item) =>
        item.origin !== "borrowed" && item.enabled && item.holding?.auth === "needs-sign-in",
    );
    const offHere = held.filter(
      (item) => item.holding?.shared === true && item.holding.switchable === true && !item.enabled,
    ).length;
    const lenders = [
      ...new Set(lent.flatMap((item) => (item.lender === undefined ? [] : [item.lender]))),
    ].map((lender) => labelOf(lens.agents, lender));
    const partial = column.unread?.some((entry) => entry.kind === words.kind) === true;
    const fact = [
      offHere > 0 ? `${plural(offHere, "shared skill", "shared skills")} turned off here` : "",
      partial ? "Not all could be read" : "",
      support.store === "shared" && !allShared ? "Shared by every profile" : "",
      support.changes === "in-app" ? `Changed only inside ${label}` : "",
      support.hostedSkips === true ? "Sessions VibeField starts don’t load them" : "",
      lent.length === 0
        ? ""
        : counted.length > 0
          ? `${lent.length} of them from ${listWords(lenders)}`
          : `All from ${listWords(lenders)} on This Mac`,
    ]
      .filter(Boolean)
      .join(" · ");
    const total = counted.length + lent.length;
    return {
      key,
      // the agent's own word for the kind, where it has one (Pi's "Packages")
      title: support.label ?? words.title,
      glyph,
      value: total > 0 ? String(total) : "None",
      attention: asking === undefined ? "" : `${asking.name} asks you to sign in`,
      fact,
      unread: false,
    };
  });
  return {
    label,
    rows,
    sub: allShared ? `${label} keeps them in one place, shared by every profile` : null,
    lacks:
      missing.length > 0
        ? `${label} has no ${listWords(
            missing.map((key) => lowerTitle(LISTS[key].title)),
            "or",
          )}.`
        : null,
    failure: null,
  };
}

/** AR-S4e — where a row of an agent's own list opens: a plugin's page, or a server's or skill's. */
export type AgentListOpen =
  | { kind: "plugin"; id: string; name: string }
  | { kind: "item"; list: ExtensionKindKey; name: string };

export interface AgentListItem {
  key: string;
  name: string;
  /** Where the row opens; none for a marketplace. */
  open?: AgentListOpen;
  /** A plugin's initial on its tile; a server at an address or a program; a skill. */
  glyph: "plugin" | "globe" | "prompt" | "snippets";
  initial?: string;
  /** What is typed — a target, a version — set as code. */
  code: string;
  /** The rest, in words. */
  text: string;
  /** On the right: its state, when there is one to say ("Off", "Signed in"). */
  state: string;
  attention: boolean;
}

export interface AgentListSection {
  key: string;
  title: string;
  sub: string;
  items: AgentListItem[];
  /** In place of the items: one line counting them (what is built in). */
  summary?: { title: string; text: string; value: string };
}

export interface AgentListModel {
  key: AgentListKey;
  title: string;
  label: string;
  /** Above the list: how the agent keeps this kind, when that is particular. */
  intro: string | null;
  sections: AgentListSection[];
  /** Nothing of its own: the sentence in its section's place. */
  empty: string | null;
  /** Why the list is missing, or not whole. */
  unread: string | null;
}

/** A commit reads as its first seven characters (pass 23). */
const versionWords = (version: string | undefined): string =>
  version === undefined ? "" : /^[0-9a-f]{12,}$/iu.test(version) ? version.slice(0, 7) : version;

function listItem(key: AgentListKey, item: Held): AgentListItem {
  if (key === "plugins" && item.plugin !== undefined) {
    const plugin = item.plugin;
    return {
      key: plugin.id,
      name: plugin.name,
      open: { kind: "plugin", id: plugin.id, name: plugin.name },
      glyph: "plugin",
      initial: plugin.name.slice(0, 1).toUpperCase(),
      // AR-S4e2 — a newer one its catalog lists, as the last read of it found
      code:
        plugin.newer === undefined
          ? versionWords(plugin.version)
          : `${versionWords(plugin.version) || "installed"} → ${versionWords(plugin.newer.version) || "newer"}`,
      text: [
        plugin.marketplace === undefined ? "" : `from ${plugin.marketplace}`,
        plugin.description ?? "",
      ]
        .filter(Boolean)
        .join(" · "),
      state: plugin.enabled ? "" : "Off",
      attention: false,
    };
  }
  const holding = item.holding!;
  if (key === "servers") {
    const asks = holding.enabled && holding.auth === "needs-sign-in";
    return {
      key: holding.id,
      name: item.name,
      open: { kind: "item", list: "servers", name: item.name },
      glyph: holding.transport === "stdio" ? "prompt" : "globe",
      code: holding.target ?? "",
      text: [
        holding.env !== undefined && holding.env.length > 0
          ? `reads ${holding.env.join(", ")}`
          : "",
        holding.headers !== undefined && holding.headers.length > 0
          ? `sends ${holding.headers.join(", ")}`
          : "",
        holding.origin === "project" ? (holding.project ?? "") : "",
        holding.origin === "plugin" && holding.plugin !== undefined
          ? `from the ${holding.plugin} plugin`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
      state: !holding.enabled
        ? "Off"
        : asks
          ? "Asks you to sign in"
          : holding.auth === "signed-in"
            ? "Signed in"
            : "",
      attention: asks,
    };
  }
  return {
    key: holding.id,
    name: item.name,
    open: { kind: "item", list: "skills", name: item.name },
    glyph: "snippets",
    code: "",
    text: item.description ?? "",
    state: !holding.enabled
      ? "Off"
      : holding.origin === "plugin"
        ? (holding.plugin ?? "")
        : holding.switchable === true
          ? "On"
          : "",
    attention: false,
  };
}

/** One agent's own list of one kind, grouped by where each item comes from. */
export function agentList(
  lens: AgentsExtensionsListResult,
  provider: string,
  key: AgentListKey,
  /** "in Work" · "on This Mac" */
  where: string,
): AgentListModel | null {
  const column = lens.agents.find((candidate) => candidate.provider === provider);
  if (column === undefined) return null;
  const words = LISTS[key];
  const { label } = column;
  const bare = { key, title: words.title, label, intro: null, sections: [], empty: null };
  const failure = failureWords(column);
  if (failure !== null) return { ...bare, unread: failure };
  const support = column.support[words.support];
  if (support === undefined) {
    return { ...bare, empty: `${label} has no ${lowerTitle(words.title)}.`, unread: null };
  }
  if (!support.read) {
    return { ...bare, unread: `VibeField can’t read ${label}’s ${words.many} yet.` };
  }
  const shared = support.store === "shared";
  const inApp = support.changes === "in-app";
  // the agent's own word for the kind, where it has one (Pi's "Packages")
  const many = support.label === undefined ? words.many : lowerTitle(support.label);
  const intro =
    [
      shared && inApp
        ? `${label} keeps its ${many} in one place for every profile, and changes them only inside its app.`
        : shared
          ? `${label} keeps its ${many} in one place, for every profile.`
          : inApp
            ? `${label} changes its ${many} only inside its app.`
            : "",
      // OpenCode's hosted sessions run without them (puppeteer's `hostedSkips`)
      support.hostedSkips === true
        ? `Sessions VibeField starts run ${label} without them; it loads them when you run it yourself.`
        : "",
    ]
      .filter(Boolean)
      .join(" ") || null;
  const held = heldOf(lens, provider, key);
  const of = (test: (item: Held) => boolean) =>
    held.filter(test).map((item) => listItem(key, item));
  const sections: AgentListSection[] = [];
  const push = (section: AgentListSection) => {
    if (section.items.length > 0 || section.summary !== undefined) sections.push(section);
  };

  const own = (item: Held) => item.origin === "own";
  if (key === "skills") {
    const switchable = held.some((item) => own(item) && item.holding?.switchable === true);
    push({
      key: "own",
      title: "Yours",
      sub: `In ${label}’s folder ${where}`,
      items: of((item) => own(item) && item.holding?.shared !== true),
    });
    push({
      key: "shared",
      title: switchable ? "Your skills" : "Shared skills",
      sub: switchable
        ? `In a folder every profile reads; whether each is on is kept ${where}`
        : "In a folder every profile reads",
      items: of((item) => own(item) && item.holding?.shared === true),
    });
  } else {
    push({
      key: "own",
      title: key === "plugins" ? "Installed" : "Servers",
      sub: "",
      items: of(own),
    });
  }
  push({
    key: "agent",
    title: `Written by ${label}`,
    sub: `${label} writes these itself, from what worked in a session.`,
    items: of((item) => item.origin === "agent"),
  });
  push({
    key: "project",
    title: "Only in one project",
    sub: `Added for one folder; ${label} keeps them ${where}.`,
    items: of((item) => item.origin === "project"),
  });
  push({
    key: "plugin",
    title: "From plugins",
    sub: "They come and go with their plugin.",
    items: of((item) => item.origin === "plugin"),
  });
  push(
    key === "plugins"
      ? {
          // pass 23: turned on by the organization or the account, kept in step with it; some it requires
          key: "managed",
          title: "From your organization",
          sub: "Your organization or your account turns these on, and they change there.",
          items: of((item) => item.origin === "managed"),
        }
      : {
          key: "managed",
          title: "From its app or your organization",
          sub: "They change with the app or your organization.",
          items: of((item) => item.origin === "managed"),
        },
  );
  const lenders = [
    ...new Set(
      held.flatMap((item) =>
        item.origin === "borrowed" && item.lender !== undefined ? [item.lender] : [],
      ),
    ),
  ];
  for (const lender of lenders) {
    const from = labelOf(lens.agents, lender);
    push({
      key: `borrowed:${lender}`,
      title: `From ${from} on This Mac`,
      sub: `${label} loads these from ${from}’s own settings on This Mac, in every profile; they change where they live.`,
      items: of((item) => item.origin === "borrowed" && item.lender === lender),
    });
  }
  const built = held.filter((item) => item.origin === "bundled");
  if (built.length > 0) {
    const names = built.map((item) => item.name);
    push({
      key: "bundled",
      title: "",
      sub: "",
      items: [],
      summary: {
        title: `Built into ${label}`,
        text: `${names.slice(0, 5).join(" · ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}`,
        value: String(names.length),
      },
    });
  }
  if (key === "plugins" && column.support.marketplaces?.read === true) {
    push({
      key: "marketplaces",
      title: "Marketplaces",
      sub: `Where ${label} finds plugins`,
      items: (lens.marketplaces[provider] ?? []).map((market) => ({
        key: market.id,
        name: market.name,
        glyph: "plugin",
        initial: market.name.slice(0, 1).toUpperCase(),
        code: market.source ?? "",
        text: "",
        state: market.enabled ? "" : "Off",
        attention: false,
      })),
    });
  }
  const mine = sections.some((section) => ["own", "shared"].includes(section.key));
  const partial = column.unread?.find((entry) => entry.kind === words.kind);
  return {
    key,
    title: support.label ?? words.title,
    label,
    intro,
    sections,
    empty: mine
      ? null
      : `${label} has no ${key === "servers" ? "MCP servers" : words.many} of its own ${where}.`,
    unread:
      partial === undefined
        ? null
        : `Not all of ${label}’s ${words.many} could be read: ${partial.message}`,
  };
}

/* ── one server or skill of the profile (pass 24's item page) ────────────────
   The grid's row name opens it: what it is, the versions the agents hold
   under its name, and a row per agent saying how that agent holds it. Its
   acts — Use this one everywhere, a switch per agent, Remove — are S4c's. */

export interface ExtensionItemVersion {
  code: string;
  /** What else tells it apart: the names a server reads and sends. */
  names: string;
  agents: string;
}

export interface ExtensionItemFact {
  term: string;
  /** The term is a name (a variable, a header), set as code. */
  termCode?: boolean;
  code?: string;
  text?: string;
  attention?: boolean;
}

export interface ExtensionItemAgent {
  provider: string;
  label: string;
  cell: ExtensionCell;
  /** What its switch or its Remove… runs; null when the agent offers nothing here. */
  act: ExtensionCellAct | null;
  /** The switch turns either way; without one, only removal is offered. */
  switchable: boolean;
  /**
   * AR-S4c — the agent's own sign-in to this server, in a terminal on the
   * page: "Sign in" where the agent says the server asks for one, "Sign in…"
   * where it doesn't say. Null when it offers none here.
   */
  signIn: { act: ExtensionCellAct; label: "Sign in" | "Sign in…" } | null;
  /** Its sign-out, offered only where the agent says it is signed in. */
  signOut: ExtensionCellAct | null;
  /** On the right, beside the cell's mark: "On", "Off", "Always on", "Signed in", … */
  state: string;
  attention: boolean;
  /** How the agent holds it — where its holding comes from — or why it has none. */
  fact: string;
  /** Where the agent keeps it. */
  place?: string;
}

export interface ExtensionItemModel {
  key: ExtensionKindKey;
  name: string;
  /** "MCP server" or "Skill". */
  kindWord: string;
  glyph: "globe" | "prompt" | "snippets";
  /** No agent of the profile holds it now. */
  gone: boolean;
  versions: { title: string; sub: string; entries: ExtensionItemVersion[] } | null;
  facts: ExtensionItemFact[];
  agentsSub: string;
  agents: ExtensionItemAgent[];
  /** A skill in a folder every profile reads: where, and who loads it from there. */
  sharedFolder: string | null;
}

const namesWords = (holding: AgentExtensionHolding): string =>
  [
    holding.env !== undefined && holding.env.length > 0 ? `reads ${holding.env.join(", ")}` : "",
    holding.headers !== undefined && holding.headers.length > 0
      ? `sends ${holding.headers.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

function stateOf(
  lens: AgentsExtensionsListResult,
  cell: ExtensionCell,
  holding: AgentExtensionHolding | undefined,
): { state: string; attention: boolean } {
  switch (cell.s) {
    case "on":
      if (holding?.auth === "needs-sign-in")
        return { state: "Asks you to sign in", attention: true };
      if (cell.attn) return { state: "Another version", attention: true };
      return { state: holding?.auth === "signed-in" ? "Signed in" : "On", attention: false };
    case "off":
      return { state: "Off", attention: false };
    case "fixed":
      return { state: "Always on", attention: false };
    case "app":
      return { state: cell.on ? "On" : "Off", attention: false };
    case "plugin":
      return { state: cell.glyph === "folder" ? "One project" : "Its own", attention: false };
    case "lent":
      return { state: `${labelOf(lens.agents, cell.from)}’s`, attention: false };
    case "none":
      return { state: "—", attention: false };
    default:
      return { state: "Not read", attention: false };
  }
}

/** The page of one server or skill the profile's agents hold. */
export function extensionItem(
  lens: AgentsExtensionsListResult,
  key: ExtensionKindKey,
  name: string,
  /** The profile's name, for the words. */
  profile = "this profile",
): ExtensionItemModel {
  const kindWord = key === "servers" ? "MCP server" : "Skill";
  const row = (key === "servers" ? lens.servers : lens.skills).find(
    (candidate) => candidate.name === name,
  );
  if (row === undefined) {
    return {
      key,
      name,
      kindWord,
      glyph: key === "skills" ? "snippets" : "globe",
      gone: true,
      versions: null,
      facts: [],
      agentsSub: "",
      agents: [],
      sharedFolder: null,
    };
  }
  const holdings = lens.agents.flatMap((column) =>
    (row.cells[column.provider] ?? []).map((holding) => ({ column, holding })),
  );
  const first = holdings.find(({ holding }) => holding.transport !== undefined)?.holding;
  const folderOf = (holding: AgentExtensionHolding) => holding.linkTarget ?? holding.place ?? "";

  let versions: ExtensionItemModel["versions"] = null;
  if (row.versions > 1) {
    const entries: ExtensionItemVersion[] = [];
    for (let index = 0; index < row.versions; index += 1) {
      const those = holdings.filter(({ holding }) => (holding.version ?? 0) === index);
      const one = those[0]?.holding;
      if (one === undefined) continue;
      entries.push({
        code: key === "servers" ? (one.target ?? "") : folderOf(one),
        names: key === "servers" ? namesWords(one) : "",
        agents: listWords([...new Set(those.map(({ column }) => column.label))]),
      });
    }
    versions =
      key === "servers"
        ? {
            title: row.versions === 2 ? "Two versions" : `${row.versions} versions`,
            sub: `The agents hold ${row.versions === 2 ? "two" : row.versions} different servers named ${name}.`,
            entries,
          }
        : {
            title: row.versions === 2 ? "In two places" : `In ${row.versions} places`,
            sub: `The agents load ${name} from different folders; an edit to one doesn’t reach the other.`,
            entries,
          };
  }

  const facts: ExtensionItemFact[] = [];
  if (key === "servers") {
    // AR-S4d — a server the profile keeps says what it is from its definition, held or not
    const definition = row.definition;
    const transport = first?.transport ?? definition?.transport;
    facts.push(
      row.versions > 1
        ? { term: "Connects to", text: "Two versions, above", attention: true }
        : {
            term: "Connects to",
            code: first?.target ?? (definition === undefined ? "" : definitionTarget(definition)),
          },
      {
        term: "Kind",
        text: transport === "stdio" ? "A program on this Mac" : "A server at a URL",
      },
    );
    const kept = new Set(lens.values ?? []);
    const env = [
      ...new Set([
        ...holdings.flatMap(({ holding }) => holding.env ?? []),
        ...(definition?.transport === "stdio" ? (definition.env ?? []) : []),
      ]),
    ].sort();
    const headers = [...new Set(holdings.flatMap(({ holding }) => holding.headers ?? []))].sort();
    for (const variable of env) {
      facts.push({
        term: variable,
        termCode: true,
        text: kept.has(variable)
          ? "Given to the server when it starts. VibeField keeps its value once, in its keychain, and gives it to each agent it turned the server on for when it starts that agent; an agent that keeps its own keeps that."
          : row.needs?.includes(variable) === true
            ? holdings.length === 0
              ? "Given to the server when it starts. VibeField keeps no value for it yet: turning the server on for an agent asks for one, and keeps it once, in its keychain."
              : "Given to the server when it starts. Each agent that holds it keeps its own value; turning it on for another asks for one, which VibeField keeps once, in its keychain."
            : "Given to the server when it starts. Its value stays with the agent; VibeField sees only the name.",
      });
    }
    for (const header of headers) {
      facts.push({
        term: header,
        termCode: true,
        text: "Sent with each request. Its value stays with the agent; VibeField sees only the name.",
      });
    }
    facts.push({
      term: "Kept",
      text:
        row.kept === true
          ? holdings.length === 0
            ? "Once, by VibeField, for this profile; no agent has it on"
            : "Once, by VibeField, for this profile, and in each agent’s own settings"
          : "In each agent’s own settings",
    });
  } else {
    if (row.description !== undefined) facts.push({ term: "What it does", text: row.description });
    // AR-S4d2 — the one copy, where the profile keeps it; else where the agents keep theirs
    const folders = [...new Set(holdings.map(({ holding }) => folderOf(holding)).filter(Boolean))];
    const folder = row.folder ?? (folders.length === 1 ? folders[0] : undefined);
    if (folder !== undefined) facts.push({ term: "Folder", code: folder });
    const holders = [...new Set(holdings.map(({ column }) => column.label))];
    const owner = row.owner === undefined ? undefined : labelOf(lens.agents, row.owner);
    const each =
      row.kept === true && row.shared === true
        ? `In the folder every profile shares, for Codex; ${profile}’s skills folder keeps a link to it, and each agent here gets a link where it looks`
        : row.kept === true
          ? "Gets a link to this folder where it looks for skills, so an edit is made once"
          : owner !== undefined
            ? `It is still ${owner}’s alone; the first other agent you turn it on for moves it to ${profile}’s skills folder and links it from both`
            : row.shared === true
              ? undefined
              : holders.length === 1
                ? `Only ${holders[0]} has it, in its own folder`
                : row.versions > 1
                  ? "Each keeps its own copy"
                  : "Each gets a link to this folder where it looks for skills";
    // a skill in the shared folder says so beneath the agents instead
    if (each !== undefined) facts.push({ term: "Each agent", text: each });
  }

  const agents = lens.agents.map((column): ExtensionItemAgent => {
    const cell = extensionCell(lens, key, row, column);
    const holding = row.cells[column.provider]?.[0];
    const act = cellAct(key, row, column);
    const signIn = offerOf(key, row, column, "sign-in");
    const base = {
      provider: column.provider,
      label: column.label,
      cell,
      act,
      // AR-S4d2 — a skill's link is its switch: on places it, off takes it away
      switchable:
        holding?.acts?.some((offer) => offer.act === "enable" || offer.act === "disable") ===
          true ||
        (key === "skills" && act !== null && (act.act === "add" || act.act === "remove")),
      signIn:
        signIn === null
          ? null
          : {
              act: signIn,
              label:
                holding?.auth === "needs-sign-in" ? ("Sign in" as const) : ("Sign in…" as const),
            },
      signOut: offerOf(key, row, column, "sign-out"),
      ...stateOf(lens, cell, holding),
    };
    if (holding === undefined) {
      // AR-S4d — an agent that cannot take it says why, in its own words
      const unavailable = row.offers?.[column.provider]?.unavailable;
      const fact =
        cell.s === "off"
          ? (unavailable?.message ?? `${column.label} doesn’t have it`)
          : cell.s === "app"
            ? `${column.label} doesn’t have it; it changes its ${WORDS[key].many} only inside its app`
            : cell.why;
      return { ...base, fact };
    }
    const words = holdingWords(lens, holding);
    // two versions: what this agent's reads, so the difference shows
    const names = key === "servers" && row.versions > 1 ? namesWords(holding) : "";
    return {
      ...base,
      fact: [words.origin, names].filter(Boolean).join(" · "),
      ...(words.place !== undefined ? { place: words.place } : {}),
    };
  });

  const sharedHoldings = holdings.filter(({ holding }) => holding.shared === true);
  const sharedPlace = sharedHoldings[0]?.holding.place;
  const sharedFolder =
    key !== "skills" || sharedPlace === undefined
      ? null
      : `${sharedPlace.replace(/\/[^/]+$/u, "")} is a folder every profile reads; ${listWords([
          ...new Set(sharedHoldings.map(({ column }) => column.label)),
        ])} ${sharedHoldings.length === 1 ? "loads" : "load"} ${name} from there. Removing it there removes it for all of them.`;

  return {
    key,
    name,
    kindWord,
    glyph:
      key === "skills"
        ? "snippets"
        : (first?.transport ?? row.definition?.transport) === "stdio"
          ? "prompt"
          : "globe",
    gone: false,
    versions,
    facts,
    agentsSub: key === "servers" ? "Each agent signs in to a server on its own" : "",
    agents,
    sharedFolder,
  };
}

/* ── one plugin an agent holds (AR-S4e; pass 23's D1) ───────────────────────
   A plugin row on an agent's own list opens its page: who made it and where
   it came from, what it brings, its version, and the agent's own acts on it —
   its switch, its update, its removal keeping its data or with it — or, in
   their place, why the agent offers none here, in the agent's own words. */

export interface PluginPart {
  key: "servers" | "skills" | "commands" | "agents" | "hooks" | "tools";
  glyph: "globe" | "snippets" | "prompt" | "plugin";
  title: string;
  /** What it is, in words, beside the names. */
  text: string;
  /** Its names, each set as code. */
  names: string[];
}

export interface PluginPageModel {
  provider: string;
  /** The agent's name. */
  label: string;
  id: string;
  name: string;
  initial: string;
  /** Who made it and where it came from. */
  sub: string;
  description: string | null;
  /** The agent's switch for it; null where it offers none here. */
  toggle: ExtensionCellAct | null;
  state: "On" | "Off";
  /** Why there is no switch, in the agent's words. */
  noSwitch: string | null;
  /** Sessions VibeField starts don't load it (OpenCode's hosted sessions). */
  hosted: string | null;
  parts: PluginPart[];
  /** What goes with it when it is removed, for the confirm. */
  goes: string;
  facts: ExtensionItemFact[];
  update: ExtensionCellAct | null;
  /** Why there is no update, where that isn't already said. */
  noUpdate: string | null;
  remove: ExtensionCellAct | null;
  purge: ExtensionCellAct | null;
  /** Why there is no removal, where that isn't already said. */
  noRemove: string | null;
  /** Its agent no longer holds it, or is no longer in the profile. */
  gone: boolean;
}

function pluginAct(
  column: AgentExtensionColumn,
  plugin: AgentExtensionPlugin,
  kind: AgentExtensionAct["act"],
): ExtensionCellAct | null {
  const offer = plugin.acts?.find((candidate) => candidate.act === kind);
  if (offer === undefined) return null;
  return {
    provider: column.provider,
    label: column.label,
    kind: "plugin",
    id: plugin.id,
    name: plugin.name,
    act: offer.act,
    runs: offer.runs,
    reaches: [...offer.reaches],
    terminal: offer.terminal === true,
    needs: [],
    title: TITLES[offer.act](plugin.name, column.label),
  };
}

/** The page of one plugin its agent holds, or a page that says it is gone. */
export function pluginPage(
  lens: AgentsExtensionsListResult,
  provider: string,
  id: string,
  /** The plugin's name as its row gave it, for a page whose plugin is gone. */
  fallbackName = id,
): PluginPageModel {
  const column = lens.agents.find((candidate) => candidate.provider === provider);
  const plugin = lens.plugins[provider]?.find((candidate) => candidate.id === id);
  const label = column?.label ?? provider;
  if (column === undefined || plugin === undefined) {
    return {
      provider,
      label,
      id,
      name: fallbackName,
      initial: fallbackName.slice(0, 1).toUpperCase(),
      sub: "",
      description: null,
      toggle: null,
      state: "Off",
      noSwitch: null,
      hosted: null,
      parts: [],
      goes: "",
      facts: [],
      update: null,
      noUpdate: null,
      remove: null,
      purge: null,
      noRemove: null,
      gone: true,
    };
  }
  const why = (act: AgentExtensionAct["act"]): string | null =>
    plugin.unavailable?.find((candidate) => candidate.act === act)?.message ?? null;
  const toggle = pluginAct(column, plugin, plugin.enabled ? "disable" : "enable");
  const noSwitch = toggle === null ? why(plugin.enabled ? "disable" : "enable") : null;
  const said = new Set(noSwitch === null ? [] : [noSwitch]);
  const unsaid = (text: string | null): string | null => {
    if (text === null || said.has(text)) return null;
    said.add(text);
    return text;
  };
  const remove = pluginAct(column, plugin, "remove");
  const purge = pluginAct(column, plugin, "purge");
  const noRemove = remove === null && purge === null ? unsaid(why("remove")) : null;
  const update = pluginAct(column, plugin, "update");
  const noUpdate = update === null ? unsaid(why("update")) : null;

  // what it brings: its servers and skills are the agent's holdings from it; the rest its folder names
  const fromIt = (rows: readonly AgentExtensionRow[]): string[] =>
    rows
      .filter((row) => row.cells[provider]?.some((holding) => holding.plugin === plugin.id))
      .map((row) => row.name);
  const servers = fromIt(lens.servers);
  const skills = fromIt(lens.skills);
  const commands = plugin.brings?.commands ?? [];
  const agents = plugin.brings?.agents ?? [];
  const hooks = plugin.brings?.hooks ?? [];
  const parts: PluginPart[] = [
    ...(skills.length > 0
      ? [
          {
            key: "skills" as const,
            glyph: "snippets" as const,
            title: plural(skills.length, "skill", "skills"),
            text: `${label} loads ${skills.length === 1 ? "it" : "them"} when a task calls for ${skills.length === 1 ? "it" : "them"}`,
            names: skills,
          },
        ]
      : []),
    ...(servers.length > 0
      ? [
          {
            key: "servers" as const,
            glyph: "globe" as const,
            title: plural(servers.length, "MCP server", "MCP servers"),
            text: `${label} connects to ${servers.length === 1 ? "it" : "them"} for tools`,
            names: servers,
          },
        ]
      : []),
    ...(commands.length > 0
      ? [
          {
            key: "commands" as const,
            glyph: "prompt" as const,
            title: plural(commands.length, "command", "commands"),
            text: "Typed in a session",
            names: commands,
          },
        ]
      : []),
    ...(agents.length > 0
      ? [
          {
            key: "agents" as const,
            glyph: "plugin" as const,
            title: plural(agents.length, "agent", "agents"),
            text: `${label} hands work to ${agents.length === 1 ? "it" : "them"}`,
            names: agents,
          },
        ]
      : []),
    ...(hooks.length > 0
      ? [
          {
            key: "hooks" as const,
            glyph: "prompt" as const,
            title: "Hooks",
            text: "It runs commands of its own at these moments",
            names: hooks,
          },
        ]
      : []),
  ];
  const brought = [
    skills.length > 0 ? plural(skills.length, "skill", "skills") : "",
    servers.length > 0 ? plural(servers.length, "MCP server", "MCP servers") : "",
    commands.length > 0 ? plural(commands.length, "command", "commands") : "",
    agents.length > 0 ? plural(agents.length, "agent", "agents") : "",
    hooks.length > 0 ? "its hooks" : "",
  ].filter(Boolean);
  const goes =
    brought.length > 0
      ? `What it brings goes with it: ${listWords(brought)}.`
      : "Its files go with it.";

  const market = lens.marketplaces[provider]?.find(
    (candidate) => candidate.id === plugin.marketplace,
  );
  const lender = plugin.lender === undefined ? undefined : labelOf(lens.agents, plugin.lender);
  const facts: ExtensionItemFact[] = [
    ...(plugin.version !== undefined || plugin.newer !== undefined
      ? [
          {
            term: "Version",
            // AR-S4e2 — its catalog lists a newer one: what Update would take
            code:
              plugin.newer === undefined
                ? versionWords(plugin.version)
                : `${versionWords(plugin.version) || "installed"} → ${versionWords(plugin.newer.version) || "newer"}`,
          },
        ]
      : []),
    ...(plugin.marketplace !== undefined
      ? [
          {
            term: "Marketplace",
            text:
              market?.source !== undefined
                ? `${plugin.marketplace} · ${market.source}`
                : plugin.marketplace,
          },
        ]
      : []),
    ...(plugin.homepage !== undefined ? [{ term: "Home page", code: plugin.homepage }] : []),
    // its folder, or the config file that names it (OpenCode's)
    ...(plugin.place !== undefined ? [{ term: "Kept in", code: plugin.place }] : []),
    ...(plugin.shared === true || column.support.plugins?.store === "shared"
      ? [{ term: "Profiles", text: `Every ${label} profile reads it from there` }]
      : []),
  ];
  const kind =
    column.support.plugins?.label === undefined
      ? "plugins"
      : lowerTitle(column.support.plugins.label);
  return {
    provider,
    label,
    id: plugin.id,
    name: plugin.name,
    initial: plugin.name.slice(0, 1).toUpperCase(),
    sub: [
      plugin.author ?? "",
      lender !== undefined ? `From ${lender} on This Mac` : (plugin.marketplace ?? ""),
    ]
      .filter(Boolean)
      .join(" · "),
    description: plugin.description ?? null,
    toggle,
    state: plugin.enabled ? "On" : "Off",
    noSwitch,
    hosted:
      column.support.plugins?.hostedSkips === true
        ? `Sessions VibeField starts run ${label} without its ${kind}; it loads them when you run it yourself.`
        : null,
    parts,
    goes,
    facts,
    update,
    noUpdate,
    remove,
    purge,
    noRemove,
    gone: false,
  };
}

/* ── acts (AR-S4c): what a cell's click runs ─────────────────────────────────
   A holding carries the acts its agent offers (RFC 006 C2, planned by its
   adapter). A click on an "on" cell turns it off — or, for an agent with no
   switch (Claude Code's servers), removes it; on an "off" cell it turns it
   on. A click that reaches further than its cell — the definition, a
   sign-in, every profile, a shared folder — asks first (P7). A remote
   server's sign-in is the agent's own login in a terminal on the page, and its
   sign-out the agent's own forgetting of it; both are the item page's. */

export interface ExtensionCellAct {
  provider: string;
  label: string;
  kind: "mcp-server" | "skill" | "plugin" | "marketplace";
  /** The holding's id in the agent's own read. */
  id: string;
  name: string;
  act: AgentExtensionAct["act"];
  runs: string;
  reaches: AgentExtensionAct["reaches"];
  /** It runs in a terminal on the page, which the person answers: a sign-in. */
  terminal: boolean;
  /** AR-S4d — for an add: the names its server reads that VibeField keeps no value for yet. */
  needs: string[];
  /** AR-S4d2 — a skill's copy moves here first (home-abbreviated): the folder every profile shares. */
  moves?: string;
  /** The control's accessible name. */
  title: string;
}

const TITLES: Record<AgentExtensionAct["act"], (name: string, agent: string) => string> = {
  enable: (name, agent) => `Turn ${name} on for ${agent}`,
  disable: (name, agent) => `Turn ${name} off for ${agent}`,
  remove: (name, agent) => `Remove ${name} from ${agent}`,
  "sign-in": (name, agent) => `Sign in to ${name} for ${agent}`,
  "sign-out": (name, agent) => `Sign out of ${name} for ${agent}`,
  add: (name, agent) => `Turn ${name} on for ${agent}`,
  update: (name, agent) => `Update ${name} for ${agent}`,
  purge: (name, agent) => `Remove ${name} and its data from ${agent}`,
  install: (name, agent) => `Install ${name} for ${agent}`,
};

/** AR-S4e2 — an act's control name: a marketplace's fetch and add read as what they do. */
export function actTitle(
  kind: ExtensionCellAct["kind"],
  act: AgentExtensionAct["act"],
  name: string,
  agent: string,
): string {
  if (kind === "marketplace" && act === "update")
    return `Fetch ${name}’s catalog again for ${agent}`;
  if (kind === "marketplace" && act === "add") return `Add the marketplace ${name} to ${agent}`;
  return TITLES[act](name, agent);
}

/** One act the agent offers on its holding under this row, or null when it offers none such. */
function offerOf(
  key: ExtensionKindKey,
  row: AgentExtensionRow,
  column: AgentExtensionColumn,
  kind: AgentExtensionAct["act"],
): ExtensionCellAct | null {
  const holding = row.cells[column.provider]?.[0];
  const offer = holding?.acts?.find((candidate) => candidate.act === kind);
  if (holding === undefined || offer === undefined) return null;
  return {
    provider: column.provider,
    label: column.label,
    kind: key === "servers" ? "mcp-server" : "skill",
    id: holding.id,
    name: row.name,
    act: offer.act,
    runs: offer.runs,
    reaches: [...offer.reaches],
    terminal: offer.terminal === true,
    needs: [],
    ...(offer.moves !== undefined ? { moves: offer.moves } : {}),
    // a skill's link goes, or its folder moves to the profile's: it is taken away, never lost
    title:
      key === "skills" && offer.act === "remove"
        ? `Take ${row.name} away from ${column.label}`
        : TITLES[offer.act](row.name, column.label),
  };
}

/**
 * AR-S4d — an empty cell's add: the agent's own, from the row's definition,
 * or null when it cannot take it. AR-S4d2 — a skill's is a link to its one
 * copy (Codex: the copy moves to the shared folder first).
 */
function addOf(
  key: ExtensionKindKey,
  row: AgentExtensionRow,
  column: AgentExtensionColumn,
): ExtensionCellAct | null {
  const offer: AgentExtensionOffer | undefined = row.offers?.[column.provider];
  if (offer?.act === undefined) return null;
  return {
    provider: column.provider,
    label: column.label,
    kind: key === "servers" ? "mcp-server" : "skill",
    id: row.name,
    name: row.name,
    act: "add",
    runs: offer.act.runs,
    reaches: [...offer.act.reaches],
    terminal: offer.act.terminal === true,
    needs: key === "servers" ? [...(row.needs ?? [])] : [],
    ...(offer.act.moves !== undefined ? { moves: offer.act.moves } : {}),
    title: TITLES.add(row.name, column.label),
  };
}

/** The act a click on one agent's cell runs, or null when it offers none here. */
export function cellAct(
  key: ExtensionKindKey,
  row: AgentExtensionRow,
  column: AgentExtensionColumn,
): ExtensionCellAct | null {
  const holding = row.cells[column.provider]?.[0];
  if (holding === undefined) return addOf(key, row, column);
  return holding.enabled
    ? (offerOf(key, row, column, "disable") ?? offerOf(key, row, column, "remove"))
    : offerOf(key, row, column, "enable");
}

export interface ExtensionActConfirm {
  question: string;
  /** What it takes, in sentences. */
  what: string;
  /** The confirming button. */
  action: string;
  danger: boolean;
  /** pass 24's chips: who gets it, beside the words. */
  chips?: Array<{ provider: string; label: string }>;
}

/** What a skill's confirm names beyond the act: who else reads the folder it moves to. */
export interface ExtensionConfirmContext {
  /** This profile's agents that read the shared folder too, with no switch for one skill. */
  readers?: Array<{ provider: string; label: string }>;
  /** The other profiles, and theirs. */
  elsewhere?: Array<{ profile: string; agents: string[] }>;
  /** AR-S4e — a plugin's removal: what goes with it, in a sentence. */
  goes?: string;
  /** AR-S4e — the agent can remove the plugin keeping its data, or with it: a removal says which. */
  keepsData?: boolean;
  /** AR-S4e2 — a marketplace's removal or fetch: how many plugins the agent installed from it. */
  installedFrom?: number;
  /** AR-S4e2 — a marketplace's source, where it can be added from again. */
  source?: string;
}

/**
 * AR-S4e2 — P7 for a marketplace: its removal always asks (the red one); a
 * fetch asks when it also updates the plugins installed from it; an add asks
 * only when it reaches further than this profile.
 */
function marketplaceConfirm(
  act: ExtensionCellAct,
  where: string,
  context: ExtensionConfirmContext,
): ExtensionActConfirm | null {
  const count = context.installedFrom ?? 0;
  const theirs =
    count === 0
      ? ""
      : count === 1
        ? "the plugin you installed from it"
        : `the ${count} plugins you installed from it`;
  const shared = act.reaches.includes("shared-folder")
    ? "Other agents read it from there too, in every profile."
    : act.reaches.includes("every-profile")
      ? `${act.label} keeps it for every profile, so this changes all of them.`
      : "";
  if (act.act === "remove") {
    return {
      question: `Remove ${act.name} from ${act.label} ${where}?`,
      what: [
        `Its catalog goes${act.reaches.includes("plugins") && theirs !== "" ? `, and so ${count === 1 ? "does" : "do"} ${theirs}` : ""}.`,
        context.source !== undefined ? `You can add it again from ${context.source}.` : "",
        shared,
      ]
        .filter(Boolean)
        .join(" "),
      action: `Remove ${act.name}`,
      danger: true,
    };
  }
  if (act.act === "update" && act.reaches.includes("plugins")) {
    return {
      question: `Fetch ${act.name}’s catalog for ${act.label} ${where}?`,
      what: [
        `${act.label} updates ${theirs !== "" ? theirs : "the plugins installed from it"} from the new catalog as it fetches it.`,
        shared,
      ]
        .filter(Boolean)
        .join(" "),
      action: "Fetch and update",
      danger: false,
    };
  }
  if (shared === "") return null;
  return {
    question:
      act.act === "add"
        ? `Add ${act.name} to ${act.label} in every profile?`
        : `Fetch ${act.name}’s catalog for ${act.label} in every profile?`,
    what: shared,
    action: act.act === "add" ? "Add it" : "Fetch it",
    danger: false,
  };
}

/**
 * AR-S4e — P7 for a plugin: a removal always asks (Remove keeps its data where
 * the agent can, Remove with its data is the red one); an update or a switch
 * asks only when it reaches further than this profile.
 */
function pluginConfirm(
  act: ExtensionCellAct,
  where: string,
  context: ExtensionConfirmContext,
): ExtensionActConfirm | null {
  const everywhere = act.reaches.includes("every-profile");
  const scope = everywhere ? "in every profile" : where;
  const reach = [
    everywhere ? `${act.label} keeps its plugins in one place, so this changes every profile.` : "",
    act.reaches.includes("shared-folder")
      ? "Other agents load it from there too, in every profile, and change with it."
      : "",
  ].filter(Boolean);
  if (act.act === "install") {
    // one click unless it reaches further than this profile: the look a person asked for is the page
    const install = act.reaches.includes("every-profile")
      ? `${act.label} keeps its plugins in one place, so every profile gets it.`
      : act.reaches.includes("shared-folder")
        ? "Other agents load it from there too, in every profile."
        : "";
    if (install === "") return null;
    return {
      question: `Install ${act.name} for ${act.label} ${everywhere ? "in every profile" : where}?`,
      what: `${install} It runs as code on this Mac.`,
      action: "Install it",
      danger: false,
    };
  }
  if (act.act === "remove" || act.act === "purge") {
    const purge = act.act === "purge";
    return {
      question: purge
        ? `Remove ${act.name} and its data from ${act.label} ${scope}?`
        : `Remove ${act.name} from ${act.label} ${scope}?`,
      what: [
        context.goes ?? "",
        purge
          ? "Its stored data is deleted too."
          : context.keepsData === true
            ? "Its stored data stays, so installing it again picks up where it left off."
            : "",
        "New sessions start without it; sessions running now keep it until they end.",
        ...reach,
      ]
        .filter(Boolean)
        .join(" "),
      action: purge ? `Remove ${act.name} and its data` : `Remove ${act.name}`,
      danger: purge,
    };
  }
  if (reach.length === 0) return null;
  return {
    question:
      act.act === "update"
        ? `Update ${act.name} for ${act.label} ${scope}?`
        : `Turn ${act.name} ${act.act === "enable" ? "on" : "off"} for ${act.label} ${scope}?`,
    what: reach.join(" "),
    action:
      act.act === "update" ? "Update it" : act.act === "enable" ? "Turn it on" : "Turn it off",
    danger: false,
  };
}

/** A click asks first when it reaches further than its cell, when its server needs a value, or when it removes a plugin or a marketplace. */
export const asksFirst = (act: ExtensionCellAct): boolean =>
  act.reaches.length > 0 ||
  act.needs.length > 0 ||
  ((act.kind === "plugin" || act.kind === "marketplace") &&
    (act.act === "remove" || act.act === "purge"));

/** A path's folder: `~/.agents/skills/x` → `~/.agents/skills`. */
const parentFolder = (path: string): string => path.replace(/\/[^/]+$/u, "");

/** P7 for a skill: a move to the shared folder, one folder for every profile, or another folder agents share. */
function skillConfirm(
  act: ExtensionCellAct,
  where: string,
  context: ExtensionConfirmContext,
): ExtensionActConfirm | null {
  const profile = where.replace(/^(in|on) /u, "");
  if (act.act === "add" && act.moves !== undefined && act.reaches.includes("shared-folder")) {
    // pass 24 (lb4): Codex reads a person's skills only from the one folder every profile shares
    const folder = parentFolder(act.moves);
    const readers = context.readers ?? [];
    const elsewhere = (context.elsewhere ?? []).filter((other) => other.agents.length > 0);
    const loads = [
      readers.length > 0 ? `${listWords(readers.map((reader) => reader.label))} here` : "",
      ...elsewhere.map((other) => `${listWords(other.agents)} in ${other.profile}`),
    ].filter(Boolean);
    return {
      question: `Move ${act.name} into the shared folder for ${act.label}?`,
      what: [
        `${act.label} reads your skills only from ${folder}, one folder every profile shares.`,
        `VibeField moves ${act.name} there and leaves a link in ${profile}’s skills folder, so every agent here that has it keeps it.`,
        `${act.label}’s own switch turns it on here and off in your other profiles.`,
        loads.length > 0
          ? `Other agents read that folder too and have no switch for one skill, so they load it: ${loads.join("; ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      action: `Move it and turn on for ${act.label}`,
      danger: false,
      chips: [{ provider: act.provider, label: act.label }, ...readers],
    };
  }
  if (act.reaches.includes("every-profile")) {
    const on = act.act === "add";
    return {
      question: `${on ? "Turn" : "Take"} ${act.name} ${on ? "on for" : "away from"} ${act.label} in every profile?`,
      what: `${act.label} reads one skills folder for every profile: this ${on ? "gives it to" : "takes it from"} all of them.${on ? "" : " Its folder stays."}`,
      action: on ? "Turn it on" : "Take it away",
      danger: !on,
    };
  }
  if (act.reaches.includes("shared-folder")) {
    const on = act.act === "add";
    return {
      question: `${on ? "Turn" : "Take"} ${act.name} ${on ? "on for" : "away from"} ${act.label} ${where}?`,
      what: `${act.label}’s skills folder ${where} is one other agents read too, in every profile: ${on ? "they load it from there as well" : "they lose it too"}.`,
      action: on ? "Turn it on" : "Take it away",
      danger: !on,
    };
  }
  return null;
}

/** P7: the two-step confirm a click needs when it reaches further than its cell; null when it does not. */
export function actConfirm(
  act: ExtensionCellAct,
  where: string,
  context: ExtensionConfirmContext = {},
): ExtensionActConfirm | null {
  if (act.kind === "plugin") return pluginConfirm(act, where, context);
  if (act.kind === "marketplace") return marketplaceConfirm(act, where, context);
  if (act.reaches.length === 0) return null;
  if (act.kind === "skill" && (act.act === "add" || act.act === "remove")) {
    return skillConfirm(act, where, context);
  }
  if (act.act === "sign-in" || act.act === "sign-out") {
    // the one reach a sign-in has: the agent keeps it once for every profile
    const signIn = act.act === "sign-in";
    return {
      question: signIn
        ? `Sign in to ${act.name} for ${act.label} in every profile?`
        : `Sign out of ${act.name} for ${act.label} in every profile?`,
      what: signIn
        ? `${act.label} keeps one sign-in to ${act.name} for every profile on this Mac: every ${act.label} profile that holds ${act.name} at this address will use this one, not only ${where.replace(/^(in|on) /u, "")}.`
        : `${act.label} keeps one sign-in to ${act.name} for every profile on this Mac: every ${act.label} profile that holds ${act.name} at this address is signed out.`,
      action: signIn ? "Sign in" : "Sign out",
      danger: false,
    };
  }
  if (act.act === "add") {
    return {
      question: `Turn ${act.name} on for ${act.label} in every profile?`,
      what: `${act.label} keeps one config for every profile: this adds ${act.name} to all of them.`,
      action: "Turn it on",
      danger: false,
    };
  }
  const sentences: string[] = [];
  if (act.act === "remove") {
    sentences.push(
      `${act.label} has no switch that turns ${act.name} off ${where}: this removes it.`,
    );
  }
  if (act.reaches.includes("sign-in")) sentences.push("Its sign-in goes with it.");
  if (act.reaches.includes("definition")) {
    sentences.push(
      act.kind === "mcp-server"
        ? `Turning it back on will need its address, and any key it uses, again.`
        : "Turning it back on will need its folder again.",
    );
  }
  if (act.reaches.includes("every-profile")) {
    sentences.push(`${act.label} keeps one config for every profile: this changes all of them.`);
  }
  if (act.reaches.includes("shared-folder")) {
    sentences.push("It lives in a folder every profile reads, and other agents too.");
  }
  const everywhere = act.reaches.includes("every-profile") ? "in every profile" : where;
  return {
    question:
      act.act === "remove"
        ? `Remove ${act.name} from ${act.label} ${where}?`
        : `Turn ${act.name} ${act.act === "enable" ? "on" : "off"} for ${act.label} ${everywhere}?`,
    what: sentences.join(" "),
    action:
      act.act === "remove"
        ? `Remove ${act.name}`
        : act.act === "enable"
          ? "Turn it on"
          : "Turn it off",
    danger: act.act === "remove",
  };
}

/** The run card's words: what ran, how it stands, and what the agent holds now. */
export function runWords(
  run: AgentExtensionRun,
  now: Date,
): { state: string; outcome: { tone: "neutral" | "error"; text: string } | null } {
  if (run.state === "running")
    return {
      state:
        run.act === "sign-in"
          ? "Signing in…"
          : run.act === "install"
            ? "Installing…"
            : run.kind === "marketplace" && run.act === "update"
              ? "Fetching…"
              : "Running…",
      outcome: null,
    };
  const at = run.finishedAt === undefined ? Number.NaN : Date.parse(run.finishedAt);
  const minutes = Number.isFinite(at) ? Math.max(0, Math.round((now.getTime() - at) / 60_000)) : 0;
  const state =
    minutes < 1 ? "Finished just now" : `Finished ${plural(minutes, "minute", "minutes")} ago`;
  const receipt = run.receipt;
  if (receipt === undefined) return { state, outcome: null };
  if (run.act === "sign-in" || run.act === "sign-out") {
    const signIn = run.act === "sign-in";
    switch (receipt.status) {
      case "changed":
        return {
          state,
          outcome: {
            tone: "neutral",
            text: signIn
              ? `${run.label} is signed in to ${run.name}.`
              : `${run.label} is signed out of ${run.name}.`,
          },
        };
      case "unchanged":
        // puppeteer's own words: "Codex still asks you to sign in", "… still holds a sign-in"
        return { state, outcome: { tone: "neutral", text: `${receipt.message} to ${run.name}.` } };
      case "unconfirmed":
        return {
          state,
          outcome: {
            tone: "neutral",
            text: `${run.label} doesn’t say whether it’s signed in until a session uses ${run.name}.`,
          },
        };
      case "failed":
        return {
          state,
          outcome: {
            tone: "error",
            text: signIn
              ? `${run.label} couldn’t sign in to ${run.name}: ${receipt.message}.`
              : `${run.label} couldn’t sign out of ${run.name}: ${receipt.message}.`,
          },
        };
      default:
        return { state, outcome: { tone: "error", text: `${receipt.message}.` } };
    }
  }
  if (run.act === "install") {
    switch (receipt.status) {
      case "changed":
        return {
          state,
          outcome: { tone: "neutral", text: `${run.name} is installed for ${run.label}.` },
        };
      case "unchanged":
        return {
          state,
          outcome: {
            tone: "neutral",
            text: `${run.label} ran its install, but doesn’t hold ${run.name}.`,
          },
        };
      case "failed":
        return {
          state,
          outcome: {
            tone: "error",
            text: `${run.label} couldn’t install ${run.name}: ${receipt.message}.`,
          },
        };
      default:
        return { state, outcome: { tone: "error", text: `${receipt.message}.` } };
    }
  }
  if (run.kind === "marketplace" && run.act !== "remove") {
    // puppeteer's own words: "added northlight", "fetched its catalog again; … also updated review 1.2.0 → 1.3.0"
    switch (receipt.status) {
      case "changed":
      case "unchanged":
        return { state, outcome: { tone: "neutral", text: `${run.label} ${receipt.message}.` } };
      case "unconfirmed":
        return { state, outcome: { tone: "neutral", text: `${receipt.message}.` } };
      case "failed":
        return {
          state,
          outcome: {
            tone: "error",
            text:
              run.act === "add"
                ? `${run.label} couldn’t add ${run.name}: ${receipt.message}.`
                : `${run.label} couldn’t fetch ${run.name}: ${receipt.message}.`,
          },
        };
      default:
        return { state, outcome: { tone: "error", text: `${receipt.message}.` } };
    }
  }
  if (run.act === "add") {
    switch (receipt.status) {
      case "changed":
        return { state, outcome: { tone: "neutral", text: `${run.name} is on for ${run.label}.` } };
      case "unchanged":
        return {
          state,
          outcome: {
            tone: "neutral",
            // a skill's link the agent doesn't read is taken back: puppeteer says so
            text:
              run.kind === "skill"
                ? `${run.label} doesn’t load ${run.name} from where it was placed, so VibeField took it back.`
                : `${run.label} ran its add, but doesn’t hold ${run.name}.`,
          },
        };
      case "failed":
        return {
          state,
          outcome: {
            tone: "error",
            text: `${run.label} couldn’t add ${run.name}: ${receipt.message}.`,
          },
        };
      default:
        return { state, outcome: { tone: "error", text: `${receipt.message}.` } };
    }
  }
  switch (receipt.status) {
    case "changed":
      return {
        state,
        outcome: {
          tone: "neutral",
          text:
            run.act === "enable"
              ? `${run.name} is on for ${run.label}.`
              : run.act === "disable"
                ? `${run.name} is off for ${run.label}.`
                : run.act === "update"
                  ? `${run.name} is updated for ${run.label}.`
                  : run.act === "purge"
                    ? `${run.name} and its data are gone from ${run.label}.`
                    : `${run.name} is gone from ${run.label}.`,
        },
      };
    case "unchanged":
      return {
        state,
        outcome: {
          tone: "neutral",
          // puppeteer's words for an update that found nothing newer: "Claude still holds 1.3.0"
          text:
            run.act === "update"
              ? `There’s no newer ${run.name}: ${receipt.message}.`
              : `${run.label} ran it, and still holds ${run.name} as before: ${receipt.message}.`,
        },
      };
    case "failed":
      return {
        state,
        outcome: {
          tone: "error",
          text:
            run.act === "update"
              ? `${run.label} couldn’t update ${run.name}: ${receipt.message}.`
              : `${run.label} couldn’t change ${run.name}: ${receipt.message}.`,
        },
      };
    default:
      return { state, outcome: { tone: "error", text: `${receipt.message}.` } };
  }
}

/**
 * Where a sign-in lands, beside its terminal: this profile alone, or — where
 * the agent keeps one sign-in for every profile — every one of them.
 */
export function signInNote(
  lens: AgentsExtensionsListResult,
  run: AgentExtensionRun,
  where: string,
): string {
  const offer = lens.servers
    .find((row) => row.name === run.name)
    ?.cells[run.provider]?.find((holding) => holding.id === run.item)
    ?.acts?.find((candidate) => candidate.act === "sign-in");
  return offer?.reaches.includes("every-profile") === true
    ? `${run.label} opens your browser to finish. The sign-in is ${run.label}’s for every profile on this Mac.`
    : `${run.label} opens your browser to finish. The sign-in lands ${where} alone.`;
}

/* ── Add server (AR-S4d; pass 24's "Adding one") ──────────────────────────────
   pass 23's A1 form without its scope: a name, what it connects to (a program
   on this Mac, or a URL), each variable the program reads with its value, and
   Turn on for — a chip per agent, chosen where its own add runs quietly,
   greyed with the agent's own reason where it cannot take the server. Runs
   says each agent's own line before anything is kept. */

export interface AddServerDraft {
  name: string;
  how: "command" | "url";
  /** One line, as a README gives it: `npx -y @upstash/context7-mcp`. */
  command: string;
  url: string;
  /** Each variable the program reads, and its value; kept once, in the keychain. */
  env: Array<{ name: string; value: string }>;
}

export const ADD_SERVER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/u;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;

/**
 * A command line as a shell would split it into words, quotes kept together
 * and removed; null when a quote is left open.
 */
export function splitCommand(line: string): string[] | null {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < line.length) word += line[++index];
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else if (char === "\\" && index + 1 < line.length) {
      word += line[++index];
      started = true;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote !== null) return null;
  if (started) words.push(word);
  return words;
}

/** What the form would keep, or null while it is not a server yet. */
export function draftDefinition(draft: AddServerDraft): AgentExtensionServerDefinition | null {
  if (draft.how === "url") {
    const url = draft.url.trim();
    if (!/^https?:\/\/\S+$/u.test(url)) return null;
    return { transport: "http", url };
  }
  const words = splitCommand(draft.command.trim());
  if (words === null || words.length === 0 || words.some((word) => word === "")) return null;
  const [command, ...args] = words;
  const env = draft.env.map((entry) => entry.name.trim()).filter((name) => name !== "");
  return {
    transport: "stdio",
    command: command!,
    args,
    ...(env.length > 0 ? { env: [...new Set(env)] } : {}),
  };
}

/** Why the form cannot be added yet, or null when it can. */
export function draftProblem(draft: AddServerDraft, taken: readonly string[]): string | null {
  const name = draft.name.trim();
  if (name === "") return "Name it";
  if (!ADD_SERVER_NAME.test(name)) return "A name is letters, digits, “-” and “_”";
  if (taken.includes(name)) return `This profile already has a server named ${name}`;
  if (draft.how === "url") {
    if (draft.url.trim() === "") return "Give its URL";
    return draftDefinition(draft) === null ? "A URL starts with https:// or http://" : null;
  }
  if (draft.command.trim() === "") return "Give the command that starts it";
  if (splitCommand(draft.command.trim()) === null) return "A quote in the command is left open";
  for (const entry of draft.env) {
    const variable = entry.name.trim();
    if (variable === "" && entry.value === "") continue;
    if (!VARIABLE_NAME.test(variable)) return "A variable’s name is letters, digits and “_”";
    if (entry.value === "") return `Give ${variable} its value`;
  }
  return null;
}

export interface AddServerChip {
  provider: string;
  label: string;
  /** The agent can take it: its own add. */
  act: AgentExtensionAct | null;
  /** Why it cannot, in its own words. */
  why: string;
  /** Chosen until the person says otherwise: its add runs quietly, in this profile alone. */
  preselected: boolean;
}

/** Turn on for: a chip per agent of the profile, from what each would run. */
export function addServerChips(
  lens: AgentsExtensionsListResult,
  offers: Record<string, AgentExtensionOffer> | null,
): AddServerChip[] {
  return lens.agents.map((column) => {
    const offer = offers?.[column.provider];
    const base = { provider: column.provider, label: column.label };
    if (column.failure !== undefined)
      return { ...base, act: null, why: `${column.label} could not be read`, preselected: false };
    if (column.support.mcpServers === undefined)
      return { ...base, act: null, why: `${column.label} has no MCP servers`, preselected: false };
    if (offer?.act !== undefined) {
      const reaches = offer.act.reaches.includes("every-profile");
      return {
        ...base,
        act: offer.act,
        why: reaches ? `${column.label} would add it for every profile` : column.label,
        preselected: !reaches && offer.act.terminal !== true,
      };
    }
    return {
      ...base,
      act: null,
      why: offer?.unavailable?.message ?? `${column.label} can’t take it here`,
      preselected: false,
    };
  });
}

/* ── Add skill (AR-S4d2; pass 24's "A skill, added once") ─────────────────────
   A folder on this Mac with a SKILL.md, copied into the profile's skills
   folder so the agents share one copy, then Turn on for — a chip per agent,
   chosen where its link stays in this profile; Codex, whose move takes it to
   the folder every profile shares, and an agent whose one folder serves every
   profile are there to choose, never chosen for you. Runs says each agent's
   own line before anything is copied. */

/** Why the folder can't be asked about yet, or null when it can. */
export function skillSourceProblem(from: string): string | null {
  const path = from.trim();
  if (path === "") return "Name a folder with a SKILL.md inside";
  if (!(path === "~" || path.startsWith("~/") || path.startsWith("/")))
    return "A full path, or one from ~/";
  return null;
}

/** Turn on for, for a skill: a chip per agent of the profile, from what each would run. */
export function addSkillChips(
  lens: AgentsExtensionsListResult,
  offers: Record<string, AgentExtensionOffer> | null,
): AddServerChip[] {
  return lens.agents.map((column) => {
    const offer = offers?.[column.provider];
    const base = { provider: column.provider, label: column.label };
    if (column.failure !== undefined)
      return { ...base, act: null, why: `${column.label} could not be read`, preselected: false };
    if (column.support.skills === undefined)
      return { ...base, act: null, why: `${column.label} has no skills`, preselected: false };
    if (offer?.act !== undefined) {
      const reaches = offer.act.reaches;
      const why = reaches.includes("shared-folder")
        ? offer.act.moves !== undefined
          ? `${column.label} would take it into the folder every profile shares`
          : `${column.label}’s skills folder here is one other agents read too`
        : reaches.includes("every-profile")
          ? `${column.label} would add it for every profile`
          : column.label;
      return { ...base, act: offer.act, why, preselected: reaches.length === 0 };
    }
    return {
      ...base,
      act: null,
      why: offer?.unavailable?.message ?? `${column.label} can’t take it here`,
      preselected: false,
    };
  });
}
