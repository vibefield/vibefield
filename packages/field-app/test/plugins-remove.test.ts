import type { PluginRecord } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_ROSTER,
  PLUGINS_FIXTURE_SNAPSHOT,
} from "../src/design-system/plugins-fixtures";
import { removable, removeQuestion } from "../src/frame/plugins/plugins-remove";
import * as words from "../src/frame/plugins/plugins-words";

// MK-4f — Remove… on a plugin's page (DESIGN.md §8 "The destructive uninstall affordance", Remove…
// drawn under "Real progress"; §9 "Installed, off and Remove…"): which pages carry it, and what its
// two questions say, James's MK-O4 sentences among them. Pure: no window, no fieldd.

const recordOf = (id: string): PluginRecord => {
  const record = PLUGINS_FIXTURE_LISTED_SNAPSHOT.plugins.find((plugin) => plugin.id === id);
  if (record === undefined) throw new Error(`the fixture has no ${id}`);
  return record;
};

describe("which pages carry Remove… (§8)", () => {
  it("a plugin from the plugin list's alone: never a Built in, Development or Sideloaded one", () => {
    expect(removable(recordOf("acme.kanban"))).toBe(true);
    for (const plugin of PLUGINS_FIXTURE_SNAPSHOT.plugins) expect(removable(plugin)).toBe(false);
    // the loop above holds each kind: the Development call is closed (§8, 2026-11-14), so a
    // Development page carries no Remove…, and fieldd removes no sideload
    const sources = PLUGINS_FIXTURE_SNAPSHOT.plugins.map((plugin) => plugin.source);
    expect(new Set(sources)).toEqual(new Set(["bundled", "dev-linked", "sideload"]));
  });
});

describe("the first question (§9, MK-E10)", () => {
  it("asks, says its settings and data stay, and names the objects that will draw as missing", () => {
    expect(removeQuestion(recordOf("acme.kanban"), "ask", null, true)).toEqual({
      ask: "Remove Kanban?",
      lines: [
        "Its settings and data stay on your desktops, so installing it again brings them back.",
        "Board and Card objects on your desks draw as missing on your desktops until then.",
      ],
      confirm: "Remove",
      danger: false,
      further: "Remove it and its data…",
    });
  });

  it("names no object for a plugin with none", () => {
    const kanban = recordOf("acme.kanban");
    const bare = { ...kanban, contributions: { ...kanban.contributions, objects: [] } };
    expect(removeQuestion(bare, "ask", null, true).lines).toEqual([words.REMOVE_WORDS.kept]);
  });
});

describe("the second question (§9, James's MK-O4: this desktop alone)", () => {
  it("deletes on this desktop, and says your other desktops remove it too and keep their copy", () => {
    const kanban = recordOf("acme.kanban");
    expect(removeQuestion(kanban, "ask-data", PLUGINS_FIXTURE_ROSTER, true)).toEqual({
      ask: "Remove Kanban and its data?",
      lines: [
        "This deletes its settings and data on this Mac. It can't be undone.",
        "mini and tower remove Kanban too, and keep their copy of its data.",
      ],
      confirm: "Remove data",
      danger: true,
      further: null,
    });
  });

  it("says one other desktop as one: it removes the plugin too, and keeps its copy", () => {
    const kanban = recordOf("acme.kanban");
    const pair = PLUGINS_FIXTURE_ROSTER.filter((device) => device.self || device.name === "mini");
    expect(pair.map((device) => device.name)).toEqual(["studio", "mini"]);
    expect(removeQuestion(kanban, "ask-data", pair, true).lines).toEqual([
      "This deletes its settings and data on this Mac. It can't be undone.",
      "mini removes Kanban too, and keeps its copy of its data.",
    ]);
  });

  it("says this PC off the Mac, and no second sentence with no other desktop or no roster read", () => {
    const kanban = recordOf("acme.kanban");
    const alone = PLUGINS_FIXTURE_ROSTER.filter((device) => device.self);
    expect(removeQuestion(kanban, "ask-data", alone, false).lines).toEqual([
      "This deletes its settings and data on this PC. It can't be undone.",
    ]);
    expect(removeQuestion(kanban, "ask-data", null, true).lines).toHaveLength(1);
  });
});

describe("a list said as a list is (MK's)", () => {
  it("joins one, two and more names", () => {
    expect(words.listNames([])).toBe("");
    expect(words.listNames(["Clock"])).toBe("Clock");
    expect(words.listNames(["Clock", "Ruler"])).toBe("Clock and Ruler");
    expect(words.listNames(["Clock", "Calendar", "Ruler"])).toBe("Clock, Calendar and Ruler");
  });
});
