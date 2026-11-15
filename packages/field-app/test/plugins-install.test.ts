import { PluginRecord, PluginsCatalog } from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { describe, expect, it } from "vitest";
import {
  CATALOG_SHELF,
  PLUGINS_FIXTURE_CANDIDATE,
  PLUGINS_FIXTURE_DOWNLOADS,
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_ROSTER,
  PLUGINS_FIXTURE_SNAPSHOT,
} from "../src/design-system/plugins-fixtures";
import {
  boardSet,
  cardDesktops,
  type InstallFlow,
  installCard,
  installLive,
  installRefusal,
  pageAct,
  refusedWhileUpdating,
} from "../src/frame/plugins/plugins-install";
import { pluginsPortOver } from "../src/frame/plugins/plugins-port";
import { listedPage } from "../src/frame/plugins/plugins-shelf";
import * as words from "../src/frame/plugins/plugins-words";

// O2-C — the install card's window half (DESIGN.md §8 "Every install asks first", "Real progress"
// and the act drawn under it; §9 "The install card", "Installing, and after"): the card read from
// the row fieldd answers for a download and this desktop's roster, a page's act in every step, and
// the port's three doors and its roster read, and a refusal worded by its kind alone. MK-O3D: the
// community statement's act at this desktop's first community install, and a community set's
// Install while community plugins are off. Pure, but for the port over a recording client: no
// window, no fieldd, no network.

const download = (id: string): PluginRecord => {
  const record = PLUGINS_FIXTURE_DOWNLOADS[id];
  if (record === undefined) throw new Error(`the fixture has no download for ${id}`);
  return record;
};

/** The download with fields of its own: what it asks for, the objects it adds, the tools it brings.
 */
const shaped = (fields: {
  requested?: readonly string[];
  objects?: readonly unknown[];
  tools?: readonly unknown[];
  declares?: readonly unknown[];
}): PluginRecord => {
  const base = download("vibefield.desk-things");
  return PluginRecord.parse({
    ...base,
    requestedCapabilities: fields.requested ?? base.requestedCapabilities,
    contributions: {
      ...base.contributions,
      objects: fields.objects ?? base.contributions.objects,
      capabilities: fields.declares ?? [],
      ...(fields.tools !== undefined ? { mcp: { tools: fields.tools, servers: [] } } : {}),
    },
  });
};

describe("the desktops a card names (§8 'What the card reads')", () => {
  it("names this desktop first, then each whose VibeField said itself, by name — never a bare tailnet device", () => {
    expect(cardDesktops(PLUGINS_FIXTURE_ROSTER)).toEqual([
      { key: "fixture-studio", name: "studio", os: "macos" },
      { key: "fixture-mini", name: "mini", os: "macos" },
      { key: "fixture-tower", name: "tower", os: "windows" },
    ]);
  });

  it("says nothing when the roster couldn't be read", () => {
    expect(cardDesktops(null)).toBeNull();
  });
});

