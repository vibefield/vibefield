import {
  PLUGIN_POWER_WORDS,
  type PluginPowerId,
  type PluginPowerWords,
  type PluginRecord,
  type PluginRegistrySnapshot,
  type PluginSource,
  type PluginsCatalog,
  pluginOwnPowerLine,
  pluginPowerWords,
} from "@vibefield/contracts";
import {
  CATALOG_FOOT,
  hasWords,
  INSTALLED_LINE,
  installedFootWords,
  listCount,
  listTime,
  NO_LIST,
  PAGE_WORDS,
  READING,
  SOURCE_WORDS,
  SWITCH_WORDS,
} from "./plugins-words";

// THE PLUGINS POPUP'S MODEL (MK-4a; DESIGN.md §8 "Plugins — the frame's second
// popup"): its size in a window (MK-E1), what Discover and Updates show for
// each state of the read, the foot's sentence, Installed's rows from the
// registry snapshot the window already holds, (MK-4c) a plugin's page and the
// walk of Installed's hot row, and (MK-4c2a) which plugins carry switches here
// and where each switch stands. Pure: the controller and the tests read the same
// functions.

/** The popup as drawn (MK-D2): 960 × 640. */
export const PLUGINS_SIZE = { width: 960, height: 640 } as const;
/** Clear of each side of the window (MK-E1), as the Peek's 24. */
export const PLUGINS_SIDE_CLEAR = 24;
/** Above it: the drag strip's 52, and 8 (MK-E1). */
export const PLUGINS_TOP_CLEAR = 60;
/** Below it: the line's 72, and 8 (MK-E1). */
export const PLUGINS_FOOT_CLEAR = 80;

export interface PluginsLayout {
  readonly width: number;
  readonly height: number;
  /** its top, centred in the band between the head and the line */
  readonly top: number;
}

/** The popup's size and place in a window (or a plate) of this size (MK-E1):
 * min(960, W − 48) × min(640, H − 140), centred in the band [60, H − 80].
 * At the default 1180 × 780 it stands at 60…700, 110 in from each side. */
export function pluginsLayout(width: number, height: number): PluginsLayout {
  const w = Math.max(0, Math.min(PLUGINS_SIZE.width, width - 2 * PLUGINS_SIDE_CLEAR));
  const band = Math.max(0, height - PLUGINS_TOP_CLEAR - PLUGINS_FOOT_CLEAR);
  const h = Math.min(PLUGINS_SIZE.height, band);
  return { width: w, height: h, top: PLUGINS_TOP_CLEAR + (band - h) / 2 };
}

export type PluginsTab = "discover" | "installed" | "updates";
export const PLUGINS_TABS: readonly PluginsTab[] = ["discover", "installed", "updates"];

/** Where the window's read of the plugin list stands: no answer yet, a list
 * fieldd answered with (held or not), or neither door answered. */
export type PluginsRead =
  | { readonly kind: "asking" }
  | { readonly kind: "answered"; readonly catalog: PluginsCatalog }
  | { readonly kind: "away" };

/** What Discover and Updates show in their body (§8 "Its states, in the
 * body"). MK-4a stops before Discover's shelf and Updates' rows, so a held
 * list is said by its count. */
export type ShelfState =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "reading" }
  | { readonly kind: "no-list"; readonly words: string }
  | { readonly kind: "counted"; readonly words: string }
  | { readonly kind: "away" };

/** A list is held when fieldd says when it was read. */
function held(catalog: PluginsCatalog): boolean {
  return catalog.checkedAt !== null;
}

export function catalogObjects(catalog: PluginsCatalog): number {
  return catalog.plugins.reduce((sum, entry) => sum + (entry.listing?.objects.length ?? 0), 0);
}

function countWords(catalog: PluginsCatalog): string {
  return listCount(catalog.plugins.length, catalogObjects(catalog));
}

