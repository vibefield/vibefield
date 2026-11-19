import { PluginsCatalog } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  CATALOG_FIXTURES,
  CATALOG_SHELF,
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_SNAPSHOT,
} from "../src/design-system/plugins-fixtures";
import type { PageLine } from "../src/frame/plugins/plugins-model";
import {
  categoriesMore,
  discoverShelf,
  isShelfKey,
  listedPage,
  type ShelfKey,
  shelfCategories,
  shelfColumns,
  shelfOrder,
  shelfShows,
  walkShelf,
} from "../src/frame/plugins/plugins-shelf";
import * as words from "../src/frame/plugins/plugins-words";

// MK-4e — Discover's shelf (DESIGN.md §8 "Plugins — the frame's second popup", Discover; §9 "The
// popup"'s MK-4e block): the sets the list held offers, in the shelf's order, the featured one
// first; search by title, summary and objects' labels; the walk of its hot tile; and the page of a
// set this desktop doesn't have, read from the list. Item 433: its categories, the pegboard's, by
// the board's names, and the sets a category chosen keeps. Pure: no window, no fieldd.

const titles = (catalog: PluginsCatalog, query = "", community = false): string[] => {
  const shelf = discoverShelf(catalog, PLUGINS_FIXTURE_SNAPSHOT, query, community);
  return shelfOrder(shelf).map((tile) => tile.title);
};

describe("the shelf's columns (§8, MK-4e)", () => {
  it("fits four 200 wide in the full 960, and never fewer than one", () => {
    expect(shelfColumns(960)).toBe(4);
    expect(shelfColumns(752)).toBe(3);
    expect(shelfColumns(240)).toBe(1);
    expect(shelfColumns(0)).toBe(1);
  });
});

