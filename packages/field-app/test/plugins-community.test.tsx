// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type PluginRecord,
  type PluginRegistrySnapshot,
  type PluginsCatalog,
  pluginPowerWords,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_FIXTURES,
  CATALOG_LISTED,
  communityFixtureDoor,
  PLUGINS_FIXTURE_HELD_SNAPSHOT,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_READ_AT,
  PLUGINS_FIXTURE_REFUSAL,
  PLUGINS_FIXTURE_SNAPSHOT,
  type PluginsFixtureActs,
  type PluginsFixtureRead,
  pluginsFixturePort,
} from "../src/design-system/plugins-fixtures";
import type { FrameSurface } from "../src/frame/frame-surface";
import { FramePlugins, Plugins } from "../src/frame/plugins/Plugins";
import {
  type CommunityStatementDoor,
  communityDoor,
  communityFrom,
  communityTile,
  statementDoor,
} from "../src/frame/plugins/plugins-community";
import { resetPluginUpdates } from "../src/frame/plugins/plugins-count";
import {
  catalogFoot,
  installedFoot,
  installedRows,
  type PluginsRead,
  pluginPage,
  type ShelfState,
  shelfState,
} from "../src/frame/plugins/plugins-model";
import {
  COMMUNITY_WORDS,
  HELD_LINE,
  listTime,
  PAGE_WORDS,
  PLUGINS_TAB_WORDS,
  SWITCH_WORDS,
} from "../src/frame/plugins/plugins-words";

// MK-O3D — the community switch drawn, and a plugin held while community plugins are off
// (DESIGN.md §8 "The community tile", drawn 2026-11-14; §8 "Installed" and "Read only first";
// §9 "Community plugins"). The statement is shown once on each desktop (James's MK-O1 pick B),
// so a door stands in for this desktop's mark. The model's reads, then the shipping controller
// over a fixture port and fixture doors, drawn on the document's body. No real fieldd, no
// network, no child.

const answered = (catalog: PluginsCatalog): PluginsRead => ({ kind: "answered", catalog });
const when = listTime(PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW);
const recordOf = (snapshot: PluginRegistrySnapshot, id: string): PluginRecord => {
  const record = snapshot.plugins.find((plugin) => plugin.id === id);
  if (record === undefined) throw new Error(`the fixture has no ${id}`);
  return record;
};
/** fieldd's effective app preferences, as it streams them to a window. */
const PREFERENCES = { showTray: true, backgroundShell: true, syncPosture: "automatic" } as const;