export function shelfState(read: PluginsRead, reading: boolean): ShelfState {
  if (read.kind === "asking") return { kind: "reading" };
  if (read.kind === "away") return { kind: "away" };
  const { catalog } = read;
  if (catalog.state === "unconfigured") return { kind: "unconfigured" };
  if (held(catalog)) return { kind: "counted", words: countWords(catalog) };
  if (reading || catalog.state === "unread" || catalog.state === "reading") {
    return { kind: "reading" };
  }
  if (catalog.state === "unreachable") return { kind: "no-list", words: NO_LIST.unreachable };
  if (catalog.state === "refused") return { kind: "no-list", words: NO_LIST.refused };
  return { kind: "counted", words: countWords(catalog) };
}

export interface FootSentence {
  readonly words: string;
  /** said in the attention ink (§2.5): a list past its date */
  readonly attention: boolean;
}

/** Discover's and Updates' foot: what the tab holds and when the list was
 * read (§9 "Reading the list"); none while nothing was read. */
export function catalogFoot(read: PluginsRead, reading: boolean, now: number): FootSentence | null {
  const say = (words: string, attention = false): FootSentence => ({ words, attention });
  if (read.kind === "asking") return say(READING);
  if (read.kind === "away") return null;
  const { catalog } = read;
  if (catalog.state === "unconfigured") return null;
  if (catalog.checkedAt === null) {
    if (reading || catalog.state === "unread" || catalog.state === "reading") return say(READING);
    if (catalog.state === "unreachable") return say(NO_LIST.unreachable);
    if (catalog.state === "refused") return say(NO_LIST.refused);
    return say(countWords(catalog));
  }
  const when = listTime(catalog.checkedAt, now);
  if (reading || catalog.state === "reading") return say(CATALOG_FOOT.reading(when));
  if (catalog.state === "unreachable") return say(CATALOG_FOOT.unreachable(when));
  if (catalog.state === "refused") return say(CATALOG_FOOT.refused);
  if (catalog.state === "stale") return say(CATALOG_FOOT.stale, true);
  return say(CATALOG_FOOT.ready(countWords(catalog), when));
}

export interface InstalledRow {
  readonly id: string;
  readonly title: string;
  /** the source pill's word (§8 "The plugin source badge") */
  readonly source: string;
  /** "Community", beside a community plugin's publisher */
  readonly community: boolean;
  readonly line: string;
  /** its one switch: on or off; null when it has none here (MK-4c2a) */
  readonly onOff: boolean | null;
}

/** What the signed list says of a plugin: whether VibeField publishes it, its
 * publisher's name as a person reads it (`listing.publisherName`), and its own
 * words (`listing.summary`). */
interface Listed {
  readonly listedAs: "vibefield" | "community";
  readonly name: string | undefined;
  readonly summary: string | undefined;
}

/** The signed list held, by plugin id: the one source of a registry plugin's
 * pill, its maker and its own words (item 321). */
function listedFrom(catalog: PluginsCatalog | null): ReadonlyMap<string, Listed> {
  return new Map<string, Listed>(
    (catalog?.plugins ?? []).map((entry) => [
      entry.id,
      {
        listedAs: entry.listedAs,
        name: entry.listing?.publisherName,
        summary: entry.listing?.summary,
      },
    ]),
  );
}

/** A registry plugin's pill (§8 "The plugin source badge"). Every word in it
 * comes from the signed list held, or is the fixed word "Community"; nothing
 * is read from the installed record, which a folder can say of itself (item
 * 321). Listed as VibeField's: "VibeField" alone. Listed as a community
 * plugin: the list's name for its publisher, with "Community" beside it, or
 * "Community" alone when the list names none. Not in the list held (none held,
 * still being read, or no entry): "Community" alone. */
function sourceOf(
  record: PluginRecord,
  listed: ReadonlyMap<string, Listed>,
): { source: string; community: boolean } {
  const from: PluginSource = record.source;
  if (from !== "registry") return { source: SOURCE_WORDS[from], community: false };
  const entry = listed.get(record.id);
  if (entry?.listedAs === "vibefield") return { source: SOURCE_WORDS.vibefield, community: false };
  if (entry?.listedAs === "community" && entry.name !== undefined) {
    return { source: entry.name, community: true };
  }
  return { source: SOURCE_WORDS.community, community: false };
}