describe("Discover's shelf from the list held (§8 'Discover', MK-4e)", () => {
  it("puts the featured set first, then VibeField's by title, and never one with no listing", () => {
    const shelf = discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "", false);
    expect(shelf.featured?.title).toBe("Brass & Glass");
    expect(shelf.tiles.map((tile) => tile.title)).toEqual(["Burndown", "Desk things"]);
    expect(shelf.none).toBeNull();
    expect(shelf.communityOff).toBeNull();
  });

  it("says each tile's act, count and source: Installed, Install, or a set that needs a newer VibeField", () => {
    const shelf = discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "", false);
    expect(shelf.featured).toEqual({
      id: "vibefield.brass-glass",
      title: "Brass & Glass",
      summary: "A barometer, a compass and a spirit level in brass, for the desk.",
      count: "3 objects",
      // the list's pill: this desktop doesn't have it (item 573: a Built in plugin is never listed, and
      // the made-up Brass & Glass stands only where a list names it)
      source: words.SOURCE_WORDS.vibefield,
      community: false,
      act: "install",
      has: null,
    });
    // a desktop that has it from the list says Installed, with the list's pill
    const had = discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_LISTED_SNAPSHOT, "", false).featured;
    expect([had?.act, had?.source]).toEqual(["installed", words.SOURCE_WORDS.vibefield]);
    const [burndown, things] = shelf.tiles;
    expect([burndown?.act, burndown?.count, burndown?.source]).toEqual([
      "needs-newer",
      "1 object",
      words.SOURCE_WORDS.vibefield,
    ]);
    expect([things?.act, things?.count, things?.source]).toEqual([
      "install",
      "4 objects",
      words.SOURCE_WORDS.vibefield,
    ]);
  });

  it("adds the community's sets after VibeField's only while community plugins are on", () => {
    expect(titles(CATALOG_SHELF)).toEqual(["Brass & Glass", "Burndown", "Desk things"]);
    expect(titles(CATALOG_SHELF, "", true)).toEqual([
      "Brass & Glass",
      "Burndown",
      "Desk things",
      "Kanban",
    ]);
    const kanban = shelfOrder(
      discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_LISTED_SNAPSHOT, "", true),
    ).find((tile) => tile.id === "acme.kanban");
    // the list's name for its maker, with Community beside it; this desktop has it
    expect([kanban?.source, kanban?.community, kanban?.act]).toEqual([
      "Acme Tools",
      true,
      "installed",
    ]);
  });

  it("finds a set by its title, its summary or an object's label, and says the object it was found by", () => {
    expect(titles(CATALOG_SHELF, "desk")).toEqual(["Brass & Glass", "Desk things"]);
    const ruler = discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "ruler", false);
    // no featured row while words are typed
    expect(ruler.featured).toBeNull();
    expect(ruler.tiles.map((tile) => [tile.title, tile.has])).toEqual([
      ["Desk things", words.SHELF_WORDS.has("Ruler")],
    ]);
    // a word its own words hold says no object
    expect(
      discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "barometer", false).tiles,
    ).toEqual([expect.objectContaining({ title: "Brass & Glass", has: null })]);
    // every word must be held
    expect(titles(CATALOG_SHELF, "clock brass")).toEqual([]);
  });

  it("says none was found, and while community plugins are off that their sets aren't searched", () => {
    const none = discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "  nothing here ", false);
    expect(none.none).toBe(words.SHELF_WORDS.none("nothing here"));
    expect(none.none).toBe("No plugin in the list matches “nothing here”.");
    expect(none.communityOff).toBe(words.SHELF_WORDS.communityOff);
    expect(shelfShows(none)).toBe(true);
    // with them on, or with none in the list, nothing is said of them
    expect(discoverShelf(CATALOG_SHELF, null, "board", true).communityOff).toBeNull();
    expect(discoverShelf(CATALOG_FIXTURES.ready, null, "nothing", false).communityOff).toBeNull();
  });

  it("shows no shelf for a held list with no set to show, which says its count as before", () => {
    const communityOnly = PluginsCatalog.parse({
      ...CATALOG_SHELF,
      featured: [],
      plugins: CATALOG_SHELF.plugins.filter((entry) => entry.listedAs === "community"),
    });
    const shows = (community: boolean): boolean =>
      shelfShows(discoverShelf(communityOnly, PLUGINS_FIXTURE_SNAPSHOT, "", community));
    expect(shows(false)).toBe(false);
    expect(shows(true)).toBe(true);
  });
});

/** The pegboard's names as the board's door hands them (MK-4d's names): each category's id and the
 * board's own name for it, in the board's order. Paper hangs no set the list holds. */
const BOARD: ReadonlyMap<string, string> = new Map([
  ["things", "Things"],
  ["paper", "Paper"],
  ["devices", "Devices"],
  ["tools", "Tools"],
]);

