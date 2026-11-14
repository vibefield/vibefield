// THE PLUGINS POPUP'S WORDS (MK-4a; DESIGN.md §9 "The plugins' words"): every word the popup says, in one module,
// so a word James changes is one edit here. A word §9 holds is quoted from it; a word marked ‹draft› there stays a
// draft here. MK-4a's own words (VF-PM 2026-11-11 11:40:58Z, ruling 1) are marked `MK's` below and listed apart in
// its commit message for James's eye. Nothing here names a key, a signature, a hash, a rung, a worker, a process, a
// restart, a repository's address, a power's id or a daemon (§9, VibeField's insides; James 2026-11-10 00:46Z).

import type { GrantDenialReason } from "@vibefield/contracts";

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

/** No build configures a plugin list (§9 "Nothing to discover yet", ‹draft›; James's MK-O5 pick: the popup never
 * says "registry"). */
export const NO_REGISTRY = {
  title: "Nothing to discover yet",
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
 * beyond drawing its own objects" is the install card's (§9); `unnamed` is James's (§9, his MK-O34 pick B). The
 * rest are MK's, ‹draft›, for James's eye. */
export const PAGE_WORDS = {
  /** the back row's name to assistive tech (MK's) */
  back: (tab: string) => `Back to ${tab}`,
  installed: "Installed",
  adds: "What it adds",
  can: "What it can do",
  madeBy: "Made by",
  version: "Version",
  /** What it adds: under a command it puts in the palette, which is said by its own title, where the command is
   * (James's MK-O20 pick A, 2026-11-11 23:03:26Z; these words ‹draft›): ⌘K on the Mac, Ctrl+K off it. */
  inPalette: (onMac: boolean) => `In the palette (${onMac ? "⌘K" : "Ctrl+K"})`,
  /** What it adds: a plugin's tools for your agents, with their count (James's MK-O14 pick B, 2026-11-11
   * 23:03:25Z: "6 tools for your agents"; one said as one, MK's, ‹draft›), and a service it runs (MK's; "service"
   * is James's to keep or strike, with Q5) */
  tools: (count: number) => `${plural(count, "tool", "tools")} for your agents`,
  service: "A service",
  /** What it can do, for a power whose declaring plugin is not installed here (MK's) */
  ownUnknown: "A power named by a plugin that isn't installed here",
  /** What it can do, for a power VibeField has no words for (James's MK-O34 pick B, 2026-11-12 06:12:24Z): nothing
   * under it says what it does or whose it is. A line for each such power (VF-PM 2026-11-14 03:11Z, MK's lean). */
  unnamed: "A power VibeField can't describe",
  /** What it can do, when it holds no power: with objects (the install card's), and with none (MK's) */
  nothing: "Nothing beyond drawing its own objects",
  nothingNoObject: "Nothing beyond its own work",
  /** Made by, for a Built in plugin (§9) */
  builtIn: "Comes with VibeField. It can be turned off, not removed.",
} as const;

/** A plugin's switches (MK-4c2a; DESIGN.md §8 "Its switches", §9 MK-4c2a's block): MK's words (VF-PM 2026-11-11
 * 18:36:34Z, 18:39:16Z, 18:43:08Z), each James's since his picks at A, as built, on 2026-11-12: `readOnly` (MK-O22),
 * `elsewhere` (MK-O21), `off` (MK-O27), `cant` (MK-O23) and `refused` (MK-O26). A switch is named by what it turns —
 * the plugin's title, or a power's plain words — and never by its state, which it says as a switch does. Settings →
 * Plugins keeps its own words until MK-5. */
export const SWITCH_WORDS = {
  /** A page of a plugin from the plugin list, or a Sideloaded one: no switches here (item 321). */
  readOnly: "Its switches aren't here yet.",
  /** A Built in plugin's page: the install-set carries its choices to your other desktops. */
  elsewhere: "Turning it off, or a power off, does the same on your other desktops.",
  /** An off plugin's page, under What it can do. */
  off: "Turn it on to change what it can do.",
  /** A power it can't have here, by why (fieldd's reasons; "revoked" is a switch, not a line). */
  cant: {
    "entry-kind": "Its kind of plugin can't have this power",
    "source-policy": "Not allowed for a plugin from its source",
    host: "Not available on this desktop",
  } satisfies Record<Exclude<GrantDenialReason, "revoked">, string>,
  /** A switch fieldd refused to move: never the error's own text. */
  refused: (turningOn: boolean) =>
    turningOn ? "Couldn't turn it on. Try again." : "Couldn't turn it off. Try again.",
} as const;

/** A plugin's settings (MK-4c2b; DESIGN.md §8 "Its settings", §9 MK-4c2b's block, as corrected for James's MK-O6
 * pick): MK's words, ‹draft›, for James's eye (VF-PM 2026-11-11 19:40:52Z). James's: `off`, `refused`, `saved`,
 * `choose` and `cantDraw` (his MK-O31 pick A, 2026-11-12 06:11:57Z), `unread` (his MK-O35 pick A) and `footHere`
 * (his MK-O33 pick B). A setting is named by its plugin's own title for it. The page has no Undo and no Redo: going
 * back stays in Settings. Settings → Plugins keeps its own words until MK-5. */
export const SETTINGS_WORDS = {
  /** The section's head (§8 "Its settings"). */
  head: "Settings",
  /** An off plugin's page, under Settings. */
  off: "Turn it on to change its settings.",
  /** A setting fieldd refused to keep: never the error's own text. */
  refused: "Couldn't save that. Try again.",
  /** A setting fieldd refused to read: never the error's own text, and no "Try again", since only the page's next
   * opening reads it again (§8 Its settings, Unread; James's MK-O35 pick A, 2026-11-12 06:12:28Z). */
  unread: "Couldn't load this setting.",
  /** A kept secret's empty field: it never shows what is kept. */
  saved: "Saved",
  /** A choice with nothing chosen yet (Settings' word, quoted). */
  choose: "Choose…",
  /** A setting the page can't draw. */
  cantDraw: "This setting can't be changed here.",
  /** The foot, with a setting in the synced history: where it can be undone (MK's, ‹draft›, for James's eye). */
  footSynced: "Synced settings can be undone in Settings.",
  /** The foot with none: they stay on this desktop (James's MK-O33 pick B, 2026-11-12 06:12:16Z). A page with
   * both kinds says `footSynced` alone, as before (VF-PM 2026-11-14 03:11Z, MK's lean). */
  footHere: "These settings stay on this desktop.",
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

/** Discover's community tile and its ask (MK-D6, MK-E3; DESIGN.md §8 "The community tile", drawn 2026-11-14 at
 * MK-O3D; §9 "Community plugins"). The title, "Off until you turn them on", the ask's question and its two acts are
 * §9's, from James's page; the line with a count is §9's ‹draft›, which James took at MK's lean (2026-11-11
 * 06:48:31Z); the statement is trust-and-distribution §7's, word for word (James's J1: "the switch states once that
 * nothing isolates their code"); "community off" at a read list's foot is §9's, from his page. The line with no
 * count and the state while on are MK's, ‹draft›, for James's eye. A switch that couldn't change says
 * SWITCH_WORDS.refused, James's MK-O26 pick. */
export const COMMUNITY_WORDS = {
  /** The tile's title, and its switch's name to assistive tech: by what it turns. */
  title: "Community plugins",
  /** The tile's line: how many plugins by other people the list held names. */
  line: (count: number) =>
    `${count > 0 ? plural(count, "plugin", "plugins") : "Plugins"} by other people. VibeField checks each one before it's listed.`,
  /** Its state while off. */
  off: "Off until you turn them on",
  /** Its state while on: what turning it off does (James's MK-O3 pick, "Stop"). */
  on: "Turning them off stops the ones you have, on every desktop.",
  /** The ask, in place, once on each desktop (James's MK-O1 pick B). */
  ask: "Turn on community plugins?",
  statement:
    "Community plugins run with the app's access. VibeField reviews the first listing and rebuilds every version from source; nothing isolates their code from yours.",
  cancel: "Cancel",
  confirm: "Turn on community plugins",
  /** The foot's end while the switch is off, after a held list's count and time (§9 "Reading the list"). */
  footOff: "community off",
} as const;

/** Installed's line for a plugin held while community plugins are off (James's MK-O3 pick, "Stop"; §9 "Community
 * plugins", ‹draft›, as his page drew them). One with no objects and no service says the first clause alone
 * (MK's, ‹draft›). A held plugin's page says the same words under where its act stands. */
export const HELD_LINE = {
  objects: "Off while community plugins are off · its objects on your desks draw as missing",
  service: "Off while community plugins are off · its service is stopped",
  bare: "Off while community plugins are off",
} as const;
