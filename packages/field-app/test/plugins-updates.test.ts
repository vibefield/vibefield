// @vitest-environment happy-dom
import { type PluginRecord, pluginPowerWords } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_UPDATES,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_OUTDATED_SNAPSHOT,
  PLUGINS_FIXTURE_READ_AT,
  PLUGINS_FIXTURE_UPDATE_DOWNLOADS,
} from "../src/design-system/plugins-fixtures";
import {
  dropCarry,
  keepCarry,
  PLUGINS_CARRY_FRESH_MS,
  type PluginsCarry,
  takeCarry,
} from "../src/frame/plugins/plugins-carry";
import type { InstallRefusal } from "../src/frame/plugins/plugins-install";
import { pluginsPortOver } from "../src/frame/plugins/plugins-port";
import {
  asksFirst,
  removedObjects,
  rowAct,
  takeable,
  type UpdateFlow,
  type UpdateRow,
  updateAllAct,
  updateAllOrder,
  updateCard,
  updatePageAct,
  updateRows,
  updatesHead,
  versionNewer,
} from "../src/frame/plugins/plugins-updates";
import * as words from "../src/frame/plugins/plugins-words";

// MK-UC's UC-C — Updates' rows and the update card's window half (DESIGN.md §8 "Updates", §9
// "Updates"; James's pick on the board, 2026-11-12 06:08:01Z: "Yes: show the card when an update
// asks for more"): the rows read from the snapshot and the list held, the head, Update all's order,
// the update card (the install card's own, naming the new powers alone), a row's and a page's act
// in every step, the note the window comes back fresh by (MK-E6), and the port's update door over a
// recording client. Pure, but for the window's own session: no window, no fieldd, no network.

afterEach(() => {
  sessionStorage.clear();
});

const installed = (id: string): PluginRecord => {
  const record = PLUGINS_FIXTURE_OUTDATED_SNAPSHOT.plugins.find((plugin) => plugin.id === id);
  if (record === undefined) throw new Error(`the fixture's desktop has no ${id}`);
  return record;
};
const download = (id: string): PluginRecord => {
  const record = PLUGINS_FIXTURE_UPDATE_DOWNLOADS[id]?.record;
  if (record === undefined) throw new Error(`the fixture has no update for ${id}`);
  return record;
};
const rows = (): UpdateRow[] => updateRows(PLUGINS_FIXTURE_OUTDATED_SNAPSHOT, CATALOG_UPDATES);
const rowOf = (id: string, from: readonly UpdateRow[] = rows()): UpdateRow => {
  const row = from.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return row;
};
const settled = {
  flow: null,
  failed: new Map<string, InstallRefusal>(),
  busy: false,
  state: "ready",
  away: false,
  snapshot: PLUGINS_FIXTURE_OUTDATED_SNAPSHOT,
  onMac: true,
} as const;

