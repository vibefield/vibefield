import { PluginRegistrySnapshot, PluginsCatalog } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  CATALOG_FIXTURES,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_READ_AT,
  PLUGINS_FIXTURE_SNAPSHOT,
} from "../src/design-system/plugins-fixtures";
import {
  catalogFoot,
  installedFoot,
  installedRows,
  type PluginsRead,
  pluginsLayout,
  shelfState,
} from "../src/frame/plugins/plugins-model";
import * as words from "../src/frame/plugins/plugins-words";

// MK-4a — the Plugins popup's model (DESIGN.md §8 "Plugins — the frame's second popup", §9 "The plugins'
// words"): its place in a window (MK-E1), what Discover and Updates say in each state of the read, the foot,
// and Installed's rows from the registry snapshot.

const answered = (catalog: PluginsCatalog): PluginsRead => ({ kind: "answered", catalog });
const when = words.listTime(PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW);

describe("where the popup stands (MK-E1)", () => {
  it("is 960 × 640 at 60…700 in the default 1180 × 780 window, 110 in from each side", () => {
    expect(pluginsLayout(1180, 780)).toEqual({ width: 960, height: 640, top: 60 });
  });

  it("clamps to min(960, W − 48) × min(640, H − 140) in a smaller window", () => {
    expect(pluginsLayout(800, 600)).toEqual({ width: 752, height: 460, top: 60 });
  });

  it("stays centred in the band between the head and the line in a taller one", () => {
    expect(pluginsLayout(1400, 1000)).toEqual({ width: 960, height: 640, top: 170 });
  });

  it("never goes below nothing", () => {
    expect(pluginsLayout(10, 10)).toEqual({ width: 0, height: 0, top: 60 });
  });
});

describe("Discover's and Updates' body, in each state of the read", () => {
  it("says the read before fieldd answers, and says it when neither door answers", () => {
    expect(shelfState({ kind: "asking" }, true)).toEqual({ kind: "reading" });
    expect(shelfState({ kind: "away" }, false)).toEqual({ kind: "away" });
  });

  it("says no registry is configured, whatever the read", () => {
    expect(shelfState(answered(CATALOG_FIXTURES.unconfigured), true)).toEqual({
      kind: "unconfigured",
    });
  });

  it("with no list held: the read, offline or a list VibeField couldn't use", () => {
    expect(shelfState(answered(CATALOG_FIXTURES.unread), false)).toEqual({ kind: "reading" });
    expect(shelfState(answered(CATALOG_FIXTURES.unreachable), true)).toEqual({ kind: "reading" });
    expect(shelfState(answered(CATALOG_FIXTURES.unreachable), false)).toEqual({
      kind: "no-list",
      words: words.NO_LIST.unreachable,
    });
    expect(shelfState(answered(CATALOG_FIXTURES.refused), false)).toEqual({
      kind: "no-list",
      words: words.NO_LIST.refused,
    });
  });

  it("with a list held, its count, in every state (Q2: a state no build reaches today)", () => {
    for (const state of ["ready", "reading", "stale", "unreachable", "refused"] as const) {
      const catalog = PluginsCatalog.parse({ ...CATALOG_FIXTURES.ready, state });
      expect(shelfState(answered(catalog), false)).toEqual({
        kind: "counted",
        words: "1 plugin, 3 objects",
      });
    }
  });
});

