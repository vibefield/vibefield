// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeskTrayDoor } from "@vibecook/ice/desk";
import {
  PluginRegistrySnapshot,
  PluginsCatalog,
  type PluginsInstallPrepareResult,
  pluginPowerWords,
} from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_FIXTURES,
  CATALOG_LISTED,
  CATALOG_SHELF,
  CATALOG_UPDATES,
  PLUGINS_FIXTURE_CANDIDATE,
  PLUGINS_FIXTURE_DOWNLOADS,
  PLUGINS_FIXTURE_HELD_SNAPSHOT,
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_NOT_WORKING_SNAPSHOT,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_OUTDATED_SNAPSHOT,
  PLUGINS_FIXTURE_READ_AT,
  PLUGINS_FIXTURE_REFUSAL,
  PLUGINS_FIXTURE_RUNTIME,
  PLUGINS_FIXTURE_RUNTIME_ERROR,
  PLUGINS_FIXTURE_SNAPSHOT,
  PLUGINS_FIXTURE_SWITCHES_SNAPSHOT,
  PLUGINS_FIXTURE_UPDATE_DOWNLOADS,
  type PluginsFixtureActs,
  type PluginsFixtureRead,
  pluginsFixturePort,
} from "../src/design-system/plugins-fixtures";
import { type MountedDesk, publishDesk } from "../src/field/desk/desk-door";
import { boardReveal, resetBoardRevealForTest } from "../src/field/desk/pegboard/board-door";
import type { FrameSurface } from "../src/frame/frame-surface";
import { FramePlugins, Plugins } from "../src/frame/plugins/Plugins";
import { keepCarry } from "../src/frame/plugins/plugins-carry";
import type { CommunityStatementDoor } from "../src/frame/plugins/plugins-community";
import { getPluginUpdates, resetPluginUpdates } from "../src/frame/plugins/plugins-count";
import { pluginsLayout } from "../src/frame/plugins/plugins-model";
import type { PluginsPort } from "../src/frame/plugins/plugins-port";
import * as words from "../src/frame/plugins/plugins-words";
import {
  getPluginRegistrySnapshot,
  setPluginRegistrySnapshot,
} from "../src/plugin-host/plugin-registry-store";
import { nameUnstartedPlugin, resetUnstartedPlugins } from "../src/plugin-host/unstarted-plugins";

// MK-4a — the Plugins popup in a window (DESIGN.md §8 "Plugins — the frame's second popup"): the shipping
// controller over a fixture port, drawn on the document's body. Each opening reads the list once and never on a
// re-render (MK-D5; one audit row per opening, `plugin.catalog.refresh`); Esc and the scrim fold it; the keyboard
// goes to its field and back; every state is said, never a blank. MK-4b adds the Me row's count (every answer the
// popup takes, and the window's one ask, over a fixture client in a FielddProvider) and the tab a door opens it on.
// MK-4c adds a plugin's page, read only (it asks fieldd nothing), Installed's hot row and Updates' count. MK-4c2a adds
// a Built in or Development plugin's switches (N18: every plugin's but a held one's), each held by the fixture port's
// recorded calls. MK-4e adds Discover's shelf and the page of a set this desktop doesn't have; O2-C its Install, the
// install card, and the requests the card sends and throws away, each held by the port's recorded calls, and a refusal
// worded by its kind alone. MK-4d its Show them on the pegboard, held by the board's door (`boardReveal`), with no
// pegboard mounted.
// MK-4d's names: where a set hangs, on Installed's lines and under What it adds, over a desk double
// whose board names its categories. Item 433: Discover's categories, the pegboard's, over the same
// desk double.
// MK-O3D adds the community statement at this desktop's first community install, over a fixture mark.
// MK-UC's UC-C adds Updates' rows, the update card, Update all and Check again, and the note the window comes back
// fresh by (MK-E6), each held by the port's recorded calls and the window's own session, which each test leaves
// empty.
// MK-5b adds a plugin whose runtime failed and its Try again, over a fixture fieldd that streams each plugin's
// runtime, and Try again where VibeField's plugins don't answer.
// No real fieldd, no network, no child.

let host: HTMLDivElement;
let root: Root;
let setSurface: (next: FrameSurface | null) => void = () => undefined;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const node of document.body.querySelectorAll(".vf-plugins")) node.remove();
  // MK-UC's UC-C: no test's note (MK-E6) reaches the next
  sessionStorage.clear();
  // MK-4d: a showing a press asked stands in the board's door until it lands; none lands here
  resetBoardRevealForTest();
});

function counting(inner: PluginsPort): {
  port: PluginsPort;
  calls: { catalog: number; refresh: number };
} {
  const calls = { catalog: 0, refresh: 0 };
  return {
    calls,
    port: {
      ...inner,
      catalog: () => {
        calls.catalog += 1;
        return inner.catalog();
      },
      refresh: () => {
        calls.refresh += 1;
        return inner.refresh();
      },
    },
  };
}

/** A port's switches and settings (MK-4c2b), (O2-C) its install's doors, (MK-4f) Remove… and (MK-UC) an update's
 * download, for a test that presses and reads none: each refuses, so a stray press or read is never a quiet pass. */
const NO_SWITCHES: Pick<
  PluginsPort,
  | "enable"
  | "disable"
  | "grant"
  | "settingsGet"
  | "settingsSet"
  | "settingsReset"
  | "prepare"
  | "prepareUpdate"
  | "commit"
  | "discard"
  | "desktops"
  | "uninstall"
> = {
  enable: () => Promise.reject(new Error("no switch is pressed in this test")),
  disable: () => Promise.reject(new Error("no switch is pressed in this test")),
  grant: () => Promise.reject(new Error("no switch is pressed in this test")),
  settingsGet: () => Promise.reject(new Error("no setting is read in this test")),
  settingsSet: () => Promise.reject(new Error("no setting is kept in this test")),
  settingsReset: () => Promise.reject(new Error("no setting is set back in this test")),
  prepare: () => Promise.reject(new Error("nothing is installed in this test")),
  prepareUpdate: () => Promise.reject(new Error("nothing is updated in this test")),
  commit: () => Promise.reject(new Error("nothing is installed in this test")),
  discard: () => Promise.reject(new Error("nothing is installed in this test")),
  desktops: () => Promise.reject(new Error("nothing is installed in this test")),
  uninstall: () => Promise.reject(new Error("nothing is removed in this test")),
};

/** The requests a port's switches sent, in order (MK-4c2a). */
function recording(inner: PluginsPort): { port: PluginsPort; acts: string[] } {
  const acts: string[] = [];
  return {
    acts,
    port: {
      ...inner,
      enable: (id) => {
        acts.push(`enable ${id}`);
        return inner.enable(id);
      },
      disable: (id) => {
        acts.push(`disable ${id}`);
        return inner.disable(id);
      },
      grant: (id, capability, granted) => {
        acts.push(`grant ${id} ${capability} ${granted}`);
        return inner.grant(id, capability, granted);
      },
    },
  };
}

function Window({
  port,
  snapshot,
  open,
  updates = null,
  away = false,
}: {
  port: PluginsPort;
  snapshot: PluginRegistrySnapshot | null;
  open: boolean;
  updates?: number | null;
  away?: boolean;
}): ReactElement {
  const [surface, set] = useState<FrameSurface | null>(open ? "plugins" : null);
  setSurface = set;
  return (
    <>
      <button type="button" id="before">
        before
      </button>
      <Plugins
        surface={surface}
        onSurfaceChange={set}
        port={port}
        snapshot={snapshot}
        updates={updates}
        away={away}
        now={() => PLUGINS_FIXTURE_NOW}
      />
    </>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function mount(
  read: PluginsFixtureRead | PluginsPort,
  snapshot: PluginRegistrySnapshot | null = PLUGINS_FIXTURE_SNAPSHOT,
  open = true,
): Promise<void> {
  const port =
    "refresh" in read && typeof read.refresh === "function"
      ? read
      : pluginsFixturePort(read as PluginsFixtureRead);
  act(() => root.render(<Window port={port as PluginsPort} snapshot={snapshot} open={open} />));
  await settle();
}

const pop = (): HTMLElement | null => document.body.querySelector<HTMLElement>(".vf-plugins-pop");
const bodyText = (): string => document.body.querySelector(".vf-plugins-body")?.textContent ?? "";
/** The iOS Simulator's own power in item 569's words (item 573: its switch plates stand on the plugin as it ships). */
const SIMULATOR_POWER = pluginPowerWords("surface.simulator", { onMac: false }) ?? "";
const footText = (): string => document.body.querySelector(".vf-plugins-said")?.textContent ?? "";
const chosen = (): string =>
  document.body.querySelector('.vf-plugins-seg [aria-checked="true"]')?.textContent ?? "";

const NO_REGISTRY: PluginsFixtureRead = {
  catalog: CATALOG_FIXTURES.unconfigured,
  refresh: CATALOG_FIXTURES.unconfigured,
};

describe("the read on open (MK-D5)", () => {
  it("reads once per opening — one refresh and one catalog — and never on a re-render", async () => {
    const { port, calls } = counting(pluginsFixturePort(NO_REGISTRY));
    await mount(port);
    expect(calls).toEqual({ catalog: 1, refresh: 1 });
    act(() => root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_SNAPSHOT} open />));
    await settle();
    expect(calls).toEqual({ catalog: 1, refresh: 1 });
    act(() => setSurface(null));
    await settle();
    expect(calls).toEqual({ catalog: 1, refresh: 1 });
    act(() => setSurface("plugins"));
    await settle();
    expect(calls).toEqual({ catalog: 2, refresh: 2 });
  });

  it("reads nothing while it is folded", async () => {
    const { port, calls } = counting(pluginsFixturePort(NO_REGISTRY));
    await mount(port, PLUGINS_FIXTURE_SNAPSHOT, false);
    expect(pop()).toBeNull();
    expect(calls).toEqual({ catalog: 0, refresh: 0 });
  });

  it("never lets a late answer for the held list replace the fresh read", async () => {
    let answerHeld: (catalog: PluginsCatalog) => void = () => undefined;
    const port: PluginsPort = {
      ...NO_SWITCHES,
      catalog: () => new Promise((resolve) => (answerHeld = resolve)),
      refresh: () => Promise.resolve(CATALOG_FIXTURES.ready),
    };
    await mount(port);
    // MK-4e: the held list's count is the foot's; the body is its shelf
    expect(footText()).toContain("1 plugin, 3 objects");
    expect(bodyText()).toContain("Brass & Glass");
    await act(async () => answerHeld(CATALOG_FIXTURES.unread));
    await settle();
    expect(footText()).toContain("1 plugin, 3 objects");
    expect(bodyText()).toContain("Brass & Glass");
  });
});

describe("its states, in the body — never a blank", () => {
  it("no registry: Discover says so, and Show installed — or ↵ — turns to Installed", async () => {
    await mount(NO_REGISTRY);
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.discover);
    expect(bodyText()).toContain(words.NO_REGISTRY.title);
    expect(bodyText()).toContain(words.NO_REGISTRY.description);
    expect(footText()).toBe("");
    const act_ = document.body.querySelector<HTMLButtonElement>(".vf-plugins-act");
    expect(act_?.textContent).toBe(`${words.NO_REGISTRY.act}↵`);
    const input = document.body.querySelector<HTMLInputElement>(".vf-plugins-field input");
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.installed);
    const titles = [...document.body.querySelectorAll(".vf-plugins-title")].map(
      (n) => n.textContent,
    );
    expect(titles).toEqual(["Comment pad", "iOS Simulator", "Desk clock", "Key-value store"]);
    expect(footText()).toBe("4 plugins, 3 objects · 1 off");
  });

  it("no registry: Updates says the plugins that come with VibeField update with it", async () => {
    await mount(NO_REGISTRY);
    const updates = [
      ...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-seg button"),
    ].find((button) => button.textContent === words.PLUGINS_TAB_WORDS.updates);
    act(() => updates?.click());
    expect(bodyText()).toBe(words.NO_REGISTRY.updates);
    expect(document.body.querySelector(".vf-plugins-act")).toBeNull();
  });

  it("a read under way with no list held says the read", async () => {
    await mount({ catalog: CATALOG_FIXTURES.unread, refresh: "pending" });
    expect(bodyText()).toBe(words.READING);
    expect(footText()).toBe(words.READING);
  });

  it("offline, or a list VibeField couldn't use, with no list held", async () => {
    await mount({ catalog: CATALOG_FIXTURES.unreachable, refresh: CATALOG_FIXTURES.unreachable });
    expect(bodyText()).toBe(words.NO_LIST.unreachable);
    act(() => root.unmount());
    root = createRoot(host);
    await mount({ catalog: CATALOG_FIXTURES.refused, refresh: CATALOG_FIXTURES.refused });
    expect(bodyText()).toBe(words.NO_LIST.refused);
  });

  it("a list held: Discover's shelf (MK-4e), and the foot's count and when it was read", async () => {
    await mount({ catalog: CATALOG_FIXTURES.ready, refresh: CATALOG_FIXTURES.ready });
    const featured = document.body.querySelector('.vf-plugins-tile-item[data-featured="true"]');
    expect(featured?.querySelector(".vf-plugins-tile-title")?.textContent).toBe("Brass & Glass");
    expect(bodyText()).not.toContain("1 plugin, 3 objects");
    const when = words.listTime(PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW);
    expect(footText()).toBe(`1 plugin, 3 objects · checked ${when}`);
  });

  it("a list held with no set to show says its count, as before the shelf (MK-4e)", async () => {
    const communityOnly = PluginsCatalog.parse({
      ...CATALOG_LISTED,
      featured: [],
      plugins: CATALOG_LISTED.plugins.filter((entry) => entry.listedAs === "community"),
    });
    await mount({ catalog: communityOnly, refresh: communityOnly });
    expect(bodyText()).toBe("1 plugin, 2 objects");
  });

  it("neither door answering is said in IS-282-2's words", async () => {
    await mount({ catalog: "fails", refresh: "fails" });
    expect(bodyText()).toBe(words.PLUGINS_AWAY);
  });

  it("the field's words filter Installed, and a word nothing holds is said (Q6)", async () => {
    await mount(NO_REGISTRY, PLUGINS_FIXTURE_SNAPSHOT);
    const input = document.body.querySelector<HTMLInputElement>(".vf-plugins-field input");
    const type = (value: string) =>
      act(() => {
        if (input === null) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type("simulator");
    expect(bodyText()).toContain(words.NO_REGISTRY.title);
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const titles = () =>
      [...document.body.querySelectorAll(".vf-plugins-title")].map((node) => node.textContent);
    expect(titles()).toEqual(["iOS Simulator"]);
    type("nothing here");
    expect(bodyText()).toBe(words.noMatchWords("nothing here"));
    expect(footText()).toBe("4 plugins, 3 objects · 1 off");
  });

  it("an opening after neither door answered says the read, never the last opening's words", async () => {
    let answer = false;
    let release: (catalog: PluginsCatalog) => void = () => undefined;
    const port: PluginsPort = {
      ...NO_SWITCHES,
      catalog: () =>
        answer
          ? new Promise<PluginsCatalog>((resolve) => {
              release = resolve;
            })
          : Promise.reject(new Error("the fixture's door does not answer")),
      refresh: () =>
        answer
          ? new Promise<PluginsCatalog>(() => undefined)
          : Promise.reject(new Error("the fixture's door does not answer")),
    };
    await mount(port);
    expect(bodyText()).toBe(words.PLUGINS_AWAY);
    act(() => setSurface(null));
    answer = true;
    act(() => setSurface("plugins"));
    expect(bodyText()).toBe(words.READING);
    await settle();
    expect(bodyText()).toBe(words.READING);
    await act(async () => release(CATALOG_FIXTURES.unconfigured));
    await settle();
    expect(bodyText()).toContain(words.NO_REGISTRY.title);
  });

  it("Installed before the window holds its plugins says it reads them", async () => {
    await mount(NO_REGISTRY, null);
    const installed = [
      ...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-seg button"),
    ].find((button) => button.textContent === words.PLUGINS_TAB_WORDS.installed);
    act(() => installed?.click());
    expect(bodyText()).toBe(words.READING_YOURS);
  });
});