/** Whether a plugin brings tools: tools for your agents, its MCP tools
 * (`contributions.mcp.tools`). A command is a palette entry, not a tool (VF-PM
 * 2026-11-11 16:05:52Z): MK-4a's line counted commands, and Installed's line
 * and the page now say the same of one plugin. */
export function bringsTools(record: PluginRecord): boolean {
  return (record.contributions.mcp?.tools.length ?? 0) > 0;
}

/** Whether a plugin runs a service of its own. */
function runsService(record: PluginRecord): boolean {
  return record.service !== "none";
}

/** Whether a plugin's switches stand in Plugins (MK-4c2a; VF-PM 2026-11-11
 * 18:36:34Z, 2): a Built in or Development plugin's alone. A record's source and
 * id are what its folder can say (item 321), so a plugin from the plugin list —
 * whatever the list held says of it, a "VibeField" listing included — and a
 * Sideloaded one are read only here. Settings → Plugins keeps its switches
 * until MK-5. The row, the page and every power's switch ask this one function. */
export function controlsHere(record: PluginRecord): boolean {
  return record.source === "bundled" || record.source === "dev-linked";
}

/** A switch's key, never shown: a plugin's one switch, or one of its powers'.
 * The controller keeps what is under way and what fieldd refused by it. */
export const switchKey = {
  one: (id: string): string => `one:${id}`,
  power: (id: string, capability: string): string => `power:${id}:${capability}`,
} as const;

/** A switch fieldd refused to move: whose it is (a power's, or the plugin's
 * own when `capability` is null), and the way it was being turned. */
export interface Refusal {
  readonly id: string;
  readonly capability: string | null;
  readonly turningOn: boolean;
}

/** Whether a snapshot shows a refused switch the way it was being turned, so
 * its refusal is stale and goes (VF-PM 2026-11-11 19:05:12Z, 4; §8 "Installed",
 * MK-4c2a's rider). A plugin gone from the snapshot, or a switch gone from its
 * page, keeps nothing to say either. */
export function refusalStale(refusal: Refusal, snapshot: PluginRegistrySnapshot): boolean {
  const record = snapshot.plugins.find((plugin) => plugin.id === refusal.id);
  if (record === undefined) return true;
  const shown =
    refusal.capability === null
      ? switchable(record)
        ? record.enabled
        : undefined
      : powerSwitchOf(record, refusal.capability)?.on;
  return shown === undefined || shown === refusal.turningOn;
}

/** Whether its one switch stands: switches here, and a state a switch turns
 * (on or off; one that isn't working has none, as Settings → Plugins' row). */
export function switchable(record: PluginRecord): boolean {
  return controlsHere(record) && (record.state === "enabled" || record.state === "disabled");
}

/** A power's switch on a plugin's page (MK-4c2a; §8 "Its switches"): what it
 * shows (`on`) and whether it takes a press (`live`). */
export interface PowerSwitch {
  readonly on: boolean;
  readonly live: boolean;
}

/** Whether the page can say a power: a core power in its plain words, or one
 * a plugin names (`x.`), by its declaring plugin's words or MK's. An id that is
 * neither is never said, so it never has a switch. */
function sayable(id: string): boolean {
  return pluginPowerWords(id, { onMac: false }) !== undefined || id.startsWith("x.");
}

/** The ONE read of a power's switch (VF-PM 2026-11-11 19:05:12Z, 3), which the
 * page and the controller both ask: null when the page gives it no switch — no
 * switches here, a power it never asked for or the page can't say, or one it
 * can't have here (any reason but `revoked`). `on` is what fieldd grants: what
 * it holds while on, and while off (when fieldd grants it nothing) what it would
 * hold once on, every power it asked for less one taken back (contracts
 * `computeEffectiveGrants`). `live` while it is on and working. */