describe("the install card (§9 'The install card')", () => {
  it("says what the plugin downloaded adds, what it can do, and the desktops it installs on", () => {
    const card = installCard(
      download("vibefield.desk-things"),
      PLUGINS_FIXTURE_SNAPSHOT,
      PLUGINS_FIXTURE_ROSTER,
      true,
    );
    expect(card).toEqual({
      ask: "Install Desk things?",
      adds: "It adds 4 objects to your pegboard:",
      objects: [
        { key: "object:DeskThingsClock", words: "Clock" },
        { key: "object:DeskThingsCalendar", words: "Calendar" },
        { key: "object:DeskThingsTimer", words: "Timer" },
        { key: "object:DeskThingsRuler", words: "Ruler" },
      ],
      tools: null,
      can: words.CARD_WORDS.can,
      powers: [
        { key: "canvas.read", words: "Read what's on the desk", under: null, whose: null },
        { key: "storage.self", words: "Keep its own data", under: null, whose: null },
      ],
      reaches: "It installs on your 3 desktops, because your desktops share one set of plugins.",
      desktops: [
        { key: "fixture-studio", name: "studio", os: "macos" },
        { key: "fixture-mini", name: "mini", os: "macos" },
        { key: "fixture-tower", name: "tower", os: "windows" },
      ],
    });
  });

  it("says this Mac (or this PC) with one desktop, and leaves the desktops unsaid with no roster", () => {
    const record = download("vibefield.desk-things");
    const alone = PLUGINS_FIXTURE_ROSTER.filter((device) => device.self);
    expect(installCard(record, null, alone, true).reaches).toBe("It installs on this Mac.");
    expect(installCard(record, null, alone, false).reaches).toBe("It installs on this PC.");
    expect(installCard(record, null, alone, true).desktops).toEqual([]);
    expect(installCard(record, null, null, true).reaches).toBeNull();
  });

  it("says one of a thing as one, and what a plugin that asks for nothing does", () => {
    const one = shaped({
      requested: [],
      objects: [download("vibefield.desk-things").contributions.objects[0]],
      tools: [{ name: "add_card", title: "Add a card", description: "Adds one.", method: "a.b" }],
    });
    const card = installCard(one, null, null, true);
    expect([card.adds, card.tools, card.can, card.powers]).toEqual([
      "It adds 1 object to your pegboard:",
      "It gives your agents 1 tool.",
      words.PAGE_WORDS.nothing,
      [],
    ]);
    const bare = installCard(shaped({ requested: [], objects: [] }), null, null, true);
    expect([bare.adds, bare.can]).toEqual([null, words.PAGE_WORDS.nothingNoObject]);
  });

  it("says a power of its own by its words and whose it is, and those it can't name in the page's line, once, never by an id", () => {
    const alarm = "x.vibefield.desk-things.alarm";
    const record = shaped({
      requested: [alarm, "fixture.unknown", "process.spawn", "fixture.other"],
      declares: [
        {
          id: "x.vibefield.desk-things.alarm",
          title: "Ring an alarm",
          description: "Plays a sound when a timer ends.",
          risk: "write",
        },
      ],
    });
    const card = installCard(record, PLUGINS_FIXTURE_LISTED_SNAPSHOT, null, false);
    // the page says each power VibeField can't describe in James's MK-O34 B word; the card says
    // that line once, where the page says the first, and the second, after a named one, unsaid
    expect(words.CARD_WORDS.unnamed).toBe(words.PAGE_WORDS.unnamed);
    expect(card.powers).toEqual([
      {
        key: "x.vibefield.desk-things.alarm",
        words: "Ring an alarm",
        under: "Plays a sound when a timer ends.",
        whose: "A power of its own, named by Desk things",
      },
      { key: "unnamed", words: words.PAGE_WORDS.unnamed, under: null, whose: null },
      { key: "process.spawn", words: "Run programs on this PC", under: null, whose: null },
    ]);
    expect(JSON.stringify(card)).not.toMatch(/fixture\.(unknown|other)/);
    // with none it can name, the card still says what it can do, over that one line
    const odd = installCard(
      shaped({ requested: ["fixture.unknown", "fixture.other"] }),
      null,
      null,
      true,
    );
    expect([odd.can, odd.powers]).toEqual([
      words.CARD_WORDS.can,
      [{ key: "unnamed", words: words.PAGE_WORDS.unnamed, under: null, whose: null }],
    ]);
    // a power its own plugin titled in those words is that plugin's: its own line, saying whose
    const titled = shaped({
      requested: ["x.vibefield.desk-things.odd", "fixture.unknown"],
      declares: [
        {
          id: "x.vibefield.desk-things.odd",
          title: words.PAGE_WORDS.unnamed,
          description: "Does something odd.",
          risk: "write",
        },
      ],
    });
    expect(installCard(titled, null, null, true).powers).toEqual([
      {
        key: "x.vibefield.desk-things.odd",
        words: words.PAGE_WORDS.unnamed,
        under: "Does something odd.",
        whose: "A power of its own, named by Desk things",
      },
      { key: "unnamed", words: words.PAGE_WORDS.unnamed, under: null, whose: null },
    ]);
  });
});