describe("the frame's popup", () => {
  it("is named Plugins, and its close Close plugins", async () => {
    await mount(NO_REGISTRY);
    expect(pop()?.getAttribute("role")).toBe("dialog");
    expect(pop()?.getAttribute("aria-label")).toBe(words.PLUGINS_NAME);
    const close = document.body.querySelector(".vf-plugins-esc");
    expect(close?.getAttribute("aria-label")).toBe(words.PLUGINS_CLOSE);
  });

  it("folds on Esc, heard on the window first, and on a click on its scrim", async () => {
    await mount(NO_REGISTRY);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(pop()).toBeNull();
    act(() => setSurface("plugins"));
    await settle();
    expect(pop()).not.toBeNull();
    act(() => document.body.querySelector<HTMLElement>(".vf-plugins-scrim")?.click());
    expect(pop()).toBeNull();
  });

  it("takes the keyboard to its field on open and gives it back where it was", async () => {
    await mount(NO_REGISTRY, PLUGINS_FIXTURE_SNAPSHOT, false);
    const before = document.getElementById("before");
    act(() => before?.focus());
    act(() => setSurface("plugins"));
    await settle();
    expect(document.activeElement).toBe(document.body.querySelector(".vf-plugins-field input"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.activeElement).toBe(before);
  });

  it("stands where MK-E1 puts it in the window", async () => {
    await mount(NO_REGISTRY);
    const { width, height, top } = pluginsLayout(window.innerWidth, window.innerHeight);
    const style = pop()?.style;
    expect([style?.width, style?.height, style?.top]).toEqual([
      `${width}px`,
      `${height}px`,
      `${top}px`,
    ]);
  });
});

/** A catalog that found `updates` to install (the fixtures' lists find none). */
const found = (updates: number): PluginsCatalog => ({ ...CATALOG_FIXTURES.ready, updates });

describe("the Me row's count: every answer the popup takes (MK-4b; VF-PM's C1)", () => {
  it("hears every answer the popup takes, in the order it takes them", async () => {
    const heard: number[] = [];
    let answerFresh: (catalog: PluginsCatalog) => void = () => undefined;
    const port: PluginsPort = {
      ...NO_SWITCHES,
      catalog: () => Promise.resolve(found(1)),
      refresh: () => new Promise((resolve) => (answerFresh = resolve)),
    };
    act(() =>
      root.render(
        <Plugins
          surface="plugins"
          onSurfaceChange={() => undefined}
          port={port}
          snapshot={PLUGINS_FIXTURE_SNAPSHOT}
          onCatalog={(catalog) => heard.push(catalog.updates)}
        />,
      ),
    );
    await settle();
    expect(heard).toEqual([1]);
    await act(async () => answerFresh(found(2)));
    await settle();
    expect(heard).toEqual([1, 2]);
  });

  it("never hears a held list's late answer, which the popup does not take", async () => {
    const heard: number[] = [];
    let answerHeld: (catalog: PluginsCatalog) => void = () => undefined;
    const port: PluginsPort = {
      ...NO_SWITCHES,
      catalog: () => new Promise((resolve) => (answerHeld = resolve)),
      refresh: () => Promise.resolve(found(2)),
    };
    act(() =>
      root.render(
        <Plugins
          surface="plugins"
          onSurfaceChange={() => undefined}
          port={port}
          snapshot={PLUGINS_FIXTURE_SNAPSHOT}
          onCatalog={(catalog) => heard.push(catalog.updates)}
        />,
      ),
    );
    await settle();
    await act(async () => answerHeld(found(7)));
    await settle();
    expect(heard).toEqual([2]);
  });
});

/** A window's fieldd as FramePlugins asks it: `plugins.catalog.get` and `refresh` answered by the test. MK-O3D:
 * it also streams the window's app preferences, as fieldd's effective snapshot, community plugins off; a
 * subscription is no request, so `asked` holds requests alone. */
function fielddAnswering(
  answer: (method: string, call: number) => Promise<unknown>,
  status: "ready" | "reconnecting" = "ready",
): {
  client: FielddClient;
  asked: string[];
} {
  const asked: string[] = [];
  const client = {
    status,
    onStatusChange: () => () => undefined,
    request: vi.fn(async (method: string) => {
      asked.push(method);
      return answer(method, asked.filter((m) => m === method).length);
    }),
    subscribe: vi.fn(async () => ({
      subId: "app-preferences",
      snapshot: {
        showTray: true,
        backgroundShell: true,
        syncPosture: "automatic",
        communityPlugins: false,
      },
      unsubscribe: () => undefined,
    })),
  } as unknown as FielddClient;
  return { client, asked };
}

function FrameWindow({
  client,
  surface,
  openOn,
}: {
  client: FielddClient;
  surface: FrameSurface | null;
  openOn?: "discover" | "updates";
}): ReactElement {
  return (
    <FielddProvider client={client}>
      <FramePlugins
        view="canvas"
        surface={surface}
        onSurfaceChange={() => undefined}
        {...(openOn === undefined ? {} : { openOn })}
      />
    </FielddProvider>
  );
}

describe("the frame's popup: its doors' tab and the window's one ask (MK-4b)", () => {
  beforeEach(() => {
    // the count is one value per window: each test starts it as a window does
    resetPluginUpdates();
  });
  afterEach(() => {
    resetPluginUpdates();
  });

  it("asks fieldd once as the window opens, for the list it holds and never a read, and counts it", async () => {
    const { client, asked } = fielddAnswering(async () => found(2));
    act(() => root.render(<FrameWindow client={client} surface={null} />));
    await settle();
    expect(asked).toEqual(["plugins.catalog.get"]);
    expect(getPluginUpdates()).toBe(2);
    // the frame mounting again in the same window asks nothing more
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<FrameWindow client={client} surface={null} />));
    await settle();
    expect(asked).toEqual(["plugins.catalog.get"]);
  });

  it("an early answer to the window's ask is replaced by the popup's", async () => {
    const { client } = fielddAnswering(async (method, call) =>
      method === "plugins.catalog.get" && call === 1 ? found(5) : found(1),
    );
    act(() => root.render(<FrameWindow client={client} surface={null} />));
    await settle();
    expect(getPluginUpdates()).toBe(5);
    act(() => root.render(<FrameWindow client={client} surface="plugins" />));
    await settle();
    expect(getPluginUpdates()).toBe(1);
  });

  it("a late answer to the window's ask never replaces the popup's", async () => {
    let answerAsk: (catalog: PluginsCatalog) => void = () => undefined;
    const { client } = fielddAnswering((method, call) =>
      method === "plugins.catalog.get" && call === 1
        ? new Promise((resolve) => (answerAsk = resolve))
        : Promise.resolve(found(1)),
    );
    act(() => root.render(<FrameWindow client={client} surface={null} />));
    await settle();
    act(() => root.render(<FrameWindow client={client} surface="plugins" />));
    await settle();
    expect(getPluginUpdates()).toBe(1);
    await act(async () => answerAsk(found(5)));
    await settle();
    expect(getPluginUpdates()).toBe(1);
  });

  it("an ask that fails leaves no count, and throws nothing", async () => {
    const { client, asked } = fielddAnswering(async () => {
      throw new Error("the fixture's fieldd does not answer");
    });
    act(() => root.render(<FrameWindow client={client} surface={null} />));
    await settle();
    expect(asked).toEqual(["plugins.catalog.get"]);
    expect(getPluginUpdates()).toBeNull();
  });

  it("opens on the tab its door asked for: Updates for Check plugins for updates, else Discover (MK-E7)", async () => {
    const { client } = fielddAnswering(async () => CATALOG_FIXTURES.unconfigured);
    act(() => root.render(<FrameWindow client={client} surface={null} openOn="discover" />));
    await settle();
    act(() => root.render(<FrameWindow client={client} surface="plugins" openOn="updates" />));
    await settle();
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.updates);
    expect(bodyText()).toBe(words.NO_REGISTRY.updates);
    act(() => root.render(<FrameWindow client={client} surface={null} openOn="updates" />));
    await settle();
    act(() => root.render(<FrameWindow client={client} surface="plugins" openOn="discover" />));
    await settle();
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.discover);
  });
});

/** The switch's part that says `words`. */
const part = (words_: string): HTMLButtonElement | null =>
  [...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-seg button")].find((button) =>
    button.textContent?.startsWith(words_),
  ) ?? null;
const field = (): HTMLInputElement | null =>
  document.body.querySelector<HTMLInputElement>(".vf-plugins-field input");
/** A key pressed in the field, as a person types it. */
const press = (key: string): void =>
  act(() => {
    field()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
const esc = (): void =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
const rows = (): HTMLButtonElement[] => [
  ...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-row"),
];
const pageTitle = (): string | null =>
  document.body.querySelector(".vf-plugins-page-title")?.textContent ?? null;
const hotTitle = (): string | null =>
  document.body.querySelector('.vf-plugins-item[data-hot="true"] .vf-plugins-title')?.textContent ??
  null;
const toInstalled = (): void => act(() => part(words.PLUGINS_TAB_WORDS.installed)?.click());

describe("a plugin's page, read only (MK-4c; §8 'Read only first')", () => {
  it("opens a row's page on a press, asking fieldd nothing; its back row and Esc go back, and Esc then folds", async () => {
    const { port, calls } = counting(pluginsFixturePort(NO_REGISTRY));
    await mount(port);
    toInstalled();
    // Comment pad, then iOS Simulator: Built in first, then by title
    act(() => rows()[1]?.click());
    expect(pageTitle()).toBe("iOS Simulator");
    expect(bodyText()).toContain(words.PAGE_WORDS.builtIn);
    expect(bodyText()).toContain("Show live windows on the desk");
    expect(bodyText()).toContain(SIMULATOR_POWER);
    const back = document.body.querySelector<HTMLButtonElement>(".vf-plugins-back");
    expect(back?.getAttribute("aria-label")).toBe(words.PAGE_WORDS.back("Installed"));
    act(() => back?.click());
    expect(pageTitle()).toBeNull();
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.installed);
    act(() => rows()[0]?.click());
    expect(pageTitle()).toBe("Comment pad");
    esc();
    expect(pageTitle()).toBeNull();
    expect(pop()).not.toBeNull();
    esc();
    expect(pop()).toBeNull();
    // the opening's one catalog and one refresh, and nothing for any page (VF-PM 13:56:27Z, 1)
    expect(calls).toEqual({ catalog: 1, refresh: 1 });
  });

  it("walks Installed's hot row with ↑ ↓ from the field, keeps it in sight, and ↵ opens its page", async () => {
    const seen: { row: Element; options: unknown }[] = [];
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value(this: HTMLElement, options: unknown) {
        seen.push({ row: this, options });
      },
    });
    try {
      await mount(NO_REGISTRY);
      toInstalled();
      expect(hotTitle()).toBe("Comment pad");
      press("ArrowDown");
      expect(hotTitle()).toBe("iOS Simulator");
      const last = seen.at(-1);
      expect(last?.row.querySelector(".vf-plugins-title")?.textContent).toBe("iOS Simulator");
      expect(last?.options).toEqual({ block: "nearest" });
      for (let i = 0; i < 5; i += 1) press("ArrowDown");
      expect(hotTitle()).toBe("Key-value store");
      press("ArrowUp");
      expect(hotTitle()).toBe("Desk clock");
      press("Enter");
      expect(pageTitle()).toBe("Desk clock");
      // back on the list, the hot row is where it was
      esc();
      expect(hotTitle()).toBe("Desk clock");
    } finally {
      if (before === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      } else {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", before);
      }
    }
  });

  it("says Installed where its act will stand as words: no button, no fill, no stop of Tab, never in the walk", async () => {
    await mount(NO_REGISTRY);
    toInstalled();
    // Comment pad: its one object hangs nowhere on the pegboard, so its page offers no Show them on the pegboard
    // (MK-4d), and Installed stands alone
    act(() => rows()[0]?.click());
    const said = document.body.querySelector(".vf-plugins-page-act");
    expect(said?.tagName).toBe("P");
    expect(said?.textContent).toBe(words.PAGE_WORDS.installed);
    expect(said?.closest("button")).toBeNull();
    expect(said?.querySelector("button, [tabindex]")).toBeNull();
    expect(said?.hasAttribute("tabindex")).toBe(false);
    // the page's controls are its back row and, from MK-4c2a, its switches: nothing else
    const controls = [
      ...document.body.querySelectorAll(".vf-plugins-page button, .vf-plugins-page [tabindex]"),
    ].filter((node) => node.getAttribute("role") !== "switch");
    expect(controls.map((node) => node.className)).toEqual(["vf-plugins-back"]);
    // ↑ ↓ and ↵ on a page walk nothing and press nothing
    press("ArrowDown");
    press("Enter");
    expect(pageTitle()).toBe("Comment pad");
    expect(document.body.querySelector('[data-hot="true"]')).toBeNull();
    // no fill: its rule draws no ground, and nothing of it answers the pointer
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/frame/plugins/plugins.css"),
      "utf8",
    );
    const rule = /\.vf-plugins-page-act \{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(rule).toContain("color: var(--vf-text-tertiary)");
    expect(rule).not.toMatch(/background|cursor/u);
    expect(css).not.toMatch(/\.vf-plugins-page-act[^{,]*:(?:hover|focus)/u);
  });

  it("leaves a page for a tab pressed on it, and for words typed on it, back to its list, filtered", async () => {
    await mount(NO_REGISTRY);
    toInstalled();
    act(() => rows()[1]?.click());
    act(() => part(words.PLUGINS_TAB_WORDS.discover)?.click());
    expect(pageTitle()).toBeNull();
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.discover);
    toInstalled();
    act(() => rows()[1]?.click());
    const input = field();
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "clock",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(pageTitle()).toBeNull();
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.installed);
    const titles = [...document.body.querySelectorAll(".vf-plugins-title")].map(
      (n) => n.textContent,
    );
    expect(titles).toEqual(["Desk clock"]);
  });

  it("names a listed community plugin's maker from the list held, never its folder's copy", async () => {
    await mount(
      { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED },
      PLUGINS_FIXTURE_LISTED_SNAPSHOT,
    );
    toInstalled();
    const kanban = rows().find((row) => row.textContent?.includes("Kanban"));
    act(() => kanban?.click());
    expect(pageTitle()).toBe("Kanban");
    expect(bodyText()).toContain("Acme Tools");
    expect(bodyText()).toContain("A board and its cards, for the work on your desk.");
    expect(bodyText()).toContain(words.PAGE_WORDS.tools(1));
    expect(bodyText()).toContain("A power of its own, named by Kanban");
    expect(bodyText()).not.toContain("Someone Else");
  });

  it("names each command a plugin puts in the palette under What it adds, where it is under it (James's MK-O20 A)", async () => {
    const commands = [
      { id: "pad.new", title: "New comment pad", placements: ["palette"] },
      { id: "pad.pin", title: "Pin the pad", placements: ["object-context"] },
    ] as unknown as PluginRegistrySnapshot["plugins"][number]["contributions"]["commands"];
    const snapshot: PluginRegistrySnapshot = {
      ...PLUGINS_FIXTURE_SNAPSHOT,
      plugins: PLUGINS_FIXTURE_SNAPSHOT.plugins.map((plugin) =>
        plugin.id === "vibefield.comment-pad"
          ? { ...plugin, contributions: { ...plugin.contributions, commands } }
          : plugin,
      ),
    };
    await mount(NO_REGISTRY, snapshot);
    toInstalled();
    act(() => rows()[0]?.click());
    expect(pageTitle()).toBe("Comment pad");
    // What it adds is the page's first list: its object, then its command, where it is under it
    const list = document.body.querySelector("ul.vf-plugins-page-lines");
    const adds = [...(list?.children ?? [])];
    expect(adds.map((line) => line.firstChild?.textContent)).toEqual([
      "Comment pad",
      "New comment pad",
    ]);
    expect(adds.map((line) => line.querySelector(".vf-plugins-page-under")?.textContent)).toEqual([
      undefined,
      words.PAGE_WORDS.inPalette(false),
    ]);
    // a command placed only on an object's menu is not said
    expect(bodyText()).not.toContain("Pin the pad");
  });

  it("carries the count on Updates, after its word, and none at 0 or with none given", async () => {
    const counted = (): string | null =>
      part(words.PLUGINS_TAB_WORDS.updates)?.querySelector(".vf-plugins-count")?.textContent ??
      null;
    act(() =>
      root.render(
        <Window
          port={pluginsFixturePort(NO_REGISTRY)}
          snapshot={PLUGINS_FIXTURE_SNAPSHOT}
          open
          updates={2}
        />,
      ),
    );
    await settle();
    expect(counted()).toBe("2");
    expect(part(words.PLUGINS_TAB_WORDS.updates)?.getAttribute("aria-label")).toBe("Updates 2");
    for (const updates of [0, null]) {
      act(() =>
        root.render(
          <Window
            port={pluginsFixturePort(NO_REGISTRY)}
            snapshot={PLUGINS_FIXTURE_SNAPSHOT}
            open
            updates={updates}
          />,
        ),
      );
      await settle();
      expect(counted()).toBeNull();
      expect(part(words.PLUGINS_TAB_WORDS.updates)?.hasAttribute("aria-label")).toBe(false);
    }
  });

  it("carries the Me row's own count in the frame's popup (VF-PM's C1)", async () => {
    resetPluginUpdates();
    try {
      const { client } = fielddAnswering(async () => found(2));
      act(() => root.render(<FrameWindow client={client} surface="plugins" />));
      await settle();
      expect(getPluginUpdates()).toBe(2);
      expect(
        part(words.PLUGINS_TAB_WORDS.updates)?.querySelector(".vf-plugins-count")?.textContent,
      ).toBe("2");
    } finally {
      resetPluginUpdates();
    }
  });
});

/** MK-4d: Show them on the pegboard, after Installed in the page's act row (an Install stands in its own stack). */
const showAct = (): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>(".vf-plugins-page-act-row > .vf-plugins-act");
/** Installed's row of the plugin titled `title`, pressed: its page opens. */
const openInstalled = (title: string): void =>
  act(() =>
    [...document.body.querySelectorAll<HTMLLIElement>(".vf-plugins-item")]
      .find((item) => item.querySelector(".vf-plugins-title")?.textContent === title)
      ?.querySelector<HTMLButtonElement>(".vf-plugins-row")
      ?.click(),
  );

