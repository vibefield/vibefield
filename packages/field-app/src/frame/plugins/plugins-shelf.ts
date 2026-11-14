import type {
  PluginRecord,
  PluginRegistrySnapshot,
  PluginsCatalog,
  PluginsCatalogEntry,
  RegistryListing,
} from "@vibefield/contracts";
import type { PageLine, PluginPage } from "./plugins-model";
import { INSTALLED_LINE, PAGE_WORDS, SHELF_WORDS, SOURCE_WORDS } from "./plugins-words";

// DISCOVER'S SHELF (MK-4e; DESIGN.md §8 "Plugins — the frame's second popup", Discover, and §9 "The
// popup"'s MK-4e block): the sets the plugin list held offers, read from the catalog the popup
// already read and the registry snapshot the window already holds. The featured set first while no
// words are typed, then the sets VibeField publishes, then, while community plugins are on, the
// community's; a plugin the list holds with no listing is not shown (MK-1). The shelf stands before
// its pictures (main's plugin scheme, MK-E9's second half) and its categories (the pegboard's
// names, MK-4d). A set this desktop does not have opens a page read from the list alone, with no
// powers: the list carries none, and the install card says them (MK-O2). Pure: the controller and
// the tests read the same functions. Nothing here asks fieldd anything.

/** The grid (§8, MK-4e): columns at least 200 wide, 12 apart, the body padded 16. */
export const SHELF_TILE_MIN = 200;
export const SHELF_GAP = 12;
export const SHELF_PAD = 16;

/** How many columns fit a popup this wide: four in the full 960, never fewer than one. */
export function shelfColumns(width: number): number {
  const fit = Math.floor((width - 2 * SHELF_PAD + SHELF_GAP) / (SHELF_TILE_MIN + SHELF_GAP));
  return Math.max(1, fit);
}

/** A tile's act, as words (§8 "A tile"): this desktop has it, it doesn't, or the list says it can't
 * run here. */
export type TileAct = "install" | "installed" | "needs-newer";

export interface ShelfTile {
  readonly id: string;
  readonly title: string;
  /** the listing's summary; null when it has none */
  readonly summary: string | null;
  /** the mat's count, "3 objects"; null for a set with no object */
  readonly count: string | null;
  /** the source pill's word (§8 "The plugin source badge") */
  readonly source: string;
  /** "Community", beside a community set's publisher */
  readonly community: boolean;
  readonly act: TileAct;
  /** "Has Watch": the object typed words found it by; null otherwise */
  readonly has: string | null;
}

export interface Shelf {
  /** the featured set, its row whole, while no words are typed; null otherwise */
  readonly featured: ShelfTile | null;
  /** the rest, in the shelf's order */
  readonly tiles: readonly ShelfTile[];
  /** said in the body when typed words found no set */
  readonly none: string | null;
  /** said at the results' end while community plugins are off and the list holds community sets */
  readonly communityOff: string | null;
}

/** Every set the shelf walks, in the order the keys walk it: the featured tile, then the grid. */
export function shelfOrder(shelf: Shelf): readonly ShelfTile[] {
  return shelf.featured === null ? shelf.tiles : [shelf.featured, ...shelf.tiles];
}

/** Whether a held list shows a shelf: one set to show, or typed words to answer. A held list with
 * neither says its count, as before the shelf (§8 "Its states, in the body", corrected at MK-4e).
 */
export function shelfShows(shelf: Shelf): boolean {
  return shelf.featured !== null || shelf.tiles.length > 0 || shelf.none !== null;
}

/** A listed set's pill from the list alone (§8 "The plugin source badge"; item 321): "VibeField",
 * or its publisher's name with "Community" beside it, or "Community" alone when the list names
 * none. */
function listedSource(entry: PluginsCatalogEntry): { source: string; community: boolean } {
  if (entry.listedAs === "vibefield") return { source: SOURCE_WORDS.vibefield, community: false };
  const name = entry.listing?.publisherName;
  return name === undefined
    ? { source: SOURCE_WORDS.community, community: false }
    : { source: name, community: true };
}

/** A tile's pill: a set this desktop has wears its row's pill when its record is not the list's
 * (Built in, Development, Sideloaded); otherwise the list's. */
function tileSource(
  entry: PluginsCatalogEntry,
  record: PluginRecord | undefined,
): { source: string; community: boolean } {
  if (record === undefined || record.source === "registry") return listedSource(entry);
  return { source: SOURCE_WORDS[record.source], community: false };
}

function typed(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
}

/** Whether a listing holds every typed word in its title, its summary or its objects' labels
 * (MK-D4), and the object it was found by, when a word is in no title and no summary: "watch" finds
 * Simulators by its Watch. `undefined` when it does not hold them. */
function found(
  listing: RegistryListing,
  words: readonly string[],
): { has: string | null } | undefined {
  const own = `${listing.title}\n${listing.summary ?? ""}`.toLowerCase();
  const labels = listing.objects.map((object) => object.label);
  const all = [own, ...labels.map((label) => label.toLowerCase())].join("\n");
  if (!words.every((word) => all.includes(word))) return undefined;
  const by = words.find((word) => !own.includes(word));
  if (by === undefined) return { has: null };
  return { has: labels.find((label) => label.toLowerCase().includes(by)) ?? null };
}

/** A catalog entry that carries a listing: the only kind the shelf shows (MK-1). */
type Listed = PluginsCatalogEntry & { readonly listing: RegistryListing };

