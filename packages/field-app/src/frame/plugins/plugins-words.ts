// THE PLUGINS POPUP'S WORDS (MK-4a; DESIGN.md §9 "The plugins' words"): every word the popup says, in one module,
// so a word James changes is one edit here. A word §9 holds is quoted from it; a word marked ‹draft› there stays a
// draft here. MK-4a's own words (VF-PM 2026-11-11 11:40:58Z, ruling 1) are marked `MK's` below and listed apart in
// its commit message for James's eye. Nothing here names a key, a signature, a hash, a rung, a worker, a process, a
// restart, a repository's address, a power's id or a daemon (§9, VibeField's insides; James 2026-11-10 00:46Z).

import { type GrantDenialReason, PLUGIN_SERVICE_QUARANTINE_AT } from "@vibefield/contracts";

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

/** The popup's doors (MK-4b; DESIGN.md §9 "The doors", James's ruled page): the Me menu's row, the palette's two
 * acts and the pegboard's pill (MK-4d) say these, and import them from here rather than spell them. */
export const PLUGINS_DOOR = {
  /** The Me menu's row and the palette's act. */
  name: "Plugins…",
  /** The palette's act that opens the popup on Updates; no "…", as ruled (§9 "The '…'"). */
  check: "Check plugins for updates",
  /** The palette's small line under Plugins…: where else it lives. */
  nameWhere: "Me menu",
  /** The palette's small line under Check plugins for updates. */
  checkWhere: "Plugins",
  /** The pill at the pegboard's foot, which opens Discover (MK-D1, ruled by James 2026-11-11). */
  more: "More in Plugins…",
} as const;

/** The Me menu row's end once a read found updates: "1 update", "2 updates" (§9 "The doors"); none at 0. */
export function updatesWords(count: number): string | null {
  return count > 0 ? plural(count, "update", "updates") : null;
}

/** The window's fieldd did not answer either door: IS-282-2's ruled words (§9 "Installed, off and Remove…"). Installed
 * says it with no act while it holds none of its plugins, for the window keeps its last plugins and heals on its own;
 * Try again (`INSTALL_WORDS.tryAgain`) stands on Discover's and Updates' away state alone, where it reads the list
 * again (MK-5b; VF-PM 2026-11-14 04:33Z, MK-5's ask 3 at its lean). */
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

/** An Installed row's one line (§9 "Installed, off and Remove…"). Where a set hangs is said by the
 * pegboard's own names (MK-4d's names; James's MK-O10 pick A, "Names now, places with MK-4d"), as
 * §9's ruled line says it: "4 objects · Things, Tools · 1.0.0", or "Hangs under Things · 1.0.0" for
 * a set of one. While the popup reads no name for any of its objects' places — no board to read, an
 * object that hangs nowhere, a plugin that is off — the line says the set alone, as MK-4a's did
 * (MK's, ‹draft›). */
export const INSTALLED_LINE = {
  set: (objects: number, version: string) => `${plural(objects, "object", "objects")} · ${version}`,
  /** a set and where it hangs: `places` are the board's names, each once, in the board's order */
  placed: (objects: number, places: readonly string[], version: string) =>
    objects === 1
      ? `${hangsUnder(places.join(", "))} · ${version}`
      : `${plural(objects, "object", "objects")} · ${places.join(", ")} · ${version}`,
  builtIn: "comes with VibeField",
  noObject: (has: string | null) => (has === null ? "No objects" : `No objects · ${has}`),
  builtInNoObject: "Comes with VibeField · no object on the desk",
  off: "Off · its objects on your desks draw as missing until it's on",
  offNoObject: "Off · its service is stopped",
  /** a plugin that is on whose runtime failed, or that cannot start in this window (item 476); its row offers Try
   * again (`INSTALL_WORDS.tryAgain`) where its switch stands, which turns it off and on (MK-5b; N18, 2026-11-17:
   * Try again follows the switch, not a Built in or Development one's alone, VF-PM 19:45:16Z). The line
   * and its Try again are §9's ruled words (IS-282-6), not ‹draft›; a refusal of Try again says the switch's
   * words (`SWITCH_WORDS.refused`, ruled; `SWITCH_WORDS.updating`, ‹draft›) */
  broken: (title: string) => `${title} isn't working right now`,
  /** MK-5b: an invalid or incompatible plugin, which turning off and on can't mend: a line of its own, with no Try
   * again (VF-PM 2026-11-14 04:33Z, MK-5's ask 2 at its lean, "its words for James"). MK's, ‹draft›, for James's
   * eye: MK-5b's one new sentence. */
  cantRun: (title: string) => `${title} can't run on this VibeField`,
  /** MK-5 (N21): a plugin that is on whose service fieldd stopped after it kept crashing, in the attention ink, its
   * switch off; a press turns it on, which starts it again (the ruled page's row, §9) */
  stopped: `Stopped after ${PLUGIN_SERVICE_QUARANTINE_AT} crashes · turn it on to try again`,
  /** MK-5 (N21): a plugin from the plugin list that the list held no longer names (James's ruled words in place of
   * "dropped from registry", 2026-11-11 06:48:31Z at MK's lean; §9) */
  unlisted: "No longer listed · it keeps working here, with no more updates",
} as const;