export function powerSwitchOf(record: PluginRecord, capability: string): PowerSwitch | null {
  if (!controlsHere(record) || !sayable(capability)) return null;
  if (!record.requestedCapabilities.includes(capability)) return null;
  const denied = record.deniedCapabilities.find((entry) => entry.capability === capability);
  if (denied !== undefined && denied.reason !== "revoked") return null;
  return {
    on: record.enabled ? record.grantedCapabilities.includes(capability) : denied === undefined,
    live: record.enabled && record.state === "enabled",
  };
}

function lineOf(record: PluginRecord): string {
  const objects = record.contributions.objects.length;
  const builtIn = record.source === "bundled";
  if (record.state === "invalid" || record.state === "incompatible") {
    return INSTALLED_LINE.broken(record.title);
  }
  if (!record.enabled) return objects > 0 ? INSTALLED_LINE.off : INSTALLED_LINE.offNoObject;
  if (objects === 0) {
    if (builtIn) return INSTALLED_LINE.builtInNoObject;
    return INSTALLED_LINE.noObject(hasWords(runsService(record), bringsTools(record)));
  }
  const set = INSTALLED_LINE.set(objects, record.version);
  return builtIn ? `${set} · ${INSTALLED_LINE.builtIn}` : set;
}

/** Whether a plugin holds every typed word, in its title or in one of its
 * objects' names — its title or its label on the pegboard (Q6, ruled at
 * MK's lean 2026-11-11 11:40:58Z; §8: search finds a set by its objects). */
export function installedMatches(record: PluginRecord, query: string): boolean {
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
  if (words.length === 0) return true;
  const names = [
    record.title,
    ...record.contributions.objects.flatMap((object) => [object.title, object.tray?.label ?? ""]),
  ]
    .join("\n")
    .toLowerCase();
  return words.every((word) => names.includes(word));
}

/** Installed's rows: every plugin this desktop has that holds the typed
 * words, Built in first, then by title (§8 "Installed"). */
export function installedRows(
  snapshot: PluginRegistrySnapshot,
  catalog: PluginsCatalog | null,
  query = "",
): InstalledRow[] {
  const listed = listedFrom(catalog);
  return snapshot.plugins
    .filter((record) => installedMatches(record, query))
    .sort((a, b) => {
      const built = Number(b.source === "bundled") - Number(a.source === "bundled");
      return built !== 0 ? built : a.title.localeCompare(b.title);
    })
    .map((record) => ({
      id: record.id,
      title: record.title,
      ...sourceOf(record, listed),
      line: lineOf(record),
      onOff: switchable(record) ? record.enabled : null,
    }));
}

/** Installed's foot: "6 plugins, 14 objects · 1 off" (§9). */
export function installedFoot(snapshot: PluginRegistrySnapshot): string {
  const objects = snapshot.plugins.reduce((n, p) => n + p.contributions.objects.length, 0);
  const off = snapshot.plugins.filter((p) => !p.enabled).length;
  return installedFootWords(snapshot.plugins.length, objects, off);
}

/** Installed's hot row after ↑ or ↓: one step, held at the first row and the
 * last (§8 "Installed", drawn at MK-4c). */
export function walkHot(at: number, key: "ArrowUp" | "ArrowDown", rows: number): number {
  if (rows <= 0) return 0;
  return Math.min(rows - 1, Math.max(0, key === "ArrowDown" ? at + 1 : at - 1));
}

/** One line of What it adds: an object, its tools or its service. `key`
 * tells lines apart and is never shown. */
export interface PageLine {
  readonly key: string;
  readonly words: string;
}

/** One power on a plugin's page: what it lets the plugin do; under it, a core
 * power's Mac note or a plugin's own power's description; and whose power it
 * is, for a plugin's own. `key` is the power's id: it tells powers apart and
 * names it to fieldd, and is never shown. MK-4c2a: its switch, on or off (null:
 * none), and why it can't have it here. */
