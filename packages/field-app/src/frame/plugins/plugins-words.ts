// THE PLUGINS POPUP'S WORDS (MK-4a; DESIGN.md §9 "The plugins' words"): every word the popup says, in one module,
// so a word James changes is one edit here. A word §9 holds is quoted from it; a word marked ‹draft› there stays a
// draft here. MK-4a's own words (VF-PM 2026-11-11 11:40:58Z, ruling 1) are marked `MK's` below and listed apart in
// its commit message for James's eye. Nothing here names a key, a signature, a hash, a rung, a worker, a process, a
// restart, a repository's address, a power's id or a daemon (§9, VibeField's insides; James 2026-11-10 00:46Z).

/** The popup's name to assistive tech (MK's, ‹draft›; the Peek's popup is named "Search"). */
export const PLUGINS_NAME = "Plugins";
/** Its close's name (MK's, ‹draft›; the Peek's says "Close search", Settings' "Close settings"). */
export const PLUGINS_CLOSE = "Close plugins";
/** The field (§9 "The popup"). */
export const PLUGINS_PLACEHOLDER = "Search plugins and objects…";

export const PLUGINS_TAB_WORDS = {
  discover: "Discover",
  installed: "Installed",
  updates: "Updates",
} as const;
/** The switch's name to assistive tech: its three parts, as §8 writes the switch. */
export const PLUGINS_SWITCH_NAME = "Discover · Installed · Updates";

/** No build configures a registry (§9 "No plugin registry yet"; Q5 is James's: this one module changes if he
 * answers). */
export const NO_REGISTRY = {
  title: "No plugin registry yet",
  description: "The plugins that come with VibeField are in Installed.",
  act: "Show installed",
  updates: "Plugins that come with VibeField update with it.",
} as const;

/** §9 "Reading the list". */
export const READING = "Reading the plugin list…";

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What a held list holds: "12 plugins, 31 objects" (§9; MK's ‹draft› as a body's words, VF-PM Q2). */
export function listCount(plugins: number, objects: number): string {
  return `${plural(plugins, "plugin", "plugins")}, ${plural(objects, "object", "objects")}`;
}

/** A held list's foot, by the state the read is in (§9 "Reading the list"). `when` is `listTime`'s. */
export const CATALOG_FOOT = {
  reading: (when: string) => `${READING} · showing the list from ${when}`,
  ready: (count: string, when: string) => `${count} · checked ${when}`,
  unreachable: (when: string) => `Offline · the list from ${when}`,
  refused:
    "VibeField couldn't use the new plugin list, so nothing new is shown · Diagnostics has the details",
  /** §9 says the list's date ("expired Feb 4"); the catalog's shape carries no expiry date, and fieldd sends no
   * `stale` at MK-2e, so the date is left out (MK's, ‹draft›). */
  stale: "The plugin list expired · installs wait for a newer one",
} as const;

/** No list held (MK's, ‹draft›, for James's eye; §8 "Its states, in the body"). */
export const NO_LIST = {
  unreachable: "Offline · no plugin list yet",
  refused: "VibeField couldn't use the plugin list · Diagnostics has the details",
} as const;

/** The popup's doors (MK-4b; DESIGN.md §9 "The doors", James's ruled page): the Me menu's row and the palette's two
 * acts say these, and import them from here rather than spell them. */
export const PLUGINS_DOOR = {
  /** The Me menu's row and the palette's act. */
  name: "Plugins…",
  /** The palette's act that opens the popup on Updates; no "…", as ruled (§9 "The '…'"). */
  check: "Check plugins for updates",
  /** The palette's small line under Plugins…: where else it lives. */
  nameWhere: "Me menu",
  /** The palette's small line under Check plugins for updates. */
  checkWhere: "Plugins",
} as const;

/** The Me menu row's end once a read found updates: "1 update", "2 updates" (§9 "The doors"); none at 0. */
export function updatesWords(count: number): string | null {
  return count > 0 ? plural(count, "update", "updates") : null;
}

/** The window's fieldd did not answer either door: IS-282-2's ruled words (§9 "Installed, off and Remove…"); its
 * Try again is MK-5's (MK-E12). */