/** What a plugin with no object has, for its line: §9's "a service and tools" (MK's when one is missing). */
export function hasWords(service: boolean, tools: boolean): string | null {
  if (service && tools) return "a service and tools";
  if (service) return "a service";
  if (tools) return "tools";
  return null;
}

/** Where an object hangs on the pegboard, by the board's own name for its category, never its id:
 * §9's "Hangs under ‹category›" ("The popup"'s What it adds, and the ruled Installed line of a set
 * of one), as James's Plugins page drew it under each object once MK-4d lands (MK-O10). */
export function hangsUnder(place: string): string {
  return `Hangs under ${place}`;
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
 * 18:36:34Z, 18:39:16Z, 18:43:08Z), each James's since his picks at A, as built, on 2026-11-12: `elsewhere`
 * (MK-O21), `off` (MK-O27), `cant` (MK-O23) and `refused` (MK-O26). A switch is named by what it turns —
 * the plugin's title, or a power's plain words — and never by its state, which it says as a switch does. N18: Plugins…
 * carries every plugin's switches but a held one's, so MK-O22's "Its switches aren't here yet." is said nowhere and
 * left this module, and Settings → Plugins says no switch's words of its own. */
export const SWITCH_WORDS = {
  /** A Built in plugin's page, and (N18) a plugin from the plugin list's: the install-set carries its choices to your
   * other desktops. */
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
  /** A plugin's switch refused while that plugin is updating (item 440, `PLUGIN_UPDATING`; §9,
   * James's pick B). The sentence is a draft, ‹draft›, for James's eye. */
  updating: "This plugin is updating. Try again in a moment.",
} as const;

/** A plugin's settings (MK-4c2b; DESIGN.md §8 "Its settings", §9 MK-4c2b's block, as corrected for James's MK-O6
 * pick): MK's words, ‹draft›, for James's eye (VF-PM 2026-11-11 19:40:52Z). James's: `off`, `refused`, `saved`,
 * `choose` and `cantDraw` (his MK-O31 pick A, 2026-11-12 06:11:57Z), `unread` (his MK-O35 pick A) and `footHere`
 * (his MK-O33 pick B). A setting is named by its plugin's own title for it. The page has no Undo and no Redo: going
 * back stays in Settings. N18: every plugin's page but a held one's carries its settings, and Settings → Plugins
 * carries none, nor its form's words. */
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
  /** MK-4c2c (James's click, 2026-11-14 08:19:36Z, "Yes, add them to the plugin's page"): a setting that is kept,
   * set back to its default. MK's three words here are ‹draft›, for his after-land list. */
  toDefault: "Back to default",
  /** MK-4c2c: a kept secret, removed; it asks first (‹draft›). */
  forget: "Remove the saved secret…",
  /** MK-4c2c: what removing it does, said in place before it is done, over Remove…'s Cancel and Remove (‹draft›). */
  forgetLine: "This deletes the saved secret. To use it again, you type it in again.",
} as const;