export interface PagePower {
  readonly key: string;
  readonly words: string;
  readonly under: string | null;
  readonly whose: string | null;
  readonly switch: boolean | null;
  readonly cant: string | null;
}

/** A plugin's page, read only (MK-4c; DESIGN.md §8 "Read only first", §9
 * MK-4c's block). */
export interface PluginPage {
  readonly id: string;
  readonly title: string;
  /** the source pill's word, as Installed's row says it */
  readonly source: string;
  readonly community: boolean;
  /** its own words: the signed list's summary, for a registry plugin in the
   * list held alone; null otherwise */
  readonly summary: string | null;
  /** What it adds: each object, then its tools and its service, or "No objects" */
  readonly adds: readonly PageLine[];
  /** What it can do: each power it holds; with switches here, each it asked for */
  readonly powers: readonly PagePower[];
  /** said under What it can do when it holds none; null when it holds any, named or not */
  readonly nothing: string | null;
  /** Made by; null when the window can name no maker */
  readonly madeBy: string | null;
  readonly version: string;
  /** its one switch: on or off; null when it has none here (MK-4c2a) */
  readonly onOff: boolean | null;
  /** whether its powers' switches take a press: switches here, and it is on */
  readonly powersLive: boolean;
  /** said where its switches would stand, when it has none here */
  readonly readOnly: string | null;
  /** said under its act, for a Built in plugin with switches: they reach your other desktops */
  readonly elsewhere: string | null;
  /** said under What it can do's head while it is off and its powers have switches */
  readonly offLine: string | null;
}

/** Made by (§9 MK-4c's block): a Built in plugin's sentence; for a registry
 * plugin, the signed list's word for its maker, never what its folder says of
 * itself (item 321: `record.registry`'s display copies are not read); none for
 * a Development or Sideloaded plugin, or a registry one the list held does not
 * name. */
function madeByOf(record: PluginRecord, listed: ReadonlyMap<string, Listed>): string | null {
  if (record.source === "bundled") return PAGE_WORDS.builtIn;
  if (record.source !== "registry") return null;
  const entry = listed.get(record.id);
  if (entry?.listedAs === "vibefield") return SOURCE_WORDS.vibefield;
  if (entry?.listedAs === "community" && entry.name !== undefined) return entry.name;
  return null;
}

/** What it adds: each object by its pegboard label (`tray.label`), or by its
 * title when it hangs nowhere; then its tools and its service; "No objects"
 * with none of them. Where each hangs waits for the pegboard's names (MK-4d). */
function addsOf(record: PluginRecord): PageLine[] {
  const adds: PageLine[] = [
    ...record.contributions.objects.map((object) => ({
      key: `object:${object.type}`,
      words: object.tray?.label ?? object.title,
    })),
    ...(bringsTools(record) ? [{ key: "tools", words: PAGE_WORDS.tools }] : []),
    ...(runsService(record) ? [{ key: "service", words: PAGE_WORDS.service }] : []),
  ];
  return adds.length > 0 ? adds : [{ key: "none", words: INSTALLED_LINE.noObject(null) }];
}

/** A power's words on a page, never its id (§9 "The powers' plain words"): a
 * core power in its plain words, the Mac's note under it on a Mac; a plugin's
 * own power by the title and description its declaring plugin wrote, and whose
 * it is; one whose declaring plugin is not installed here, by MK's words. Any
 * other id is no power the page can say: null, and it is not said. */