describe("Show them on the pegboard (MK-4d; MK-D8's fallback B, §8 'The pegboard')", () => {
  it("hands the board the set's objects that hang there, in its own order, on a press and on ↵, folding nothing itself", async () => {
    const { port: read, calls } = counting(
      pluginsFixturePort({ catalog: CATALOG_LISTED, refresh: CATALOG_LISTED }),
    );
    const { port, acts: sent } = recording(read);
    act(() => root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_LISTED_SNAPSHOT} open />));
    await settle();
    toInstalled();
    openInstalled("Kanban");
    expect(pageTitle()).toBe("Kanban");
    expect(showAct()?.textContent).toBe(`${words.showWords(2)}↵`);
    act(() => showAct()?.click());
    expect(boardReveal()?.types).toEqual(["AcmeBoard", "AcmeCard"]);
    // the board's rise folds the popup (the pegboard's; over a covered view, Canvas first): the press alone leaves
    // it standing on the page
    expect(pop()).not.toBeNull();
    expect(pageTitle()).toBe("Kanban");
    // ↵ from the field presses it too, a newer showing each time
    const first = boardReveal()?.id;
    press("Enter");
    expect(boardReveal()?.types).toEqual(["AcmeBoard", "AcmeCard"]);
    expect(boardReveal()?.id).not.toBe(first);
    // it asks fieldd nothing
    await settle();
    expect(sent).toEqual([]);
    expect(calls).toEqual({ catalog: 1, refresh: 1 });
  });

  it("says Show on the pegboard for a set of one, and offers none where the board hangs none of the set or the plugin is off", async () => {
    await mount(NO_REGISTRY);
    toInstalled();
    // the iOS Simulator: its one object hangs on its shelf
    openInstalled("iOS Simulator");
    expect(showAct()?.textContent).toBe(`${words.showWords(1)}↵`);
    act(() => showAct()?.click());
    expect(boardReveal()?.types).toEqual(["vibefield.simulator"]);
    resetBoardRevealForTest();
    // Comment pad's one object hangs nowhere, Desk clock is turned off, Key-value store adds no object
    for (const title of ["Comment pad", "Desk clock", "Key-value store"]) {
      esc();
      openInstalled(title);
      expect(pageTitle()).toBe(title);
      expect(showAct()).toBeNull();
      // ↵ on its page presses nothing
      press("Enter");
      expect(boardReveal()).toBeNull();
    }
  });

  it("takes no ↵ from the field while Remove…'s question stands on the page (MK-4f)", async () => {
    await openKanban(pluginsFixturePort(LISTED));
    act(() => removeAct()?.click());
    await settle();
    expect(question()).not.toBeNull();
    act(() => field()?.focus());
    press("Enter");
    expect(boardReveal()).toBeNull();
    expect(question()).not.toBeNull();
    // the question answered, ↵ shows the set again
    esc();
    expect(question()).toBeNull();
    press("Enter");
    expect(boardReveal()?.types).toEqual(["AcmeBoard", "AcmeCard"]);
  });
});

