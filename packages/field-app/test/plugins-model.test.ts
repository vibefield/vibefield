import {
  type PluginRecord,
  PluginRegistrySnapshot,
  PluginsCatalog,
  SettingsGetResult,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  CATALOG_FIXTURES,
  CATALOG_LISTED,
  PLUGINS_FIXTURE_HELD_SNAPSHOT,
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_READ_AT,
  PLUGINS_FIXTURE_SETTINGS_SNAPSHOT,
  PLUGINS_FIXTURE_SNAPSHOT,
  PLUGINS_FIXTURE_SWITCHES_SNAPSHOT,
} from "../src/design-system/plugins-fixtures";
import {
  bringsTools,
  catalogFoot,
  controlsHere,
  installedFoot,
  installedRows,
  type PageSetting,
  type PluginsRead,
  pluginPage,
  pluginsLayout,
  powerSwitchOf,
  refusalStale,
  settingAct,
  settingDraft,
  settingKind,
  settingsOf,
  settingToSend,
  shelfState,
  stoppedAfterCrashes,
  walkHot,
} from "../src/frame/plugins/plugins-model";
import * as words from "../src/frame/plugins/plugins-words";

// MK-4a — the Plugins popup's model (DESIGN.md §8 "Plugins — the frame's second popup", §9 "The plugins'
// words"): its place in a window (MK-E1), what Discover and Updates say in each state of the read, the foot,
// and Installed's rows from the registry snapshot; MK-4c adds a plugin's page, read only, and the hot row's walk;
// MK-4c2a, which plugins carry switches here and where each stands; MK-4c2b, a plugin's settings on its page.

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
        onOff: true,
      },
      {
        id: "vibefield.simulator",
        title: "Simulators",
        source: "Built in",
        community: false,
        line: "3 objects · 1.2.0 · comes with VibeField",
        onOff: true,
      },
      {
        id: "example.desk-clock",
        title: "Desk clock",
        source: "Development",
        community: false,
        line: "Off · its objects on your desks draw as missing until it's on",
        onOff: false,
      },
      {
        id: "example.kv-service",
        title: "Key-value store",
        source: "Sideloaded",
        community: false,
        line: "No objects · a service",
        // Sideloaded: its switch here too, on (N18; MK-4c2a gave it none)
        onOff: true,
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

describe("Installed's honest rows (MK-5, N21; §9 'Installed, off and Remove…')", () => {
  /** The same desktop with one plugin changed, as fieldd's next snapshot would say it. */
  const changed = (
    snapshot: PluginRegistrySnapshot,
    id: string,
    change: Partial<PluginRecord>,
  ): PluginRegistrySnapshot => ({
    ...snapshot,
    plugins: snapshot.plugins.map((plugin) =>
      plugin.id === id ? { ...plugin, ...change } : plugin,
    ),
  });
  const row = (snapshot: PluginRegistrySnapshot, catalog: PluginsCatalog | null, id: string) =>
    installedRows(snapshot, catalog).find((candidate) => candidate.id === id);
  const stopped = changed(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator", {
    service: "quarantined",
  });

  it("says a plugin fieldd stopped after it kept crashing in the attention ink, its switch off on its row and its page", () => {
    const simulators = row(stopped, null, "vibefield.simulator");
    expect([simulators?.line, simulators?.attention, simulators?.onOff]).toEqual([
      words.INSTALLED_LINE.stopped,
      true,
      false,
    ]);
    const record = recordOf(stopped, "vibefield.simulator");
    expect(stoppedAfterCrashes(record)).toBe(true);
    expect(pluginPage(record, null, stopped, false).onOff).toBe(false);
    // running, it says its set in the line's own ink, its switch on
    const running = row(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, null, "vibefield.simulator");
    expect([running?.line, running?.attention, running?.onOff]).toEqual([
      "3 objects · 1.2.0 · comes with VibeField",
      undefined,
      true,
    ]);
    // fieldd starting it again after a crash is no stop
    const restarting = changed(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator", {
      service: "restarting",
    });
    expect(row(restarting, null, "vibefield.simulator")?.onOff).toBe(true);
    // a plugin from the list says it too, its switch off as a Built in one's is (N18)
    const kanban = changed(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban", {
      service: "quarantined",
    });
    const listed = row(kanban, CATALOG_LISTED, "acme.kanban");
    expect([listed?.line, listed?.onOff]).toEqual([words.INSTALLED_LINE.stopped, false]);
  });

  it("says first that a plugin is off, or can't run, never that it stopped", () => {
    const off = changed(stopped, "vibefield.simulator", { enabled: false, state: "disabled" });
    expect(row(off, null, "vibefield.simulator")?.line).toBe(words.INSTALLED_LINE.off);
    // MK-5b: an invalid or incompatible plugin says a line of its own, never that it isn't working right now,
    // for turning it off and on fails the same way; it has no switch, and so no Try again
    const invalid = changed(stopped, "vibefield.simulator", { state: "invalid" });
    const incompatible = changed(stopped, "vibefield.simulator", {
      state: "incompatible",
      compatible: false,
    });
    for (const snapshot of [invalid, incompatible]) {
      const simulators = row(snapshot, null, "vibefield.simulator");
      expect(simulators?.line).toBe("Simulators can't run on this VibeField");
      expect(simulators?.onOff).toBeNull();
    }
  });

  it("takes a press on a stopped plugin's switch as turning it on, its refusal kept until it runs", () => {
    const turningOn = { id: "vibefield.simulator", capability: null, turningOn: true };
    expect(refusalStale(turningOn, stopped)).toBe(false);
    expect(refusalStale(turningOn, PLUGINS_FIXTURE_SWITCHES_SNAPSHOT)).toBe(true);
  });

  it("says a plugin from the list that the list held no longer names keeps working, with no more updates", () => {
    const kanban = (catalog: PluginsCatalog | null) =>
      row(PLUGINS_FIXTURE_LISTED_SNAPSHOT, catalog, "acme.kanban");
    // the list held names it: its set
    expect(kanban(CATALOG_LISTED)?.line).toBe("2 objects · 2.1.0");
    // a list held that names it no more, in every state a held list stands in
    for (const state of ["ready", "reading", "stale", "unreachable"] as const) {
      const catalog = PluginsCatalog.parse({ ...CATALOG_FIXTURES.ready, state });
      expect(kanban(catalog)?.line).toBe(words.INSTALLED_LINE.unlisted);
    }
    // in the line's own ink, with its pill and its switch, on (N18): the list naming it no more
    // moves no switch, which fieldd decides
    const unlisted = kanban(CATALOG_FIXTURES.ready);
    expect([unlisted?.attention, unlisted?.source, unlisted?.onOff]).toEqual([
      undefined,
      "Community",
      true,
    ]);
    // no list held — none read, none configured, or none VibeField could use: nothing said of it
    const none = [
      null,
      CATALOG_FIXTURES.unread,
      CATALOG_FIXTURES.unconfigured,
      CATALOG_FIXTURES.refused,
    ];
    for (const catalog of none) expect(kanban(catalog)?.line).toBe("2 objects · 2.1.0");
    // a plugin that isn't from the list is never said to have left it
    const sideloaded = row(
      PLUGINS_FIXTURE_LISTED_SNAPSHOT,
      CATALOG_FIXTURES.ready,
      "example.kv-service",
    );
    expect(sideloaded?.line).toBe("No objects · a service");
    // off, it says it is off
    const off = changed(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban", {
      enabled: false,
      state: "disabled",
    });
    expect(row(off, CATALOG_FIXTURES.ready, "acme.kanban")?.line).toBe(words.INSTALLED_LINE.off);
  });

  it("says a plugin that cannot start in this window isn't working, whatever the reason, until it leaves the window's set (item 476)", () => {
    // the window's own set, handed in, with each reason it holds: a lane that would not open
    // (for room or not), an import, an activation
    const reasons = [
      { reason: "lane", room: true },
      { reason: "lane", room: false },
      { reason: "import" },
      { reason: "activation" },
    ];
    type Unstarted = ReadonlyMap<string, object>;
    const rowOf = (snapshot: PluginRegistrySnapshot, id: string, unstarted: Unstarted) =>
      installedRows(snapshot, null, "", null, unstarted).find((entry) => entry.id === id);
    const fixture = PLUGINS_FIXTURE_SNAPSHOT;
    for (const why of reasons) {
      const unstarted: Unstarted = new Map([
        ["vibefield.simulator", why],
        ["example.kv-service", why],
        ["example.desk-clock", why],
      ]);
      // a set, and a plugin with no object: the line fieldd's own faults read, never the reason
      const simulators = rowOf(fixture, "vibefield.simulator", unstarted);
      expect(simulators?.line).toBe(words.INSTALLED_LINE.broken("Simulators"));
      expect(simulators?.line).toBe("Simulators isn't working right now");
      // its switch stands: turning it off and on is a person's own way to try again
      expect(simulators?.onOff).toBe(true);
      const store = rowOf(fixture, "example.kv-service", unstarted);
      expect(store?.line).toBe(words.INSTALLED_LINE.broken("Key-value store"));
      // turned off, it says it is off, as before
      const clock = rowOf(fixture, "example.desk-clock", unstarted);
      expect(clock?.line).toBe(words.INSTALLED_LINE.off);
      // a plugin fieldd stopped after it kept crashing keeps its stopped line and its attention
      // ink: that it also cannot start here is likely the same fault seen twice, and the plainer
      // line does not take the stopped one's place
      const quarantined = rowOf(stopped, "vibefield.simulator", unstarted);
      expect([quarantined?.line, quarantined?.attention]).toEqual([
        words.INSTALLED_LINE.stopped,
        true,
      ]);
    }
    // out of the set, each says its ordinary line again
    const none: Unstarted = new Map();
    const running = rowOf(fixture, "vibefield.simulator", none);
    expect(running?.line).toBe("3 objects · 1.2.0 · comes with VibeField");
    expect(rowOf(fixture, "example.kv-service", none)?.line).toBe("No objects · a service");
    const crashed = rowOf(stopped, "vibefield.simulator", none);
    expect(crashed?.line).toBe(words.INSTALLED_LINE.stopped);
  });
});