function powerWords(
  id: string,
  record: PluginRecord,
  declared: ReadonlyMap<string, { title: string; description: string; by: PluginRecord }>,
  onMac: boolean,
): Pick<PagePower, "key" | "words" | "under" | "whose"> | null {
  const core = pluginPowerWords(id, { onMac });
  if (core !== undefined) {
    const entry: PluginPowerWords = PLUGIN_POWER_WORDS[id as PluginPowerId];
    return {
      key: id,
      words: core,
      under: onMac && entry.macNote !== undefined ? entry.macNote : null,
      whose: null,
    };
  }
  const own = declared.get(id);
  if (own !== undefined) {
    return {
      key: id,
      words: own.title,
      under: own.description,
      whose: pluginOwnPowerLine(own.by.title, own.by.id === record.id),
    };
  }
  if (id.startsWith("x.")) {
    return { key: id, words: PAGE_WORDS.ownUnknown, under: null, whose: null };
  }
  return null;
}

/** What it can do. A plugin with no switches here lists each power it holds
 * (`grantedCapabilities`), read only (MK-4c). One with switches here (MK-4c2a,
 * §8 "Its switches") lists each power it asked for: its switch as
 * `powerSwitchOf` reads it, and for one it can't have here (any reason but
 * `revoked`), no switch and why. */
function powersOf(
  record: PluginRecord,
  snapshot: PluginRegistrySnapshot,
  onMac: boolean,
): PagePower[] {
  const declared = new Map<string, { title: string; description: string; by: PluginRecord }>();
  for (const plugin of snapshot.plugins) {
    for (const power of plugin.contributions.capabilities) {
      declared.set(power.id, { title: power.title, description: power.description, by: plugin });
    }
  }
  const switches = controlsHere(record);
  const ids = switches ? record.requestedCapabilities : record.grantedCapabilities;
  const powers: PagePower[] = [];
  for (const id of ids) {
    const said = powerWords(id, record, declared, onMac);
    if (said === null) continue;
    if (!switches) {
      powers.push({ ...said, switch: null, cant: null });
      continue;
    }
    const denied = record.deniedCapabilities.find((entry) => entry.capability === id);
    const cant =
      denied !== undefined && denied.reason !== "revoked" ? SWITCH_WORDS.cant[denied.reason] : null;
    powers.push({ ...said, switch: powerSwitchOf(record, id)?.on ?? null, cant });
  }
  return powers;
}

/** A plugin's page, from the registry snapshot the window holds and the plugin
 * list the popup already read: nothing here asks fieldd anything. */
export function pluginPage(
  record: PluginRecord,
  catalog: PluginsCatalog | null,
  snapshot: PluginRegistrySnapshot,
  onMac: boolean,
): PluginPage {
  const listed = listedFrom(catalog);
  const powers = powersOf(record, snapshot, onMac);
  const objects = record.contributions.objects.length;
  const switches = controlsHere(record);
  const onOff = switchable(record) ? record.enabled : null;
  const powerSwitches = powers.some((power) => power.switch !== null);
  // whether its powers' switches take a press: `powerSwitchOf`'s `live`, the same for each of them
  const live = powers.some((power) => powerSwitchOf(record, power.key)?.live === true);
  return {
    id: record.id,
    title: record.title,
    ...sourceOf(record, listed),
    summary: record.source === "registry" ? (listed.get(record.id)?.summary ?? null) : null,
    adds: addsOf(record),
    powers,
    // "nothing" is decided by the list the page reads, not by what it can say: a power this build cannot name is
    // not said, and the page never says it holds none (VF-PM 18:13:11Z, 1). With switches here, that list is
    // every power it asked for (MK-4c2a).
    nothing:
      (switches ? record.requestedCapabilities : record.grantedCapabilities).length > 0
        ? null
        : objects > 0
          ? PAGE_WORDS.nothing
          : PAGE_WORDS.nothingNoObject,
    madeBy: madeByOf(record, listed),
    version: record.version,
    onOff,
    powersLive: live,
    readOnly: switches ? null : SWITCH_WORDS.readOnly,
    // the install-set carries a Built in plugin's choices, never a Development one's (install-reconciler.ts:369)
    elsewhere:
      record.source === "bundled" && (onOff !== null || powerSwitches)
        ? SWITCH_WORDS.elsewhere
        : null,
    offLine: switches && !record.enabled && powerSwitches ? SWITCH_WORDS.off : null,
  };
}