describe("which updates (§8 'Which updates')", () => {
  it("compares versions as fieldd does: a.b.c, a prerelease tag dropped", () => {
    expect(versionNewer("0.7.0", "0.6.1")).toBe(true);
    expect(versionNewer("1.0.0", "1.0.0")).toBe(false);
    expect(versionNewer("0.9.9", "1.0.0")).toBe(false);
    expect(versionNewer("1.1.0-beta.1", "1.0.0")).toBe(true);
  });

  it("lists each plugin from the list whose entry is newer, by title, with its line and what it changes", () => {
    const listed = rows();
    expect(listed.map((row) => row.id)).toEqual([
      "vibefield.burndown",
      "vibefield.notes",
      "vibefield.timers",
    ]);
    const notes = rowOf("vibefield.notes", listed);
    expect([notes.from, notes.to, notes.line]).toEqual(["0.6.1", "0.7.0", "0.6.1 → 0.7.0 · Nov 7"]);
    expect([notes.changes, notes.asksFirst, notes.source]).toEqual([
      null,
      false,
      words.SOURCE_WORDS.vibefield,
    ]);
    const timers = rowOf("vibefield.timers", listed);
    expect([timers.changes, timers.asksFirst]).toEqual(["Adds Alarm · Removes Stopwatch", true]);
    expect(rowOf("vibefield.burndown", listed).compatible).toBe(false);
    // a Built in, Development or Sideloaded plugin is never an update here, whatever the list holds
    expect(listed.some((row) => row.id === "vibefield.simulator")).toBe(false);
  });

  it("keeps the rows whose plugin holds the typed words, and an update this opening took", () => {
    const found = updateRows(PLUGINS_FIXTURE_OUTDATED_SNAPSHOT, CATALOG_UPDATES, "stopwatch");
    expect(found.map((row) => row.id)).toEqual(["vibefield.timers"]);
    const taken = new Map([["vibefield.notes", "0.7.0"]]);
    const withNotes = {
      ...PLUGINS_FIXTURE_OUTDATED_SNAPSHOT,
      plugins: PLUGINS_FIXTURE_OUTDATED_SNAPSHOT.plugins.map((plugin) =>
        plugin.id === "vibefield.notes" ? download("vibefield.notes") : plugin,
      ),
    };
    const notes = rowOf("vibefield.notes", updateRows(withNotes, CATALOG_UPDATES, "", taken));
    expect([notes.done, takeable(notes)]).toEqual(["0.7.0", false]);
  });

  it("says how many can be taken and when the list was read, or that everything is up to date", () => {
    const when = words.listTime(PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW);
    expect(updatesHead(rows(), CATALOG_UPDATES, PLUGINS_FIXTURE_NOW)).toBe(
      `2 updates · checked ${when}`,
    );
    expect(updatesHead([], CATALOG_UPDATES, PLUGINS_FIXTURE_NOW)).toBe(
      `Everything is up to date · checked ${when}`,
    );
  });

  it("takes plugins with no object first in Update all, and passes one that can't run here", () => {
    expect(updateAllOrder(rows())).toEqual(["vibefield.notes", "vibefield.timers"]);
    expect(updateAllAct(rows(), false, "ready", false)).toEqual({
      words: words.UPDATE_WORDS.allAsks,
      live: true,
    });
    expect(updateAllAct(rows(), true, "ready", false)?.live).toBe(false);
    expect(updateAllAct(rows(), false, "unreachable", false)?.live).toBe(false);
    expect(updateAllAct([rowOf("vibefield.burndown")], false, "ready", false)).toBeNull();
  });
});

describe("the update card (§9 'Updates', the update card)", () => {
  it("is the install card's own, naming only the new powers, where it updates, and its act's word", () => {
    const card = updateCard(download("vibefield.notes"), ["net.outbound"], [], null, true);
    expect(card).toEqual({
      ask: "Update Notes?",
      adds: null,
      objects: [],
      tools: null,
      can: words.UPDATE_CARD_WORDS.can,
      powers: [
        {
          key: "net.outbound",
          words: pluginPowerWords("net.outbound", { onMac: true }),
          under: null,
          whose: null,
        },
      ],
      reaches: "It updates on this Mac.",
      desktops: [],
      missing: null,
      confirm: words.UPDATE_CARD_WORDS.confirm,
    });
    expect(updateCard(download("vibefield.notes"), [], [], null, false).reaches).toBe(
      "It updates on this PC.",
    );
  });

  it("says what an update leaves missing, and no 'This version can also:' when it names no new power", () => {
    const removes = removedObjects(installed("vibefield.timers"), download("vibefield.timers"));
    expect(removes).toEqual(["Stopwatch"]);
    const card = updateCard(download("vibefield.timers"), [], removes, null, true);
    expect([card.can, card.powers, card.missing]).toEqual([
      null,
      [],
      "Stopwatch objects on your desks will draw as missing.",
    ]);
  });

  it("asks first when fieldd says it can do more, when it doesn't say, or when it drops an object", () => {
    expect(asksFirst(["net.outbound"], [])).toBe(true);
    expect(asksFirst(null, [])).toBe(true);
    expect(asksFirst([], ["Stopwatch"])).toBe(true);
    expect(asksFirst([], [])).toBe(false);
  });
});