/** Discover's shelf (MK-4e; DESIGN.md §8 "Discover", §9 "The popup"'s MK-4e block). A tile's act is "Install" (§9
 * "Installing, and after"), or "Installed" (`PAGE_WORDS.installed`), or, for a set the list says can't run here,
 * MK's words; a mat says its count as Installed's line does; "Has Watch" and the community line are §9's. The rest
 * are MK's, ‹draft›, for James's eye. */
export const SHELF_WORDS = {
  install: "Install",
  /** a set the list says can't run on this VibeField (MK's) */
  needsNewer: "Needs a newer VibeField",
  /** the mat's count: "3 objects", "1 object" */
  count: (objects: number) => plural(objects, "object", "objects"),
  /** a set typed words found by one of its objects (§9 "The popup") */
  has: (label: string) => `Has ${label}`,
  /** no set holds every typed word (MK's; Installed's line below is its pattern) */
  none: (query: string) => `No plugin in the list matches “${query.trim()}”.`,
  /** while community plugins are off, at the results' end (§9 "Community plugins") */
  communityOff: "Community plugins are off, so their objects aren't searched.",
  /** Discover's categories (item 433; §9 "The popup"): the first, the pegboard's filters' own word (§8 "The
   * pegboard"); each other is the board's own name for it */
  all: "All",
  /** the categories' row, to assistive tech (item 433; MK's, ‹draft›) */
  categories: "Categories",
} as const;

/** The install card (O2-C; DESIGN.md §9 "The install card", and its O2-C block under "Installing, and after"): §9's
 * words, one of a thing said as one (MK's), and, for a power it can't name, the word James picked for the page
 * (MK-O34, B, ‹draft›). "‹plugin›" is the title the downloaded plugin's manifest writes. */
export const CARD_WORDS = {
  ask: (title: string) => `Install ${title}?`,
  adds: (objects: number) => `It adds ${plural(objects, "object", "objects")} to your pegboard:`,
  tools: (tools: number) => `It gives your agents ${plural(tools, "tool", "tools")}.`,
  can: "It can:",
  /** for the powers it can't name, the page's own line, read from it (VF-PM 2026-11-14 04:33Z) */
  unnamed: PAGE_WORDS.unnamed,
  /** one desktop: this one ("this PC" off the Mac) */
  here: (onMac: boolean) => (onMac ? "It installs on this Mac." : "It installs on this PC."),
  /** more than one: how many, and the page's reason */
  reaches: (desktops: number) =>
    `It installs on your ${desktops} desktops, because your desktops share one set of plugins.`,
  cancel: "Cancel",
} as const;

/** The act after Installed on a plugin's page whose objects hang on the pegboard (MK-4d; MK-D8, ruled A, its
 * fallback B): §9's words ("Installing, and after"), "Show on the pegboard" for a set of one. It completes as pressed
 * and wears no "…" (§9 "The '…'"). */
export function showWords(objects: number): string {
  return objects === 1 ? "Show on the pegboard" : "Show them on the pegboard";
}

/** An install's steps on a page's act (O2-C; §9 "Installing, and after"). "Downloading…" stands for §9's
 * "Downloading · 42%", since fieldd says nothing of a download's bytes (MK's, ‹draft›); the failure's line and Try
 * again are §9's (‹draft›); "Installing needs the internet" is §9's ruled offline word. Never fieldd's own text: a
 * refusal is worded by its kind (`plugins-install.ts`, `installRefusal`). MK-O3D (§9 "Community plugins"): a
 * community set's Install while community plugins are off says why (MK's, ‹draft›), and the statement at this
 * desktop's first community install has James's page's heading and Continue (his MK-O1 pick B, ‹draft› there); its
 * statement and its Cancel are `COMMUNITY_WORDS`'. */
export const INSTALL_WORDS = {
  downloading: "Downloading…",
  installing: (objects: number) =>
    objects === 0 ? "Installing…" : `Installing ${plural(objects, "object", "objects")}…`,
  failed: (title: string) => `VibeField didn't install ${title}. Nothing changed.`,
  tryAgain: "Try again",
  offline: "Installing needs the internet",
  communityOff: "Installing needs community plugins turned on",
  firstCommunity: (desktop: string) => `First community plugin on ${desktop}`,
  goOn: "Continue",
} as const;

