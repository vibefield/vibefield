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
  discoverShelf,
  isShelfKey,
  listedPage,
  type ShelfKey,
  shelfColumns,
  shelfOrder,
  shelfShows,
  walkShelf,
} from "../src/frame/plugins/plugins-shelf";
import * as words from "../src/frame/plugins/plugins-words";

// MK-4e — Discover's shelf (DESIGN.md §8 "Plugins — the frame's second popup", Discover; §9 "The
// popup"'s MK-4e block): the sets the list held offers, in the shelf's order, the featured one
// first; search by title, summary and objects' labels; the walk of its hot tile; and the page of a
// set this desktop doesn't have, read from the list. Pure: no window, no fieldd.

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
    expect(shelf.featured?.title).toBe("Simulators");
    expect(shelf.tiles.map((tile) => tile.title)).toEqual(["Burndown", "Desk things"]);
    expect(shelf.none).toBeNull();
    expect(shelf.communityOff).toBeNull();
  });

  it("says each tile's act, count and source: Installed, Install, or a set that needs a newer VibeField", () => {
    const shelf = discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "", false);
    expect(shelf.featured).toEqual({
      id: "vibefield.simulator",
      title: "Simulators",
      summary: "An iPhone, an iPad and a Watch, live on your desk.",
      count: "3 objects",
      // this desktop has it as a Built in plugin: its row's pill, never the list's
      source: words.SOURCE_WORDS.bundled,
      community: false,
      act: "installed",
      has: null,
    });
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
    expect(titles(CATALOG_SHELF)).toEqual(["Simulators", "Burndown", "Desk things"]);
    expect(titles(CATALOG_SHELF, "", true)).toEqual([
      "Simulators",
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
    expect(titles(CATALOG_SHELF, "desk")).toEqual(["Desk things", "Simulators"]);
    const ruler = discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "ruler", false);
    // no featured row while words are typed
    expect(ruler.featured).toBeNull();
    expect(ruler.tiles.map((tile) => [tile.title, tile.has])).toEqual([
      ["Desk things", words.SHELF_WORDS.has("Ruler")],
    ]);
    // a word its own words hold says no object
    expect(discoverShelf(CATALOG_SHELF, PLUGINS_FIXTURE_SNAPSHOT, "watch", false).tiles).toEqual([
      expect.objectContaining({ title: "Simulators", has: null }),
    ]);
    // every word must be held
    expect(titles(CATALOG_SHELF, "clock simulators")).toEqual([]);
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
      readOnly: null,
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