export const PLUGINS_AWAY = "Plugins aren't available right now.";

/** Installed before the window holds its plugins (IS-282-2's ruled words). */
export const READING_YOURS = "Reading your plugins…";

/** §9 "Sources" (MK-D13, MK-E11). */
export const SOURCE_WORDS = {
  bundled: "Built in",
  vibefield: "VibeField",
  community: "Community",
  "dev-linked": "Development",
  sideload: "Sideloaded",
} as const;

/** An Installed row's one line (§9 "Installed, off and Remove…"). Where a set hangs ("Things, Tools") is the
 * desk's pegboard's to name, which the frame's popup does not read: MK-4a's line leaves it out (MK's, ‹draft›),
 * and it waits for the pegboard's names to reach the popup (MK-4d), not for the plugin's page (corrected at MK-4c,
 * as DESIGN.md §9 says). */
export const INSTALLED_LINE = {
  set: (objects: number, version: string) => `${plural(objects, "object", "objects")} · ${version}`,
  builtIn: "comes with VibeField",
  noObject: (has: string | null) => (has === null ? "No objects" : `No objects · ${has}`),
  builtInNoObject: "Comes with VibeField · no object on the desk",
  off: "Off · its objects on your desks draw as missing until it's on",
  offNoObject: "Off · its service is stopped",
  broken: (title: string) => `${title} isn't working right now`,
} as const;

/** What a plugin with no object has, for its line: §9's "a service and tools" (MK's when one is missing). */
export function hasWords(service: boolean, tools: boolean): string | null {
  if (service && tools) return "a service and tools";
  if (service) return "a service";
  if (tools) return "tools";
  return null;
}

/** A plugin's page, read only (MK-4c; DESIGN.md §8 "Read only first", §9 MK-4c's block). Its section heads are
 * §9's ("The popup"); "Installed", where its act will stand, is the act's own word once true (§9 "Installing, and
 * after"), said as words; a Built in plugin's maker is §9's sentence ("Installed, off and Remove…"); "Nothing
 * beyond drawing its own objects" is the install card's (§9). The rest are MK's, ‹draft›, for James's eye. */
export const PAGE_WORDS = {
  /** the back row's name to assistive tech (MK's) */
  back: (tab: string) => `Back to ${tab}`,
  installed: "Installed",
  adds: "What it adds",
  can: "What it can do",
  madeBy: "Made by",
  version: "Version",
  /** What it adds: a plugin's tools for your agents, and a service it runs (MK's; "service" is James's to keep or
   * strike, with Q5) */
  tools: "Tools for your agents",
  service: "A service",
  /** What it can do, for a power whose declaring plugin is not installed here (MK's) */
  ownUnknown: "A power named by a plugin that isn't installed here",
  /** What it can do, when it holds no power: with objects (the install card's), and with none (MK's) */
  nothing: "Nothing beyond drawing its own objects",
  nothingNoObject: "Nothing beyond its own work",
  /** Made by, for a Built in plugin (§9) */
  builtIn: "Comes with VibeField. It can be turned off, not removed.",
} as const;

/** Installed, when no plugin holds every typed word (MK's, ‹draft›; the Peek's "Nothing in your past holds every
 * word of “q”" is its pattern). */
export function noMatchWords(query: string): string {
  return `None of your plugins matches “${query.trim()}”.`;
}

/** Installed's foot: "6 plugins, 14 objects · 1 off" (§9). */
export function installedFootWords(plugins: number, objects: number, off: number): string {
  const count = listCount(plugins, objects);
  return off > 0 ? `${count} · ${off} off` : count;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** When the list was read, as §9 says it: "14:02" today, "Nov 6, 14:02" another day. */
export function listTime(at: number, now: number): string {
  const read = new Date(at);
  const today = new Date(now);
  const clock = `${String(read.getHours()).padStart(2, "0")}:${String(read.getMinutes()).padStart(2, "0")}`;
  const sameDay =
    read.getFullYear() === today.getFullYear() &&
    read.getMonth() === today.getMonth() &&
    read.getDate() === today.getDate();
  return sameDay ? clock : `${MONTHS[read.getMonth()]} ${read.getDate()}, ${clock}`;
}