/** A record of a fixture snapshot, by id. */
function recordOf(snapshot: PluginRegistrySnapshot, id: string): PluginRecord {
  const record = snapshot.plugins.find((plugin) => plugin.id === id);
  if (record === undefined) throw new Error(`the fixture holds no ${id}`);
  return record;
}

describe("a plugin's page, read only (MK-4c; §8 'Read only first', §9 MK-4c's block)", () => {
  it("says a Built in plugin from the snapshot: its objects, its powers in plain words, its maker and version", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.simulator");
    const page = pluginPage(simulators, null, PLUGINS_FIXTURE_SNAPSHOT, true);
    expect(page).toEqual({
      id: "vibefield.simulator",
      title: "Simulators",
      source: "Built in",
      community: false,
      summary: null,
      // by its pegboard label, or by its title when it hangs nowhere
      adds: [
        { key: "object:SimPhone", words: "Phone" },
        { key: "object:SimTablet", words: "Tablet" },
        { key: "object:SimWatch", words: "Apple Watch" },
      ],
      powers: [
        {
          key: "surface.capture",
          words: "See other apps' windows",
          under: "macOS asks you once, for Screen Recording",
          whose: null,
          switch: true,
          cant: null,
        },
        {
          key: "canvas.read",
          words: "Read what's on the desk",
          under: null,
          whose: null,
          switch: true,
          cant: null,
        },
      ],
      nothing: null,
      madeBy: words.PAGE_WORDS.builtIn,
      version: "1.2.0",
      // MK-4c2a: a Built in plugin carries its switches, and says they reach your other desktops
      onOff: true,
      powersLive: true,
      // MK-O3D: it is not held while community plugins are off
      held: null,
      // item 494: it works, so its page says no row's line
      notWorking: null,
      elsewhere: words.SWITCH_WORDS.elsewhere,
      offLine: null,
      // MK-4c2b: it declares no setting here, so its page has no Settings section
      settings: null,
      // MK-4e: this desktop has it
      installed: true,
    });
    // off the Mac, no Mac note
    const offMac = pluginPage(simulators, null, PLUGINS_FIXTURE_SNAPSHOT, false);
    expect(offMac.powers.map((power) => power.under)).toEqual([null, null]);
  });

  it("takes a registry plugin's maker and own words from the signed list alone, never its folder's copy (item 321)", () => {
    const kanban = recordOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban");
    // the folder's display copy names a maker of its own
    expect(kanban.registry?.publisherName).toBe("Someone Else");
    const listed = pluginPage(kanban, CATALOG_LISTED, PLUGINS_FIXTURE_LISTED_SNAPSHOT, true);
    expect([listed.source, listed.community, listed.madeBy, listed.summary]).toEqual([
      "Acme Tools",
      true,
      "Acme Tools",
      "A board and its cards, for the work on your desk.",
    ]);
    // a list held with no entry for it, and no list held: no maker, no words of its own
    for (const catalog of [CATALOG_FIXTURES.ready, null]) {
      const page = pluginPage(kanban, catalog, PLUGINS_FIXTURE_LISTED_SNAPSHOT, true);
      expect([page.source, page.community, page.madeBy, page.summary]).toEqual([
        "Community",
        false,
        null,
        null,
      ]);
    }
    for (const catalog of [CATALOG_LISTED, CATALOG_FIXTURES.ready, null]) {
      const page = pluginPage(kanban, catalog, PLUGINS_FIXTURE_LISTED_SNAPSHOT, true);
      expect(JSON.stringify(page)).not.toContain("Someone Else");
    }
  });

  it("says a plugin's own power by its declaring plugin's words, and one named by a plugin not installed here", () => {
    const kanban = recordOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban");
    const page = pluginPage(kanban, CATALOG_LISTED, PLUGINS_FIXTURE_LISTED_SNAPSHOT, true);
    expect(page.adds.map((line) => line.words)).toEqual([
      "Board",
      "Card",
      "1 tool for your agents",
    ]);
    // a plugin from the list carries a switch on each power, as a Built in one does (N18; MK-4c2a
    // gave it none)
    expect(page.powers).toEqual([
      {
        key: "canvas.write",
        words: "Change what's on the desk",
        under: null,
        whose: null,
        switch: true,
        cant: null,
      },
      {
        key: "x.acme.kanban.sync",
        words: "Keep your boards in step",
        under: "Copies a board's cards to the boards you share.",
        whose: "A power of its own, named by Kanban",
        switch: true,
        cant: null,
      },
    ]);
    // another plugin holding Kanban's power: whose it is, named (it asked for what it holds, as fieldd's records do)
    const pad = recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.comment-pad");
    const borrower = {
      ...pad,
      requestedCapabilities: ["x.acme.kanban.sync"],
      grantedCapabilities: ["x.acme.kanban.sync"],
    };
    const lent = pluginPage(borrower, null, PLUGINS_FIXTURE_LISTED_SNAPSHOT, true);
    expect(lent.powers.map((power) => power.whose)).toEqual(["A power Kanban names"]);
    // with Kanban not installed, the power has no words of its own to say, and no id is shown
    const alone = pluginPage(borrower, null, PLUGINS_FIXTURE_SNAPSHOT, true);
    expect(alone.powers).toEqual([
      {
        key: "x.acme.kanban.sync",
        words: words.PAGE_WORDS.ownUnknown,
        under: null,
        whose: null,
        switch: true,
        cant: null,
      },
    ]);
    // what the page says of it never names its id
    const said = alone.powers.flatMap((power) => [power.words, power.under, power.whose]);
    expect(said.join(" ")).not.toContain("x.acme");
  });

  it("says when it holds no power, what it adds with no object, and no maker for Development or Sideloaded", () => {
    const pad = pluginPage(
      recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.comment-pad"),
      null,
      PLUGINS_FIXTURE_SNAPSHOT,
      true,
    );
    expect([pad.powers, pad.nothing]).toEqual([[], words.PAGE_WORDS.nothing]);
    // a held power this build cannot name is said as a power VibeField can't describe (James's MK-O34 B): one
    // row, nothing under it and no whose; and the page does not say it holds none
    const unnamed = {
      ...recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.comment-pad"),
      requestedCapabilities: ["made.up"],
      grantedCapabilities: ["made.up"],
    };
    const odd = pluginPage(unnamed, null, PLUGINS_FIXTURE_SNAPSHOT, true);
    expect(odd.powers).toEqual([
      {
        key: "made.up",
        words: words.PAGE_WORDS.unnamed,
        under: null,
        whose: null,
        switch: null,
        cant: null,
      },
    ]);
    expect(odd.nothing).toBeNull();
    const store = pluginPage(
      recordOf(PLUGINS_FIXTURE_SNAPSHOT, "example.kv-service"),
      null,
      PLUGINS_FIXTURE_SNAPSHOT,
      true,
    );
    expect(store.adds).toEqual([{ key: "service", words: words.PAGE_WORDS.service }]);
    expect([store.nothing, store.madeBy, store.source]).toEqual([
      words.PAGE_WORDS.nothingNoObject,
      null,
      "Sideloaded",
    ]);
    const clock = pluginPage(
      recordOf(PLUGINS_FIXTURE_SNAPSHOT, "example.desk-clock"),
      null,
      PLUGINS_FIXTURE_SNAPSHOT,
      true,
    );
    expect([clock.madeBy, clock.source, clock.version]).toEqual([null, "Development", "0.3.0"]);
    const bare = {
      ...recordOf(PLUGINS_FIXTURE_SNAPSHOT, "example.kv-service"),
      service: "none" as const,
    };
    expect(pluginPage(bare, null, PLUGINS_FIXTURE_SNAPSHOT, true).adds).toEqual([
      { key: "none", words: "No objects" },
    ]);
  });

  it("says a power VibeField can't describe beside one it can, never its id (James's MK-O34 B), a line each (VF-PM 03:11Z)", () => {
    // a Sideloaded page lists every power it asked for (its switches here since N18): a fieldd newer than the
    // window can grant a power the window has no words for, and two such powers are two lines
    const held = ["canvas.read", "made.up", "made.up.too"];
    const sideloaded = {
      ...recordOf(PLUGINS_FIXTURE_SNAPSHOT, "example.kv-service"),
      requestedCapabilities: held,
      grantedCapabilities: held,
    };
    const store = pluginPage(sideloaded, null, PLUGINS_FIXTURE_SNAPSHOT, true);
    const lines = store.powers.map((power) => [power.key, power.words, power.under, power.whose]);
    expect(lines).toEqual([
      ["canvas.read", "Read what's on the desk", null, null],
      ["made.up", words.PAGE_WORDS.unnamed, null, null],
      ["made.up.too", words.PAGE_WORDS.unnamed, null, null],
    ]);
    expect(store.nothing).toBeNull();
    const said = store.powers.flatMap((power) => [power.words, power.under, power.whose]);
    expect(said.join(" ")).not.toContain("made.up");
    // with switches here, one it asked for that no plugin may hold: no switch, and fieldd's reason under it
    const simulators = recordOf(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator");
    const asked: PluginRecord = {
      ...simulators,
      requestedCapabilities: [...simulators.requestedCapabilities, "made.up"],
      deniedCapabilities: [
        ...simulators.deniedCapabilities,
        { capability: "made.up", reason: "entry-kind" },
      ],
    };
    const page = pluginPage(asked, null, PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, false);
    expect(page.powers.map((power) => [power.key, power.switch, power.cant])).toEqual([
      ["surface.capture", true, null],
      ["canvas.read", true, null],
      ["canvas.write", false, null],
      ["process.spawn", null, words.SWITCH_WORDS.cant["entry-kind"]],
      ["made.up", null, words.SWITCH_WORDS.cant["entry-kind"]],
    ]);
    expect(page.powers[4]?.words).toBe(words.PAGE_WORDS.unnamed);
  });

  it("calls tools what a plugin brings your agents, never its commands — on Installed's row and its page alike (VF-PM 16:05:52Z)", () => {
    const base = {
      ...recordOf(PLUGINS_FIXTURE_SNAPSHOT, "example.kv-service"),
      service: "none" as const,
    };
    const contributions = base.contributions;
    const command = { id: "acme.do", title: "Do it", placements: [] };
    const commandsOnly: PluginRecord = {
      ...base,
      contributions: {
        ...contributions,
        commands: [command] as unknown as PluginRecord["contributions"]["commands"],
      },
    };
    const tool = { name: "do_it", title: "Do it", description: "Does it.", method: "do.it" };
    const withTools: PluginRecord = {
      ...base,
      contributions: { ...contributions, mcp: { tools: [tool], servers: [] } },
    };
    const lineOf = (record: PluginRecord) =>
      installedRows({ generation: 1, problems: [], plugins: [record] }, null)[0]?.line;
    const adds = (record: PluginRecord) =>
      pluginPage(record, null, PLUGINS_FIXTURE_SNAPSHOT, true).adds.map((line) => line.words);
    expect([bringsTools(commandsOnly), lineOf(commandsOnly), adds(commandsOnly)]).toEqual([
      false,
      "No objects",
      ["No objects"],
    ]);
    expect([bringsTools(withTools), lineOf(withTools), adds(withTools)]).toEqual([
      true,
      "No objects · tools",
      [words.PAGE_WORDS.tools(1)],
    ]);
  });

  it("names each command it puts in the palette, where it is under it, and counts its tools (James's MK-O20 A, MK-O14 B)", () => {
    const pad = recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.comment-pad");
    // two in the palette (one also on an object's menu), and one placed only on an object's menu
    const commands = [
      { id: "pad.new", title: "New comment pad", placements: ["palette"] },
      { id: "pad.clear", title: "Clear the pad", placements: ["object-context", "palette"] },
      { id: "pad.pin", title: "Pin the pad", placements: ["object-context"] },
    ] as unknown as PluginRecord["contributions"]["commands"];
    const tools = Array.from({ length: 6 }, (_, at) => ({
      name: `tool_${at}`,
      title: `Tool ${at}`,
      description: "Does a thing.",
      method: `tool.${at}`,
    }));
    const full: PluginRecord = {
      ...pad,
      service: "active",
      contributions: { ...pad.contributions, commands, mcp: { tools, servers: [] } },
    };
    const lines = (record: PluginRecord, onMac: boolean) => {
      const page = pluginPage(record, null, PLUGINS_FIXTURE_SNAPSHOT, onMac);
      return page.adds.map((line) => [line.key, line.words, line.under]);
    };
    // after its objects, before its tools and its service; one placed only elsewhere is not said
    expect(lines(full, true)).toEqual([
      ["object:commentPad", "Comment pad", undefined],
      ["command:pad.new", "New comment pad", "In the palette (⌘K)"],
      ["command:pad.clear", "Clear the pad", "In the palette (⌘K)"],
      ["tools", "6 tools for your agents", undefined],
      ["service", words.PAGE_WORDS.service, undefined],
    ]);
    // off the Mac, the key as it is spelled there
    expect(lines(full, false)[1]).toEqual([
      "command:pad.new",
      "New comment pad",
      "In the palette (Ctrl+K)",
    ]);
    // off, its commands are said as its objects are, though the palette lists them only while on
    const off: PluginRecord = { ...full, enabled: false, state: "disabled" };
    expect(lines(off, true)).toEqual(lines(full, true));
    // with no object, its command and its tool alone, never "No objects"; one tool is said as one.
    // Sideloaded, as the case above: a Built in plugin with no object has a line of its own
    const kv = recordOf(PLUGINS_FIXTURE_SNAPSHOT, "example.kv-service");
    const bare: PluginRecord = {
      ...kv,
      service: "none",
      contributions: {
        ...kv.contributions,
        commands: commands.slice(0, 1),
        mcp: { tools: tools.slice(0, 1), servers: [] },
      },
    };
    expect(lines(bare, true).map((line) => line[1])).toEqual([
      "New comment pad",
      "1 tool for your agents",
    ]);
    // Installed's line keeps "tools", and never counts a command as one
    const row = installedRows({ generation: 1, problems: [], plugins: [bare] }, null)[0];
    expect(row?.line).toBe("No objects · tools");
  });

  it("walks Installed's hot row one step, held at the first row and the last", () => {
    expect(walkHot(0, "ArrowDown", 4)).toBe(1);
    expect(walkHot(3, "ArrowDown", 4)).toBe(3);
    expect(walkHot(1, "ArrowUp", 4)).toBe(0);
    expect(walkHot(0, "ArrowUp", 4)).toBe(0);
    expect(walkHot(0, "ArrowDown", 0)).toBe(0);
  });
});