describe("the foot (§9 'Reading the list')", () => {
  const foot = (read: PluginsRead, reading = false) =>
    catalogFoot(read, reading, PLUGINS_FIXTURE_NOW);

  it("says no time, and nothing at all, when no registry is configured", () => {
    expect(foot(answered(CATALOG_FIXTURES.unconfigured), true)).toBeNull();
  });

  it("says the read with no list, and the list's time while a read runs over one", () => {
    expect(foot({ kind: "asking" }, true)?.words).toBe(words.READING);
    expect(foot(answered(CATALOG_FIXTURES.unread))?.words).toBe(words.READING);
    expect(foot(answered(CATALOG_FIXTURES.ready), true)?.words).toBe(
      `Reading the plugin list… · showing the list from ${when}`,
    );
  });

  it("says what a held list holds and when it was read", () => {
    expect(foot(answered(CATALOG_FIXTURES.ready))).toEqual({
      words: `1 plugin, 3 objects · checked ${when}`,
      attention: false,
    });
  });

  it("is honest offline, about a list it couldn't use, and about one past its date", () => {
    const held = (state: "unreachable" | "refused" | "stale") =>
      answered(PluginsCatalog.parse({ ...CATALOG_FIXTURES.ready, state }));
    expect(foot(held("unreachable"))?.words).toBe(`Offline · the list from ${when}`);
    expect(foot(held("refused"))?.words).toBe(words.CATALOG_FOOT.refused);
    expect(foot(held("stale"))).toEqual({ words: words.CATALOG_FOOT.stale, attention: true });
    expect(foot(answered(CATALOG_FIXTURES.unreachable))?.words).toBe(words.NO_LIST.unreachable);
    expect(foot(answered(CATALOG_FIXTURES.refused))?.words).toBe(words.NO_LIST.refused);
  });

  it("says the clock today and the day before it otherwise", () => {
    const at = new Date(2026, 10, 6, 9, 5).getTime();
    expect(words.listTime(at, new Date(2026, 10, 6, 23, 0).getTime())).toBe("09:05");
    expect(words.listTime(at, new Date(2026, 10, 11, 14, 2).getTime())).toBe("Nov 6, 09:05");
  });
});

describe("Installed (§8 'Installed', read only)", () => {
  it("lists every plugin, Built in first, then by title, each with its pill and one line", () => {
    expect(installedRows(PLUGINS_FIXTURE_SNAPSHOT, null)).toEqual([
      {
        id: "vibefield.comment-pad",
        title: "Comment pad",
        source: "Built in",
        community: false,
        line: "1 object · 0.1.0 · comes with VibeField",
      },
      {
        id: "vibefield.simulator",
        title: "Simulators",
        source: "Built in",
        community: false,
        line: "3 objects · 1.2.0 · comes with VibeField",
      },
      {
        id: "example.desk-clock",
        title: "Desk clock",
        source: "Development",
        community: false,
        line: "Off · its objects on your desks draw as missing until it's on",
      },
      {
        id: "example.kv-service",
        title: "Key-value store",
        source: "Sideloaded",
        community: false,
        line: "No objects · a service",
      },
    ]);
  });

  it("filters by every typed word, in a plugin's title or its objects' names and labels (Q6)", () => {
    const ids = (query: string) =>
      installedRows(PLUGINS_FIXTURE_SNAPSHOT, null, query).map((row) => row.id);
    expect(ids("")).toHaveLength(4);
    expect(ids("  ")).toHaveLength(4);
    expect(ids("CLOCK")).toEqual(["example.desk-clock"]);
    expect(ids("tablet")).toEqual(["vibefield.simulator"]);
    expect(ids("apple")).toEqual(["vibefield.simulator"]);
    expect(ids("pad comment")).toEqual(["vibefield.comment-pad"]);
    expect(ids("pad clock")).toEqual([]);
    expect(words.noMatchWords(" pad clock ")).toBe("None of your plugins matches “pad clock”.");
  });

  it("says its foot: how many plugins, how many objects, how many off", () => {
    expect(installedFoot(PLUGINS_FIXTURE_SNAPSHOT)).toBe("4 plugins, 5 objects · 1 off");
  });

  it("takes every word of a registry plugin's pill from the signed list, or says Community", () => {
    const [base] = PLUGINS_FIXTURE_SNAPSHOT.plugins;
    if (base === undefined) throw new Error("the fixture holds no plugin");
    // each record names a publisher of its own, which the pill must never read
    const registry = (id: string, publisherName = "A Maker") => ({
      ...base,
      id,
      title: id,
      source: "registry",
      registry: {
        indexRef: "index.json",
        artifactSha256: `sha256:${"b".repeat(64)}`,
        publisher: "maker",
        publisherName,
      },
    });
    const snapshot = PluginRegistrySnapshot.parse({
      generation: 1,
      problems: [],
      plugins: [
        registry("a.ours"),
        registry("b.theirs"),
        registry("c.nameless"),
        registry("d.unlisted"),
        // an unlisted record that calls itself VibeField's
        registry("e.claims", "VibeField"),
      ],
    });
    const entry = CATALOG_FIXTURES.ready.plugins[0];
    if (entry === undefined) throw new Error("the fixture lists no plugin");
    const catalog = PluginsCatalog.parse({
      ...CATALOG_FIXTURES.ready,
      plugins: [
        { ...entry, id: "a.ours", listedAs: "vibefield" },
        {
          ...entry,
          id: "b.theirs",
          listedAs: "community",
          listing: { ...entry.listing, publisherName: "List Maker" },
        },
        {
          ...entry,
          id: "c.nameless",
          listedAs: "community",
          listing: { title: "Nameless", objects: [] },
        },
      ],
    });
    const pills = installedRows(snapshot, catalog).map((row) => [row.source, row.community]);
    expect(pills).toEqual([
      ["VibeField", false],
      ["List Maker", true],
      ["Community", false],
      ["Community", false],
      ["Community", false],
    ]);
    // no list held: every registry plugin says Community alone, VibeField's own included
    const none = installedRows(snapshot, null).map((row) => [row.source, row.community]);
    expect(new Set(none.map((pill) => JSON.stringify(pill)))).toEqual(
      new Set(['["Community",false]']),
    );
  });
});