/** A board's category as its door says it: its id, the board's name for it, how many it hangs. */
interface BoardCategory {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/** MK-4d's names: a desk mounted for one test, its board a double whose door says `categories` as
 * the desk last published them; `publish` is the desk's next frame, `unmount` the desk going. */
function mountBoard(categories: readonly BoardCategory[]): {
  publish: (next: readonly BoardCategory[]) => void;
  unmount: () => void;
} {
  let now = categories;
  const listeners = new Set<() => void>();
  const door = {
    anchor: () => ({ categories: now }),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  } as unknown as DeskTrayDoor;
  const unpublish = publishDesk({
    engine: {} as MountedDesk["engine"],
    handle: { tray: door } as unknown as MountedDesk["handle"],
    generation: 1,
    mount: 0,
    theme: "light",
  });
  return {
    publish(next) {
      now = next;
      act(() => {
        for (const fn of [...listeners]) fn();
      });
    },
    unmount: () => act(() => unpublish()),
  };
}
/** Installed's line of the plugin titled `title`. */
const lineSaid = (title: string): string | null =>
  [...document.body.querySelectorAll(".vf-plugins-item")]
    .find((item) => item.querySelector(".vf-plugins-title")?.textContent === title)
    ?.querySelector(".vf-plugins-line")?.textContent ?? null;
/** What it adds, as the open page says it: each line's words, and what is said under it. */
const addsSaid = (): (string | null)[][] =>
  [...(document.body.querySelector("ul.vf-plugins-page-lines")?.children ?? [])].map((line) => [
    line.firstChild?.textContent ?? null,
    line.querySelector(".vf-plugins-page-under")?.textContent ?? null,
  ]);

describe("the pegboard's names in the popup (MK-4d's names; James's MK-O10 pick A)", () => {
  it("says where each set hangs on Installed's lines and under What it adds, following the board", async () => {
    const board = mountBoard([{ id: "devices", label: "Devices", count: 3 }]);
    try {
      await mount(
        { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED },
        PLUGINS_FIXTURE_LISTED_SNAPSHOT,
      );
      toInstalled();
      expect(lineSaid("iOS Simulator")).toBe("Hangs under Devices · 0.1.0 · comes with VibeField");
      expect(lineSaid("Brass & Glass")).toBe("3 objects · Devices · 1.2.0");
      expect(lineSaid("Kanban")).toBe("2 objects · Devices · 2.1.0");
      expect(lineSaid("Comment pad")).toBe("1 object · 0.1.0 · comes with VibeField");
      // item 573: the made-up Brass & Glass, its Barometer hung as a Weather glass
      openInstalled("Brass & Glass");
      expect(addsSaid()).toEqual([
        ["Weather glass", words.hangsUnder("Devices")],
        ["Compass", null],
        ["Spirit level", null],
      ]);
      // the board names the category anew on its next frame: the page follows, never by its id
      board.publish([{ id: "devices", label: "On the bench", count: 3 }]);
      expect(addsSaid()[0]).toEqual(["Weather glass", words.hangsUnder("On the bench")]);
      expect(bodyText()).not.toContain("devices");
      // a board that hangs that category no more: no place
      board.publish([{ id: "things", label: "Things", count: 1 }]);
      expect(addsSaid()[0]).toEqual(["Weather glass", null]);
    } finally {
      board.unmount();
    }
  });

  it("says each set alone once no desk is mounted, as the catalog's popup does", async () => {
    const board = mountBoard([{ id: "devices", label: "Devices", count: 3 }]);
    try {
      await mount(NO_REGISTRY);
      toInstalled();
      expect(lineSaid("iOS Simulator")).toBe("Hangs under Devices · 0.1.0 · comes with VibeField");
    } finally {
      board.unmount();
    }
    // the desk gone (a remount's gap, or none mounted): no name to say a place by
    expect(lineSaid("iOS Simulator")).toBe("1 object · 0.1.0 · comes with VibeField");
    openInstalled("iOS Simulator");
    expect(addsSaid().map(([, under]) => under)).toEqual([null]);
  });
});

const tileTitles = (): (string | null)[] =>
  [...document.body.querySelectorAll(".vf-plugins-tile-title")].map((node) => node.textContent);
const tileActs = (): (string | null)[] =>
  [...document.body.querySelectorAll(".vf-plugins-tile-act")].map((node) => node.textContent);
const hotTile = (): string | null =>
  document.body.querySelector('.vf-plugins-tile-item[data-hot="true"] .vf-plugins-tile-title')
    ?.textContent ?? null;
const tile = (title: string): HTMLButtonElement | null =>
  [...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-tile")].find(
    (button) => button.querySelector(".vf-plugins-tile-title")?.textContent === title,
  ) ?? null;
/** Words typed in the field, as a person types them. */
const typeWords = (value: string): void =>
  act(() => {
    const input = field();
    if (input === null) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const SHELF: PluginsFixtureRead = { catalog: CATALOG_SHELF, refresh: CATALOG_SHELF };

describe("Discover's shelf (MK-4e; §8 'Discover')", () => {
  it("shows the featured set, then VibeField's, each saying its act, and asks fieldd nothing more", async () => {
    const { port, calls } = counting(pluginsFixturePort(SHELF));
    // item 573: this desktop has Brass & Glass from the list (a Built in plugin is never listed)
    await mount(port, PLUGINS_FIXTURE_LISTED_SNAPSHOT);
    expect(tileTitles()).toEqual(["Brass & Glass", "Burndown", "Desk things"]);
    expect(tileActs()).toEqual([
      words.PAGE_WORDS.installed,
      words.SHELF_WORDS.needsNewer,
      words.SHELF_WORDS.install,
    ]);
    expect(bodyText()).toContain("4 objects");
    // a community set waits for community plugins, and one with no listing is never shown
    expect(bodyText()).not.toContain("Kanban");
    // a tile is no stop of Tab: the field keeps the keys
    expect(tile("Desk things")?.tabIndex).toBe(-1);
    // each tile carries its plugin's id for the market's smoke rows (MK-6's A4), never on screen
    expect(
      [...document.body.querySelectorAll(".vf-plugins-body [data-plugin]")].map((node) =>
        node.getAttribute("data-plugin"),
      ),
    ).toEqual(["vibefield.brass-glass", "vibefield.burndown", "vibefield.desk-things"]);
    expect(bodyText()).not.toContain("vibefield.desk-things");
    expect(calls).toEqual({ catalog: 1, refresh: 1 });
  });

  it("walks its tiles from the field, ↓ ↑ a row and ← → one, and ↵ opens the hot one's page", async () => {
    await mount(SHELF);
    expect(hotTile()).toBe("Brass & Glass");
    press("ArrowDown");
    expect(hotTile()).toBe("Burndown");
    press("ArrowRight");
    expect(hotTile()).toBe("Desk things");
    press("ArrowLeft");
    expect(hotTile()).toBe("Burndown");
    press("ArrowUp");
    expect(hotTile()).toBe("Brass & Glass");
    press("ArrowDown");
    press("ArrowRight");
    press("Enter");
    expect(pageTitle()).toBe("Desk things");
    const back = document.body.querySelector<HTMLButtonElement>(".vf-plugins-back");
    expect(back?.getAttribute("aria-label")).toBe(words.PAGE_WORDS.back("Discover"));
    expect(bodyText()).toContain("Calendar");
    expect(bodyText()).toContain("Small things that keep time and measure, for the desk.");
    // a set this desktop doesn't have says no power; O2-C: ↵ on it pressed the foot's Install, so it downloads
    expect(bodyText()).not.toContain(words.PAGE_WORDS.can);
    expect(document.body.querySelector(".vf-plugins-page-act")?.textContent).toBe(
      words.INSTALL_WORDS.downloading,
    );
    esc();
    expect(pageTitle()).toBeNull();
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.discover);
  });

  it("opens a set's page on a press, and a set this desktop has opens its own page", async () => {
    await mount(SHELF, PLUGINS_FIXTURE_LISTED_SNAPSHOT);
    act(() => tile("Brass & Glass")?.click());
    expect(pageTitle()).toBe("Brass & Glass");
    expect(bodyText()).toContain(words.PAGE_WORDS.can);
    expect(document.body.querySelector(".vf-plugins-page-act")?.textContent).toBe(
      words.PAGE_WORDS.installed,
    );
  });

  it("searches its sets by typed words, says the object it found one by, and leaves ← → to the caret", async () => {
    await mount(SHELF);
    typeWords("ruler");
    expect(tileTitles()).toEqual(["Desk things"]);
    expect(bodyText()).toContain(words.SHELF_WORDS.has("Ruler"));
    expect(bodyText()).toContain(words.SHELF_WORDS.communityOff);
    // "desk" finds two sets, by title (Brass & Glass by its summary). → would walk to the second, so
    // the hot tile staying says → is the caret's while words are typed
    typeWords("desk");
    expect(tileTitles()).toEqual(["Brass & Glass", "Desk things"]);
    expect(hotTile()).toBe("Brass & Glass");
    press("ArrowRight");
    expect(hotTile()).toBe("Brass & Glass");
    typeWords("nothing here");
    expect(bodyText()).toContain(words.SHELF_WORDS.none("nothing here"));
    expect(tileTitles()).toEqual([]);
  });

  it("adds the community's sets after VibeField's while community plugins are on", async () => {
    act(() =>
      root.render(
        <Plugins
          surface="plugins"
          onSurfaceChange={() => undefined}
          port={pluginsFixturePort(SHELF)}
          snapshot={PLUGINS_FIXTURE_SNAPSHOT}
          community
          now={() => PLUGINS_FIXTURE_NOW}
        />,
      ),
    );
    await settle();
    expect(tileTitles()).toEqual(["Brass & Glass", "Burndown", "Desk things", "Kanban"]);
    expect(bodyText()).not.toContain(words.SHELF_WORDS.communityOff);
  });
});

/** Discover's categories as drawn (item 433): each segment's id, never on screen, its words, and
 * the chosen one's id. */
const categoriesSaid = (): {
  ids: (string | null)[];
  words: (string | null)[];
  chosen: string | null;
} => {
  const segments = [
    ...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-body button[data-id]"),
  ];
  const pressed = segments.find((node) => node.getAttribute("aria-pressed") === "true");
  return {
    ids: segments.map((node) => node.getAttribute("data-id")),
    words: segments.map((node) => node.textContent),
    chosen: pressed?.getAttribute("data-id") ?? null,
  };
};
/** The category's segment, by its id (`""` All). */
const categorySegment = (id: string): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>(`.vf-plugins-body button[data-id="${id}"]`);
/** A board that names four categories, in its order; Paper hangs no set the shelf's list holds. */
const NAMING_BOARD: readonly BoardCategory[] = [
  { id: "things", label: "Things", count: 4 },
  { id: "paper", label: "Paper", count: 2 },
  { id: "devices", label: "Devices", count: 1 },
  { id: "tools", label: "Tools", count: 1 },
];

describe("Discover's categories (item 433; §8 'Discover', MK-D2)", () => {
  it("draws the pegboard's categories after the featured set, by the board's names, and a category chosen keeps its sets", async () => {
    const board = mountBoard(NAMING_BOARD);
    try {
      await mount(SHELF);
      // All, then each category a shown set hangs under, in the board's order: Paper hangs none
      expect(categoriesSaid()).toEqual({
        ids: ["", "things", "devices", "tools"],
        words: ["All", "Things", "Devices", "Tools"],
        chosen: "",
      });
      // a category's id is never on screen
      expect(bodyText()).not.toContain("devices");
      expect(bodyText()).not.toContain("tools");
      // a row of its own, after the featured set and before the other sets, named to assistive tech
      const row = categorySegment("")?.closest("li") ?? null;
      const featured = document.body.querySelector('.vf-plugins-tile-item[data-featured="true"]');
      expect(row?.previousElementSibling).toBe(featured);
      expect(row?.nextElementSibling?.querySelector(".vf-plugins-tile-title")?.textContent).toBe(
        "Burndown",
      );
      expect(row?.querySelector("fieldset")?.getAttribute("aria-label")).toBe("Categories");
      // a category chosen keeps the sets one of whose objects hangs under it, by title, with no
      // featured row; its first tile is hot, and the field's keys walk them
      act(() => categorySegment("things")?.click());
      expect(categoriesSaid().chosen).toBe("things");
      expect(tileTitles()).toEqual(["Burndown", "Desk things"]);
      expect(document.body.querySelector('.vf-plugins-tile-item[data-featured="true"]')).toBeNull();
      expect(hotTile()).toBe("Burndown");
      press("ArrowRight");
      expect(hotTile()).toBe("Desk things");
      act(() => categorySegment("devices")?.click());
      expect(tileTitles()).toEqual(["Brass & Glass"]);
      expect(hotTile()).toBe("Brass & Glass");
      // All again: the featured set first
      act(() => categorySegment("")?.click());
      expect(categoriesSaid().chosen).toBe("");
      expect(tileTitles()).toEqual(["Brass & Glass", "Burndown", "Desk things"]);
    } finally {
      board.unmount();
    }
  });

  it("gives the keyboard back to the field after a press on a category, so ↵ opens the hot tile", async () => {
    const board = mountBoard(NAMING_BOARD);
    /** A segment pressed as the window's pointer presses it: the button takes the focus, then the
     * click counts one. A key's click (↵ or space on the segment) counts none. */
    const pressSegment = (id: string, detail: number): void =>
      act(() => {
        const segment = categorySegment(id);
        segment?.focus();
        segment?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
      });
    try {
      await mount(SHELF);
      pressSegment("things", 1);
      expect(categoriesSaid().chosen).toBe("things");
      expect(document.activeElement).toBe(field());
      expect(hotTile()).toBe("Burndown");
      // the chosen one pressed again keeps the hot tile where the keys left it
      press("ArrowRight");
      expect(hotTile()).toBe("Desk things");
      pressSegment("things", 1);
      expect(hotTile()).toBe("Desk things");
      // ↵ reaches the field and opens the hot tile's page (Desk things: the foot's Install)
      press("Enter");
      expect(pageTitle()).toBe("Desk things");
      esc();
      // a key's click leaves the keyboard on the row, for ← → Home End
      pressSegment("devices", 0);
      expect(categoriesSaid().chosen).toBe("devices");
      expect(document.activeElement).toBe(categorySegment("devices"));
    } finally {
      board.unmount();
    }
  });
});

describe("Discover's categories: their door, typed words and the board they follow (item 433)", () => {
  it("opens on the category its door asked for, each opening, and on All where Discover offers none", async () => {
    const board = mountBoard(NAMING_BOARD);
    try {
      const port = pluginsFixturePort(SHELF);
      const render = (surface: FrameSurface | null, initialCategory: string): void =>
        act(() =>
          root.render(
            <Plugins
              surface={surface}
              onSurfaceChange={() => undefined}
              port={port}
              snapshot={PLUGINS_FIXTURE_SNAPSHOT}
              initialCategory={initialCategory}
              now={() => PLUGINS_FIXTURE_NOW}
            />,
          ),
        );
      render("plugins", "tools");
      await settle();
      expect(categoriesSaid().chosen).toBe("tools");
      expect(tileTitles()).toEqual(["Desk things"]);
      // the next opening starts on its own door's: All, as the Me menu's Plugins… asks
      render(null, "");
      render("plugins", "");
      await settle();
      expect(categoriesSaid().chosen).toBe("");
      expect(tileTitles()).toEqual(["Brass & Glass", "Burndown", "Desk things"]);
      // a category no shown set hangs under (Paper): All, the featured set first
      render(null, "paper");
      render("plugins", "paper");
      await settle();
      expect(categoriesSaid().chosen).toBe("");
      expect(tileTitles()).toEqual(["Brass & Glass", "Burndown", "Desk things"]);
    } finally {
      board.unmount();
    }
  });

  it("searches every set while words are typed, its row gone, and the category comes back with it", async () => {
    const board = mountBoard(NAMING_BOARD);
    try {
      await mount(SHELF);
      act(() => categorySegment("devices")?.click());
      typeWords("ruler");
      expect(categoriesSaid().ids).toEqual([]);
      expect(tileTitles()).toEqual(["Desk things"]);
      expect(bodyText()).toContain(words.SHELF_WORDS.has("Ruler"));
      typeWords("");
      expect(categoriesSaid().chosen).toBe("devices");
      expect(tileTitles()).toEqual(["Brass & Glass"]);
    } finally {
      board.unmount();
    }
  });

  it("draws no row with no board, nor while the board names none the sets hang under, and follows the board", async () => {
    // no desk mounted, as in the catalog: nothing is named
    await mount(SHELF);
    expect(categoriesSaid().ids).toEqual([]);
    act(() => root.unmount());
    root = createRoot(host);
    const board = mountBoard([{ id: "paper", label: "Paper", count: 2 }]);
    try {
      await mount(SHELF);
      expect(categoriesSaid().ids).toEqual([]);
      // the board's next frame names them: the row follows
      board.publish(NAMING_BOARD);
      expect(categoriesSaid()).toEqual({
        ids: ["", "things", "devices", "tools"],
        words: [words.SHELF_WORDS.all, "Things", "Devices", "Tools"],
        chosen: "",
      });
      act(() => categorySegment("tools")?.click());
      expect(tileTitles()).toEqual(["Desk things"]);
    } finally {
      board.unmount();
    }
    // the desk gone (a remount's gap): no name, so no row, and the shelf shows All
    expect(categoriesSaid().ids).toEqual([]);
    expect(tileTitles()).toEqual(["Brass & Glass", "Burndown", "Desk things"]);
  });

  it("in the frame, opens Discover on the category its door asked for (More in Plugins…)", async () => {
    const board = mountBoard(NAMING_BOARD);
    resetPluginUpdates();
    try {
      const { client } = fielddAnswering(async () => CATALOG_SHELF);
      const frame = (surface: FrameSurface | null): ReactElement => (
        <FielddProvider client={client}>
          <FramePlugins
            view="canvas"
            surface={surface}
            onSurfaceChange={() => undefined}
            openCategory="devices"
          />
        </FielddProvider>
      );
      act(() => root.render(frame(null)));
      await settle();
      act(() => root.render(frame("plugins")));
      await settle();
      expect(categoriesSaid().chosen).toBe("devices");
      expect(tileTitles()).toEqual(["Brass & Glass"]);
    } finally {
      board.unmount();
      resetPluginUpdates();
    }
  });
});

/** The install's requests a port sent, in order (O2-C). */
function installs(inner: PluginsPort): { port: PluginsPort; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    port: {
      ...inner,
      prepare: (id) => {
        sent.push(`prepare ${id}`);
        return inner.prepare(id);
      },
      commit: (candidate) => {
        sent.push(`commit ${candidate}`);
        return inner.commit(candidate);
      },
      discard: (candidate) => {
        sent.push(`discard ${candidate}`);
        return inner.discard(candidate);
      },
    },
  };
}
const actRow = (): string =>
  document.body.querySelector(".vf-plugins-page-act-row")?.textContent ?? "";
const pageAct = (): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>(".vf-plugins-page-act-stack .vf-plugins-act");
const card = (): HTMLElement | null => document.body.querySelector<HTMLElement>(".vf-plugins-card");
const cardInstall = (): HTMLButtonElement | null =>
  card()?.querySelector<HTMLButtonElement>(".vf-plugins-card-acts .vf-plugins-act") ?? null;
const cardCancel = (): HTMLButtonElement | null =>
  card()?.querySelector<HTMLButtonElement>(".vf-plugins-card-cancel") ?? null;
const openThings = (): void => act(() => tile("Desk things")?.click());
const CANDIDATE = PLUGINS_FIXTURE_CANDIDATE;
/** The desktop once fieldd's snapshot holds Desk things. */
const WITH_THINGS = PluginRegistrySnapshot.parse({
  ...PLUGINS_FIXTURE_SNAPSHOT,
  generation: 9,
  plugins: [
    ...PLUGINS_FIXTURE_SNAPSHOT.plugins,
    PLUGINS_FIXTURE_DOWNLOADS["vibefield.desk-things"],
  ],
});

describe("Install and the install card (O2-C; §8 'Every install asks first')", () => {
  it("downloads first and says so, then the card stands where the act stood, read from the plugin", async () => {
    const pending = installs(pluginsFixturePort(SHELF, "answers", {}, { prepare: "pending" }));
    await mount(pending.port);
    openThings();
    expect(pageAct()?.textContent).toBe(`${words.SHELF_WORDS.install}↵`);
    act(() => pageAct()?.click());
    expect(actRow()).toBe(words.INSTALL_WORDS.downloading);
    expect(pending.sent).toEqual(["prepare vibefield.desk-things"]);
    act(() => root.unmount());
    root = createRoot(host);
    const { port } = installs(pluginsFixturePort(SHELF));
    await mount(port);
    openThings();
    act(() => pageAct()?.click());
    await settle();
    expect(card()?.getAttribute("aria-label")).toBe("Install Desk things?");
    const said = card()?.textContent ?? "";
    for (const line of [
      "It adds 4 objects to your pegboard:",
      "Clock",
      "Ruler",
      "It can:",
      "Read what's on the desk",
      "Keep its own data",
      "It installs on your 3 desktops, because your desktops share one set of plugins.",
      "studio",
      "mini",
      "tower",
    ]) {
      expect(said).toContain(line);
    }
    // a device on the tailnet that runs no VibeField is never counted
    expect(said).not.toContain("iPhone");
  });

  it("installs what the card showed, says Installing until the snapshot holds it, then Installed", async () => {
    const { port, sent } = installs(pluginsFixturePort(SHELF));
    await mount(port);
    openThings();
    act(() => pageAct()?.click());
    await settle();
    act(() => cardInstall()?.click());
    await settle();
    expect(sent).toEqual(["prepare vibefield.desk-things", `commit ${CANDIDATE}`]);
    expect(card()).toBeNull();
    expect(actRow()).toBe(words.INSTALL_WORDS.installing(4));
    act(() => root.render(<Window port={port} snapshot={WITH_THINGS} open />));
    await settle();
    expect(pageTitle()).toBe("Desk things");
    // MK-4d: then Show them on the pegboard, for the four objects the board hangs, which a press hands the board
    expect(actRow()).toBe(`${words.PAGE_WORDS.installed}${words.showWords(4)}↵`);
    expect(bodyText()).toContain(words.PAGE_WORDS.can);
    act(() => showAct()?.click());
    expect(boardReveal()?.types).toEqual([
      "DeskThingsClock",
      "DeskThingsCalendar",
      "DeskThingsTimer",
      "DeskThingsRuler",
    ]);
  });

  it("throws the download away on Cancel, on Esc, and on leaving the page, and goes back to Install", async () => {
    const { port, sent } = installs(pluginsFixturePort(SHELF));
    await mount(port);
    openThings();
    act(() => pageAct()?.click());
    await settle();
    act(() => cardCancel()?.click());
    expect(card()).toBeNull();
    expect(pageAct()?.textContent).toBe(`${words.SHELF_WORDS.install}↵`);
    // the Cancel pressed is gone, so the keyboard goes back to the field
    expect(document.activeElement).toBe(field());
    // Esc answers the card first, and the page stays
    act(() => pageAct()?.click());
    await settle();
    esc();
    expect(card()).toBeNull();
    expect(pageTitle()).toBe("Desk things");
    // its back row lets it go too
    act(() => pageAct()?.click());
    await settle();
    act(() => document.body.querySelector<HTMLButtonElement>(".vf-plugins-back")?.click());
    await settle();
    expect(sent.filter((line) => line.startsWith("discard"))).toEqual([
      `discard ${CANDIDATE}`,
      `discard ${CANDIDATE}`,
      `discard ${CANDIDATE}`,
    ]);
    expect(sent.some((line) => line.startsWith("commit"))).toBe(false);
  });

  it("lets the card go for a tab pressed, words typed, or the popup folding", async () => {
    const { port, sent } = installs(pluginsFixturePort(SHELF));
    await mount(port);
    const discards = (): number => sent.filter((line) => line.startsWith("discard")).length;
    const cardUp = async (): Promise<void> => {
      openThings();
      act(() => pageAct()?.click());
      await settle();
      expect(card()).not.toBeNull();
    };
    await cardUp();
    act(() => part(words.PLUGINS_TAB_WORDS.installed)?.click());
    await settle();
    expect(discards()).toBe(1);
    act(() => part(words.PLUGINS_TAB_WORDS.discover)?.click());
    await cardUp();
    typeWords("desk");
    await settle();
    expect(discards()).toBe(2);
    typeWords("");
    await cardUp();
    act(() => setSurface(null));
    await settle();
    expect(discards()).toBe(3);
    expect(card()).toBeNull();
    expect(sent.some((line) => line.startsWith("commit"))).toBe(false);
  });

  it("throws away a download that lands after its page was left, or after the window closed", async () => {
    let land: (value: PluginsInstallPrepareResult) => void = () => undefined;
    const inner = pluginsFixturePort(SHELF);
    const { port, sent } = installs({
      ...inner,
      prepare: () => new Promise((resolve) => (land = resolve)),
    });
    await mount(port);
    openThings();
    act(() => pageAct()?.click());
    act(() => document.body.querySelector<HTMLButtonElement>(".vf-plugins-back")?.click());
    const record = PLUGINS_FIXTURE_DOWNLOADS["vibefield.desk-things"];
    if (record === undefined) throw new Error("the fixture's download is missing");
    await act(async () => land({ candidate: CANDIDATE, record }));
    await settle();
    expect(sent).toEqual(["prepare vibefield.desk-things", `discard ${CANDIDATE}`]);
    expect(card()).toBeNull();
    // the window closing lets its install go: a download landing after it is thrown away too
    openThings();
    act(() => pageAct()?.click());
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => land({ candidate: CANDIDATE, record }));
    await settle();
    expect(sent.filter((line) => line.startsWith("discard"))).toHaveLength(2);
  });

  it("says a failure in §9's words, never fieldd's text, and Try again downloads again", async () => {
    const { port, sent } = installs(
      pluginsFixturePort(SHELF, "answers", {}, { prepare: "refuses" }),
    );
    await mount(port);
    openThings();
    act(() => pageAct()?.click());
    await settle();
    expect(bodyText()).toContain(words.INSTALL_WORDS.failed("Desk things"));
    expect(bodyText()).not.toContain(PLUGINS_FIXTURE_REFUSAL);
    expect(pageAct()?.textContent).toBe(`${words.INSTALL_WORDS.tryAgain}↵`);
    act(() => pageAct()?.click());
    expect(sent).toEqual(["prepare vibefield.desk-things", "prepare vibefield.desk-things"]);
    // an install refused after the card says the same
    act(() => root.unmount());
    root = createRoot(host);
    await mount(pluginsFixturePort(SHELF, "answers", {}, { commit: "refuses" }));
    openThings();
    act(() => pageAct()?.click());
    await settle();
    act(() => cardInstall()?.click());
    await settle();
    expect(bodyText()).toContain(words.INSTALL_WORDS.failed("Desk things"));
  });

  it("words a refusal by its kind, never its text: one this VibeField can't run needs a newer one", async () => {
    const refusing = (error: FielddRpcError): PluginsPort => ({
      ...pluginsFixturePort(SHELF),
      prepare: () => Promise.reject(error),
    });
    // item 322's refusal names an inside (the carry's F7), so the page says §9's line
    const slot =
      "the copy of this release already in place does not match the artifact — not installed";
    await mount(
      refusing(
        new FielddRpcError("PRECONDITION_FAILED", slot, false, {
          pluginKind: "PLUGIN_ARTIFACT_MISMATCH",
        }),
      ),
    );
    openThings();
    act(() => pageAct()?.click());
    await settle();
    expect(bodyText()).toContain(words.INSTALL_WORDS.failed("Desk things"));
    expect(bodyText()).not.toContain(slot);
    act(() => root.unmount());
    root = createRoot(host);
    await mount(
      refusing(
        new FielddRpcError("PRECONDITION_FAILED", "requires contracts ^9.0.0", false, {
          pluginKind: "PLUGIN_INCOMPATIBLE",
        }),
      ),
    );
    openThings();
    act(() => pageAct()?.click());
    await settle();
    // no Try again: it would fail the same way until VibeField updates
    expect(actRow()).toBe(words.SHELF_WORDS.needsNewer);
    expect(pageAct()).toBeNull();
    expect(bodyText()).not.toContain("contracts");
  });

  it("presses the page's act and the card's Install with ↵ from the field", async () => {
    const { port, sent } = installs(pluginsFixturePort(SHELF));
    await mount(port);
    openThings();
    press("Enter");
    await settle();
    expect(card()).not.toBeNull();
    press("Enter");
    await settle();
    expect(sent).toEqual(["prepare vibefield.desk-things", `commit ${CANDIDATE}`]);
  });

  it("offers the hot tile's Install in Discover's foot, and none for a set this desktop has", async () => {
    const { port, sent } = installs(pluginsFixturePort(SHELF));
    await mount(port, PLUGINS_FIXTURE_LISTED_SNAPSHOT);
    const footAct = (): HTMLButtonElement | null =>
      document.body.querySelector<HTMLButtonElement>(".vf-plugins-foot .vf-plugins-act");
    // Brass & Glass, featured, is installed here from the list: no act
    expect(footAct()).toBeNull();
    press("ArrowDown");
    press("ArrowRight");
    expect(hotTile()).toBe("Desk things");
    expect(footAct()?.textContent).toBe(`${words.SHELF_WORDS.install}↵`);
    act(() => footAct()?.click());
    await settle();
    expect(pageTitle()).toBe("Desk things");
    expect(card()).not.toBeNull();
    expect(sent).toEqual(["prepare vibefield.desk-things"]);
  });

  it("waits offline, saying why, and takes no press while fieldd isn't answering", async () => {
    const offline = PluginsCatalog.parse({ ...CATALOG_SHELF, state: "unreachable" });
    await mount({ catalog: offline, refresh: offline });
    openThings();
    expect(pageAct()?.disabled).toBe(true);
    expect(actRow()).toContain(words.INSTALL_WORDS.offline);
    act(() => root.unmount());
    root = createRoot(host);
    act(() =>
      root.render(
        <Window port={pluginsFixturePort(SHELF)} snapshot={PLUGINS_FIXTURE_SNAPSHOT} open away />,
      ),
    );
    await settle();
    openThings();
    expect(pageAct()?.disabled).toBe(true);
    expect(bodyText()).toContain(words.PLUGINS_AWAY);
  });
});

/** This desktop's statement mark as fieldd's two doors answer it (MK-O3D; James's MK-O1 pick B), and the marks the
 * window sent. */
