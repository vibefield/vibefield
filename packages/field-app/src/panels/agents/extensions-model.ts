import type {
  AgentExtensionColumn,
  AgentExtensionHolding,
  AgentExtensionRow,
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
  glyph: "globe" | "prompt" | "skill";
  cells: Array<{ provider: string; cell: ExtensionCell }>;
  /** Every holding, per agent, for the row's detail. */
  holdings: Array<{ provider: string; label: string; items: AgentExtensionHolding[] }>;
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

const listWords = (names: readonly string[]): string =>
  names.length < 3
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

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
      glyph: key === "skills" ? "skill" : first?.transport === "stdio" ? "prompt" : "globe",
      cells: lens.agents.map((column) => ({
        provider: column.provider,
        cell: extensionCell(lens, key, row, column),
      })),
      holdings: lens.agents
        .filter((column) => (row.cells[column.provider]?.length ?? 0) > 0)
        .map((column) => ({
          provider: column.provider,
          label: column.label,
          items: row.cells[column.provider] ?? [],
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

/** A holding in the row's detail: where it comes from and where it lives. */
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