describe("Discover's categories (§8 'Discover', item 433; MK-D2)", () => {
  it("offers each category a shown set hangs under, by the board's own name, in the board's order", () => {
    expect(shelfCategories(CATALOG_SHELF, false, BOARD)).toEqual([
      { id: "things", label: "Things" },
      { id: "devices", label: "Devices" },
      { id: "tools", label: "Tools" },
    ]);
    // the board's order, never the list's, and the board's name, never the id
    const renamed = new Map([
      ["tools", "On the bench"],
      ["devices", "Devices"],
      ["things", "Things"],
    ]);
    expect(shelfCategories(CATALOG_SHELF, false, renamed)).toEqual([
      { id: "tools", label: "On the bench" },
      { id: "devices", label: "Devices" },
      { id: "things", label: "Things" },
    ]);
  });

  it("offers none with no board to read, none the board doesn't name, and none while words are typed", () => {
    expect(shelfCategories(CATALOG_SHELF, false, null)).toEqual([]);
    expect(shelfCategories(CATALOG_SHELF, false, new Map([["paper", "Paper"]]))).toEqual([]);
    expect(shelfCategories(CATALOG_SHELF, false, BOARD, "ruler")).toEqual([]);
    // spaces are no words
    expect(shelfCategories(CATALOG_SHELF, false, BOARD, "  ").map((c) => c.id)).toEqual([
      "things",
      "devices",
      "tools",
    ]);
    // a list with no set to show offers none
    expect(shelfCategories(CATALOG_FIXTURES.unconfigured, false, BOARD)).toEqual([]);
  });

  it("offers a community set's categories only while community plugins are on", () => {
    // Kanban, by other people, hangs its Board and Card under Things alone
    const communityOnly = PluginsCatalog.parse({
      ...CATALOG_SHELF,
      featured: [],
      plugins: CATALOG_SHELF.plugins.filter((entry) => entry.listedAs === "community"),
    });
    expect(shelfCategories(communityOnly, false, BOARD)).toEqual([]);
    expect(shelfCategories(communityOnly, true, BOARD)).toEqual([
      { id: "things", label: "Things" },
    ]);
  });

  it("keeps the sets one of whose objects hangs under the category chosen, in the shelf's order, with no featured row", () => {
    const under = (category: string, community = false, query = ""): string[] =>
      shelfOrder(
        discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, query, community, category),
      ).map((tile) => tile.title);
    const things = discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "", false, "things");
    expect(things.featured).toBeNull();
    expect(under("things")).toEqual(["Burndown", "Desk things"]);
    // the featured set too stands under its category, as a tile of the grid
    expect(under("devices")).toEqual(["Brass & Glass"]);
    expect(under("tools")).toEqual(["Desk things"]);
    // a community set joins after VibeField's while community plugins are on
    expect(under("things", true)).toEqual(["Burndown", "Desk things", "Kanban"]);
    // All is the shelf as it was
    expect(discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "", false, "")).toEqual(
      discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "", false),
    );
    // typed words search every set, whatever the category
    expect(under("devices", false, "ruler")).toEqual(["Desk things"]);
  });

  it("fades the end of the row where more categories lie past its width, and none while all show", () => {
    const at = (scrollLeft: number, clientWidth: number, scrollWidth: number) =>
      categoriesMore({ scrollLeft, clientWidth, scrollWidth });
    expect(at(0, 400, 400)).toBeNull();
    expect(at(0, 300, 400)).toBe("end");
    expect(at(50, 300, 400)).toBe("both");
    expect(at(100, 300, 400)).toBe("start");
    // a pixel's rounding is no more
    expect(at(1, 300, 302)).toBeNull();
  });
});

describe("the hot tile's walk (§8 'Keys', MK-4e)", () => {
  // the featured tile, then a grid of six in three columns: 1 2 3 / 4 5 6
  const walk = (at: number, key: ShelfKey): number => walkShelf(at, key, 7, 3, true);

  it("goes from the featured tile to the grid's first and back, a row at a time", () => {
    expect(walk(0, "ArrowDown")).toBe(1);
    expect(walk(1, "ArrowDown")).toBe(4);
    expect(walk(5, "ArrowUp")).toBe(2);
    expect(walk(3, "ArrowUp")).toBe(0);
    expect(walk(0, "ArrowUp")).toBe(0);
    // no tile under it: it stays
    expect(walk(4, "ArrowDown")).toBe(4);
  });

  it("goes one tile at a time sideways, held at the first and the last", () => {
    expect(walk(0, "ArrowLeft")).toBe(0);
    expect(walk(0, "ArrowRight")).toBe(1);
    expect(walk(3, "ArrowRight")).toBe(4);
    expect(walk(6, "ArrowRight")).toBe(6);
  });

  it("walks a grid with no featured tile, and nothing at all with no tile", () => {
    expect(walkShelf(0, "ArrowDown", 5, 2, false)).toBe(2);
    expect(walkShelf(1, "ArrowUp", 5, 2, false)).toBe(1);
    expect(walkShelf(3, "ArrowDown", 5, 2, false)).toBe(3);
    expect(walkShelf(0, "ArrowDown", 0, 2, false)).toBe(0);
  });

  it("knows its four keys and no other", () => {
    expect(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].every(isShelfKey)).toBe(true);
    expect(isShelfKey("Enter")).toBe(false);
  });
});

