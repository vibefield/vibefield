import type {
  AgentExtensionAct,
  AgentExtensionCatalogAsk,
  AgentExtensionCatalogPlugin,
  AgentExtensionColumn,
  AgentExtensionMarketplace,
  AgentsExtensionsCatalogResult,
  AgentsExtensionsListResult,
} from "@vibefield/contracts";
import {
  actTitle,
  type ExtensionCellAct,
  type ExtensionItemFact,
  type PluginPart,
} from "./extensions-model";

// Browse and install (AR-S4e2; the design record's pass 23: B1 one list, D1
// the plugin's own page). fieldd sends what an agent could install — the
// plugins its marketplaces list, read from the catalogs it already fetched —
// with the agent's own install for each, or why not. This worded model is
// pure, so the catalog specimen and the tests draw the shipping words.
//
// One list, grouped by marketplace, the agent's featured plugins first. A row
// says Installed, or offers the agent's install: one click, unless the agent
// asks something first (its look, a command it fetches with, values, consent
// for what the plugin may do) or the install reaches further than this
// profile — then the button opens the plugin's page, which is that look, and
// the install runs from there (in a terminal the person answers, where the
// agent asks). A marketplace's own acts — its catalog fetched again, its
// removal — sit on its group. "Check for updates" is the agent's own fetch of
// each catalog; an agent whose fetch also updates what it installed says so
// before it runs.

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const listWords = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** "Plugins" stays itself at the head of a sentence; "plugins" inside one. */
const lower = (title: string): string =>
  title.replace(/^[A-Z][a-z]/u, (head) => head.toLowerCase());

/** The agent's own word for its plugins (Pi's "Packages"), as a title. */
export function pluginsTitle(column: AgentExtensionColumn | undefined): string {
  return column?.support.plugins?.label ?? "Plugins";
}

/** A day's words for when a catalog was fetched: "today", "yesterday", "Sep 21". */
function dayWords(at: string, now: Date): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  const day = (date: Date) => Math.floor(date.getTime() / 86_400_000);
  const days = day(now) - day(when);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return when.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "21:40" — a check's time, in the reader's clock. */