function marking(shown: boolean | "unread"): { door: CommunityStatementDoor; marks: string[] } {
  const marks: string[] = [];
  return {
    marks,
    door: {
      shownHere: () =>
        shown === "unread"
          ? Promise.reject(new Error("the fixture's mark can't be read"))
          : Promise.resolve(shown),
      markShown: () => {
        marks.push("shown");
        return Promise.resolve();
      },
    },
  };
}
/** Kanban, a community set, as this desktop would have it once installed: the row its download answers. */
const KANBAN = PLUGINS_FIXTURE_LISTED_SNAPSHOT.plugins.find(
  (plugin) => plugin.id === "acme.kanban",
);
/** The shelf's fixture port, whose download of Kanban answers its row. */
function withKanban(): PluginsPort {
  const inner = pluginsFixturePort(SHELF);
  return {
    ...inner,
    prepare: (id) =>
      id === "acme.kanban" && KANBAN !== undefined
        ? Promise.resolve({ candidate: CANDIDATE, record: KANBAN })
        : inner.prepare(id),
  };
}
/** The popup over this desktop's mark, with community plugins as given (on unless said), on a page if given. */
async function mountCommunity(
  port: PluginsPort,
  door: CommunityStatementDoor,
  community: boolean | null = true,
  initialPage: string | null = null,
): Promise<void> {
  act(() =>
    root.render(
      <Plugins
        surface="plugins"
        onSurfaceChange={() => undefined}
        port={port}
        snapshot={PLUGINS_FIXTURE_SNAPSHOT}
        community={community}
        statement={door}
        initialPage={initialPage}
        now={() => PLUGINS_FIXTURE_NOW}
      />,
    ),
  );
  await settle();
}
const clickKanbanTile = (): void => act(() => tile("Kanban")?.click());
/** One of the statement's two acts, by its words. */
const statementAct = (words_: string): HTMLButtonElement | null =>
  [...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-card button")].find(
    (button) => button.textContent === words_,
  ) ?? null;

describe("the community statement at this desktop's first community install (MK-O3D; MK-O1 B)", () => {
  it("stands in the card's place once the download is in; only Continue marks it and brings the card", async () => {
    const { door, marks } = marking(false);
    const { port, sent } = installs(withKanban());
    await mountCommunity(port, door);
    clickKanbanTile();
    act(() => pageAct()?.click());
    await settle();
    expect(card()?.getAttribute("aria-label")).toBe("First community plugin on studio");
    expect(card()?.textContent).toContain(words.COMMUNITY_WORDS.statement);
    expect(cardInstall()).toBeNull();
    // no ↵ printed on its acts; the keyboard on its Cancel, and ↵ in the field presses nothing
    expect(card()?.querySelector("kbd")).toBeNull();
    expect(document.activeElement).toBe(statementAct(words.COMMUNITY_WORDS.cancel));
    press("Enter");
    await settle();
    expect([sent, marks]).toEqual([["prepare acme.kanban"], []]);
    act(() => statementAct(words.INSTALL_WORDS.goOn)?.click());
    await settle();
    expect(marks).toEqual(["shown"]);
    expect(card()?.getAttribute("aria-label")).toBe("Install Kanban?");
    expect(document.activeElement).toBe(field());
    act(() => cardInstall()?.click());
    await settle();
    expect(sent).toEqual(["prepare acme.kanban", `commit ${CANDIDATE}`]);
  });

  it("throws the download away on Cancel or Esc and marks nothing, so the next Install asks again", async () => {
    const { door, marks } = marking(false);
    const { port, sent } = installs(withKanban());
    await mountCommunity(port, door);
    clickKanbanTile();
    act(() => pageAct()?.click());
    await settle();
    act(() => statementAct(words.COMMUNITY_WORDS.cancel)?.click());
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(field());
    act(() => pageAct()?.click());
    await settle();
    expect(card()?.getAttribute("aria-label")).toBe("First community plugin on studio");
    esc();
    expect(card()).toBeNull();
    expect(pageTitle()).toBe("Kanban");
    expect(sent).toEqual([
      "prepare acme.kanban",
      `discard ${CANDIDATE}`,
      "prepare acme.kanban",
      `discard ${CANDIDATE}`,
    ]);
    expect(marks).toEqual([]);
  });

  it("goes straight to the card at a desktop that has shown it, and for a set by VibeField", async () => {
    const shown = marking(true);
    const { port, sent } = installs(withKanban());
    await mountCommunity(port, shown.door);
    clickKanbanTile();
    act(() => pageAct()?.click());
    await settle();
    expect(card()?.getAttribute("aria-label")).toBe("Install Kanban?");
    expect(sent).toEqual(["prepare acme.kanban"]);
    act(() => root.unmount());
    root = createRoot(host);
    const notShown = marking(false);
    await mountCommunity(withKanban(), notShown.door);
    openThings();
    act(() => pageAct()?.click());
    await settle();
    expect(card()?.getAttribute("aria-label")).toBe("Install Desk things?");
    expect([shown.marks, notShown.marks]).toEqual([[], []]);
  });

  it("shows it where the mark can't be read, and says why a community set's Install waits while off", async () => {
    await mountCommunity(withKanban(), marking("unread").door);
    clickKanbanTile();
    act(() => pageAct()?.click());
    await settle();
    expect(card()?.getAttribute("aria-label")).toBe("First community plugin on studio");
    act(() => root.unmount());
    root = createRoot(host);
    // off, a community set's page (opened as a plate opens one) takes no Install, and says why
    await mountCommunity(withKanban(), marking(false).door, false, "acme.kanban");
    expect(pageTitle()).toBe("Kanban");
    expect(pageAct()?.disabled).toBe(true);
    expect(actRow()).toContain(words.INSTALL_WORDS.communityOff);
    act(() => root.unmount());
    root = createRoot(host);
    // unread, they may be on: no press, and nothing said of a switch the window hasn't read
    await mountCommunity(withKanban(), marking(false).door, null, "acme.kanban");
    expect(pageAct()?.disabled).toBe(true);
    expect(actRow()).not.toContain(words.INSTALL_WORDS.communityOff);
  });
});

/** The removals a port sent, in order (MK-4f). */
function removals(inner: PluginsPort): { port: PluginsPort; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    port: {
      ...inner,
      uninstall: (id, removeData) => {
        sent.push(`uninstall ${id} ${removeData}`);
        return inner.uninstall(id, removeData);
      },
    },
  };
}
const removeAct = (): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>(".vf-plugins-remove .vf-plugins-card-cancel");
const question = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('.vf-plugins-card[aria-label^="Remove"]');
const questionButton = (words_: string): HTMLButtonElement | null =>
  [...(question()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.textContent === words_,
  ) ?? null;
const LISTED: PluginsFixtureRead = { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED };
/** Kanban's page, from Installed, on the desktop that has it. */
async function openKanban(port: PluginsPort): Promise<void> {
  await mount(port, PLUGINS_FIXTURE_LISTED_SNAPSHOT);
  toInstalled();
  const kanban = rows().find((row) => row.textContent?.includes("Kanban"));
  act(() => kanban?.click());
}

describe("Remove… on a plugin's page (MK-4f; §8 'The destructive uninstall affordance')", () => {
  it("stands on a plugin from the list's page alone: never a Built in, Development (§8's call, closed) or Sideloaded one", async () => {
    await openKanban(pluginsFixturePort(LISTED));
    expect(removeAct()?.textContent).toBe(words.REMOVE_WORDS.act);
    act(() => root.unmount());
    root = createRoot(host);
    await mount(pluginsFixturePort(LISTED), PLUGINS_FIXTURE_LISTED_SNAPSHOT);
    toInstalled();
    for (const title of ["iOS Simulator", "Desk clock", "Key-value store"]) {
      act(() =>
        rows()
          .find((row) => row.textContent?.includes(title))
          ?.click(),
      );
      expect(pageTitle()).toBe(title);
      expect(removeAct()).toBeNull();
      esc();
    }
  });

  it("asks in place, Cancel holding the keyboard, and names the objects that will draw as missing", async () => {
    const { port, sent } = removals(pluginsFixturePort(LISTED));
    await openKanban(port);
    act(() => removeAct()?.click());
    await settle();
    expect(question()?.getAttribute("aria-label")).toBe("Remove Kanban?");
    expect(question()?.textContent).toContain(
      "Board and Card objects on your desks draw as missing on your desktops until then.",
    );
    expect(document.activeElement).toBe(questionButton(words.REMOVE_WORDS.cancel));
    // Esc answers the question first, and the keyboard goes back to the field
    esc();
    expect(question()).toBeNull();
    expect(pageTitle()).toBe("Kanban");
    expect(document.activeElement).toBe(field());
    act(() => removeAct()?.click());
    act(() => questionButton(words.REMOVE_WORDS.cancel)?.click());
    await settle();
    // a roster answering after Cancel brings no question back
    expect(question()).toBeNull();
    expect(sent).toEqual([]);
  });

  it("removes it with its data kept, and stands until the snapshot no longer holds it", async () => {
    const { port, sent } = removals(pluginsFixturePort(LISTED));
    await openKanban(port);
    act(() => removeAct()?.click());
    await settle();
    act(() => questionButton(words.REMOVE_WORDS.confirm)?.click());
    await settle();
    expect(sent).toEqual(["uninstall acme.kanban false"]);
    // under way: it stands, and nothing takes a press
    expect(questionButton(words.REMOVE_WORDS.cancel)?.disabled).toBe(true);
    act(() => root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_SNAPSHOT} open />));
    await settle();
    // gone from this desktop: its page is the list's, whose act is Install, and the keyboard is the field's
    expect(question()).toBeNull();
    expect(pageTitle()).toBe("Kanban");
    expect(removeAct()).toBeNull();
    expect(pageAct()?.textContent).toBe(`${words.SHELF_WORDS.install}↵`);
    expect(document.activeElement).toBe(field());
  });

  it("closes the page to its tab once a plugin the list doesn't hold is gone, and its keys walk again", async () => {
    const port = pluginsFixturePort(NO_REGISTRY);
    await mount(port, PLUGINS_FIXTURE_LISTED_SNAPSHOT);
    toInstalled();
    act(() =>
      rows()
        .find((row) => row.textContent?.includes("Kanban"))
        ?.click(),
    );
    expect(pageTitle()).toBe("Kanban");
    act(() => removeAct()?.click());
    await settle();
    act(() => questionButton(words.REMOVE_WORDS.confirm)?.click());
    await settle();
    act(() => root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_SNAPSHOT} open />));
    await settle();
    expect(pageTitle()).toBeNull();
    expect(chosen()).toBe(words.PLUGINS_TAB_WORDS.installed);
    expect(document.activeElement).toBe(field());
    expect(hotTitle()).toBe("Comment pad");
    press("ArrowDown");
    expect(hotTitle()).toBe("iOS Simulator");
  });

  it("asks again before its data goes: this desktop alone, your others named, Remove data", async () => {
    const { port, sent } = removals(pluginsFixturePort(LISTED));
    await openKanban(port);
    act(() => removeAct()?.click());
    await settle();
    act(() => questionButton(words.REMOVE_WORDS.further)?.click());
    expect(question()?.getAttribute("aria-label")).toBe("Remove Kanban and its data?");
    // the window says this PC unless it is told it runs on a Mac (`onMac`, false in these tests)
    expect(question()?.textContent).toContain(
      "This deletes its settings and data on this PC. It can't be undone.",
    );
    expect(question()?.textContent).toContain(
      "mini and tower remove Kanban too, and keep their copy of its data.",
    );
    expect(document.activeElement).toBe(questionButton(words.REMOVE_WORDS.cancel));
    act(() => questionButton(words.REMOVE_WORDS.confirmData)?.click());
    await settle();
    expect(sent).toEqual(["uninstall acme.kanban true"]);
  });

  it("says a refusal under Remove…, never fieldd's text, until it is pressed again", async () => {
    await openKanban(pluginsFixturePort(LISTED, "answers", {}, { uninstall: "refuses" }));
    act(() => removeAct()?.click());
    await settle();
    act(() => questionButton(words.REMOVE_WORDS.confirm)?.click());
    await settle();
    expect(question()).toBeNull();
    expect(bodyText()).toContain(words.REMOVE_WORDS.refused);
    expect(bodyText()).not.toContain(PLUGINS_FIXTURE_REFUSAL);
    // the question's buttons went with it, so the keyboard goes back to the field
    expect(document.activeElement).toBe(field());
    act(() => removeAct()?.click());
    await settle();
    expect(bodyText()).not.toContain(words.REMOVE_WORDS.refused);
  });
});

/** An update's requests a port sent, in order (MK-UC's UC-C). */
function updating(inner: PluginsPort): { port: PluginsPort; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    port: {
      ...inner,
      prepareUpdate: (id, version) => {
        sent.push(`prepareUpdate ${id} ${version}`);
        return inner.prepareUpdate(id, version);
      },
      commit: (candidate) => {
        sent.push(`commit ${candidate}`);
        return inner.commit(candidate);
      },
      discard: (candidate) => {
        sent.push(`discard ${candidate}`);
        return inner.discard(candidate);
      },
    },
  };
}
const UPDATES: PluginsFixtureRead = { catalog: CATALOG_UPDATES, refresh: CATALOG_UPDATES };
const NOTE_KEY = "vf-plugins-carry";
/** Updates' row of the plugin titled `title`. */
const updateRow = (title: string): HTMLLIElement | null =>
  [...document.body.querySelectorAll<HTMLLIElement>(".vf-plugins-update")].find(
    (item) => item.querySelector(".vf-plugins-title")?.textContent === title,
  ) ?? null;
const rowUpdate = (title: string): HTMLButtonElement | null =>
  updateRow(title)?.querySelector<HTMLButtonElement>(".vf-plugins-update-act .vf-plugins-act") ??
  null;
const rowCard = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(".vf-plugins-update-card .vf-plugins-card");
const cardButton = (words_: string): HTMLButtonElement | null =>
  [...(card()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) =>
    button.textContent?.startsWith(words_),
  ) ?? null;
const updatesHead = (): string =>
  document.body.querySelector(".vf-plugins-updates-said")?.textContent ?? "";
const footButton = (words_: string): HTMLButtonElement | null =>
  [...document.body.querySelectorAll<HTMLButtonElement>(".vf-plugins-foot button")].find(
    (button) => button.textContent === words_,
  ) ?? null;
async function openUpdates(port: PluginsPort): Promise<void> {
  await mount(port, PLUGINS_FIXTURE_OUTDATED_SNAPSHOT);
  act(() => part(words.PLUGINS_TAB_WORDS.updates)?.click());
}
/** The download an update's fixture answers for `id`. */
const downloaded = (id: string) => {
  const download = PLUGINS_FIXTURE_UPDATE_DOWNLOADS[id];
  if (download === undefined) throw new Error(`the fixture has no update for ${id}`);
  return download.record;
};
/** The desktop once fieldd's snapshot holds the update of `id`. */
const takenOn = (id: string): PluginRegistrySnapshot =>
  PluginRegistrySnapshot.parse({
    ...PLUGINS_FIXTURE_OUTDATED_SNAPSHOT,
    generation: 7,
    plugins: PLUGINS_FIXTURE_OUTDATED_SNAPSHOT.plugins.map((plugin) =>
      plugin.id === id ? downloaded(id) : plugin,
    ),
  });