describe("a page's act (§8, the act drawn under 'Real progress')", () => {
  const entry = CATALOG_SHELF.plugins.find((listed) => listed.id === "vibefield.desk-things");
  const page = entry === undefined ? null : listedPage(entry);
  if (page === null) throw new Error("the fixture has no Desk things");
  const base = {
    page,
    entry,
    state: "ready" as const,
    flow: null,
    away: false,
    community: false,
    snapshot: PLUGINS_FIXTURE_SNAPSHOT,
    onMac: true,
  };
  const at = (step: InstallFlow["at"], id = "vibefield.desk-things"): InstallFlow => ({
    id,
    at: step,
  });
  const held = { kind: "install", live: false, note: null };

  it("is Install on a set this desktop doesn't have, live while fieldd answers and the list is current", () => {
    expect(pageAct(base)).toEqual({ kind: "install", live: true, note: null });
    expect(pageAct({ ...base, away: true })).toEqual(held);
    expect(pageAct({ ...base, state: "stale" })).toEqual(held);
    expect(pageAct({ ...base, state: "unreachable" })).toEqual({
      kind: "install",
      live: false,
      note: words.INSTALL_WORDS.offline,
    });
    expect(installLive("ready", false)).toBe(true);
  });

  it("says each step of its own install, and Installed once this desktop has it", () => {
    const downloading = pageAct({ ...base, flow: at({ step: "downloading" }) });
    expect(downloading).toEqual({ kind: "downloading" });
    const record = download("vibefield.desk-things");
    const card = pageAct({
      ...base,
      flow: at({ step: "card", candidate: PLUGINS_FIXTURE_CANDIDATE, record, roster: null }),
    });
    expect(card.kind === "card" ? card.card.ask : null).toBe("Install Desk things?");
    expect(pageAct({ ...base, flow: at({ step: "installing", objects: 4 }) })).toEqual({
      kind: "installing",
      words: "Installing 4 objects…",
    });
    expect(pageAct({ ...base, flow: at({ step: "failed", refusal: "failed" }) })).toEqual({
      kind: "failed",
      words: "VibeField didn't install Desk things. Nothing changed.",
      live: true,
    });
    // MK-4d: this desktop's plugins hold no Desk things here, so Installed offers no set to show
    expect(pageAct({ ...base, page: { ...page, installed: true } })).toEqual({
      kind: "installed",
      show: [],
    });
  });

  it("words a refusal by its kind: one this VibeField can't run needs a newer one, with no Try again", () => {
    expect(pageAct({ ...base, flow: at({ step: "failed", refusal: "incompatible" }) })).toEqual({
      kind: "needs-newer",
    });
    // Try again takes a press when Install would: never offline, nor on a community set while off
    const failed = at({ step: "failed", refusal: "failed" });
    expect(pageAct({ ...base, flow: failed, state: "unreachable" })).toMatchObject({
      kind: "failed",
      live: false,
    });
    const kanban = CATALOG_SHELF.plugins.find((listed) => listed.id === "acme.kanban");
    const theirs = kanban === undefined ? null : listedPage(kanban);
    if (theirs === null) throw new Error("the fixture has no Kanban");
    const theirsFailed = at({ step: "failed", refusal: "failed" }, "acme.kanban");
    expect(pageAct({ ...base, page: theirs, entry: kanban, flow: theirsFailed })).toMatchObject({
      kind: "failed",
      live: false,
    });
  });

  it("holds every other Install while another plugin installs, and ignores another's download", () => {
    expect(pageAct({ ...base, flow: at({ step: "downloading" }, "vibefield.burndown") })).toEqual({
      kind: "install",
      live: true,
      note: null,
    });
    expect(
      pageAct({ ...base, flow: at({ step: "installing", objects: 1 }, "vibefield.burndown") }),
    ).toEqual({ kind: "install", live: false, note: null });
  });

  it("takes no press for a community set while community plugins are off (fieldd refuses it, MK-2c)", () => {
    const kanban = CATALOG_SHELF.plugins.find((listed) => listed.id === "acme.kanban");
    const theirs = kanban === undefined ? null : listedPage(kanban);
    if (theirs === null) throw new Error("the fixture has no Kanban");
    // MK-O3D: and says why
    expect(pageAct({ ...base, page: theirs, entry: kanban })).toEqual({
      kind: "install",
      live: false,
      note: words.INSTALL_WORDS.communityOff,
    });
    // unread, they may be on: no press, and nothing said of a switch the window hasn't read
    expect(pageAct({ ...base, page: theirs, entry: kanban, community: null })).toEqual(held);
    expect(pageAct({ ...base, page: theirs, entry: kanban, community: true })).toEqual({
      kind: "install",
      live: true,
      note: null,
    });
  });

  it("stands the community statement in the card's place, naming this desktop (MK-O3D)", () => {
    const record = download("vibefield.desk-things");
    const statement = (roster: typeof PLUGINS_FIXTURE_ROSTER | null): InstallFlow =>
      at({ step: "statement", candidate: PLUGINS_FIXTURE_CANDIDATE, record, roster });
    expect(pageAct({ ...base, flow: statement(PLUGINS_FIXTURE_ROSTER) })).toEqual({
      kind: "statement",
      heading: "First community plugin on studio",
      live: true,
    });
    // with no roster read, this desktop as the card says it; while fieldd isn't answering,
    // Continue takes no press
    expect(pageAct({ ...base, flow: statement(null), onMac: false })).toEqual({
      kind: "statement",
      heading: "First community plugin on this PC",
      live: true,
    });
    expect(pageAct({ ...base, flow: statement(null), away: true })).toEqual({
      kind: "statement",
      heading: "First community plugin on this Mac",
      live: false,
    });
  });

  it("offers no Install for a set that needs a newer VibeField", () => {
    const burndown = CATALOG_SHELF.plugins.find((listed) => listed.id === "vibefield.burndown");
    const needs = burndown === undefined ? null : listedPage(burndown);
    if (needs === null) throw new Error("the fixture has no Burndown");
    expect(pageAct({ ...base, page: needs, entry: burndown })).toEqual({ kind: "needs-newer" });
  });

  it("says installing with no object, and one object as one", () => {
    expect(words.INSTALL_WORDS.installing(0)).toBe("Installing…");
    expect(words.INSTALL_WORDS.installing(1)).toBe("Installing 1 object…");
  });
});

