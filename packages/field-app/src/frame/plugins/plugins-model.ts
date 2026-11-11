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
} from "./plugins-words";

// THE PLUGINS POPUP'S MODEL (MK-4a; DESIGN.md §8 "Plugins — the frame's second
// popup"): its size in a window (MK-E1), what Discover and Updates show for
// each state of the read, the foot's sentence, Installed's rows from the
// registry snapshot the window already holds, and (MK-4c) a plugin's page, read
// only, and the walk of Installed's hot row. Pure: the controller and the tests
// read the same functions.

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
 * is, for a plugin's own. `key` tells powers apart and is never shown. */
export interface PagePower {
  readonly key: string;
  readonly words: string;
  readonly under: string | null;
  readonly whose: string | null;
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
  /** What it can do: each power it holds */
  readonly powers: readonly PagePower[];
  /** said under What it can do when it holds none; null when it holds any, named or not */
  readonly nothing: string | null;
  /** Made by; null when the window can name no maker */
  readonly madeBy: string | null;
  readonly version: string;
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

/** What it can do: each power it holds (`grantedCapabilities`), never by its
 * id (§9 "The powers' plain words"). A core power in its plain words, the Mac's
 * note under it on a Mac; a plugin's own power by the title and description its
 * declaring plugin wrote, and whose it is; one whose declaring plugin is not
 * installed here, by MK's words. Powers it asked for and does not hold come
 * back with their switches (MK-4c2). */
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
  const powers: PagePower[] = [];
  for (const id of record.grantedCapabilities) {
    const core = pluginPowerWords(id, { onMac });
    if (core !== undefined) {
      const entry: PluginPowerWords = PLUGIN_POWER_WORDS[id as PluginPowerId];
      powers.push({
        key: id,
        words: core,
        under: onMac && entry.macNote !== undefined ? entry.macNote : null,
        whose: null,
      });
      continue;
    }
    const own = declared.get(id);
    if (own !== undefined) {
      powers.push({
        key: id,
        words: own.title,
        under: own.description,
        whose: pluginOwnPowerLine(own.by.title, own.by.id === record.id),
      });
    } else if (id.startsWith("x.")) {
      powers.push({ key: id, words: PAGE_WORDS.ownUnknown, under: null, whose: null });
    }
    // any other id is no power the page can say, and an id is never shown
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
  return {
    id: record.id,
    title: record.title,
    ...sourceOf(record, listed),
    summary: record.source === "registry" ? (listed.get(record.id)?.summary ?? null) : null,
    adds: addsOf(record),
    powers,
    // "nothing" is decided by what it holds, not by what the page can say: a held power this build
    // cannot name is not said, and the page never says it holds none (VF-PM 18:13:11Z, 1)
    nothing:
      record.grantedCapabilities.length > 0
        ? null
        : objects > 0
          ? PAGE_WORDS.nothing
          : PAGE_WORDS.nothingNoObject,
    madeBy: madeByOf(record, listed),
    version: record.version,
  };
}