describe("the page of a set this desktop doesn't have (§8 'Read only first', corrected at MK-4e)", () => {
  it("is read from the list alone: its words, what it adds, its maker and the list's version — no power", () => {
    const entry = CATALOG_SHELF.plugins.find((listed) => listed.id === "vibefield.desk-things");
    expect(entry === undefined ? null : listedPage(entry)).toEqual({
      id: "vibefield.desk-things",
      title: "Desk things",
      source: words.SOURCE_WORDS.vibefield,
      community: false,
      summary: "Small things that keep time and measure, for the desk.",
      adds: [
        { key: "object:vibefield.desk-things.clock", words: "Clock" },
        { key: "object:vibefield.desk-things.calendar", words: "Calendar" },
        { key: "object:vibefield.desk-things.timer", words: "Timer" },
        { key: "object:vibefield.desk-things.ruler", words: "Ruler" },
      ],
      powers: [],
      nothing: null,
      madeBy: words.SOURCE_WORDS.vibefield,
      version: "1.0.0",
      onOff: null,
      powersLive: false,
      // O3-D's held line: a set this desktop doesn't have is held by nothing
      held: null,
      // item 494: a set this desktop doesn't have runs nowhere here, so its page says no row's line
      notWorking: null,
      elsewhere: null,
      offLine: null,
      settings: null,
      installed: false,
    });
  });

  it("says the listing's tools with their count, as an installed plugin's page does", () => {
    const things = CATALOG_SHELF.plugins.find((listed) => listed.id === "vibefield.desk-things");
    // Desk things' listing counting the tools and services given, its objects kept or none
    const adds = (tools: number, services: number, objects = true): readonly PageLine[] => {
      if (things?.listing === undefined) return [];
      const listing = {
        ...things.listing,
        objects: objects ? things.listing.objects : [],
        tools,
        services,
      };
      return listedPage({ ...things, listing })?.adds ?? [];
    };
    // each object by its label, then its tools with the listing's count (James's MK-O14 pick B),
    // then its service
    expect(adds(6, 1)).toEqual([
      { key: "object:vibefield.desk-things.clock", words: "Clock" },
      { key: "object:vibefield.desk-things.calendar", words: "Calendar" },
      { key: "object:vibefield.desk-things.timer", words: "Timer" },
      { key: "object:vibefield.desk-things.ruler", words: "Ruler" },
      { key: "tools", words: words.PAGE_WORDS.tools(6) },
      { key: "service", words: words.PAGE_WORDS.service },
    ]);
    expect(words.PAGE_WORDS.tools(6)).toBe("6 tools for your agents");
    // one said as one, with no object and no service
    expect(adds(1, 0, false)).toEqual([{ key: "tools", words: "1 tool for your agents" }]);
    // a listing that counts none of them says "No objects"
    expect(adds(0, 0, false)).toEqual([
      { key: "none", words: words.INSTALLED_LINE.noObject(null) },
    ]);
  });

  it("names a community set's maker as the list does, and is none for an entry with no listing", () => {
    const kanban = CATALOG_SHELF.plugins.find((listed) => listed.id === "acme.kanban");
    const page = kanban === undefined ? null : listedPage(kanban);
    expect([page?.source, page?.community, page?.madeBy]).toEqual([
      "Acme Tools",
      true,
      "Acme Tools",
    ]);
    const unlisted = CATALOG_SHELF.plugins.find((listed) => listed.id === "acme.unlisted");
    expect(unlisted === undefined ? "missing" : listedPage(unlisted)).toBeNull();
  });
});