describe("a plugin's switches (MK-4c2a; §8 'Its switches', §9 MK-4c2a's block)", () => {
  it("stand for every plugin, whatever its source or the list held says, but one held while community plugins are off (N18)", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator");
    const clock = recordOf(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "example.desk-clock");
    const kanban = recordOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban");
    // a Sideloaded plugin that asked for a power, so its page has a power's switch to show
    const store: PluginRecord = {
      ...recordOf(PLUGINS_FIXTURE_SNAPSHOT, "example.kv-service"),
      requestedCapabilities: ["canvas.read"],
      grantedCapabilities: ["canvas.read"],
    };
    // fieldd keeps it held whatever its switch asks (O3-C), so it has none
    const held = recordOf(PLUGINS_FIXTURE_HELD_SNAPSHOT, "acme.kanban");
    const asVibeField = PluginsCatalog.parse({
      ...CATALOG_LISTED,
      plugins: CATALOG_LISTED.plugins.map((entry) =>
        entry.id === "acme.kanban" ? { ...entry, listedAs: "vibefield" } : entry,
      ),
    });
    // whose they are, the list held, whether it carries them, and whether its page says they reach
    // your other desktops (the install-set carries a Built in plugin's and a listed one's alone)
    const cases: [string, PluginRecord, PluginsCatalog | null, boolean, boolean][] = [
      ["bundled", simulators, null, true, true],
      ["dev-linked", clock, null, true, false],
      ["registry, listed as VibeField", kanban, asVibeField, true, true],
      ["registry, listed as community", kanban, CATALOG_LISTED, true, true],
      ["registry, unlisted", kanban, CATALOG_FIXTURES.ready, true, true],
      ["sideload", store, null, true, false],
      ["registry, held while community plugins are off", held, CATALOG_LISTED, false, false],
    ];
    for (const [source, record, catalog, carries, elsewhere] of cases) {
      const page = pluginPage(record, catalog, PLUGINS_FIXTURE_LISTED_SNAPSHOT, true);
      const row = installedRows({ generation: 1, problems: [], plugins: [record] }, catalog)[0];
      expect([
        source,
        controlsHere(record),
        row?.onOff !== null,
        page.onOff !== null,
        page.powers.some((power) => power.switch !== null),
        page.elsewhere !== null,
      ]).toEqual([source, carries, carries, carries, carries, elsewhere]);
      // no page says its switches aren't here (MK-O22's words, retired at N18)
      expect(JSON.stringify(page)).not.toContain("aren't here yet");
    }
    // a Built in plugin that isn't working has no one switch (as Settings → Plugins' row)
    const broken: PluginRecord = {
      ...recordOf(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator"),
      state: "invalid",
      enabled: false,
    };
    expect(pluginPage(broken, null, PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, true).onOff).toBeNull();
  });

  it("puts a Built in plugin's one switch and each power it asked for on its page, and says why one can't be had", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator");
    const page = pluginPage(simulators, null, PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, false);
    expect(page.powers.map((power) => [power.key, power.switch, power.cant])).toEqual([
      ["surface.capture", true, null],
      ["canvas.read", true, null],
      // taken back: its switch off
      ["canvas.write", false, null],
      // its kind of plugin can't have it: no switch, and why
      ["process.spawn", null, words.SWITCH_WORDS.cant["entry-kind"]],
    ]);
    expect([page.onOff, page.powersLive, page.elsewhere, page.offLine]).toEqual([
      true,
      true,
      words.SWITCH_WORDS.elsewhere,
      null,
    ]);
  });

  it("shows an off Development plugin's powers as fieldd grants them once on, taking no press, and never your other desktops", () => {
    const clock = recordOf(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "example.desk-clock");
    // fieldd's off plugin holds no power
    expect(clock.grantedCapabilities).toEqual([]);
    const page = pluginPage(clock, null, PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, false);
    expect(page.powers.map((power) => [power.key, power.switch])).toEqual([
      ["canvas.read", true],
      ["net.outbound", false],
    ]);
    expect([page.onOff, page.powersLive, page.offLine, page.elsewhere]).toEqual([
      false,
      false,
      words.SWITCH_WORDS.off,
      // a Development plugin never enters the install-set (fieldd's install-reconciler.ts,
      // `publishInner`)
      null,
    ]);
    // turned on, fieldd holds what it asked for less what was taken back
    const on: PluginRecord = {
      ...clock,
      enabled: true,
      state: "enabled",
      grantedCapabilities: ["canvas.read"],
    };
    const live = pluginPage(on, null, PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, false);
    expect([live.powers.map((power) => power.switch), live.powersLive, live.offLine]).toEqual([
      [true, false],
      true,
      null,
    ]);
  });

  it("reads a power's switch in one place, the page's and the controller's (VF-PM 19:05:12Z, 3)", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator");
    const clock = recordOf(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "example.desk-clock");
    const kanban = recordOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban");
    const held = recordOf(PLUGINS_FIXTURE_HELD_SNAPSHOT, "acme.kanban");
    const asked = {
      ...simulators,
      requestedCapabilities: [...simulators.requestedCapabilities, "made.up"],
    };
    expect([
      powerSwitchOf(simulators, "surface.capture"),
      powerSwitchOf(simulators, "canvas.write"),
      // can't have it here, never asked for it, or no words to say it: no switch
      powerSwitchOf(simulators, "process.spawn"),
      powerSwitchOf(simulators, "doc.write"),
      powerSwitchOf(asked, "made.up"),
      // off: what it would hold once on, taking no press
      powerSwitchOf(clock, "canvas.read"),
      powerSwitchOf(clock, "net.outbound"),
      // a plugin from the list: its own, as a Built in one's (N18)
      powerSwitchOf(kanban, "canvas.write"),
      // held while community plugins are off: none, for no switch would move it
      powerSwitchOf(held, "canvas.write"),
    ]).toEqual([
      { on: true, live: true },
      { on: false, live: true },
      null,
      null,
      null,
      { on: true, live: false },
      { on: false, live: false },
      { on: true, live: true },
      null,
    ]);
    // the page's switches are the same read
    const page = pluginPage(simulators, null, PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, false);
    expect(page.powers.map((power) => power.switch)).toEqual(
      page.powers.map((power) => powerSwitchOf(simulators, power.key)?.on ?? null),
    );
  });

  it("calls a refusal stale once the snapshot shows its switch the way it was being turned (VF-PM 19:05:12Z, 4)", () => {
    const snapshot = PLUGINS_FIXTURE_SWITCHES_SNAPSHOT;
    const off = {
      ...snapshot,
      plugins: snapshot.plugins.map((plugin) =>
        plugin.id === "vibefield.simulator"
          ? { ...plugin, enabled: false, state: "disabled" as const, grantedCapabilities: [] }
          : plugin,
      ),
    };
    const turningOff = { id: "vibefield.simulator", capability: null, turningOn: false };
    expect([refusalStale(turningOff, snapshot), refusalStale(turningOff, off)]).toEqual([
      false,
      true,
    ]);
    const granting = { id: "vibefield.simulator", capability: "canvas.write", turningOn: true };
    const granted = {
      ...snapshot,
      plugins: snapshot.plugins.map((plugin) =>
        plugin.id === "vibefield.simulator"
          ? {
              ...plugin,
              grantedCapabilities: [...plugin.grantedCapabilities, "canvas.write"],
              deniedCapabilities: plugin.deniedCapabilities.filter(
                (entry) => entry.capability !== "canvas.write",
              ),
            }
          : plugin,
      ),
    };
    expect([refusalStale(granting, snapshot), refusalStale(granting, granted)]).toEqual([
      false,
      true,
    ]);
    // a plugin gone from the snapshot leaves nothing to say
    expect(refusalStale({ ...turningOff, id: "gone.plugin" }, snapshot)).toBe(true);
  });
});

