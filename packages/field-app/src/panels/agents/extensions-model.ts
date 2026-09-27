import type {
  AgentExtensionAct,
  AgentExtensionColumn,
  AgentExtensionHolding,
  AgentExtensionOrigin,
  AgentExtensionPlugin,
  AgentExtensionRow,
  AgentExtensionRun,
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
  /** A server at an address (globe) or a program on this Mac (prompt); a skill. */
  glyph: "globe" | "prompt" | "snippets";
  cells: Array<{ provider: string; cell: ExtensionCell; act: ExtensionCellAct | null }>;
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
    return state.inApp
      ? { s: "app", on: false, why: `Off · changed in ${label}` }
      : { s: "off", why: "Off" };
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

function factOf(key: ExtensionKindKey, row: AgentExtensionRow): { code: string; text: string } {
  const holdings = Object.values(row.cells).flat();
  if (key === "skills") {
    const shared = holdings.some((holding) => holding.shared === true);
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
  const listed = source.filter((row) =>
    Object.values(row.cells).some((holdings) =>
      holdings.some((holding) => MINE.has(holding.origin)),
    ),
  );
  const heads = lens.agents.map((column) => headOf(lens, key, column));
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
      glyph: key === "skills" ? "snippets" : first?.transport === "stdio" ? "prompt" : "globe",
      cells: lens.agents.map((column) => ({
        provider: column.provider,
        cell: extensionCell(lens, key, row, column),
        act: cellAct(key, row, column),
      })),
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

/**
 * The I1 line: the lists are built from what the agents already hold, and
 * reading them changed nothing — with the names held two ways.
 */
export function builtFromWords(
  lens: AgentsExtensionsListResult,
  profile: string,
): { text: string; twoVersions: string[] } | null {
  const servers = extensionGrid(lens, "servers");
  const skills = extensionGrid(lens, "skills");
  if (servers.rows.length === 0 && skills.rows.length === 0) return null;
  return {
    text: `Built from what ${profile}’s agents already have: ${plural(servers.rows.length, "server", "servers")} and ${plural(skills.rows.length, "skill", "skills")}. Nothing in the agents changed.`,
    twoVersions: servers.rows.filter((row) => row.twoVersions).map((row) => row.name),
  };
}

/** One agent's holding, in words: where it comes from and where it lives. */
export function holdingWords(
  lens: AgentsExtensionsListResult,
  holding: AgentExtensionHolding,
): { origin: string; detail: string; place?: string } {
  const origin = {
    own: holding.shared === true ? "Its own, in a folder every profile reads" : "Its own",
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
      title: words.title,
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

export interface AgentListItem {
  key: string;
  name: string;
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
      glyph: "plugin",
      initial: plugin.name.slice(0, 1).toUpperCase(),
      code: versionWords(plugin.version),
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
  const intro =
    shared && inApp
      ? `${label} keeps its ${words.many} in one place for every profile, and changes them only inside its app.`
      : shared
        ? `${label} keeps its ${words.many} in one place, for every profile.`
        : inApp
          ? `${label} changes its ${words.many} only inside its app.`
          : null;
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
          key: "managed",
          title: "Required by your organization",
          sub: "Your organization installs these; they change with it.",
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
    title: words.title,
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
    facts.push(
      row.versions > 1
        ? { term: "Connects to", text: "Two versions, above", attention: true }
        : { term: "Connects to", code: first?.target ?? "" },
      {
        term: "Kind",
        text: first?.transport === "stdio" ? "A program on this Mac" : "A server at a URL",
      },
    );
    const env = [...new Set(holdings.flatMap(({ holding }) => holding.env ?? []))].sort();
    const headers = [...new Set(holdings.flatMap(({ holding }) => holding.headers ?? []))].sort();
    for (const variable of env) {
      facts.push({
        term: variable,
        termCode: true,
        text: "Given to the server when it starts. Its value stays with the agent; VibeField sees only the name.",
      });
    }
    for (const header of headers) {
      facts.push({
        term: header,
        termCode: true,
        text: "Sent with each request. Its value stays with the agent; VibeField sees only the name.",
      });
    }
    facts.push({ term: "Kept", text: "In each agent’s own settings" });
  } else {
    if (row.description !== undefined) facts.push({ term: "What it does", text: row.description });
    const folders = [...new Set(holdings.map(({ holding }) => folderOf(holding)).filter(Boolean))];
    if (folders.length === 1) facts.push({ term: "Folder", code: folders[0]! });
    // a skill in the shared folder says so beneath the agents instead
    const holders = [...new Set(holdings.map(({ column }) => column.label))];
    if (!holdings.some(({ holding }) => holding.shared === true)) {
      facts.push({
        term: "Each agent",
        text:
          holders.length === 1
            ? `Only ${holders[0]} has it, in its own folder`
            : "Each keeps its own copy",
      });
    }
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
      switchable:
        holding?.acts?.some((offer) => offer.act === "enable" || offer.act === "disable") === true,
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
      const fact =
        cell.s === "off"
          ? `${column.label} doesn’t have it`
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
    glyph: key === "skills" ? "snippets" : first?.transport === "stdio" ? "prompt" : "globe",
    gone: false,
    versions,
    facts,
    agentsSub: key === "servers" ? "Each agent signs in to a server on its own" : "",
    agents,
    sharedFolder,
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
  kind: "mcp-server" | "skill";
  /** The holding's id in the agent's own read. */
  id: string;
  name: string;
  act: AgentExtensionAct["act"];
  runs: string;
  reaches: AgentExtensionAct["reaches"];
  /** It runs in a terminal on the page, which the person answers: a sign-in. */
  terminal: boolean;
  /** The control's accessible name. */
  title: string;
}

const TITLES: Record<AgentExtensionAct["act"], (name: string, agent: string) => string> = {
  enable: (name, agent) => `Turn ${name} on for ${agent}`,
  disable: (name, agent) => `Turn ${name} off for ${agent}`,
  remove: (name, agent) => `Remove ${name} from ${agent}`,
  "sign-in": (name, agent) => `Sign in to ${name} for ${agent}`,
  "sign-out": (name, agent) => `Sign out of ${name} for ${agent}`,
};

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
    title: TITLES[offer.act](row.name, column.label),
  };
}

/** The act a click on one agent's cell runs, or null when it offers none here. */
export function cellAct(
  key: ExtensionKindKey,
  row: AgentExtensionRow,
  column: AgentExtensionColumn,
): ExtensionCellAct | null {
  const holding = row.cells[column.provider]?.[0];
  if (holding === undefined) return null;
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
}

/** P7: the two-step confirm a click needs when it reaches further than its cell; null when it does not. */
export function actConfirm(act: ExtensionCellAct, where: string): ExtensionActConfirm | null {
  if (act.reaches.length === 0) return null;
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
    return { state: run.act === "sign-in" ? "Signing in…" : "Running…", outcome: null };
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
                : `${run.name} is gone from ${run.label}.`,
        },
      };
    case "unchanged":
      return {
        state,
        outcome: {
          tone: "neutral",
          text: `${run.label} ran it, and still holds ${run.name} as before: ${receipt.message}.`,
        },
      };
    case "failed":
      return {
        state,
        outcome: {
          tone: "error",
          text: `${run.label} couldn’t change ${run.name}: ${receipt.message}.`,
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