describe("the community switch, as the popup reads and sends it (MK-O3D)", () => {
  it("reads on only for a stored true, off when absent, and nothing from a snapshot it can't read", () => {
    expect(communityFrom({ ...PREFERENCES, communityPlugins: true })).toBe(true);
    expect(communityFrom({ ...PREFERENCES, communityPlugins: false })).toBe(false);
    // an older daemon's snapshot says nothing of it: off, as fieldd reads it
    expect(communityFrom(PREFERENCES)).toBe(false);
    for (const raw of [null, undefined, {}, "on"]) expect(communityFrom(raw)).toBeNull();
  });

  it("sends the one request Settings' preferences send, and reads nothing of its answer", async () => {
    const asked: unknown[][] = [];
    const send = communityDoor({
      request: async (method, params) => {
        asked.push([method, params]);
        return { ok: true, ignored: "an answer the switch never reads" };
      },
    });
    await send(true);
    await send(false);
    expect(asked).toEqual([
      ["storage.appPreferences.set", { key: "plugins.community", value: true }],
      ["storage.appPreferences.set", { key: "plugins.community", value: false }],
    ]);
  });

  it("reads and marks this desktop's statement mark through its two doors (MK-O1 B)", async () => {
    const asked: unknown[][] = [];
    let answer: unknown = { shownHere: false };
    const door = statementDoor({
      request: async (method, params) => {
        asked.push([method, params]);
        return answer;
      },
    });
    expect(await door.shownHere()).toBe(false);
    answer = { shownHere: true };
    await door.markShown();
    expect(await door.shownHere()).toBe(true);
    expect(asked).toEqual([
      ["plugins.community.statement.get", {}],
      ["plugins.community.statement.shown", {}],
      ["plugins.community.statement.get", {}],
    ]);
    // an answer it can't read is no answer: the hook leaves the mark unread, which asks
    answer = { shownHere: "yes" };
    await expect(door.shownHere()).rejects.toThrow();
  });

  it("stands with a list held that names a plugin by other people, or while it is on", () => {
    const listed = shelfState(answered(CATALOG_LISTED), false);
    expect(communityTile(listed, CATALOG_LISTED, false)).toEqual({
      on: false,
      line: "1 plugin by other people. VibeField checks each one before it's listed.",
      state: COMMUNITY_WORDS.off,
    });
    // not read yet: no tile, as for fieldd away, so nothing says off for a switch that may be on
    expect(communityTile(listed, CATALOG_LISTED, null)).toBeNull();
    // a list naming none: no tile while off, and one to turn it off with while on
    const ready = shelfState(answered(CATALOG_FIXTURES.ready), false);
    expect(communityTile(ready, CATALOG_FIXTURES.ready, false)).toBeNull();
    expect(communityTile(ready, CATALOG_FIXTURES.ready, true)).toEqual({
      on: true,
      line: "Plugins by other people. VibeField checks each one before it's listed.",
      state: COMMUNITY_WORDS.on,
    });
    // nothing to discover, no list held, or fieldd not answering: no tile, whatever the switch
    const none: readonly ShelfState[] = [
      { kind: "unconfigured" },
      { kind: "reading" },
      { kind: "no-list", words: "Offline · no plugin list yet" },
      { kind: "away" },
    ];
    for (const shelf of none) expect(communityTile(shelf, CATALOG_LISTED, true)).toBeNull();
  });

  it("ends a read list's foot with '· community off' while the switch is off, and nowhere else", () => {
    const foot = (catalog: PluginsCatalog, reading: boolean, off: boolean) =>
      catalogFoot(answered(catalog), reading, PLUGINS_FIXTURE_NOW, off)?.words;
    expect(foot(CATALOG_FIXTURES.ready, false, true)).toBe(
      `1 plugin, 3 objects · checked ${when} · community off`,
    );
    expect(foot(CATALOG_FIXTURES.ready, false, false)).toBe(
      `1 plugin, 3 objects · checked ${when}`,
    );
    expect(foot(CATALOG_FIXTURES.ready, true, true)).toBe(
      `Reading the plugin list… · showing the list from ${when}`,
    );
    expect(foot(CATALOG_FIXTURES.unconfigured, false, true)).toBeUndefined();
  });

  it("asks with trust-and-distribution §7's statement, word for word as DESIGN.md §9 quotes it", () => {
    const design = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "DESIGN.md"),
      "utf8",
    ).replace(/\s+/gu, " ");
    expect(design).toContain(`"${COMMUNITY_WORDS.statement}"`);
    expect(design).toContain(`**${COMMUNITY_WORDS.ask}**`);
    expect(design).toContain(`**${COMMUNITY_WORDS.confirm}**`);
  });
});