/** Updates (MK-UC's UC-C; DESIGN.md §9 "Updates" and its UC-C block): §9's words — the head, a row's line and what
 * it changes in the set, Update, Update…, Update all, Update all…, Check again, Updating…, Updated to and the tab's
 * note, all ‹draft› but the ruled ones — and MK's, ‹draft›, for James's eye: a failed update, the install's twin.
 * "‹plugin›" is the installed plugin's title. */
export const UPDATE_WORDS = {
  head: (count: number, when: string) => `${plural(count, "update", "updates")} · checked ${when}`,
  current: (when: string) => `Everything is up to date · checked ${when}`,
  all: "Update all",
  /** while one of the updates it would take removes an object */
  allAsks: "Update all…",
  again: "Check again",
  /** "0.6.1 → 0.7.0 · Nov 7": the version you have, the update's, and the day the list says it was published */
  line: (from: string, to: string, day: string) => `${from} → ${to} · ${day}`,
  adds: (objects: string) => `Adds ${objects}`,
  removes: (objects: string) => `Removes ${objects}`,
  update: "Update",
  /** an update the list says removes an object asks first */
  updateAsks: "Update…",
  updating: "Updating…",
  updated: (version: string) => `Updated to ${version}`,
  failed: (title: string) => `VibeField didn't update ${title}. Nothing changed.`,
  note: "Plugins look for updates when you open Plugins. Updates never install on their own. An update that removes an object, or that can do more, asks first.",
} as const;

/** The update card (MK-UC; DESIGN.md §9 "Updates", James's pick on the board, 2026-11-12 06:08:01Z: "Yes: show the
 * card when an update asks for more"), ‹draft› for his eye: the install card's own, its ask and its lead changed;
 * where it updates is this desktop alone (the reconciler installs only a missing plugin). */
export const UPDATE_CARD_WORDS = {
  ask: (title: string) => `Update ${title}?`,
  can: "This version can also:",
  here: (onMac: boolean) => (onMac ? "It updates on this Mac." : "It updates on this PC."),
  missing: (objects: string) => `${objects} objects on your desks will draw as missing.`,
  confirm: "Update",
} as const;

/** Names said as a list is: "Clock", "Clock and Ruler", "Clock, Calendar and Ruler" (MK's). */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** Remove… and its two questions (MK-4f; DESIGN.md §9 "Installed, off and Remove…", ruled with MK-E10's change and
 * MK-O4's ‹draft› sentences): §9's words, ‹this desktop› said as the card says it ("this Mac", MK's), one other
 * desktop said as one ("mini removes …", MK's, ‹draft›), and the refusal in the switches' pattern (MK's, ‹draft›).
 * "‹plugin›" is the installed plugin's title. */
export const REMOVE_WORDS = {
  act: "Remove…",
  ask: (title: string) => `Remove ${title}?`,
  kept: "Its settings and data stay on your desktops, so installing it again brings them back.",
  missing: (objects: string) =>
    `${objects} objects on your desks draw as missing on your desktops until then.`,
  confirm: "Remove",
  further: "Remove it and its data…",
  askData: (title: string) => `Remove ${title} and its data?`,
  deletes: (here: string) => `This deletes its settings and data on ${here}. It can't be undone.`,
  others: (desktops: readonly string[], title: string) =>
    desktops.length === 1
      ? `${listNames(desktops)} removes ${title} too, and keeps its copy of its data.`
      : `${listNames(desktops)} remove ${title} too, and keep their copy of its data.`,
  confirmData: "Remove data",
  cancel: "Cancel",
  /** ‹this desktop›, as the install card says it */
  here: (onMac: boolean) => (onMac ? "this Mac" : "this PC"),
  refused: "Couldn't remove it. Try again.",
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

/** The day a release was published, as an update's row says it: "Nov 7" (MK-UC's UC-C). */
export function releaseDay(at: number): string {
  const day = new Date(at);
  return `${MONTHS[day.getMonth()]} ${day.getDate()}`;
}