/** A plugin this desktop has, as the fixture's snapshot holds it (Kanban, from the list, among
 * them). */
const mine = (id: string): PluginRecord => {
  const record = PLUGINS_FIXTURE_LISTED_SNAPSHOT.plugins.find((plugin) => plugin.id === id);
  if (record === undefined) throw new Error(`the fixture has no ${id}`);
  return record;
};

describe("Show them on the pegboard (MK-4d; MK-D8's fallback B, §8 'The pegboard')", () => {
  it("hands the board the objects that hang there, in the set's own order, while the plugin is on", () => {
    expect(boardSet(mine("acme.kanban"))).toEqual(["AcmeBoard", "AcmeCard"]);
    // the set's own order, whatever it is
    const things = download("vibefield.desk-things").contributions.objects;
    expect(boardSet(shaped({ objects: [...things].reverse() }))).toEqual([
      "DeskThingsRuler",
      "DeskThingsTimer",
      "DeskThingsCalendar",
      "DeskThingsClock",
    ]);
    // Simulators' Phone and Tablet have no pegboard entry: they hang nowhere, so Watch alone is
    // shown
    expect(boardSet(mine("vibefield.simulator"))).toEqual(["SimWatch"]);
    // once this desktop has Desk things, its page's act carries its four
    const entry = CATALOG_SHELF.plugins.find((listed) => listed.id === "vibefield.desk-things");
    if (entry === undefined) throw new Error("the fixture has no Desk things");
    const listed = listedPage(entry);
    if (listed === null) throw new Error("Desk things has no page from the list");
    const withThings = {
      ...PLUGINS_FIXTURE_SNAPSHOT,
      plugins: [...PLUGINS_FIXTURE_SNAPSHOT.plugins, download("vibefield.desk-things")],
    };
    expect(
      pageAct({
        page: { ...listed, installed: true },
        entry,
        state: "ready",
        flow: null,
        away: false,
        community: false,
        snapshot: withThings,
        onMac: true,
      }),
    ).toEqual({
      kind: "installed",
      show: ["DeskThingsClock", "DeskThingsCalendar", "DeskThingsTimer", "DeskThingsRuler"],
    });
  });

  it("offers none for a plugin that adds no object the board hangs, or one that is off", () => {
    // Comment pad's one object hangs nowhere; Key-value store adds none; Desk clock is turned off
    expect(boardSet(mine("vibefield.comment-pad"))).toEqual([]);
    expect(boardSet(mine("example.kv-service"))).toEqual([]);
    expect(boardSet(mine("example.desk-clock"))).toEqual([]);
    // held off while community plugins are off (MK-O3, "Stop"): the desk draws none of its kinds
    const held = PluginRecord.parse({
      ...mine("acme.kanban"),
      enabled: false,
      state: "disabled",
      held: "community-off",
    });
    expect(boardSet(held)).toEqual([]);
    expect(boardSet(undefined)).toEqual([]);
  });

  it("says Show on the pegboard for one, and Show them on the pegboard for more (§9)", () => {
    expect(words.showWords(1)).toBe("Show on the pegboard");
    expect(words.showWords(2)).toBe("Show them on the pegboard");
    expect(words.showWords(4)).toBe("Show them on the pegboard");
  });
});