describe("a row's and a page's act (§8 'Its steps', 'A page's act')", () => {
  const at = (step: UpdateFlow["at"], id = "vibefield.notes"): UpdateFlow => ({
    id,
    where: "row",
    all: false,
    at: step,
  });

  it("says Update, Update… for one that asks first, and words for one that can't run here", () => {
    expect(rowAct({ ...settled, row: rowOf("vibefield.notes") })).toEqual({
      kind: "update",
      live: true,
      asks: false,
    });
    expect(rowAct({ ...settled, row: rowOf("vibefield.timers") })).toMatchObject({ asks: true });
    expect(rowAct({ ...settled, row: rowOf("vibefield.burndown") })).toEqual({
      kind: "needs-newer",
    });
  });

  it("takes each step where its act stood, and none while another update or an install holds the presses", () => {
    const row = rowOf("vibefield.notes");
    expect(rowAct({ ...settled, row, flow: at({ step: "downloading" }) })).toEqual({
      kind: "downloading",
    });
    const card = rowAct({
      ...settled,
      row,
      flow: at({
        step: "card",
        candidate: "c".repeat(32),
        record: download("vibefield.notes"),
        asksFor: ["net.outbound"],
        removes: [],
      }),
    });
    expect(card).toMatchObject({ kind: "card", live: true, card: { ask: "Update Notes?" } });
    expect(rowAct({ ...settled, row, flow: at({ step: "updating", version: "0.7.0" }) })).toEqual({
      kind: "updating",
    });
    const refused = (refusal: InstallRefusal) => new Map([["vibefield.notes", refusal]]);
    expect(rowAct({ ...settled, row, failed: refused("failed") })).toEqual({
      kind: "failed",
      live: true,
    });
    // refused as needing a newer VibeField, by its kind alone: it says so, with no Try again
    expect(rowAct({ ...settled, row, failed: refused("incompatible") })).toEqual({
      kind: "needs-newer",
    });
    expect(rowAct({ ...settled, row, busy: true })).toMatchObject({ kind: "update", live: false });
    expect(rowAct({ ...settled, row, away: true })).toMatchObject({ kind: "update", live: false });
  });

  it("gives a page Update where Installed stood, its own Updating… and failure, and Installed once taken or when it can't run here", () => {
    expect(updatePageAct({ kind: "update", live: true, asks: true }, "Timers")).toEqual({
      kind: "update",
      live: true,
      asks: true,
    });
    expect(updatePageAct({ kind: "updating" }, "Notes")).toEqual({
      kind: "installing",
      words: words.UPDATE_WORDS.updating,
    });
    expect(updatePageAct({ kind: "failed", live: true }, "Notes")).toEqual({
      kind: "failed",
      words: "VibeField didn't update Notes. Nothing changed.",
      live: true,
    });
    expect(updatePageAct({ kind: "updated" }, "Notes")).toEqual({ kind: "installed" });
    // the plugin you have runs: only its update can't, and Updates' row says so, never its page
    expect(updatePageAct({ kind: "needs-newer" }, "Burndown")).toEqual({ kind: "installed" });
  });
});

describe("the note the window comes back fresh by (MK-E6; plugins-carry.ts)", () => {
  it("is read once, within a minute of its writing, and then gone", () => {
    const note = { page: { id: "vibefield.timers", from: "updates" as const }, rest: [], done: [] };
    keepCarry(note, 1_000);
    expect(takeCarry(1_000 + PLUGINS_CARRY_FRESH_MS)).toEqual(note);
    expect(takeCarry(1_000)).toBeNull();
    keepCarry(note, 1_000);
    expect(takeCarry(1_001 + PLUGINS_CARRY_FRESH_MS)).toBeNull();
  });

  it("carries Update all's rest and what it took, and reads nothing it can't", () => {
    const all: PluginsCarry = {
      page: null,
      rest: ["vibefield.timers"],
      done: [["vibefield.notes", "0.7.0"]],
    };
    keepCarry(all, 5);
    expect(takeCarry(5)).toEqual(all);
    sessionStorage.setItem("vf-plugins-carry", JSON.stringify({ v: 1, at: 5, page: { id: 7 } }));
    expect(takeCarry(5)).toBeNull();
    sessionStorage.setItem("vf-plugins-carry", "not json");
    expect(takeCarry(5)).toBeNull();
    keepCarry(all, 5);
    dropCarry();
    expect(takeCarry(5)).toBeNull();
  });
});

describe("the port's update door (MK-UC's plugins.install.prepare with update)", () => {
  it("asks for the version its row showed, as an update, and parses fieldd's answer", async () => {
    const sent: [string, Record<string, unknown>][] = [];
    const port = pluginsPortOver({
      request: async (method, params) => {
        sent.push([method, params]);
        return {
          candidate: "c".repeat(32),
          record: download("vibefield.notes"),
          update: { from: "0.6.1", asksFor: ["net.outbound"] },
        };
      },
    });
    const prepared = await port.prepareUpdate("vibefield.notes", "0.7.0");
    expect(sent).toEqual([
      ["plugins.install.prepare", { id: "vibefield.notes", version: "0.7.0", update: true }],
    ]);
    expect(prepared.update).toEqual({ from: "0.6.1", asksFor: ["net.outbound"] });
  });
});