describe("Updates' rows and the update card (MK-UC's UC-C; §8 'Updates')", () => {
  it("lists each plugin from the list with a newer release: its head, line, changes, act and note", async () => {
    await openUpdates(pluginsFixturePort(UPDATES));
    const when = words.listTime(PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW);
    expect(updatesHead()).toBe(`2 updates · checked ${when}`);
    const titles = [...document.body.querySelectorAll(".vf-plugins-update .vf-plugins-title")].map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(["Burndown", "Notes", "Timers"]);
    expect(updateRow("Notes")?.textContent).toContain("0.6.1 → 0.7.0 · Nov 7");
    expect(rowUpdate("Notes")?.textContent).toBe(words.UPDATE_WORDS.update);
    // the list's listing says Timers keeps its Timer, adds an Alarm and drops the Stopwatch, so it asks first
    expect(updateRow("Timers")?.textContent).toContain("Adds Alarm · Removes Stopwatch");
    expect(rowUpdate("Timers")?.textContent).toBe(words.UPDATE_WORDS.updateAsks);
    // one that can't run here says so, with no act, and is not counted
    expect(updateRow("Burndown")?.textContent).toContain(words.SHELF_WORDS.needsNewer);
    expect(rowUpdate("Burndown")).toBeNull();
    const all = document.body.querySelector<HTMLButtonElement>(".vf-plugins-updates-all");
    expect(all?.textContent).toBe(words.UPDATE_WORDS.allAsks);
    expect(bodyText()).toContain(words.UPDATE_WORDS.note);
    expect(footButton(words.UPDATE_WORDS.again)).not.toBeNull();
  });

  it("stops at its card when it can do more, naming only the new power; Cancel and Esc throw it away", async () => {
    const { port, sent } = updating(pluginsFixturePort(UPDATES));
    await openUpdates(port);
    act(() => rowUpdate("Notes")?.click());
    expect(updateRow("Notes")?.textContent).toContain(words.INSTALL_WORDS.downloading);
    await settle();
    expect(rowCard()?.getAttribute("aria-label")).toBe("Update Notes?");
    const said = rowCard()?.textContent ?? "";
    expect(said).toContain(words.UPDATE_CARD_WORDS.can);
    expect(said).toContain(pluginPowerWords("net.outbound", { onMac: false }) ?? "net.outbound");
    // a power the version you have holds already is not named
    const held = pluginPowerWords("storage.self", { onMac: false }) ?? "storage.self";
    expect(said).not.toContain(held);
    expect(said).toContain(words.UPDATE_CARD_WORDS.here(false));
    act(() => cardButton(words.CARD_WORDS.cancel)?.click());
    await settle();
    expect(rowCard()).toBeNull();
    expect(rowUpdate("Notes")?.textContent).toBe(words.UPDATE_WORDS.update);
    act(() => rowUpdate("Notes")?.click());
    await settle();
    esc();
    expect(rowCard()).toBeNull();
    expect(pop()).not.toBeNull();
    expect(sent).toEqual([
      "prepareUpdate vibefield.notes 0.7.0",
      `discard ${CANDIDATE}`,
      "prepareUpdate vibefield.notes 0.7.0",
      `discard ${CANDIDATE}`,
    ]);
  });

  it("takes what its card showed: Updating… until the snapshot holds the version, then Updated to", async () => {
    const { port, sent } = updating(pluginsFixturePort(UPDATES));
    await openUpdates(port);
    act(() => rowUpdate("Notes")?.click());
    await settle();
    act(() => cardButton(words.UPDATE_CARD_WORDS.confirm)?.click());
    await settle();
    expect(sent).toEqual(["prepareUpdate vibefield.notes 0.7.0", `commit ${CANDIDATE}`]);
    expect(rowCard()).toBeNull();
    expect(updateRow("Notes")?.textContent).toContain(words.UPDATE_WORDS.updating);
    // a plugin with no object brings no window back fresh, so no note is kept
    expect(sessionStorage.getItem(NOTE_KEY)).toBeNull();
    act(() => root.render(<Window port={port} snapshot={takenOn("vibefield.notes")} open />));
    await settle();
    expect(updateRow("Notes")?.textContent).toContain(words.UPDATE_WORDS.updated("0.7.0"));
    expect(rowUpdate("Notes")).toBeNull();
    const when = words.listTime(PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW);
    expect(updatesHead()).toBe(`1 update · checked ${when}`);
  });

  it("takes an update that asks for nothing new and drops nothing in one press, with no card", async () => {
    const inner = pluginsFixturePort(UPDATES);
    const quiet: PluginsInstallPrepareResult = {
      candidate: CANDIDATE,
      record: downloaded("vibefield.notes"),
      update: { from: "0.6.1", asksFor: [] },
    };
    const { port, sent } = updating({ ...inner, prepareUpdate: () => Promise.resolve(quiet) });
    await openUpdates(port);
    act(() => rowUpdate("Notes")?.click());
    await settle();
    expect(sent).toEqual(["prepareUpdate vibefield.notes 0.7.0", `commit ${CANDIDATE}`]);
    expect(rowCard()).toBeNull();
    expect(updateRow("Notes")?.textContent).toContain(words.UPDATE_WORDS.updating);
  });

  it("asks first for one that drops an object, saying what will draw as missing, and keeps the note", async () => {
    const { port, sent } = updating(pluginsFixturePort(UPDATES));
    await openUpdates(port);
    act(() => rowUpdate("Timers")?.click());
    await settle();
    const said = rowCard()?.textContent ?? "";
    expect(said).toContain(words.UPDATE_CARD_WORDS.missing("Stopwatch"));
    expect(said).not.toContain(words.UPDATE_CARD_WORDS.can);
    act(() => cardButton(words.UPDATE_CARD_WORDS.confirm)?.click());
    await settle();
    expect(sent).toEqual(["prepareUpdate vibefield.timers 1.1.0", `commit ${CANDIDATE}`]);
    // MK-E6: a plugin with objects can bring the window back fresh, so the note says where the popup stood
    expect(JSON.parse(sessionStorage.getItem(NOTE_KEY) ?? "null")).toMatchObject({
      v: 1,
      page: { id: "vibefield.timers", from: "updates" },
      rest: [],
      done: [],
    });
    // folding the popup lets the note go
    act(() => setSurface(null));
    expect(sessionStorage.getItem(NOTE_KEY)).toBeNull();
  });

  it("says a failure in its words, never fieldd's text, and Try again downloads again", async () => {
    const refusing = pluginsFixturePort(UPDATES, "answers", {}, { prepare: "refuses" });
    const { port, sent } = updating(refusing);
    await openUpdates(port);
    act(() => rowUpdate("Notes")?.click());
    await settle();
    expect(updateRow("Notes")?.textContent).toContain(words.UPDATE_WORDS.failed("Notes"));
    expect(bodyText()).not.toContain(PLUGINS_FIXTURE_REFUSAL);
    expect(rowUpdate("Notes")?.textContent).toBe(words.INSTALL_WORDS.tryAgain);
    act(() => rowUpdate("Notes")?.click());
    expect(sent).toEqual([
      "prepareUpdate vibefield.notes 0.7.0",
      "prepareUpdate vibefield.notes 0.7.0",
    ]);
  });

  it("Update all takes them one at a time, plugins with no object first, waiting at each card", async () => {
    const { port, sent } = updating(pluginsFixturePort(UPDATES));
    await openUpdates(port);
    act(() => document.body.querySelector<HTMLButtonElement>(".vf-plugins-updates-all")?.click());
    await settle();
    expect(sent).toEqual(["prepareUpdate vibefield.notes 0.7.0"]);
    expect(rowCard()?.getAttribute("aria-label")).toBe("Update Notes?");
    // its Cancel answers it, and Update all goes on to Timers; Burndown, which can't run here, is passed
    act(() => cardButton(words.CARD_WORDS.cancel)?.click());
    await settle();
    expect(rowCard()?.getAttribute("aria-label")).toBe("Update Timers?");
    act(() => cardButton(words.UPDATE_CARD_WORDS.confirm)?.click());
    await settle();
    expect(sent).toEqual([
      "prepareUpdate vibefield.notes 0.7.0",
      `discard ${CANDIDATE}`,
      "prepareUpdate vibefield.timers 1.1.0",
      `commit ${CANDIDATE}`,
    ]);
    // during Update all the note reopens on Updates, with what it took
    expect(JSON.parse(sessionStorage.getItem(NOTE_KEY) ?? "null")).toMatchObject({
      page: null,
      rest: [],
      done: [["vibefield.timers", "1.1.0"]],
    });
  });

  it("walks its rows with ↑ ↓, and ↵ presses the hot row's Update, then its card's", async () => {
    const { port, sent } = updating(pluginsFixturePort(UPDATES));
    await openUpdates(port);
    press("ArrowDown");
    expect(rowUpdate("Notes")?.textContent).toBe(`${words.UPDATE_WORDS.update}↵`);
    press("Enter");
    await settle();
    expect(rowCard()).not.toBeNull();
    press("Enter");
    await settle();
    expect(sent).toEqual(["prepareUpdate vibefield.notes 0.7.0", `commit ${CANDIDATE}`]);
  });

  it("says Update on a page whose update waits, and takes the same steps there", async () => {
    const { port, sent } = updating(pluginsFixturePort(UPDATES));
    await openUpdates(port);
    act(() => updateRow("Notes")?.querySelector<HTMLButtonElement>(".vf-plugins-row")?.click());
    expect(pageTitle()).toBe("Notes");
    expect(document.body.querySelector(".vf-plugins-back")?.textContent).toBe(
      words.PLUGINS_TAB_WORDS.updates,
    );
    expect(pageAct()?.textContent).toBe(`${words.UPDATE_WORDS.update}↵`);
    act(() => pageAct()?.click());
    await settle();
    expect(card()?.getAttribute("aria-label")).toBe("Update Notes?");
    act(() => cardButton(words.UPDATE_CARD_WORDS.confirm)?.click());
    await settle();
    expect(actRow()).toBe(words.UPDATE_WORDS.updating);
    act(() => root.render(<Window port={port} snapshot={takenOn("vibefield.notes")} open />));
    await settle();
    expect(actRow()).toBe(words.PAGE_WORDS.installed);
    expect(sent).toEqual(["prepareUpdate vibefield.notes 0.7.0", `commit ${CANDIDATE}`]);
  });

  it("keeps Installed on the page of a plugin whose update can't run here, opened from Updates or Installed", async () => {
    await openUpdates(pluginsFixturePort(UPDATES));
    act(() => updateRow("Burndown")?.querySelector<HTMLButtonElement>(".vf-plugins-row")?.click());
    expect(pageTitle()).toBe("Burndown");
    // the plugin you have runs: only its update can't, and its row on Updates says so
    // MK-4d (K4 at its lean): Show on the pegboard after it, for the one object the board hangs
    expect(actRow()).toBe(`${words.PAGE_WORDS.installed}${words.showWords(1)}↵`);
    expect(pageAct()).toBeNull();
    esc();
    toInstalled();
    const burndown = [...document.body.querySelectorAll<HTMLLIElement>(".vf-plugins-item")].find(
      (item) => item.querySelector(".vf-plugins-title")?.textContent === "Burndown",
    );
    act(() => burndown?.querySelector<HTMLButtonElement>(".vf-plugins-row")?.click());
    expect(pageTitle()).toBe("Burndown");
    expect(actRow()).toBe(`${words.PAGE_WORDS.installed}${words.showWords(1)}↵`);
    // a download refused as needing a newer VibeField: its row says so, its page Installed
    act(() => root.unmount());
    root = createRoot(host);
    const incompatible = new FielddRpcError(
      "PRECONDITION_FAILED",
      "requires contracts ^9.0.0",
      false,
      { pluginKind: "PLUGIN_INCOMPATIBLE" },
    );
    await openUpdates({
      ...pluginsFixturePort(UPDATES),
      prepareUpdate: () => Promise.reject(incompatible),
    });
    act(() => rowUpdate("Notes")?.click());
    await settle();
    expect(updateRow("Notes")?.textContent).toContain(words.SHELF_WORDS.needsNewer);
    act(() => updateRow("Notes")?.querySelector<HTMLButtonElement>(".vf-plugins-row")?.click());
    expect(pageTitle()).toBe("Notes");
    expect(actRow()).toBe(words.PAGE_WORDS.installed);
    expect(bodyText()).not.toContain("requires contracts");
  });

  it("keeps the rows typed words hold, letting a card go with its row; Update all takes those shown", async () => {
    const { port, sent } = updating(pluginsFixturePort(UPDATES));
    await openUpdates(port);
    act(() => rowUpdate("Notes")?.click());
    await settle();
    expect(rowCard()).not.toBeNull();
    typeWords("stopwatch");
    await settle();
    expect(updateRow("Notes")).toBeNull();
    expect(rowCard()).toBeNull();
    act(() => document.body.querySelector<HTMLButtonElement>(".vf-plugins-updates-all")?.click());
    await settle();
    expect(rowCard()?.getAttribute("aria-label")).toBe("Update Timers?");
    act(() => cardButton(words.CARD_WORDS.cancel)?.click());
    await settle();
    expect(sent).toEqual([
      "prepareUpdate vibefield.notes 0.7.0",
      `discard ${CANDIDATE}`,
      "prepareUpdate vibefield.timers 1.1.0",
      `discard ${CANDIDATE}`,
    ]);
  });

  it("reads the list again on Check again, once per press, and takes no press while a read runs", async () => {
    const { port, calls } = counting(pluginsFixturePort(UPDATES));
    await openUpdates(port);
    expect(calls.refresh).toBe(1);
    act(() => footButton(words.UPDATE_WORDS.again)?.click());
    await settle();
    expect(calls.refresh).toBe(2);
    act(() => root.unmount());
    root = createRoot(host);
    await openUpdates(pluginsFixturePort({ catalog: CATALOG_UPDATES, refresh: "pending" }));
    expect(footButton(words.UPDATE_WORDS.again)?.disabled).toBe(true);
  });
});

/** A window as it comes back fresh: the frame's popup over a fixture fieldd, its surface its own. */
function FreshWindow({ client }: { client: FielddClient }): ReactElement {
  const [surface, set] = useState<FrameSurface | null>(null);
  return (
    <FielddProvider client={client}>
      <FramePlugins view="canvas" surface={surface} onSurfaceChange={set} />
    </FielddProvider>
  );
}

describe("the window coming back fresh (MK-E6; MK-UC's UC-C)", () => {
  it("opens the popup once on the page the note names, saying Installed, and the note is gone", async () => {
    const before = getPluginRegistrySnapshot();
    resetPluginUpdates();
    setPluginRegistrySnapshot(takenOn("vibefield.timers"));
    try {
      keepCarry({ page: { id: "vibefield.timers", from: "updates" }, rest: [], done: [] });
      const { client } = fielddAnswering(async () => CATALOG_UPDATES);
      act(() => root.render(<FreshWindow client={client} />));
      await settle();
      expect(pop()).not.toBeNull();
      expect(pageTitle()).toBe("Timers");
      expect(document.body.querySelector(".vf-plugins-back")?.textContent).toBe(
        words.PLUGINS_TAB_WORDS.updates,
      );
      // MK-4d: then Show them on the pegboard, for the version taken's Timer and Alarm (no row of
      // Updates stands for it, so the act is the installed page's own, `pageAct`)
      expect(actRow()).toBe(`${words.PAGE_WORDS.installed}${words.showWords(2)}↵`);
      expect(sessionStorage.getItem(NOTE_KEY)).toBeNull();
    } finally {
      setPluginRegistrySnapshot(before ?? { generation: 0, problems: [], plugins: [] });
      resetPluginUpdates();
    }
  });

  it("opens nothing for a note older than a minute, or with none", async () => {
    resetPluginUpdates();
    try {
      keepCarry(
        { page: { id: "vibefield.timers", from: "updates" }, rest: [], done: [] },
        Date.now() - 61_000,
      );
      const { client } = fielddAnswering(async () => CATALOG_UPDATES);
      act(() => root.render(<FreshWindow client={client} />));
      await settle();
      expect(pop()).toBeNull();
      expect(sessionStorage.getItem(NOTE_KEY)).toBeNull();
    } finally {
      resetPluginUpdates();
    }
  });
});

const switches = (): HTMLButtonElement[] => [
  ...document.body.querySelectorAll<HTMLButtonElement>('.vf-plugins [role="switch"]'),
];
/** Installed's row of the plugin titled `title`. */
const rowOf = (title: string): HTMLLIElement | null =>
  [...document.body.querySelectorAll<HTMLLIElement>(".vf-plugins-item")].find(
    (item) => item.querySelector(".vf-plugins-title")?.textContent === title,
  ) ?? null;
const rowSwitch = (title: string): HTMLButtonElement | null =>
  rowOf(title)?.querySelector<HTMLButtonElement>('[role="switch"]') ?? null;
const pageSwitch = (): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>('.vf-plugins-page-act-row [role="switch"]');
const powerSwitch = (name: string): HTMLButtonElement | null =>
  [...document.body.querySelectorAll<HTMLButtonElement>('.vf-plugins-power [role="switch"]')].find(
    (node) => node.getAttribute("aria-label") === name,
  ) ?? null;
const openRow = (title: string): void =>
  act(() => rowOf(title)?.querySelector<HTMLButtonElement>(".vf-plugins-row")?.click());

/** The same desktop with one plugin turned on or off, as fieldd's next snapshot says it. */
function turned(
  snapshot: PluginRegistrySnapshot,
  id: string,
  enabled: boolean,
): PluginRegistrySnapshot {
  return {
    ...snapshot,
    generation: snapshot.generation + 1,
    plugins: snapshot.plugins.map((plugin) =>
      plugin.id === id
        ? {
            ...plugin,
            enabled,
            state: enabled ? ("enabled" as const) : ("disabled" as const),
            grantedCapabilities: enabled ? plugin.grantedCapabilities : [],
          }
        : plugin,
    ),
  };
}

async function mountSwitches(
  acts: PluginsFixtureActs = "answers",
  away = false,
): Promise<{ port: PluginsPort; sent: string[] }> {
  const { port, acts: sent } = recording(pluginsFixturePort(NO_REGISTRY, acts));
  act(() =>
    root.render(
      <Window port={port} snapshot={PLUGINS_FIXTURE_SWITCHES_SNAPSHOT} open away={away} />,
    ),
  );
  await settle();
  return { port, sent };
}

/** The Installed list, with fieldd refusing every plugin switch with this error (item 440). */
async function mountRefusing(error: unknown): Promise<string[]> {
  const inner = pluginsFixturePort(NO_REGISTRY);
  const { port, acts } = recording({
    ...inner,
    enable: () => Promise.reject(error),
    disable: () => Promise.reject(error),
  });
  const snapshot = PLUGINS_FIXTURE_SWITCHES_SNAPSHOT;
  act(() => root.render(<Window port={port} snapshot={snapshot} open />));
  await settle();
  return acts;
}