/** One of Simulators' settings, as its page draws it (MK-4c2b's fixture). */
function simulatorsSetting(key: string): PageSetting {
  const record = recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "vibefield.simulator");
  const setting = settingsOf(record)?.rows.find((row) => row.key === key);
  if (setting === undefined) throw new Error(`the fixture's Simulators declares no ${key}`);
  return setting;
}

describe("a plugin's settings (MK-4c2b; §8 'Its settings', corrected for James's MK-O6)", () => {
  it("draws each setting by what its schema declares, as Settings → Plugins does", () => {
    expect(settingKind("secret", { type: "string" })).toBe("secret");
    expect(settingKind("user", { type: "string", enum: ["a", "b"] })).toBe("choice");
    expect(settingKind("user", { type: "string" })).toBe("text");
    expect(settingKind("device", { type: "integer" })).toBe("integer");
    expect(settingKind("user", { type: "number" })).toBe("number");
    expect(settingKind("user", { type: "boolean" })).toBe("switch");
    expect(settingKind("user", { type: "array" })).toBe("unsupported");
    expect(settingKind("user", {})).toBe("unsupported");
  });

  it("lists a Built in plugin's settings in its order, with its own words and bounds, and says where they go back", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "vibefield.simulator");
    const settings = settingsOf(simulators);
    expect(settings?.rows.map((setting) => [setting.key, setting.kind])).toEqual([
      ["showFrame", "switch"],
      ["phone", "choice"],
      ["frameRate", "integer"],
      ["caption", "text"],
      ["token", "secret"],
      ["sizes", "unsupported"],
    ]);
    expect(settings?.rows[2]).toEqual({
      key: "frameRate",
      title: "Frames each second",
      description: "How often a screen is drawn on your desk.",
      kind: "integer",
      options: [],
      min: 1,
      max: 60,
      fallback: 30,
    });
    expect(settings?.rows[1]?.options).toEqual(["iPhone 17", "iPhone 17 Pro", "iPhone Air"]);
    expect(settings?.rows[1]?.description).toBeNull();
    expect([settings?.live, settings?.foot, settings?.offLine]).toEqual([
      true,
      words.SETTINGS_WORDS.footSynced,
      null,
    ]);
    // no Undo and no Redo on the page (James's MK-O6), and no "Reset": Back to default (MK-4c2c)
    expect(Object.keys(settings ?? {}).sort()).toEqual(["foot", "live", "offLine", "rows"]);
    expect(Object.values(words.SETTINGS_WORDS).join(" ")).not.toMatch(/\b(undo|redo|reset)\b/i);
    // the page carries the same section
    const page = pluginPage(simulators, null, PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, true);
    expect(page.settings).toEqual(settings);
  });

  it("shows an off plugin's settings taking no input, and says how to change them", () => {
    const clock = settingsOf(recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "example.desk-clock"));
    expect([clock?.live, clock?.offLine, clock?.foot]).toEqual([
      false,
      words.SETTINGS_WORDS.off,
      words.SETTINGS_WORDS.footSynced,
    ]);
    // one that is on but not working takes no input either, and is not called off
    const simulators = recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "vibefield.simulator");
    const broken = settingsOf({ ...simulators, state: "invalid" });
    expect([broken?.live, broken?.offLine]).toEqual([false, null]);
    // one whose settings all stay on this desktop
    const pad = settingsOf(recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "vibefield.comment-pad"));
    expect(pad?.foot).toBe(words.SETTINGS_WORDS.footHere);
  });

  it("offers a kept setting its way back, a kept secret its removal, and one at its default none (MK-4c2c)", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "vibefield.simulator");
    const rows = settingsOf(simulators)?.rows ?? [];
    const of = (key: string): PageSetting => {
      const found = rows.find((setting) => setting.key === key);
      if (found === undefined) throw new Error(`no setting ${key}`);
      return found;
    };
    const kept = SettingsGetResult.parse({ isSet: true, value: false });
    const unset = SettingsGetResult.parse({ isSet: false });
    const keptSecret = SettingsGetResult.parse({ isSet: true, secret: true });
    const noSecret = SettingsGetResult.parse({ isSet: false, secret: true });
    expect(settingAct(of("showFrame"), kept)).toBe("toDefault");
    expect(settingAct(of("showFrame"), unset)).toBeNull();
    expect(settingAct(of("sizes"), kept)).toBe("toDefault");
    expect(settingAct(of("token"), keptSecret)).toBe("forget");
    expect(settingAct(of("token"), noSecret)).toBeNull();
  });

  it("carries a plugin from the list's settings, and a Sideloaded one's, as a Built in plugin's (N18)", () => {
    const kanban = settingsOf(recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "acme.kanban"));
    expect(kanban?.rows.map((row) => [row.key, row.title, row.kind])).toEqual([
      ["columns", "Columns on a new board", "integer"],
    ]);
    expect([kanban?.live, kanban?.foot, kanban?.offLine]).toEqual([
      true,
      words.SETTINGS_WORDS.footSynced,
      null,
    ]);
    const store = settingsOf(recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "example.kv-service"));
    expect(store?.rows.map((row) => [row.key, row.title, row.kind])).toEqual([
      ["limit", "Largest value", "integer"],
    ]);
    expect([store?.live, store?.foot]).toEqual([true, words.SETTINGS_WORDS.footHere]);
  });

  it("carries no section for a plugin held while community plugins are off, nor one that declares no setting (U2)", () => {
    // fieldd keeps it held whatever is sent (O3-C), so its page has no switch and no settings
    const listed = recordOf(PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, "acme.kanban");
    const held: PluginRecord = {
      ...listed,
      enabled: false,
      state: "disabled",
      held: "community-off",
    };
    expect(settingsOf(held)).toBeNull();
    expect(pluginPage(held, null, PLUGINS_FIXTURE_SETTINGS_SNAPSHOT, true).settings).toBeNull();
    const bare = recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.simulator");
    expect(settingsOf(bare)).toBeNull();
    const contributions = { ...bare.contributions, settings: { properties: {} } };
    expect(settingsOf({ ...bare, contributions })).toBeNull();
  });

  it("shows what fieldd keeps, or the default while nothing is kept, and never a secret", () => {
    const frame = simulatorsSetting("showFrame");
    expect(settingDraft(frame, { isSet: false })).toBe("true");
    expect(settingDraft(frame, { isSet: true, value: false })).toBe("false");
    const phone = simulatorsSetting("phone");
    expect(settingDraft(phone, { isSet: true, value: "iPhone Air" })).toBe("2");
    // nothing kept and no default, or a kept choice it no longer offers: no choice shown
    expect(settingDraft(phone, { isSet: false })).toBe("");
    expect(settingDraft(phone, { isSet: true, value: "iPhone 4" })).toBe("");
    const rate = simulatorsSetting("frameRate");
    expect(settingDraft(rate, { isSet: false })).toBe("30");
    expect(settingDraft(rate, { isSet: true, value: 45 })).toBe("45");
    expect(settingDraft(simulatorsSetting("caption"), { isSet: false })).toBe("");
    // a secret's field is empty, kept or not, whatever an answer carries
    const token = simulatorsSetting("token");
    const carried = { isSet: true, secret: true, value: "plum orchard lantern" };
    expect(settingDraft(token, carried) === "").toBe(true);
    expect(settingDraft(token, { isSet: false, secret: true }) === "").toBe(true);
  });

  it("sends a field's words, a number as a number and a secret as typed; nothing unchanged, blank or unreadable", () => {
    const unset = { isSet: false };
    const rate = simulatorsSetting("frameRate");
    expect(settingToSend(rate, "30", unset)).toBeNull();
    expect(settingToSend(rate, "45", unset)).toEqual({ value: 45 });
    expect(settingToSend(rate, " ", unset)).toBeNull();
    expect(settingToSend(rate, "lots", unset)).toBeNull();
    const caption = simulatorsSetting("caption");
    expect(settingToSend(caption, "", unset)).toBeNull();
    expect(settingToSend(caption, "Lab bench", unset)).toEqual({ value: "Lab bench" });
    const token = simulatorsSetting("token");
    const kept = { isSet: true, secret: true };
    const typed = "plum orchard lantern";
    expect(settingToSend(token, "", kept)).toBeNull();
    expect(settingToSend(token, typed, kept)?.value === typed).toBe(true);
    // a switch and a choice send from their own controls, never from a field
    expect(settingToSend(simulatorsSetting("showFrame"), "false", unset)).toBeNull();
    expect(settingToSend(simulatorsSetting("phone"), "1", unset)).toBeNull();
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
  // MK-4d's names: a set and where it hangs, and a set of one
  "INSTALLED_LINE.placed": [
    [4, ["Things", "Tools"], "1.0.0"],
    [1, ["Things"], "1.0.0"],
  ],
  "INSTALLED_LINE.noObject": [[null], ["a service"]],
  "INSTALLED_LINE.broken": [["Desk clock"]],
  // MK-5b (2026-11-14): a plugin that can't run here, a line of its own with no Try again
  "INSTALLED_LINE.cantRun": [["Desk clock"]],
  // MK-O3D: the community tile's line, with no plugin by other people listed, one, and many
  "COMMUNITY_WORDS.line": [[0], [1], [12]],
  hasWords: [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ],
  hangsUnder: [["Things"]],
  noMatchWords: [["clock"]],
  installedFootWords: [
    [6, 14, 1],
    [1, 1, 0],
  ],
  listTime: [
    [PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW],
    [PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW + 7 * 24 * 60 * 60_000],
  ],
  updatesWords: [[0], [1], [2]],
  "PAGE_WORDS.back": [["Installed"]],
  "PAGE_WORDS.inPalette": [[true], [false]],
  "PAGE_WORDS.tools": [[1], [6]],
  "SWITCH_WORDS.refused": [[true], [false]],
  // MK-4e (acts a): Discover's shelf, a set's picture, a search that finds none
  "SHELF_WORDS.count": [[0], [1], [3]],
  "SHELF_WORDS.has": [["Clock"]],
  "SHELF_WORDS.none": [["clock"]],
  // acts b: the install card and its steps
  "CARD_WORDS.ask": [["Desk clock"]],
  "CARD_WORDS.adds": [[1], [3]],
  "CARD_WORDS.tools": [[1], [4]],
  "CARD_WORDS.here": [[true], [false]],
  "CARD_WORDS.reaches": [[2], [3]],
  "INSTALL_WORDS.installing": [[0], [1], [3]],
  "INSTALL_WORDS.failed": [["Desk clock"]],
  // acts c: Remove… and its two questions
  listNames: [[["Laptop"]], [["Laptop", "Studio"]], [["Laptop", "Studio", "Office"]]],
  "REMOVE_WORDS.ask": [["Desk clock"]],
  "REMOVE_WORDS.missing": [["3"]],
  "REMOVE_WORDS.askData": [["Desk clock"]],
  "REMOVE_WORDS.deletes": [["this Mac"]],
  "REMOVE_WORDS.others": [
    [["Laptop"], "Desk clock"],
    [["Laptop", "Studio"], "Desk clock"],
  ],
  "REMOVE_WORDS.here": [[true], [false]],
  // O3-E: the first community install's line
  "INSTALL_WORDS.firstCommunity": [["this Mac"]],
  // UC-C: Updates' rows and the update card
  "UPDATE_WORDS.head": [
    [1, "14:02"],
    [3, "14:02"],
  ],
  "UPDATE_WORDS.current": [["14:02"]],
  "UPDATE_WORDS.line": [["1.0.0", "1.1.0", "Nov 6"]],
  "UPDATE_WORDS.adds": [["Timer"]],
  "UPDATE_WORDS.removes": [["Timer"]],
  "UPDATE_WORDS.updated": [["1.1.0"]],
  "UPDATE_WORDS.failed": [["Desk clock"]],
  "UPDATE_CARD_WORDS.ask": [["Desk clock"]],
  "UPDATE_CARD_WORDS.here": [[true], [false]],
  "UPDATE_CARD_WORDS.missing": [["2"]],
  releaseDay: [[PLUGINS_FIXTURE_READ_AT]],
  // MK-4d: the act that shows a set on the pegboard
  showWords: [[1], [3]],
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
  it("names no key, signature, hash, daemon, worker, restart, reload or registry", () => {
    const out: string[] = [];
    const uncalled: string[] = [];
    const used = new Set<string>();
    for (const [name, value] of Object.entries(words)) said(value, name, out, uncalled, used);
    expect(uncalled).toEqual([]);
    expect(Object.keys(SAMPLES).filter((path) => !used.has(path))).toEqual([]);
    expect(out.length).toBeGreaterThan(30);
    // no exemption: James's MK-O5 pick took the last word that said it (§9, Sources)
    const all = out.join("\n");
    expect(all).not.toMatch(/registry|signature|\bkeys?\b|hash|daemon|worker|restart|reload/i);
  });

  it("says the doors as §9 holds them, and a count only once a read found one (MK-4b, MK-4d)", () => {
    expect(words.PLUGINS_DOOR).toEqual({
      name: "Plugins…",
      check: "Check plugins for updates",
      nameWhere: "Me menu",
      checkWhere: "Plugins",
      more: "More in Plugins…",
    });
    expect(words.updatesWords(0)).toBeNull();
    expect(words.updatesWords(1)).toBe("1 update");
    expect(words.updatesWords(2)).toBe("2 updates");
  });
});