function clockWords(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

/** A plan fieldd sent, as the control that runs it. */
function cellAct(
  column: AgentExtensionColumn,
  kind: ExtensionCellAct["kind"],
  id: string,
  name: string,
  offer: AgentExtensionAct,
): ExtensionCellAct {
  return {
    provider: column.provider,
    label: column.label,
    kind,
    id,
    name,
    act: offer.act,
    runs: offer.runs,
    reaches: [...offer.reaches],
    terminal: offer.terminal === true,
    needs: [],
    title: actTitle(kind, offer.act, name, column.label),
  };
}

/** A listed plugin's install asks first: a look, a terminal, or more than this profile. */
export function installAsksFirst(
  plugin: AgentExtensionCatalogPlugin,
  install: ExtensionCellAct,
): boolean {
  return install.terminal || install.reaches.length > 0 || (plugin.asks ?? []).length > 0;
}

export interface BrowseRow {
  id: string;
  name: string;
  initial: string;
  /** Its description; in the featured group, its marketplace first. */
  text: string;
  /**
   * `installed` — the agent holds it (`held` is its id on the agent's list);
   * `install` — one click; `look` — its page first; `blocked` — the agent's
   * words; `none` — nothing to offer here (the page says why).
   */
  state: "installed" | "install" | "look" | "blocked" | "none";
  held: string | null;
  /** The agent holds an older one than its catalog lists. */
  newer: boolean;
  /** What stands in the button's place: "Turned off by your organization". */
  words: string | null;
  install: ExtensionCellAct | null;
}

export interface BrowseGroup {
  /** The marketplace's id. */
  key: string;
  title: string;
  /** Where it comes from, when it was fetched, who else reads it. */
  sub: string;
  rows: BrowseRow[];
  count: number;
  /** Its catalog fetched again, its removal: the agent's own. */
  update: ExtensionCellAct | null;
  remove: ExtensionCellAct | null;
  /** Its catalog could not be read: why. */
  unread: string | null;
  /** Its source, where it could be added from again. */
  source: string | null;
}

export interface BrowseModel {
  label: string;
  title: string;
  /** "Search 312 plugins" */
  placeholder: string;
  /** "All" and each marketplace, where there is more than one. */
  chips: Array<{ key: string; label: string }>;
  featured: BrowseRow[];
  groups: BrowseGroup[];
  /** The one reason every listed plugin shares for having no install here, said once above the list. */
  notice: string | null;
  /** No marketplace in the profile yet. */
  empty: {
    title: string;
    text: string;
    /** The marketplace the agent adds itself, which can be added now with its own add. */
    suggest: ExtensionCellAct | null;
  } | null;
  /** A search that matched nothing. */
  noMatch: string | null;
  /** The agent adds a marketplace from a source: its own words for what it takes. */
  addMarketplace: string | null;
  /** The catalog could not be read at all. */
  failure: string | null;
}

function rowOf(
  column: AgentExtensionColumn,
  plugin: AgentExtensionCatalogPlugin,
  marketplace: string | null,
): BrowseRow {
  const install =
    plugin.install === undefined
      ? null
      : cellAct(column, "plugin", plugin.id, plugin.name, plugin.install);
  const state: BrowseRow["state"] =
    plugin.held !== undefined
      ? "installed"
      : plugin.blocked !== undefined
        ? "blocked"
        : install === null
          ? "none"
          : installAsksFirst(plugin, install)
            ? "look"
            : "install";
  return {
    id: plugin.id,
    name: plugin.name,
    initial:
      plugin.name
        .replace(/^[^A-Za-z0-9]+/u, "")
        .slice(0, 1)
        .toUpperCase() || "?",
    text: [marketplace ?? "", plugin.description ?? ""].filter(Boolean).join(" · "),
    state,
    held: plugin.held ?? null,
    newer: plugin.newer === true,
    words: state === "blocked" ? (plugin.blocked ?? null) : null,
    install,
  };
}

const matches = (plugin: AgentExtensionCatalogPlugin, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return [plugin.name, plugin.description, plugin.author, plugin.category]
    .filter((part): part is string => part !== undefined)
    .some((part) => part.toLowerCase().includes(q));
};

/** The lens's marketplace row, for its acts. */
const marketOf = (
  lens: AgentsExtensionsListResult | null,
  provider: string,
  id: string,
): AgentExtensionMarketplace | undefined =>
  lens?.marketplaces[provider]?.find((row) => row.id === id);

/** One agent's catalog as the Browse page lists it. */
export function browsePage(
  catalog: AgentsExtensionsCatalogResult,
  lens: AgentsExtensionsListResult | null,
  /** "in Work" · "on This Mac" */
  where: string,
  now: Date,
  view: { query?: string; market?: string } = {},
): BrowseModel {
  const provider = catalog.provider;
  const column: AgentExtensionColumn = lens?.agents.find(
    (candidate) => candidate.provider === provider,
  ) ?? {
    provider,
    label: catalog.label,
    profileId: provider,
    support: {},
    counts: { plugins: 0, marketplaces: 0, mcpServers: 0, skills: 0 },
  };
  const label = catalog.label;
  const kind = lower(pluginsTitle(column));
  const query = view.query ?? "";
  const market = view.market ?? "all";
  const addMarketplace = column.support.marketplaces?.sources ?? null;
  const base = {
    label,
    title: `Browse ${kind}`,
    placeholder: `Search ${plural(catalog.plugins.length, kind.replace(/s$/u, ""), kind)}`,
    chips: [] as BrowseModel["chips"],
    featured: [] as BrowseRow[],
    groups: [] as BrowseGroup[],
    notice: null,
    empty: null,
    noMatch: null,
    addMarketplace,
    failure: null,
  };
  if (catalog.failure !== undefined) {
    return {
      ...base,
      failure:
        catalog.failure.status === "unsupported"
          ? `VibeField doesn’t read ${label}’s catalogs.`
          : `${label}’s catalogs couldn’t be read: ${catalog.failure.message}`,
    };
  }
  if (catalog.marketplaces.length === 0) {
    const suggestion = catalog.suggested?.[0];
    const suggest =
      suggestion?.add === undefined
        ? null
        : cellAct(
            column,
            "marketplace",
            suggestion.source ?? suggestion.name,
            suggestion.name,
            suggestion.add,
          );
    return {
      ...base,
      empty: {
        title: `No marketplaces ${where} yet`,
        text: [
          suggestion !== undefined ? `${suggestion.message}.` : "",
          suggest !== null
            ? "Add it now to browse before then, or add another from its source."
            : addMarketplace !== null
              ? "Add one from its source to browse its plugins."
              : "",
        ]
          .filter(Boolean)
          .join(" "),
        suggest,
      },
    };
  }
  const names = new Map(catalog.marketplaces.map((entry) => [entry.id, entry.name]));
  const shown = catalog.plugins.filter(
    (plugin) => (market === "all" || plugin.marketplace === market) && matches(plugin, query),
  );
  const featured =
    market === "all" && query.trim() === ""
      ? catalog.plugins
          .filter((plugin) => plugin.featured === true)
          .map((plugin) =>
            rowOf(column, plugin, names.get(plugin.marketplace) ?? plugin.marketplace),
          )
      : [];
  const lender = (id: string | undefined) =>
    id === undefined
      ? undefined
      : (lens?.agents.find((agent) => agent.provider === id)?.label ?? id);
  const groups = catalog.marketplaces
    .filter((entry) => market === "all" || entry.id === market)
    .map((entry): BrowseGroup => {
      const row = marketOf(lens, provider, entry.id);
      const act = (name: AgentExtensionAct["act"]) => {
        const offer = row?.acts?.find((candidate) => candidate.act === name);
        return offer === undefined
          ? null
          : cellAct(column, "marketplace", entry.id, entry.name, offer);
      };
      const from = lender(entry.lender);
      return {
        key: entry.id,
        title: entry.name,
        sub: [
          entry.source ?? "",
          entry.updatedAt !== undefined ? `fetched ${dayWords(entry.updatedAt, now)}` : "",
          from !== undefined ? `from ${from} on This Mac` : "",
          entry.shared === true ? "every profile reads it" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        rows: shown
          .filter((plugin) => plugin.marketplace === entry.id)
          .map((plugin) => rowOf(column, plugin, null)),
        count: entry.count,
        update: act("update"),
        remove: act("remove"),
        unread: entry.unread ?? null,
        source: entry.source ?? null,
      };
    })
    // a search leaves out the marketplaces it found nothing in
    .filter((group) => query.trim() === "" || group.rows.length > 0 || group.unread !== null);
  // the reason every listed plugin shares, said once instead of on each row
  const reasons = new Set(
    catalog.plugins.map((plugin) =>
      plugin.held !== undefined || plugin.blocked !== undefined || plugin.install !== undefined
        ? ""
        : (plugin.unavailable?.message ?? ""),
    ),
  );
  const notice =
    catalog.plugins.length > 0 && reasons.size === 1 && !reasons.has("") ? [...reasons][0]! : null;
  return {
    ...base,
    chips:
      catalog.marketplaces.length > 1
        ? [
            { key: "all", label: "All" },
            ...catalog.marketplaces.map((entry) => ({ key: entry.id, label: entry.name })),
          ]
        : [],
    featured,
    groups,
    notice,
    noMatch:
      query.trim() !== "" && shown.length === 0
        ? `No ${kind.replace(/s$/u, "")} matches “${query.trim()}”.`
        : null,
  };
}

/* ── one listed plugin's page (pass 23's D1, before it is installed) ─────── */

export interface BeforeItRuns {
  key: string;
  glyph: "prompt" | "globe" | "snippets" | "plugin" | "check";
  title: string;
  text: string;
  /** What is typed, set as code. */
  code?: string;
}

export interface ListedPluginModel {
  provider: string;
  label: string;
  id: string;
  name: string;
  initial: string;
  /** Who made it, its marketplace, its category. */
  sub: string;
  description: string | null;
  /** The agent's install; it runs from here, or in a terminal the person answers. */
  install: ExtensionCellAct | null;
  /** The agent holds it: its id on the agent's own list, whose page this becomes. */
  held: string | null;
  /** Why the agent won't install it here, in its words. */
  blocked: string | null;
  /** Why the agent offers no install here, in its words. */
  why: string | null;
  /** What the agent asks, or does, before its code runs. */
  before: BeforeItRuns[];
  /** What it would add, as its listing names it. */
  parts: PluginPart[];
  facts: ExtensionItemFact[];
  /** The catalog no longer lists it. */
  gone: boolean;
}

function askOf(
  label: string,
  ask: AgentExtensionCatalogAsk,
  author: string | undefined,
): BeforeItRuns {
  switch (ask.kind) {
    case "look":
      return {
        key: "look",
        glyph: "check",
        title: `${label} asks you to look first`,
        text: "What it adds is below.",
      };
    case "command":
      return {
        key: "command",
        glyph: "prompt",
        title: `${label} runs a command to fetch it`,
        text: `You accept it in the terminal. Install it only if you trust ${author ?? "where it comes from"}.`,
        ...(ask.command !== undefined ? { code: ask.command } : {}),
      };
    case "fetch":
      return {
        key: "fetch",
        glyph: "prompt",
        title: "A package manager fetches it",
        text: "Its install scripts run as you.",
        ...(ask.command !== undefined ? { code: ask.command } : {}),
      };
    case "values":
      return {
        key: "values",
        glyph: "snippets",
        title: `It asks for ${listWords(ask.names ?? [])}`,
        text: `${label} asks for ${(ask.names ?? []).length === 1 ? "it" : "them"} in the terminal as it installs it, and keeps ${(ask.names ?? []).length === 1 ? "it" : "them"} in its own settings.`,
      };
    case "consent":
      return {
        key: "consent",
        glyph: "check",
        title: `${label} asks your consent for what it may do`,
        text:
          ask.capabilities !== undefined && ask.capabilities.length > 0
            ? `It asks to ${listWords(ask.capabilities)}. You answer in the terminal.`
            : "You answer in the terminal when it is turned on. The code runs as you either way.",
      };
    case "scan":
      return {
        key: "scan",
        glyph: "check",
        title: `${label} scans its code first`,
        text: "It refuses what it finds dangerous, and asks about what looks risky.",
      };
    case "sign-in":
      return {
        key: "sign-in",
        glyph: "globe",
        title: `${listWords(ask.apps ?? [])} will ask you to sign in`,
        text: `The first time a session of ${label}’s uses ${(ask.apps ?? []).length === 1 ? "it" : "them"}.`,
      };
    default:
      return { key: String(ask.kind), glyph: "check", title: String(ask.kind), text: "" };
  }
}

function partsOf(label: string, brings: AgentExtensionCatalogPlugin["brings"]): PluginPart[] {
  const parts: PluginPart[] = [];
  const add = (
    key: PluginPart["key"] | "tools",
    names: readonly string[] | undefined,
    glyph: PluginPart["glyph"],
    one: string,
    many: string,
    text: string,
  ) => {
    if (names === undefined || names.length === 0) return;
    parts.push({
      key: key as PluginPart["key"],
      glyph,
      title: plural(names.length, one, many),
      text,
      names: [...names],
    });
  };
  // one is "it", more are "them"
  const them = (names: readonly string[] | undefined) =>
    (names?.length ?? 0) === 1 ? "it" : "them";
  add(
    "skills",
    brings?.skills,
    "snippets",
    "skill",
    "skills",
    `${label} loads ${them(brings?.skills)} when a task calls for ${them(brings?.skills)}`,
  );
  add(
    "servers",
    brings?.servers,
    "globe",
    "MCP server",
    "MCP servers",
    `${label} connects to ${them(brings?.servers)} for tools`,
  );
  add(
    "tools",
    brings?.tools,
    "prompt",
    "tool",
    "tools",
    `${label} can call ${them(brings?.tools)} in a session`,
  );
  add("commands", brings?.commands, "prompt", "command", "commands", "Typed in a session");
  add(
    "agents",
    brings?.agents,
    "plugin",
    "agent",
    "agents",
    `${label} hands work to ${them(brings?.agents)}`,
  );
  if (brings?.hooks !== undefined && brings.hooks.length > 0) {
    parts.push({
      key: "hooks",
      glyph: "prompt",
      title: "Hooks",
      text: "It runs commands of its own at these moments",
      names: [...brings.hooks],
    });
  }
  return parts;
}

/** A plugin a catalog lists, before it is installed: its page. */
export function listedPluginPage(
  catalog: AgentsExtensionsCatalogResult,
  lens: AgentsExtensionsListResult | null,
  id: string,
  /** The name its row gave it, for a page whose plugin is no longer listed. */
  fallbackName = id,
): ListedPluginModel {
  const provider = catalog.provider;
  const column = lens?.agents.find((candidate) => candidate.provider === provider);
  const label = column?.label ?? catalog.label;
  const plugin = catalog.plugins.find((candidate) => candidate.id === id);
  if (plugin === undefined) {
    return {
      provider,
      label,
      id,
      name: fallbackName,
      initial: fallbackName.slice(0, 1).toUpperCase(),
      sub: "",
      description: null,
      install: null,
      held: null,
      blocked: null,
      why: null,
      before: [],
      parts: [],
      facts: [],
      gone: true,
    };
  }
  const market = catalog.marketplaces.find((entry) => entry.id === plugin.marketplace);
  const install =
    plugin.install === undefined || column === undefined
      ? null
      : cellAct(column, "plugin", plugin.id, plugin.name, plugin.install);
  const before = (plugin.asks ?? []).map((ask) => askOf(label, ask, plugin.author));
  if (install?.reaches.includes("every-profile")) {
    before.push({
      key: "every-profile",
      glyph: "plugin",
      title: "Every profile gets it",
      text: `${label} keeps its plugins in one place, for every profile.`,
    });
  }
  if (install?.terminal && !before.some((row) => row.key === "command")) {
    before.push({
      key: "terminal",
      glyph: "prompt",
      title: `${label} installs it in a terminal`,
      text: "You answer what it asks there; VibeField reads it again when the terminal closes.",
    });
  }
  const facts: ExtensionItemFact[] = [
    ...(plugin.version !== undefined
      ? [
          {
            term: "Version",
            code: /^[0-9a-f]{12,}$/iu.test(plugin.version)
              ? plugin.version.slice(0, 7)
              : plugin.version,
          },
        ]
      : []),
    ...(market !== undefined
      ? [
          {
            term: "Marketplace",
            text: market.source !== undefined ? `${market.name} · ${market.source}` : market.name,
          },
        ]
      : []),
    ...(plugin.category !== undefined ? [{ term: "Category", text: plugin.category }] : []),
    ...(plugin.homepage !== undefined ? [{ term: "Home page", code: plugin.homepage }] : []),
  ];
  return {
    provider,
    label,
    id: plugin.id,
    name: plugin.name,
    initial:
      plugin.name
        .replace(/^[^A-Za-z0-9]+/u, "")
        .slice(0, 1)
        .toUpperCase() || "?",
    sub: [plugin.author ?? "", market?.name ?? plugin.marketplace, plugin.category ?? ""]
      .filter(Boolean)
      .join(" · "),
    description: plugin.description ?? null,
    install,
    held: plugin.held ?? null,
    blocked: plugin.blocked ?? null,
    why:
      plugin.install === undefined && plugin.blocked === undefined
        ? (plugin.unavailable?.message ?? null)
        : null,
    before,
    parts: partsOf(label, plugin.brings),
    facts,
    gone: false,
  };
}

/* ── the agent's own list: Check for updates, and adding from a source ───── */

export interface PluginsHead {
  /** "Check for updates", or — where the agent's fetch also updates what it installed — "Update catalogs…". */
  check: { label: string; asks: boolean } | null;
  /** Browse its catalogs. */
  browse: string | null;
  /** Add one from a source: the button, and the agent's own words for what it takes. */
  add: { label: string; words: string } | null;
  /** When updates were last checked, and what was found. */
  checked: string;
}

/** What an agent's own Plugins list offers at its head. */
export function pluginsHead(
  lens: AgentsExtensionsListResult,
  provider: string,
): PluginsHead | null {
  const column = lens.agents.find((candidate) => candidate.provider === provider);
  if (column === undefined || column.failure !== undefined) return null;
  const support = column.support.plugins;
  if (support === undefined) return null;
  const title = pluginsTitle(column);
  const kind = lower(title);
  const one = kind.replace(/s$/u, "");
  const catalog = support.catalog === true;
  const fetches = (lens.marketplaces[provider] ?? []).flatMap(
    (row) => row.acts?.filter((act) => act.act === "update" && act.terminal !== true) ?? [],
  );
  const updatesToo = fetches.some((act) => act.reaches.includes("plugins"));
  const newer = (lens.plugins[provider] ?? []).filter(
    (plugin) => plugin.newer !== undefined,
  ).length;
  const checkedAt = column.checkedAt;
  return {
    check: catalog
      ? { label: updatesToo ? "Update catalogs…" : "Check for updates", asks: updatesToo }
      : null,
    browse: catalog ? `Browse ${kind}…` : null,
    add: support.sources !== undefined ? { label: `Add ${one}…`, words: support.sources } : null,
    checked: !catalog
      ? ""
      : checkedAt === undefined
        ? updatesToo
          ? "Catalogs are fetched only when you ask"
          : "Updates are checked only when you ask"
        : `${updatesToo ? "Catalogs fetched" : "Checked"} ${clockWords(checkedAt)} · ${
            newer > 0 ? plural(newer, "update", "updates") : "everything current"
          }`,
  };
}

/** P7 for "Update catalogs…": the agent's fetch also updates what it installed from them. */
export function checkConfirm(
  lens: AgentsExtensionsListResult,
  provider: string,
  where: string,
): { question: string; what: string; action: string } | null {
  const column = lens.agents.find((candidate) => candidate.provider === provider);
  if (column === undefined) return null;
  const head = pluginsHead(lens, provider);
  if (head?.check?.asks !== true) return null;
  const count = (lens.plugins[provider] ?? []).filter((plugin) => plugin.origin === "own").length;
  return {
    question: `Update ${column.label}’s catalogs ${where}?`,
    what: `${column.label} fetches each of its catalogs and updates ${
      count === 0
        ? "what you install from them"
        : count === 1
          ? "the plugin you installed from them"
          : `the ${count} plugins you installed from them`
    } as it does. Nothing else changes.`,
    action: "Update catalogs",
  };
}