describe("a plugin's switches (MK-4c2a; §8 'Its switches')", () => {
  it("is one switch on the row and the page: a press sends one request, and neither moves until fieldd's next snapshot", async () => {
    const { port, sent } = await mountSwitches();
    toInstalled();
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("true");
    act(() => rowSwitch("iOS Simulator")?.click());
    await settle();
    expect(sent).toEqual(["disable vibefield.simulator"]);
    // fieldd answered; the switch waits for its snapshot
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("true");
    openRow("iOS Simulator");
    expect(pageSwitch()?.getAttribute("aria-checked")).toBe("true");
    const off = turned(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator", false);
    act(() => root.render(<Window port={port} snapshot={off} open />));
    await settle();
    expect(pageSwitch()?.getAttribute("aria-checked")).toBe("false");
    esc();
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("false");
    // the page's switch sends its own one request, the other way
    openRow("iOS Simulator");
    act(() => pageSwitch()?.click());
    await settle();
    expect(sent).toEqual(["disable vibefield.simulator", "enable vibefield.simulator"]);
  });

  it("sends nothing for a second press while its request is out", async () => {
    const { sent } = await mountSwitches("pending");
    toInstalled();
    openRow("iOS Simulator");
    act(() => {
      pageSwitch()?.click();
      pageSwitch()?.click();
    });
    await settle();
    act(() => pageSwitch()?.click());
    await settle();
    expect(sent).toEqual(["disable vibefield.simulator"]);
    expect(pageSwitch()?.disabled).toBe(true);
    expect(pageSwitch()?.getAttribute("aria-checked")).toBe("true");
  });

  it("says a refusal in its own words, never the error's text, and the switch stays where fieldd has it", async () => {
    const { sent } = await mountSwitches("refuses");
    toInstalled();
    act(() => rowSwitch("iOS Simulator")?.click());
    await settle();
    expect(sent).toEqual(["disable vibefield.simulator"]);
    const line = rowOf("iOS Simulator")?.querySelector(".vf-plugins-line");
    expect(line?.textContent).toBe(words.SWITCH_WORDS.refused(false));
    expect(line?.getAttribute("data-tone")).toBe("attention");
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("true");
    openRow("iOS Simulator");
    act(() => powerSwitch(SIMULATOR_POWER)?.click());
    await settle();
    expect(sent).toEqual([
      "disable vibefield.simulator",
      "grant vibefield.simulator surface.simulator true",
    ]);
    const refusals = [...document.body.querySelectorAll(".vf-plugins-page-refused")].map(
      (node) => node.textContent,
    );
    expect(refusals).toEqual([words.SWITCH_WORDS.refused(false), words.SWITCH_WORDS.refused(true)]);
    expect(document.body.textContent).not.toContain(PLUGINS_FIXTURE_REFUSAL);
  });

  it("says a switch refused while its plugin is updating in its own sentence, on the row and the page (item 440)", async () => {
    const said = "vibefield.simulator: updating; the switch was not applied";
    const refusal = new FielddRpcError("PRECONDITION_FAILED", said, true, {
      pluginKind: "PLUGIN_UPDATING",
    });
    const sent = await mountRefusing(refusal);
    toInstalled();
    act(() => rowSwitch("iOS Simulator")?.click());
    await settle();
    expect(sent).toEqual(["disable vibefield.simulator"]);
    const line = rowOf("iOS Simulator")?.querySelector(".vf-plugins-line");
    expect(line?.textContent, "the Installed row says the plugin is updating").toBe(
      words.SWITCH_WORDS.updating,
    ); // RED before the view
    expect(line?.getAttribute("data-tone")).toBe("attention");
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("true");
    openRow("iOS Simulator");
    const page = document.body.querySelector(".vf-plugins-page-refused");
    expect(page?.textContent, "and its page says it too").toBe(words.SWITCH_WORDS.updating);
    expect(document.body.textContent).not.toContain(said);
  });

  it("says any other refusal of a switch as before, whatever its text says (item 440)", async () => {
    const said = "vibefield.simulator: updating; the switch was not applied";
    const sent = await mountRefusing(new FielddRpcError("PRECONDITION_FAILED", said, true));
    toInstalled();
    act(() => rowSwitch("iOS Simulator")?.click());
    await settle();
    expect(sent).toEqual(["disable vibefield.simulator"]);
    const line = rowOf("iOS Simulator")?.querySelector(".vf-plugins-line");
    expect(line?.textContent).toBe(words.SWITCH_WORDS.refused(false));
    openRow("iOS Simulator");
    const page = document.body.querySelector(".vf-plugins-page-refused");
    expect(page?.textContent).toBe(words.SWITCH_WORDS.refused(false));
    expect(document.body.textContent).not.toContain(said);
  });

  it("drops a refusal once fieldd's snapshot shows the switch the way it was being turned (VF-PM 19:05:12Z, 4)", async () => {
    const { port } = await mountSwitches("refuses");
    toInstalled();
    act(() => rowSwitch("iOS Simulator")?.click());
    await settle();
    expect(rowOf("iOS Simulator")?.querySelector(".vf-plugins-line")?.textContent).toBe(
      words.SWITCH_WORDS.refused(false),
    );
    // a snapshot that still shows it on keeps the refusal
    const again = { ...PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, generation: 9 };
    act(() => root.render(<Window port={port} snapshot={again} open />));
    await settle();
    expect(rowOf("iOS Simulator")?.querySelector(".vf-plugins-line")?.textContent).toBe(
      words.SWITCH_WORDS.refused(false),
    );
    // one that shows it off, the way it was being turned, drops it
    const off = turned(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator", false);
    act(() => root.render(<Window port={port} snapshot={off} open />));
    await settle();
    const line = rowOf("iOS Simulator")?.querySelector(".vf-plugins-line");
    expect(line?.textContent).toBe(words.INSTALLED_LINE.off);
    expect(line?.hasAttribute("data-tone")).toBe(false);
    openRow("iOS Simulator");
    expect(document.body.querySelector(".vf-plugins-page-refused")).toBeNull();
  });

  it("says a plugin stopped after it kept crashing in the attention ink, its switch off, and a press turns it on (MK-5, N21)", async () => {
    const { port, sent } = await mountSwitches();
    const stopped = {
      ...PLUGINS_FIXTURE_SWITCHES_SNAPSHOT,
      generation: PLUGINS_FIXTURE_SWITCHES_SNAPSHOT.generation + 1,
      plugins: PLUGINS_FIXTURE_SWITCHES_SNAPSHOT.plugins.map((plugin) =>
        plugin.id === "vibefield.simulator"
          ? { ...plugin, service: "quarantined" as const }
          : plugin,
      ),
    };
    act(() => root.render(<Window port={port} snapshot={stopped} open />));
    await settle();
    toInstalled();
    const line = rowOf("iOS Simulator")?.querySelector(".vf-plugins-line");
    expect(line?.textContent).toBe(words.INSTALLED_LINE.stopped);
    expect(line?.getAttribute("data-tone")).toBe("attention");
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("false");
    act(() => rowSwitch("iOS Simulator")?.click());
    await settle();
    expect(sent).toEqual(["enable vibefield.simulator"]);
    // its page's switch says the same
    openRow("iOS Simulator");
    expect(pageSwitch()?.getAttribute("aria-checked")).toBe("false");
  });

  it("takes no press anywhere while fieldd isn't answering, and says so on the page", async () => {
    const { sent } = await mountSwitches("answers", true);
    toInstalled();
    expect(switches().length).toBeGreaterThan(0);
    expect(switches().every((node) => node.disabled)).toBe(true);
    act(() => {
      for (const node of switches()) node.click();
    });
    openRow("iOS Simulator");
    act(() => {
      for (const node of switches()) node.click();
    });
    await settle();
    expect(sent).toEqual([]);
    expect(bodyText()).toContain(words.PLUGINS_AWAY);
  });

  it("gives a plugin from the list, and a Sideloaded one, the switches a Built in one has, each press one request (N18)", async () => {
    const { port: read, calls } = counting(
      pluginsFixturePort({ catalog: CATALOG_LISTED, refresh: CATALOG_LISTED }),
    );
    const { port, acts: sent } = recording(read);
    act(() => root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_LISTED_SNAPSHOT} open />));
    await settle();
    toInstalled();
    for (const title of ["Kanban", "Key-value store", "iOS Simulator", "Desk clock"]) {
      expect(rowSwitch(title), title).not.toBeNull();
    }
    act(() => rowSwitch("Key-value store")?.click());
    await settle();
    expect(sent).toEqual(["disable example.kv-service"]);
    openRow("Kanban");
    expect(pageTitle()).toBe("Kanban");
    expect(pageSwitch()?.getAttribute("aria-checked")).toBe("true");
    // the install-set carries a listed plugin's choices to your other desktops, as a Built in one's
    expect(bodyText()).toContain(words.SWITCH_WORDS.elsewhere);
    expect(bodyText()).not.toContain("aren't here yet");
    act(() => powerSwitch("Keep your boards in step")?.click());
    await settle();
    act(() => pageSwitch()?.click());
    await settle();
    expect(sent).toEqual([
      "disable example.kv-service",
      "grant acme.kanban x.acme.kanban.sync false",
      "disable acme.kanban",
    ]);
    // a Sideloaded plugin never enters the install-set: its page says nothing of your other desktops
    esc();
    openRow("Key-value store");
    expect(pageSwitch()).not.toBeNull();
    expect(bodyText()).not.toContain(words.SWITCH_WORDS.elsewhere);
    expect(calls).toEqual({ catalog: 1, refresh: 1 });
  });

  it("sends one grant for a power's switch, and none for a power it can't have or on a plugin that is off", async () => {
    const { sent } = await mountSwitches();
    toInstalled();
    openRow("iOS Simulator");
    expect(powerSwitch("Show live windows on the desk")?.getAttribute("aria-checked")).toBe("true");
    expect(powerSwitch(SIMULATOR_POWER)?.getAttribute("aria-checked")).toBe("false");
    expect(bodyText()).toContain(words.SWITCH_WORDS.elsewhere);
    act(() => powerSwitch(SIMULATOR_POWER)?.click());
    await settle();
    expect(sent).toEqual(["grant vibefield.simulator surface.simulator true"]);
    // a power its kind of plugin can't have: why, and no switch (item 573: on the made-up
    // Brass & Glass, since no plugin that ships asks for one)
    esc();
    openRow("Brass & Glass");
    expect(bodyText()).toContain(words.SWITCH_WORDS.cant["entry-kind"]);
    expect(powerSwitch(pluginPowerWords("process.spawn", { onMac: false }) ?? "")).toBeNull();
    // Desk clock, in development and off: its powers wait, and its page never says your other desktops
    esc();
    openRow("Desk clock");
    expect(bodyText()).toContain(words.SWITCH_WORDS.off);
    expect(bodyText()).not.toContain(words.SWITCH_WORDS.elsewhere);
    const waiting = [
      ...document.body.querySelectorAll<HTMLButtonElement>('.vf-plugins-power [role="switch"]'),
    ];
    expect(waiting.map((node) => [node.getAttribute("aria-checked"), node.disabled])).toEqual([
      ["true", true],
      ["false", true],
    ]);
    act(() => {
      for (const node of waiting) node.click();
    });
    await settle();
    expect(sent).toEqual(["grant vibefield.simulator surface.simulator true"]);
    // its one switch still turns it on
    expect(pageSwitch()?.disabled).toBe(false);
  });

  it("names each switch by what it turns, the same on and off", async () => {
    const { port } = await mountSwitches();
    toInstalled();
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-label")).toBe("iOS Simulator");
    const off = turned(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT, "vibefield.simulator", false);
    act(() => root.render(<Window port={port} snapshot={off} open />));
    await settle();
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("false");
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-label")).toBe("iOS Simulator");
    act(() =>
      root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_SWITCHES_SNAPSHOT} open />),
    );
    await settle();
    openRow("iOS Simulator");
    expect(pageSwitch()?.getAttribute("aria-label")).toBe("iOS Simulator");
    const names = [
      ...document.body.querySelectorAll<HTMLButtonElement>('.vf-plugins-power [role="switch"]'),
    ].map((node) => node.getAttribute("aria-label"));
    expect(names).toEqual(["Show live windows on the desk", SIMULATOR_POWER]);
  });

  it("puts no control inside another: each switch is a stop of Tab of its own, and a row's press is none", async () => {
    const { port } = await mountSwitches();
    toInstalled();
    const nested = (): Element[] =>
      [...document.body.querySelectorAll('.vf-plugins button, .vf-plugins [role="switch"]')].filter(
        (node) => (node.parentElement?.closest('button, [role="switch"]') ?? null) !== null,
      );
    expect(nested()).toEqual([]);
    expect(rows().every((row) => row.tabIndex === -1)).toBe(true);
    expect(switches().every((node) => node.tabIndex === 0)).toBe(true);
    // a row with no switch keeps its chevron in its press; a switch row's stands
    // beside it, no control (VF-PM 19:05:12Z, 2)
    const chevronIn = (title: string): boolean =>
      (rowOf(title)?.querySelector(".vf-plugins-row .vf-plugins-chevron") ?? null) !== null;
    const chevronBeside = (title: string): boolean =>
      (rowOf(title)?.querySelector(":scope > .vf-plugins-chevron") ?? null) !== null;
    // a Sideloaded plugin's row has its switch too (N18)
    expect([chevronIn("Key-value store"), chevronBeside("Key-value store")]).toEqual([false, true]);
    expect([chevronIn("iOS Simulator"), chevronBeside("iOS Simulator")]).toEqual([false, true]);
    openRow("iOS Simulator");
    expect(nested()).toEqual([]);
    // the iOS Simulator's own switch and one for each of its two powers (item 573)
    expect(switches().length).toBe(3);
    // the one row with no switch: a plugin held while community plugins are off
    esc();
    act(() => root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_HELD_SNAPSHOT} open />));
    await settle();
    expect([chevronIn("Kanban"), chevronBeside("Kanban")]).toEqual([true, false]);
    expect(nested()).toEqual([]);
  });

  // it sets the window's registry store, which no earlier test reads, and sets it back; MK-5b's rows below do the
  // same in their own hooks
  it("in the frame, takes no press while this window's fieldd client isn't ready", async () => {
    const before = getPluginRegistrySnapshot();
    setPluginRegistrySnapshot(PLUGINS_FIXTURE_SWITCHES_SNAPSHOT);
    try {
      const { client, asked } = fielddAnswering(
        async () => CATALOG_FIXTURES.unconfigured,
        "reconnecting",
      );
      act(() => root.render(<FrameWindow client={client} surface="plugins" />));
      await settle();
      toInstalled();
      expect(switches().length).toBeGreaterThan(0);
      expect(switches().every((node) => node.disabled)).toBe(true);
      act(() => {
        for (const node of switches()) node.click();
      });
      await settle();
      expect(asked.filter((method) => !method.startsWith("plugins.catalog."))).toEqual([]);
    } finally {
      // the store has no door back to none held: an empty desktop stands for it when none was
      setPluginRegistrySnapshot(before ?? { generation: 0, problems: [], plugins: [] });
    }
  });
});