/** The pegboard's names as the board's door hands them (MK-4d's names): each category's id and the
 * board's own name for it, in the board's order. The fixtures' objects that hang, hang under
 * "devices". */
const BOARD: ReadonlyMap<string, string> = new Map([
  ["things", "Things"],
  ["devices", "Devices"],
  ["tools", "Tools"],
]);

type Objects = PluginRecord["contributions"]["objects"];

/** A fixture plugin with its objects changed as `change` says, the rest as the fixture holds it. */
function reshaped(record: PluginRecord, change: (objects: Objects) => Objects): PluginRecord {
  return {
    ...record,
    contributions: { ...record.contributions, objects: change(record.contributions.objects) },
  };
}

/** Kanban's Card moved under "things", so its set hangs across two categories. */
function cardUnderThings(object: Objects[number]): Objects[number] {
  if (object.type !== "AcmeCard" || object.tray === undefined) return object;
  return { ...object, tray: { ...object.tray, category: "things" } };
}

describe("the pegboard's names in the popup (MK-4d's names; James's MK-O10 pick A)", () => {
  it("says where a set hangs on Installed's line by the board's names, as §9's ruled line", () => {
    const rows = installedRows(PLUGINS_FIXTURE_LISTED_SNAPSHOT, CATALOG_LISTED, "", BOARD);
    const line = (id: string) => rows.find((row) => row.id === id)?.line;
    // Simulators' Watch hangs under Devices; its Phone and Tablet hang nowhere, and still count
    expect(line("vibefield.simulator")).toBe("3 objects · Devices · 1.2.0 · comes with VibeField");
    expect(line("acme.kanban")).toBe("2 objects · Devices · 2.1.0");
    // Comment pad's one object hangs nowhere: its set alone; off, and no object, as before
    expect(line("vibefield.comment-pad")).toBe("1 object · 0.1.0 · comes with VibeField");
    expect(line("example.desk-clock")).toBe(words.INSTALLED_LINE.off);
    expect(line("example.kv-service")).toBe("No objects · a service");
    // the words, as §9 rules them
    expect(words.INSTALLED_LINE.placed(4, ["Things", "Tools"], "1.0.0")).toBe(
      "4 objects · Things, Tools · 1.0.0",
    );
    expect(words.INSTALLED_LINE.placed(1, ["Things"], "1.0.0")).toBe("Hangs under Things · 1.0.0");
  });

  it("says a set of one as hanging, and a set across categories once each, in the board's order", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.simulator");
    const watch = reshaped(simulators, (objects) => objects.filter((o) => o.type === "SimWatch"));
    const kanban = recordOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban");
    // its Card moved under Things: the board names Things before Devices
    const across = reshaped(kanban, (objects) => objects.map(cardUnderThings));
    const twice = reshaped(kanban, (objects) => [...objects, ...objects]);
    const lines = (plugins: PluginRecord[]) =>
      installedRows({ ...PLUGINS_FIXTURE_SNAPSHOT, plugins }, null, "", BOARD).map((r) => r.line);
    expect(lines([watch])).toEqual(["Hangs under Devices · 1.2.0 · comes with VibeField"]);
    expect(lines([across])).toEqual(["2 objects · Things, Devices · 2.1.0"]);
    expect(lines([twice])).toEqual(["4 objects · Devices · 2.1.0"]);
  });

  it("says under each object in What it adds where it hangs, and nothing under one that hangs nowhere", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.simulator");
    expect(pluginPage(simulators, null, PLUGINS_FIXTURE_SNAPSHOT, true, BOARD).adds).toEqual([
      { key: "object:SimPhone", words: "Phone" },
      { key: "object:SimTablet", words: "Tablet" },
      { key: "object:SimWatch", words: "Apple Watch", under: "Hangs under Devices" },
    ]);
    // its tools keep their own line, with nothing under it
    const kanban = recordOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban");
    const page = pluginPage(kanban, CATALOG_LISTED, PLUGINS_FIXTURE_LISTED_SNAPSHOT, true, BOARD);
    expect(page.adds.map((line) => [line.words, line.under])).toEqual([
      ["Board", "Hangs under Devices"],
      ["Card", "Hangs under Devices"],
      ["1 tool for your agents", undefined],
    ]);
    expect(words.hangsUnder("Things")).toBe("Hangs under Things");
  });

  it("says no place with no board to read, where the board names none, or while the plugin is off", () => {
    const simulators = recordOf(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.simulator");
    const set = "3 objects · 1.2.0 · comes with VibeField";
    for (const names of [null, new Map([["things", "Things"]]), new Map<string, string>()]) {
      const page = pluginPage(simulators, null, PLUGINS_FIXTURE_SNAPSHOT, true, names);
      expect(page.adds.map((line) => line.under)).toEqual([undefined, undefined, undefined]);
      const rows = installedRows(PLUGINS_FIXTURE_SNAPSHOT, null, "", names);
      expect(rows.find((row) => row.id === "vibefield.simulator")?.line).toBe(set);
    }
    // the default, as every caller but the popup's controller asks: no names
    expect(installedRows(PLUGINS_FIXTURE_SNAPSHOT, null)).toEqual(
      installedRows(PLUGINS_FIXTURE_SNAPSHOT, null, "", null),
    );
    // off, turned off or held while community plugins are off: the board hangs none of its kinds
    const kanban = recordOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban");
    const turnedOff: PluginRecord = { ...kanban, enabled: false, state: "disabled" };
    const held: PluginRecord = { ...turnedOff, held: "community-off" };
    for (const off of [turnedOff, held]) {
      const snapshot = { ...PLUGINS_FIXTURE_LISTED_SNAPSHOT, plugins: [off] };
      const page = pluginPage(off, CATALOG_LISTED, snapshot, true, BOARD);
      expect(page.adds.some((line) => line.under !== undefined)).toBe(false);
      expect(installedRows(snapshot, CATALOG_LISTED, "", BOARD)[0]?.line).toBe(
        off.held === undefined ? words.INSTALLED_LINE.off : words.HELD_LINE.objects,
      );
    }
  });

  it("says a place by the board's own name for it, never its category's id", () => {
    const names = new Map([["devices", "On the bench"]]);
    const rows = installedRows(PLUGINS_FIXTURE_LISTED_SNAPSHOT, CATALOG_LISTED, "", names);
    const kanban = recordOf(PLUGINS_FIXTURE_LISTED_SNAPSHOT, "acme.kanban");
    const page = pluginPage(kanban, CATALOG_LISTED, PLUGINS_FIXTURE_LISTED_SNAPSHOT, true, names);
    expect(rows.find((row) => row.id === "acme.kanban")?.line).toBe(
      "2 objects · On the bench · 2.1.0",
    );
    expect(page.adds[0]?.under).toBe("Hangs under On the bench");
    expect(JSON.stringify([rows, page])).not.toContain("devices");
  });
});