const isListed = (entry: PluginsCatalogEntry): entry is Listed => entry.listing !== undefined;

function tileOf(entry: Listed, record: PluginRecord | undefined, has: string | null): ShelfTile {
  const objects = entry.listing.objects.length;
  return {
    id: entry.id,
    title: entry.listing.title,
    summary: entry.listing.summary ?? null,
    count: objects > 0 ? SHELF_WORDS.count(objects) : null,
    ...tileSource(entry, record),
    act: record !== undefined ? "installed" : entry.compatible ? "install" : "needs-newer",
    has: has === null ? null : SHELF_WORDS.has(has),
  };
}

/** Discover's shelf from the list held (§8 "Discover", MK-4e). `community`: whether community
 * plugins are on, so their sets join after VibeField's; off, they are neither shown nor searched,
 * and the results say so. */
export function discoverShelf(
  catalog: PluginsCatalog,
  snapshot: PluginRegistrySnapshot | null,
  query: string,
  community: boolean,
): Shelf {
  const records = new Map((snapshot?.plugins ?? []).map((record) => [record.id, record]));
  const byTitle = (a: Listed, b: Listed): number => a.listing.title.localeCompare(b.listing.title);
  const listed = catalog.plugins.filter(isListed);
  const shown = [
    ...listed.filter((entry) => entry.listedAs === "vibefield").sort(byTitle),
    ...(community ? listed.filter((entry) => entry.listedAs === "community").sort(byTitle) : []),
  ];
  const words = typed(query);
  const hidden = !community && listed.some((entry) => entry.listedAs === "community");
  if (words.length === 0) {
    const pick = catalog.featured.find((id) => shown.some((entry) => entry.id === id));
    const tiles = shown.map((entry) => tileOf(entry, records.get(entry.id), null));
    return {
      featured: tiles.find((tile) => tile.id === pick) ?? null,
      tiles: tiles.filter((tile) => tile.id !== pick),
      none: null,
      communityOff: null,
    };
  }
  const tiles: ShelfTile[] = [];
  for (const entry of shown) {
    const match = found(entry.listing, words);
    if (match !== undefined) tiles.push(tileOf(entry, records.get(entry.id), match.has));
  }
  return {
    featured: null,
    tiles,
    none: tiles.length === 0 ? SHELF_WORDS.none(query) : null,
    communityOff: hidden ? SHELF_WORDS.communityOff : null,
  };
}

export type ShelfKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export function isShelfKey(key: string): key is ShelfKey {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

/** The hot tile after a key (§8 "Keys", MK-4e): ← → one tile, ↑ ↓ one row of `columns`, from the
 * featured tile (its row whole) to the grid's first and back; held at the first tile and the last.
 * `featured`: whether the walk's first tile is the featured one. */
export function walkShelf(
  at: number,
  key: ShelfKey,
  count: number,
  columns: number,
  featured: boolean,
): number {
  if (count <= 0) return 0;
  const last = count - 1;
  const here = Math.min(Math.max(0, at), last);
  if (key === "ArrowRight") return Math.min(last, here + 1);
  if (key === "ArrowLeft") return Math.max(0, here - 1);
  const first = featured ? 1 : 0;
  if (featured && here === 0) return key === "ArrowDown" ? Math.min(last, 1) : 0;
  const cell = here - first;
  if (key === "ArrowDown") return cell + columns <= last - first ? here + columns : here;
  if (cell - columns >= 0) return here - columns;
  return featured ? 0 : here;
}

/** What a listed set adds, from its listing: each object by its label, then its tools and its
 * service when the listing counts any, or "No objects". Its tools are said with their count, the
 * listing's own (`RegistryListing.tools`), as an installed plugin's page says its own (James's
 * MK-O14 pick B; `plugins-model.ts`, `addsOf`). */
function listedAdds(listing: RegistryListing): PageLine[] {
  const tools = listing.tools ?? 0;
  const adds: PageLine[] = [
    ...listing.objects.map((object) => ({ key: `object:${object.type}`, words: object.label })),
    ...(tools > 0 ? [{ key: "tools", words: PAGE_WORDS.tools(tools) }] : []),
    ...((listing.services ?? 0) > 0 ? [{ key: "service", words: PAGE_WORDS.service }] : []),
  ];
  return adds.length > 0 ? adds : [{ key: "none", words: INSTALLED_LINE.noObject(null) }];
}

/** The page of a set this desktop does not have (§8 "Read only first", corrected at MK-4e): read
 * from the list held alone. Its own words are the listing's summary; Made by is the list's word for
 * its maker; Version is the list's latest. It says no power, for the list carries none: the install
 * card says them. null for an entry with no listing, which the shelf never shows. */
export function listedPage(entry: PluginsCatalogEntry): PluginPage | null {
  const listing = entry.listing;
  if (listing === undefined) return null;
  const madeBy = entry.listedAs === "vibefield" ? SOURCE_WORDS.vibefield : listing.publisherName;
  return {
    id: entry.id,
    title: listing.title,
    ...listedSource(entry),
    summary: listing.summary ?? null,
    adds: listedAdds(listing),
    powers: [],
    nothing: null,
    madeBy: madeBy ?? null,
    version: entry.latest.version,
    onOff: null,
    powersLive: false,
    // O3-D's line for a plugin held while community plugins are off: a set this desktop doesn't
    // have is held by nothing, so its page says none
    held: null,
    readOnly: null,
    elsewhere: null,
    offLine: null,
    settings: null,
    installed: false,
  };
}