describe("a plugin whose runtime failed, and its Try again (MK-5b; §8 'Installed', MK-5b's drawing)", () => {
  /** The window's app preferences as fieldd's effective snapshot says them, community plugins off. */
  const preferences = {
    showTray: true,
    backgroundShell: true,
    syncPosture: "automatic",
    communityPlugins: false,
  } as const;

  /** What the fixture's fieldd streams as each plugin's runtime, how it answers a plugin's switch — refusing one
   * request, or holding one unanswered until the test answers it — and whether this window's client is ready. */
  interface FielddHow {
    readonly runtime: unknown;
    readonly refuse?: "plugins.enable" | "plugins.disable";
    readonly hold?: "plugins.enable" | "plugins.disable";
    readonly status?: "ready" | "reconnecting";
  }

  /** The fixture's fieldd: its client, what a test reads of it, and what a test does to it. */
  interface RuntimeFieldd {
    readonly client: FielddClient;
    /** each request but the list's, by its method and its plugin's id */
    readonly sent: string[];
    /** each subscription asked, by its method */
    readonly subscribed: string[];
    /** each subscription given back, by its method */
    readonly unsubscribed: string[];
    /** answers each request of the kind `hold` names, held until now */
    readonly answer: () => void;
    /** the runtime each later subscription to it is handed */
    readonly streams: (runtime: unknown) => void;
    /** ends the runtime's subscription, as the client does when fieldd refuses its replay */
    readonly end: () => void;
  }

  /** A window's fieldd that streams each plugin's runtime (`plugins.runtime.subscribe`) as `how` says it, and the
   * app preferences as `fielddAnswering`'s does; it answers the list fieldd holds with none configured, and every
   * other request as `how` says. */
  function fielddWithRuntime(how: FielddHow): RuntimeFieldd {
    const sent: string[] = [];
    const subscribed: string[] = [];
    const unsubscribed: string[] = [];
    const waiting: (() => void)[] = [];
    let runtime = how.runtime;
    let ended: ((error: Error) => void) | undefined;
    const client = {
      status: how.status ?? "ready",
      onStatusChange: () => () => undefined,
      request: vi.fn(async (method: string, params?: { id?: unknown }) => {
        if (method.startsWith("plugins.catalog.")) return CATALOG_FIXTURES.unconfigured;
        sent.push(`${method} ${String(params?.id ?? "")}`);
        if (method === how.hold) await new Promise<void>((resolve) => waiting.push(resolve));
        if (method === how.refuse) throw new Error(PLUGINS_FIXTURE_REFUSAL);
        return {};
      }),
      subscribe: vi.fn(
        async (
          method: string,
          _params: unknown,
          _onEvent: unknown,
          opts?: { onEnded?: (error: Error) => void },
        ) => {
          subscribed.push(method);
          const read = method === "plugins.runtime.subscribe";
          if (read) ended = opts?.onEnded;
          return {
            subId: method,
            snapshot: read ? runtime : preferences,
            unsubscribe: () => {
              unsubscribed.push(method);
            },
          };
        },
      ),
    } as unknown as FielddClient;
    return {
      client,
      sent,
      subscribed,
      unsubscribed,
      answer: () => {
        for (const resolve of waiting.splice(0)) resolve();
      },
      streams: (next) => {
        runtime = next;
      },
      end: () => ended?.(new Error("the fixture's fieldd refused the runtime read's replay")),
    };
  }

  /** The frame's popup open on Installed, over `how`'s fieldd. */
  async function openFrameOnInstalled(how: FielddHow): Promise<RuntimeFieldd> {
    const fieldd = fielddWithRuntime(how);
    act(() => root.render(<FrameWindow client={fieldd.client} surface="plugins" />));
    await settle();
    toInstalled();
    return fieldd;
  }

  /** iOS Simulator's line while it says its set: no board is mounted, so no place is said. */
  const SIMULATORS_SET = "1 object · 0.1.0 · comes with VibeField";
  /** A row's Try again: the one act an Installed row carries. */
  const againOf = (title: string): HTMLButtonElement | null =>
    rowOf(title)?.querySelector<HTMLButtonElement>(".vf-plugins-act") ?? null;
  /** The requests a plugin's one switch sends, in order. */
  const switchCalls = (sent: readonly string[]): string[] =>
    sent.filter(
      (call) => call.startsWith("plugins.disable ") || call.startsWith("plugins.enable "),
    );

  // each sets the window's registry store, as the test above does, and sets it back
  let held: PluginRegistrySnapshot | null = null;
  beforeEach(() => {
    held = getPluginRegistrySnapshot();
    setPluginRegistrySnapshot(PLUGINS_FIXTURE_SNAPSHOT);
  });
  afterEach(() => {
    setPluginRegistrySnapshot(held ?? { generation: 0, problems: [], plugins: [] });
  });

  it("reads each plugin's runtime while the popup stands, and says one whose runtime failed isn't working", async () => {
    const { client, subscribed } = fielddWithRuntime({ runtime: PLUGINS_FIXTURE_RUNTIME });
    act(() => root.render(<FrameWindow client={client} surface={null} />));
    await settle();
    // folded, the window reads no runtime
    expect(subscribed).not.toContain("plugins.runtime.subscribe");
    act(() => root.render(<FrameWindow client={client} surface="plugins" />));
    await settle();
    toInstalled();
    // iOS Simulator's renderer failed in a window still connected, and Key-value store's service failed
    expect(lineSaid("iOS Simulator")).toBe("iOS Simulator isn't working right now");
    expect(lineSaid("Key-value store")).toBe("Key-value store isn't working right now");
    // Comment pad's failure is the last report of a window that left: not read
    expect(lineSaid("Comment pad")).toBe("1 object · 0.1.0 · comes with VibeField");
    // Desk clock is off, whatever its last report says
    expect(lineSaid("Desk clock")).toBe(words.INSTALLED_LINE.off);
    expect(subscribed).toContain("plugins.runtime.subscribe");
    // never fieldd's own sentence
    expect(document.body.textContent).not.toContain(PLUGINS_FIXTURE_RUNTIME_ERROR);
  });

  it("lets the read go as the popup folds, and reads it afresh as it opens again", async () => {
    const fieldd = await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
    expect(lineSaid("iOS Simulator")).toBe("iOS Simulator isn't working right now");
    act(() => root.render(<FrameWindow client={fieldd.client} surface={null} />));
    await settle();
    expect(fieldd.unsubscribed).toContain("plugins.runtime.subscribe");
    // opened again over a runtime read that names no plugin failed: iOS Simulator says its set
    fieldd.streams({ ...PLUGINS_FIXTURE_RUNTIME, plugins: [] });
    act(() => root.render(<FrameWindow client={fieldd.client} surface="plugins" />));
    await settle();
    toInstalled();
    expect(lineSaid("iOS Simulator")).toBe(SIMULATORS_SET);
    expect(againOf("iOS Simulator")).toBeNull();
  });

  it("reads none as failed once the client ends the read, never its last data as live", async () => {
    const fieldd = await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
    expect(lineSaid("iOS Simulator")).toBe("iOS Simulator isn't working right now");
    act(() => fieldd.end());
    await settle();
    expect(lineSaid("iOS Simulator")).toBe(SIMULATORS_SET);
    expect(againOf("iOS Simulator")).toBeNull();
  });

  it("offers Try again on a plugin that isn't working wherever its switches stand, which turns it off and on", async () => {
    const { sent } = await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
    const again = againOf("iOS Simulator");
    // the act's look with no ↵ printed: ↵ opens the hot row's page
    expect(again?.textContent).toBe(words.INSTALL_WORDS.tryAgain);
    expect(again?.hasAttribute("aria-keyshortcuts")).toBe(false);
    // a Sideloaded plugin's row offers it too, N18 (2026-11-17): Try again follows the switch;
    // each plugin working or off has none
    expect(againOf("Key-value store")?.textContent).toBe(words.INSTALL_WORDS.tryAgain);
    expect(againOf("Comment pad")).toBeNull();
    expect(againOf("Desk clock")).toBeNull();
    act(() => again?.click());
    await settle();
    expect(switchCalls(sent)).toEqual([
      "plugins.disable vibefield.simulator",
      "plugins.enable vibefield.simulator",
    ]);
    // the Sideloaded one's press sends its switch's two requests, as iOS Simulator's did
    act(() => againOf("Key-value store")?.click());
    await settle();
    expect(switchCalls(sent).slice(2)).toEqual([
      "plugins.disable example.kv-service",
      "plugins.enable example.kv-service",
    ]);
  });

  it("says a refused off in the switch's words, nothing changed, and Try again stands", async () => {
    const { sent } = await openFrameOnInstalled({
      runtime: PLUGINS_FIXTURE_RUNTIME,
      refuse: "plugins.disable",
    });
    act(() => againOf("iOS Simulator")?.click());
    await settle();
    expect(switchCalls(sent)).toEqual(["plugins.disable vibefield.simulator"]);
    const line = rowOf("iOS Simulator")?.querySelector(".vf-plugins-line");
    expect(line?.textContent).toBe(words.SWITCH_WORDS.refused(false));
    expect(line?.getAttribute("data-tone")).toBe("attention");
    expect(againOf("iOS Simulator")?.disabled).toBe(false);
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).not.toContain(PLUGINS_FIXTURE_REFUSAL);
    // pressed again, it asks again from the start
    act(() => againOf("iOS Simulator")?.click());
    await settle();
    expect(switchCalls(sent)).toEqual([
      "plugins.disable vibefield.simulator",
      "plugins.disable vibefield.simulator",
    ]);
  });

  it("says a refused on in the switch's words, by the request fieldd refused", async () => {
    const { sent } = await openFrameOnInstalled({
      runtime: PLUGINS_FIXTURE_RUNTIME,
      refuse: "plugins.enable",
    });
    act(() => againOf("iOS Simulator")?.click());
    await settle();
    expect(switchCalls(sent)).toEqual([
      "plugins.disable vibefield.simulator",
      "plugins.enable vibefield.simulator",
    ]);
    const line = rowOf("iOS Simulator")?.querySelector(".vf-plugins-line");
    expect(line?.textContent).toBe(words.SWITCH_WORDS.refused(true));
    expect(line?.getAttribute("data-tone")).toBe("attention");
  });

  it("takes no second press while its requests are out, and neither does the switch", async () => {
    const { sent } = await openFrameOnInstalled({
      runtime: PLUGINS_FIXTURE_RUNTIME,
      hold: "plugins.disable",
    });
    act(() => {
      againOf("iOS Simulator")?.click();
      againOf("iOS Simulator")?.click();
    });
    await settle();
    act(() => rowSwitch("iOS Simulator")?.click());
    await settle();
    expect(switchCalls(sent)).toEqual(["plugins.disable vibefield.simulator"]);
    expect(againOf("iOS Simulator")?.disabled).toBe(true);
    expect(rowSwitch("iOS Simulator")?.disabled).toBe(true);
  });

  it("keeps the keyboard in the field as it is pressed, and stands, taking no press, until both are answered", async () => {
    const fieldd = await openFrameOnInstalled({
      runtime: PLUGINS_FIXTURE_RUNTIME,
      hold: "plugins.enable",
    });
    const again = againOf("iOS Simulator");
    act(() => again?.focus());
    expect(document.activeElement).toBe(again);
    act(() => again?.click());
    await settle();
    // the press takes no second press while it runs, so the keyboard goes back to the field, as an Install's
    expect(document.activeElement).toBe(field());
    expect(switchCalls(fieldd.sent)).toEqual([
      "plugins.disable vibefield.simulator",
      "plugins.enable vibefield.simulator",
    ]);
    // fieldd's snapshot shows it off between the two: its row says so, and Try again stands, taking no press
    act(() =>
      setPluginRegistrySnapshot(turned(PLUGINS_FIXTURE_SNAPSHOT, "vibefield.simulator", false)),
    );
    await settle();
    expect(lineSaid("iOS Simulator")).toBe(words.INSTALLED_LINE.off);
    expect(againOf("iOS Simulator")?.disabled).toBe(true);
    expect(rowSwitch("iOS Simulator")?.disabled).toBe(true);
    // the on answered while the snapshot still shows it off: Try again goes, and the switch takes a press
    act(() => fieldd.answer());
    await settle();
    expect(againOf("iOS Simulator")).toBeNull();
    expect(rowSwitch("iOS Simulator")?.disabled).toBe(false);
    // on again and its runtime still failed: Try again stands once more, and takes a press
    act(() => setPluginRegistrySnapshot(PLUGINS_FIXTURE_SNAPSHOT));
    await settle();
    expect(againOf("iOS Simulator")?.disabled).toBe(false);
  });

  it("takes no press while this window's fieldd client isn't ready", async () => {
    const { sent } = await openFrameOnInstalled({
      runtime: PLUGINS_FIXTURE_RUNTIME,
      status: "reconnecting",
    });
    expect(againOf("iOS Simulator")?.disabled).toBe(true);
    act(() => againOf("iOS Simulator")?.click());
    await settle();
    expect(switchCalls(sent)).toEqual([]);
  });

  it("is a stop of Tab of its own beside the press, never inside it, and the switch stands with it", async () => {
    await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
    const again = againOf("iOS Simulator");
    expect(again?.closest(".vf-plugins-row")).toBeNull();
    expect(again?.tabIndex).toBe(0);
    expect(rowSwitch("iOS Simulator")?.getAttribute("aria-checked")).toBe("true");
  });

  it("offers Try again on a plugin that cannot start in this window too (item 476)", async () => {
    nameUnstartedPlugin("vibefield.comment-pad", { reason: "activation" });
    try {
      await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
      expect(lineSaid("Comment pad")).toBe("Comment pad isn't working right now");
      expect(againOf("Comment pad")?.textContent).toBe(words.INSTALL_WORDS.tryAgain);
    } finally {
      resetUnstartedPlugins();
    }
  });

  // item 494 (2026-11-18): a plugin that isn't working, or can't run here, says its row's line on its own page
  // too, under its act, in the row's words
  /** The open page's notes under its act, each one's words. */
  const pageNotes = (): string[] =>
    [...document.body.querySelectorAll(".vf-plugins-page-note")].map(
      (note) => note.textContent ?? "",
    );
  /** The page of the row titled `title`, opened as a press on its row opens it. */
  const openPageOf = (title: string): void =>
    act(() => rowOf(title)?.querySelector<HTMLButtonElement>(".vf-plugins-row")?.click());
  const NOT_WORKING = /isn't working right now|can't run on this VibeField/u;

  it("says a plugin's not-working line on its own page too, under its act (item 494)", async () => {
    await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
    expect(lineSaid("Key-value store")).toBe("Key-value store isn't working right now");
    openPageOf("Key-value store");
    expect(pageTitle()).toBe("Key-value store");
    expect(pageNotes()).toContain("Key-value store isn't working right now");
  });

  it("says it on the page of a plugin that cannot start in this window too (item 476's line; item 494)", async () => {
    nameUnstartedPlugin("vibefield.comment-pad", { reason: "activation" });
    try {
      await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
      openPageOf("Comment pad");
      expect(pageTitle()).toBe("Comment pad");
      expect(pageNotes()).toContain("Comment pad isn't working right now");
    } finally {
      resetUnstartedPlugins();
    }
  });

  it("says a plugin this VibeField can't run on its page too, in its row's words (item 494)", async () => {
    setPluginRegistrySnapshot(PLUGINS_FIXTURE_NOT_WORKING_SNAPSHOT);
    await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
    expect(lineSaid("Gauge")).toBe("Gauge can't run on this VibeField");
    openPageOf("Gauge");
    expect(pageTitle()).toBe("Gauge");
    expect(pageNotes()).toContain("Gauge can't run on this VibeField");
  });

  it("says no such line on the page of a plugin that works, or one that is off (item 494)", async () => {
    await openFrameOnInstalled({ runtime: PLUGINS_FIXTURE_RUNTIME });
    // Comment pad's failure is the last report of a window that left: not read, so it works
    openPageOf("Comment pad");
    expect(pageTitle()).toBe("Comment pad");
    expect(pageNotes().filter((note) => NOT_WORKING.test(note))).toEqual([]);
    toInstalled();
    // Desk clock is off, whatever its last report says
    openPageOf("Desk clock");
    expect(pageTitle()).toBe("Desk clock");
    expect(pageNotes().filter((note) => NOT_WORKING.test(note))).toEqual([]);
  });
});

describe("Try again where VibeField's plugins don't answer (MK-5b; §8 'Its states, in the body')", () => {
  const AWAY: PluginsFixtureRead = { catalog: "fails", refresh: "fails" };
  const footAct = (): HTMLButtonElement | null =>
    document.body.querySelector<HTMLButtonElement>(".vf-plugins-foot .vf-plugins-act");

  it("offers Try again on Discover and Updates, which reads the list again as an opening does, once per press", async () => {
    const { port, calls } = counting(pluginsFixturePort(AWAY));
    await mount(port);
    expect(bodyText()).toBe(words.PLUGINS_AWAY);
    expect(footAct()?.textContent).toBe(`${words.INSTALL_WORDS.tryAgain}↵`);
    act(() => footAct()?.focus());
    act(() => footAct()?.click());
    await settle();
    expect(calls).toEqual({ catalog: 2, refresh: 2 });
    expect(bodyText()).toBe(words.PLUGINS_AWAY);
    // it left the foot while the read ran, so the keyboard went to the field
    expect(document.activeElement).toBe(field());
    // ↵ in the field presses it too
    press("Enter");
    await settle();
    expect(calls).toEqual({ catalog: 3, refresh: 3 });
    // Updates says the same, with the same press
    act(() => part(words.PLUGINS_TAB_WORDS.updates)?.click());
    expect(bodyText()).toBe(words.PLUGINS_AWAY);
    act(() => footAct()?.click());
    await settle();
    expect(calls).toEqual({ catalog: 4, refresh: 4 });
  });

  it("shows what the doors answer once they answer again, and its press goes", async () => {
    let answer = false;
    const door = (): Promise<PluginsCatalog> =>
      answer
        ? Promise.resolve(CATALOG_FIXTURES.unconfigured)
        : Promise.reject(new Error("the fixture's door does not answer"));
    await mount({ ...NO_SWITCHES, catalog: door, refresh: door });
    expect(bodyText()).toBe(words.PLUGINS_AWAY);
    answer = true;
    act(() => footAct()?.click());
    await settle();
    expect(bodyText()).toContain(words.NO_REGISTRY.title);
    expect(footAct()?.textContent).toBe(`${words.NO_REGISTRY.act}↵`);
  });

  it("says it on Installed with no act while the window holds none of its plugins, and takes no press while fieldd isn't answering", async () => {
    const { port, calls } = counting(pluginsFixturePort(AWAY));
    await mount(port, null);
    toInstalled();
    expect(bodyText()).toBe(words.PLUGINS_AWAY);
    expect(footAct()).toBeNull();
    // with its plugins held, Installed lists them, as before
    act(() => root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_SNAPSHOT} open />));
    await settle();
    expect(rows()).toHaveLength(4);
    // while fieldd isn't answering this window, Discover's Try again takes no press
    act(() => root.render(<Window port={port} snapshot={PLUGINS_FIXTURE_SNAPSHOT} open away />));
    await settle();
    act(() => part(words.PLUGINS_TAB_WORDS.discover)?.click());
    expect(bodyText()).toBe(words.PLUGINS_AWAY);
    expect(footAct()?.disabled).toBe(true);
    act(() => footAct()?.click());
    press("Enter");
    await settle();
    expect(calls).toEqual({ catalog: 1, refresh: 1 });
  });
});