describe("a refusal, worded by its kind and never its text (§8 'A failure'; the carry's F7)", () => {
  it("reads a plugin this VibeField can't run from the refusal's kind alone", () => {
    const refused = new FielddRpcError(
      "PRECONDITION_FAILED",
      "vibefield.desk-things@1.0.0 requires contracts ^9.0.0; this device has 0.1.0",
      false,
      { pluginKind: "PLUGIN_INCOMPATIBLE" },
    );
    expect(installRefusal(refused)).toBe("incompatible");
  });

  it("reads every other refusal as one, whatever its text says", () => {
    // item 322's refusal names an inside; the window reads its kind, never these words
    const slot = new FielddRpcError(
      "PRECONDITION_FAILED",
      "the copy of this release already in place does not match the artifact — not installed",
      false,
      { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
    );
    const late = new FielddRpcError(
      "NOT_FOUND",
      "This install took too long. Press Install again.",
      false,
    );
    const offline = new FielddRpcError("UNAVAILABLE", "client closed", true);
    const unknownKind = new FielddRpcError("PRECONDITION_FAILED", "PLUGIN_INCOMPATIBLE", false, {
      pluginKind: "PLUGIN_FROM_A_NEWER_DAEMON",
    });
    for (const error of [slot, late, offline, unknownKind, new Error("no"), "no", null]) {
      expect(installRefusal(error)).toBe("failed");
    }
  });
});

describe("a switch refused while its plugin is updating, read by its kind alone (item 440; §9)", () => {
  // fieldd's words for a switch behind an update; the window reads the kind, never them
  const said = "vibefield.desk-things: updating; the switch was not applied";

  it("reads a switch refused with the kind PLUGIN_UPDATING as its plugin updating", () => {
    const updating = new FielddRpcError("PRECONDITION_FAILED", said, true, {
      pluginKind: "PLUGIN_UPDATING",
    });
    expect(refusedWhileUpdating(updating), "the kind says the plugin is updating").toBe(true);
  });

  it("reads no other refusal as updating, whatever its text says", () => {
    const noKind = new FielddRpcError("PRECONDITION_FAILED", said, true);
    const otherKind = new FielddRpcError("PRECONDITION_FAILED", said, true, {
      pluginKind: "PLUGIN_INCOMPATIBLE",
    });
    for (const error of [noKind, otherKind, new Error(said), said, null, undefined]) {
      expect(refusedWhileUpdating(error)).toBe(false);
    }
  });
});

describe("the port's install doors (O2-C)", () => {
  it("asks fieldd's three doors and its roster with the parameters MK-O2B built, and parses each answer", async () => {
    const asked: [string, Record<string, unknown>][] = [];
    const record = download("vibefield.desk-things");
    const port = pluginsPortOver({
      request: async (method, params) => {
        asked.push([method, params]);
        if (method === "plugins.install.prepare") {
          return { candidate: PLUGINS_FIXTURE_CANDIDATE, record, extra: "kept" };
        }
        if (method === "device.list") return { devices: [] };
        return {};
      },
    });
    const prepared = await port.prepare("vibefield.desk-things");
    expect(prepared.candidate).toBe(PLUGINS_FIXTURE_CANDIDATE);
    expect(prepared.record.title).toBe("Desk things");
    await port.commit(PLUGINS_FIXTURE_CANDIDATE);
    await port.discard(PLUGINS_FIXTURE_CANDIDATE);
    expect(await port.desktops()).toEqual([]);
    expect(asked).toEqual([
      ["plugins.install.prepare", { id: "vibefield.desk-things" }],
      ["plugins.install.commit", { candidate: PLUGINS_FIXTURE_CANDIDATE }],
      ["plugins.install.discard", { candidate: PLUGINS_FIXTURE_CANDIDATE }],
      ["device.list", {}],
    ]);
  });

  it("refuses a download answer that isn't one, never casting it", async () => {
    const port = pluginsPortOver({ request: async () => ({ candidate: "not a handle" }) });
    await expect(port.prepare("vibefield.desk-things")).rejects.toThrow();
  });

  it("reads the shelf's list as fieldd's catalog shape", () => {
    expect(PluginsCatalog.safeParse(CATALOG_SHELF).success).toBe(true);
  });
});