describe("a plugin held while community plugins are off (MK-O3D; O3-C's `held`)", () => {
  const kanban = recordOf(PLUGINS_FIXTURE_HELD_SNAPSHOT, "acme.kanban");

  it("says why on its row and its page, with no switch, and counts it among the off", () => {
    const row = installedRows(PLUGINS_FIXTURE_HELD_SNAPSHOT, CATALOG_LISTED).find(
      (entry) => entry.id === "acme.kanban",
    );
    expect(row).toEqual({
      id: "acme.kanban",
      title: "Kanban",
      source: "Acme Tools",
      community: true,
      line: HELD_LINE.objects,
      onOff: null,
    });
    const page = pluginPage(kanban, CATALOG_LISTED, PLUGINS_FIXTURE_HELD_SNAPSHOT, true);
    expect([page.held, page.readOnly, page.onOff]).toEqual([
      HELD_LINE.objects,
      SWITCH_WORDS.readOnly,
      null,
    ]);
    expect(installedFoot(PLUGINS_FIXTURE_HELD_SNAPSHOT)).toBe("5 plugins, 7 objects · 2 off");
  });

  it("says what it can do once on, never that it does nothing, while it holds no power", () => {
    const page = pluginPage(kanban, CATALOG_LISTED, PLUGINS_FIXTURE_HELD_SNAPSHOT, true);
    expect(kanban.grantedCapabilities).toEqual([]);
    expect(page.powers.map((power) => power.words)).toEqual([
      pluginPowerWords("canvas.write", { onMac: true }),
      "Keep your boards in step",
    ]);
    expect(page.nothing).toBeNull();
    // any off plugin with no switches here: what it asked for, less one fieldd denies it
    const off: PluginRecord = {
      ...recordOf(PLUGINS_FIXTURE_SNAPSHOT, "example.kv-service"),
      enabled: false,
      state: "disabled",
      requestedCapabilities: ["net.outbound", "process.spawn"],
      grantedCapabilities: [],
      deniedCapabilities: [{ capability: "process.spawn", reason: "source-policy" }],
    };
    const offPage = pluginPage(off, null, PLUGINS_FIXTURE_SNAPSHOT, true);
    expect([offPage.powers.map((power) => power.key), offPage.nothing, offPage.held]).toEqual([
      ["net.outbound"],
      null,
      null,
    ]);
    const none = pluginPage(
      { ...off, requestedCapabilities: [] },
      null,
      PLUGINS_FIXTURE_SNAPSHOT,
      true,
    );
    expect(none.nothing).toBe(PAGE_WORDS.nothingNoObject);
  });

  it("decides nothing by `held`: a row on is read as on, and the line follows what it adds", () => {
    const on: PluginRecord = { ...kanban, enabled: true, state: "enabled" };
    const snapshot = { ...PLUGINS_FIXTURE_HELD_SNAPSHOT, plugins: [on] };
    expect(installedRows(snapshot, CATALOG_LISTED)[0]?.line).toBe("2 objects · 2.1.0");
    expect(pluginPage(on, CATALOG_LISTED, snapshot, true).held).toBeNull();
    const bare: PluginRecord = {
      ...kanban,
      contributions: { ...kanban.contributions, objects: [] },
    };
    const line = (record: PluginRecord) =>
      installedRows({ ...snapshot, plugins: [record] }, CATALOG_LISTED)[0]?.line;
    expect(line(bare)).toBe(HELD_LINE.bare);
    expect(line({ ...bare, service: "active" })).toBe(HELD_LINE.service);
  });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const node of document.body.querySelectorAll(".vf-plugins")) node.remove();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

const LISTED: PluginsFixtureRead = { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED };

/** A fixture door that also says what it was asked to send, in order. */
function recordingDoor(acts: PluginsFixtureActs = "answers"): {
  send: (on: boolean) => Promise<void>;
  sent: boolean[];
} {
  const sent: boolean[] = [];
  const inner = communityFixtureDoor(acts);
  return {
    sent,
    send: (on) => {
      sent.push(on);
      return inner(on);
    },
  };
}

/** This desktop's statement mark, held by the test: shown or not, or a read that fails; it
 * counts its reads and its marks. */
function recordingMark(shown: boolean | "fails" = false): {
  door: CommunityStatementDoor;
  reads: () => number;
  marks: () => number;
} {
  let reads = 0;
  let marks = 0;
  let marked = shown === true;
  return {
    reads: () => reads,
    marks: () => marks,
    door: {
      shownHere: async () => {
        reads += 1;
        if (shown === "fails") throw new Error("the fixture's mark can't be read");
        return marked;
      },
      markShown: async () => {
        marks += 1;
        marked = true;
      },
    },
  };
}

interface WindowProps {
  readonly read?: PluginsFixtureRead;
  readonly snapshot?: PluginRegistrySnapshot;
  readonly community: boolean | null;
  readonly send?: ((on: boolean) => Promise<void>) | undefined;
  readonly statement?: CommunityStatementDoor | undefined;
  readonly away?: boolean;
}

/** The read and the port stay one per test, so a re-render with the switch fieldd says next
 * starts no read of its own. */
let windowPort = pluginsFixturePort(LISTED);

function Window({
  snapshot = PLUGINS_FIXTURE_SNAPSHOT,
  community,
  send,
  statement,
  away = false,
}: WindowProps): ReactElement {
  const [surface, set] = useState<FrameSurface | null>("plugins");
  return (
    <Plugins
      surface={surface}
      onSurfaceChange={set}
      port={windowPort}
      snapshot={snapshot}
      community={community}
      onCommunity={send}
      statement={statement}
      away={away}
      now={() => PLUGINS_FIXTURE_NOW}
    />
  );
}

/** A fresh window: its own root, its own port, the popup open on Discover. */
async function mount(props: WindowProps): Promise<void> {
  act(() => root.unmount());
  root = createRoot(host);
  windowPort = pluginsFixturePort(props.read ?? LISTED);
  act(() => root.render(<Window {...props} />));
  await settle();
}

/** The same window, as fieldd's next preferences say the switch. */
async function rerender(props: WindowProps): Promise<void> {
  act(() => root.render(<Window {...props} />));
  await settle();
}

const tile = (): HTMLElement | null => document.body.querySelector("[data-community-tile]");
const tileSwitch = (): HTMLButtonElement | null =>
  tile()?.querySelector<HTMLButtonElement>('[role="switch"]') ?? null;
const ask = (): HTMLElement | null => document.body.querySelector(".vf-plugins-community-ask");
/** One of the ask's two acts, which are the foot's act (`.vf-plugins-act`), by its words. */
const askAct = (words: string): HTMLButtonElement | null => {
  const acts = document.body.querySelectorAll<HTMLButtonElement>(
    ".vf-plugins-community-acts .vf-plugins-act",
  );
  return [...acts].find((button) => button.textContent === words) ?? null;
};
const refusal = (): string | null =>
  document.body.querySelector(".vf-plugins-community-refused")?.textContent ?? null;
const field = (): HTMLInputElement | null =>
  document.body.querySelector<HTMLInputElement>(".vf-plugins-field input");
const footText = (): string => document.body.querySelector(".vf-plugins-said")?.textContent ?? "";
const part = (words: string): HTMLButtonElement | null =>
  [...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-seg button")].find((button) =>
    button.textContent?.startsWith(words),
  ) ?? null;
const esc = (): void =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
const press = (node: HTMLElement | null): void => act(() => node?.click());

describe("Discover's community tile, in a window (MK-O3D; §8 'The community tile')", () => {
  it("stands at Discover's end over a list naming a plugin by other people, off, and the foot says so", async () => {
    await mount({ community: false, send: recordingDoor().send });
    expect(tile()?.className).toBe("vf-plugins-community");
    expect(tile()?.textContent).toContain(COMMUNITY_WORDS.title);
    expect(tile()?.textContent).toContain(COMMUNITY_WORDS.line(1));
    expect(tile()?.textContent).toContain(COMMUNITY_WORDS.off);
    expect(tileSwitch()?.getAttribute("aria-label")).toBe(COMMUNITY_WORDS.title);
    expect(tileSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(ask()).toBeNull();
    expect(footText()).toBe(`2 plugins, 5 objects · checked ${when} · community off`);
  });

  it("stands nowhere with nothing to discover, no list held or fieldd away, whatever the switch", async () => {
    const reads: readonly PluginsFixtureRead[] = [
      { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
      { catalog: CATALOG_FIXTURES.unreachable, refresh: CATALOG_FIXTURES.unreachable },
      { catalog: "fails", refresh: "fails" },
    ];
    for (const read of reads) {
      for (const community of [false, true]) {
        const mark = recordingMark();
        await mount({ read, community, send: recordingDoor().send, statement: mark.door });
        expect(tile()).toBeNull();
        // the mark is read only while the tile stands or community plugins are on
        expect(mark.reads()).toBe(community ? 1 : 0);
      }
    }
  });

  it("pressed on where it wasn't shown, asks first in place, takes the keyboard to Cancel, sends nothing", async () => {
    const door = recordingDoor();
    const mark = recordingMark();
    await mount({ community: false, send: door.send, statement: mark.door });
    expect(mark.reads()).toBe(1);
    press(tileSwitch());
    expect(ask()?.textContent).toContain(COMMUNITY_WORDS.ask);
    expect(ask()?.textContent).toContain(COMMUNITY_WORDS.statement);
    expect(document.activeElement).toBe(askAct(COMMUNITY_WORDS.cancel));
    // no ↵ is printed on either act
    expect(ask()?.querySelector("kbd")).toBeNull();
    expect(tileSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect([door.sent, mark.marks()]).toEqual([[], 0]);
  });

  it("Cancel, Esc and leaving Discover take the ask back, send nothing and mark nothing; Esc then folds", async () => {
    const door = recordingDoor();
    const mark = recordingMark();
    await mount({ community: false, send: door.send, statement: mark.door });
    press(tileSwitch());
    press(askAct(COMMUNITY_WORDS.cancel));
    expect(ask()).toBeNull();
    expect(document.activeElement).toBe(field());
    press(tileSwitch());
    esc();
    expect(ask()).toBeNull();
    expect(document.body.querySelector(".vf-plugins-pop")).not.toBeNull();
    press(tileSwitch());
    press(part(PLUGINS_TAB_WORDS.installed));
    press(part(PLUGINS_TAB_WORDS.discover));
    expect(ask()).toBeNull();
    esc();
    expect(document.body.querySelector(".vf-plugins-pop")).toBeNull();
    expect([door.sent, mark.marks()]).toEqual([[], 0]);
  });

  it("Turn on community plugins marks this desktop and sends the one request; it moves when fieldd says", async () => {
    const door = recordingDoor("pending");
    const mark = recordingMark();
    await mount({ community: false, send: door.send, statement: mark.door });
    press(tileSwitch());
    press(askAct(COMMUNITY_WORDS.confirm));
    expect([door.sent, mark.marks()]).toEqual([[true], 1]);
    expect(ask()).toBeNull();
    expect(document.activeElement).toBe(field());
    // under way: it keeps its place, takes no press, and nothing spins
    expect(tileSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(tileSwitch()?.disabled).toBe(true);
    press(tileSwitch());
    expect(door.sent).toEqual([true]);
    await rerender({ community: true, send: door.send, statement: mark.door });
    expect(tileSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(tile()?.textContent).toContain(COMMUNITY_WORDS.on);
    expect(footText()).toBe(`2 plugins, 5 objects · checked ${when}`);
  });

  it("turned off, asks nothing and sends at once; once shown here, turned on again it asks nothing", async () => {
    const door = recordingDoor();
    const mark = recordingMark();
    await mount({ community: false, send: door.send, statement: mark.door });
    press(tileSwitch());
    press(askAct(COMMUNITY_WORDS.confirm));
    await rerender({ community: true, send: door.send, statement: mark.door });
    press(tileSwitch());
    expect(ask()).toBeNull();
    await settle();
    await rerender({ community: false, send: door.send, statement: mark.door });
    press(tileSwitch());
    expect(ask()).toBeNull();
    await settle();
    expect([door.sent, mark.marks()]).toEqual([[true, false, true], 1]);
  });

  it("a desktop that has shown it asks nothing; one whose mark can't be read asks (MK-O1 B)", async () => {
    const shownDoor = recordingDoor();
    await mount({ community: false, send: shownDoor.send, statement: recordingMark(true).door });
    press(tileSwitch());
    expect(ask()).toBeNull();
    await settle();
    expect(shownDoor.sent).toEqual([true]);
    for (const statement of [recordingMark("fails").door, undefined]) {
      const door = recordingDoor();
      await mount({ community: false, send: door.send, statement });
      press(tileSwitch());
      expect(ask()?.textContent).toContain(COMMUNITY_WORDS.statement);
      expect(door.sent).toEqual([]);
    }
  });

  it("says a refusal in the switch words, never the error's text, until fieldd shows it as it was turning", async () => {
    const door = recordingDoor("refuses");
    await mount({ community: false, send: door.send, statement: recordingMark().door });
    press(tileSwitch());
    press(askAct(COMMUNITY_WORDS.confirm));
    await settle();
    expect(refusal()).toBe(SWITCH_WORDS.refused(true));
    expect(document.body.textContent).not.toContain(PLUGINS_FIXTURE_REFUSAL);
    expect(tileSwitch()?.getAttribute("aria-checked")).toBe("false");
    await rerender({ community: true, send: door.send });
    expect(refusal()).toBeNull();
  });

  it("takes no press while fieldd isn't answering or with no door; unread, it stands nowhere and its ask goes", async () => {
    const door = recordingDoor();
    const cases: readonly WindowProps[] = [
      { community: false, send: door.send, away: true },
      { community: false, send: undefined },
    ];
    for (const props of cases) {
      await mount(props);
      expect(tileSwitch()?.disabled).toBe(true);
      press(tileSwitch());
      expect(ask()).toBeNull();
    }
    // before the window has read the switch: no tile that could say off for one that is on
    await mount({ community: null, send: door.send });
    expect(tile()).toBeNull();
    // read, asked, then unread again: the ask goes with the tile, and Esc folds the popup
    await mount({ community: false, send: door.send });
    press(tileSwitch());
    expect(ask()).not.toBeNull();
    await rerender({ community: null, send: door.send });
    expect(tile()).toBeNull();
    await rerender({ community: false, send: door.send });
    expect(ask()).toBeNull();
    esc();
    expect(document.body.querySelector(".vf-plugins-pop")).toBeNull();
    expect(door.sent).toEqual([]);
  });

  it("in the frame, reads the switch and the mark, and marks it before it sends the switch as Settings does", async () => {
    resetPluginUpdates();
    const asked: unknown[][] = [];
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      request: vi.fn(async (method: string, params: unknown) => {
        asked.push([method, params]);
        if (method.startsWith("plugins.catalog.")) return CATALOG_LISTED;
        if (method === "plugins.community.statement.get") return { shownHere: false };
        if (method === "plugins.community.statement.shown") return { shownHere: true };
        return { ok: true };
      }),
      subscribe: vi.fn(async (method: string) => {
        if (method !== "storage.appPreferences.subscribe") {
          throw new Error(`unexpected subscription: ${method}`);
        }
        return {
          subId: "app-preferences",
          snapshot: { ...PREFERENCES, communityPlugins: false },
          unsubscribe: () => undefined,
        };
      }),
    } as unknown as FielddClient;
    try {
      act(() =>
        root.render(
          <FielddProvider client={client}>
            <FramePlugins view="canvas" surface="plugins" onSurfaceChange={() => undefined} />
          </FielddProvider>,
        ),
      );
      await settle();
      expect(tileSwitch()?.disabled).toBe(false);
      press(tileSwitch());
      press(askAct(COMMUNITY_WORDS.confirm));
      await settle();
      expect(asked.filter(([method]) => !String(method).startsWith("plugins.catalog."))).toEqual([
        ["plugins.community.statement.get", {}],
        ["plugins.community.statement.shown", {}],
        ["storage.appPreferences.set", { key: "plugins.community", value: true }],
      ]);
    } finally {
      resetPluginUpdates();
    }
  });
});

describe("a held plugin, in a window (MK-O3D; §8 'Installed', 'Read only first')", () => {
  it("says why on its row, with no switch, and on its page before its read-only line", async () => {
    await mount({ snapshot: PLUGINS_FIXTURE_HELD_SNAPSHOT, community: false });
    press(part(PLUGINS_TAB_WORDS.installed));
    const kanban = [...document.body.querySelectorAll<HTMLLIElement>(".vf-plugins-item")].find(
      (item) => item.querySelector(".vf-plugins-title")?.textContent === "Kanban",
    );
    expect(kanban?.querySelector(".vf-plugins-line")?.textContent).toBe(HELD_LINE.objects);
    expect(kanban?.querySelector('[role="switch"]')).toBeNull();
    press(kanban?.querySelector<HTMLButtonElement>(".vf-plugins-row") ?? null);
    const notes = [...document.body.querySelectorAll(".vf-plugins-page-note")].map(
      (node) => node.textContent,
    );
    expect(notes).toEqual([HELD_LINE.objects, SWITCH_WORDS.readOnly]);
    expect(document.body.querySelector(".vf-plugins-page")?.textContent).not.toContain(
      PAGE_WORDS.nothing,
    );
  });
});