/** Every function the words module exports, at any depth, called with sample
 * arguments: a word built by a function is read as it is said. A function
 * with no samples here is a red that names it (VF-PM 2026-11-11 12:21:20Z). */
const SAMPLES: Readonly<Record<string, readonly (readonly unknown[])[]>> = {
  plural: [
    [1, "plugin", "plugins"],
    [2, "plugin", "plugins"],
  ],
  listCount: [
    [1, 3],
    [12, 31],
  ],
  "CATALOG_FOOT.reading": [["14:02"]],
  "CATALOG_FOOT.ready": [["12 plugins, 31 objects", "Nov 6, 14:02"]],
  "CATALOG_FOOT.unreachable": [["14:02"]],
  "INSTALLED_LINE.set": [
    [1, "0.1.0"],
    [3, "1.2.0"],
  ],
  "INSTALLED_LINE.noObject": [[null], ["a service"]],
  "INSTALLED_LINE.broken": [["Desk clock"]],
  hasWords: [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ],
  noMatchWords: [["clock"]],
  installedFootWords: [
    [6, 14, 1],
    [1, 1, 0],
  ],
  listTime: [
    [PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW],
    [PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW + 7 * 24 * 60 * 60_000],
  ],
};

/** The strings a value says: strings as they are, objects and arrays by their
 * values (never their keys, which are names in the code), functions by what
 * SAMPLES calls them with. */
function said(
  value: unknown,
  path: string,
  out: string[],
  uncalled: string[],
  used: Set<string>,
): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (typeof value === "function") {
    const samples = SAMPLES[path];
    if (samples === undefined) {
      uncalled.push(path);
      return;
    }
    used.add(path);
    for (const args of samples) {
      said((value as (...args: unknown[]) => unknown)(...args), `${path}()`, out, uncalled, used);
    }
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      said(item, `${path}[${index}]`, out, uncalled, used);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      said(item, `${path}.${key}`, out, uncalled, used);
  }
}

describe("the popup's words (§9; James 2026-11-10 00:46Z: no insides)", () => {
  it("names no key, signature, hash, daemon, worker, restart or reload, and no registry but the ruled one", () => {
    const out: string[] = [];
    const uncalled: string[] = [];
    const used = new Set<string>();
    for (const [name, value] of Object.entries(words)) said(value, name, out, uncalled, used);
    expect(uncalled).toEqual([]);
    expect(Object.keys(SAMPLES).filter((path) => !used.has(path))).toEqual([]);
    expect(out.length).toBeGreaterThan(30);
    const ruled = out.join("\n").replaceAll(words.NO_REGISTRY.title, "");
    expect(ruled).not.toMatch(/registry|signature|\bkeys?\b|hash|daemon|worker|restart|reload/i);
  });
});
