// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginRegistrySnapshot, PluginsCatalog } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_FIXTURES,
  CATALOG_LISTED,
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_READ_AT,
  PLUGINS_FIXTURE_SNAPSHOT,
  type PluginsFixtureRead,
  pluginsFixturePort,
} from "../src/design-system/plugins-fixtures";
import type { FrameSurface } from "../src/frame/frame-surface";
import { FramePlugins, Plugins } from "../src/frame/plugins/Plugins";
import { getPluginUpdates, resetPluginUpdates } from "../src/frame/plugins/plugins-count";
import { pluginsLayout } from "../src/frame/plugins/plugins-model";
import type { PluginsPort } from "../src/frame/plugins/plugins-port";
import * as words from "../src/frame/plugins/plugins-words";

// MK-4a — the Plugins popup in a window (DESIGN.md §8 "Plugins — the frame's second popup"): the shipping
// controller over a fixture port, drawn on the document's body. Each opening reads the list once and never on a
// re-render (MK-D5; one audit row per opening, `plugin.catalog.refresh`); Esc and the scrim fold it; the keyboard
// goes to its field and back; every state is said, never a blank. MK-4b adds the Me row's count (every answer the
// popup takes, and the window's one ask, over a fixture client in a FielddProvider) and the tab a door opens it on.
// MK-4c adds a plugin's page, read only (it asks fieldd nothing), Installed's hot row and Updates' count.
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
});

function counting(inner: PluginsPort): {
  port: PluginsPort;
  calls: { catalog: number; refresh: number };
} {
  const calls = { catalog: 0, refresh: 0 };
  return {
    calls,
    port: {
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

function Window({
  port,
  snapshot,
  open,
  updates = null,
}: {
  port: PluginsPort;
  snapshot: PluginRegistrySnapshot | null;
  open: boolean;
  updates?: number | null;
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
      catalog: () => new Promise((resolve) => (answerHeld = resolve)),
      refresh: () => Promise.resolve(CATALOG_FIXTURES.ready),
    };
    await mount(port);
    expect(bodyText()).toContain("1 plugin, 3 objects");
    await act(async () => answerHeld(CATALOG_FIXTURES.unread));
    await settle();
    expect(bodyText()).toContain("1 plugin, 3 objects");
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
    expect(titles).toEqual(["Comment pad", "Simulators", "Desk clock", "Key-value store"]);
    expect(footText()).toBe("4 plugins, 5 objects · 1 off");
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

  it("a list held, before the shelf is built: its count, and when it was read", async () => {
    await mount({ catalog: CATALOG_FIXTURES.ready, refresh: CATALOG_FIXTURES.ready });
    expect(bodyText()).toBe("1 plugin, 3 objects");
    const when = words.listTime(PLUGINS_FIXTURE_READ_AT, PLUGINS_FIXTURE_NOW);
    expect(footText()).toBe(`1 plugin, 3 objects · checked ${when}`);
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
    type("watch");
    expect(bodyText()).toContain(words.NO_REGISTRY.title);
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const titles = () =>
      [...document.body.querySelectorAll(".vf-plugins-title")].map((node) => node.textContent);
    expect(titles()).toEqual(["Simulators"]);
    type("nothing here");
    expect(bodyText()).toBe(words.noMatchWords("nothing here"));
    expect(footText()).toBe("4 plugins, 5 objects · 1 off");
  });

  it("an opening after neither door answered says the read, never the last opening's words", async () => {
    let answer = false;
    let release: (catalog: PluginsCatalog) => void = () => undefined;
    const port: PluginsPort = {
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

/** A window's fieldd as FramePlugins asks it: `plugins.catalog.get` and `refresh` answered by the test. */
function fielddAnswering(answer: (method: string, call: number) => Promise<unknown>): {
  client: FielddClient;
  asked: string[];
} {
  const asked: string[] = [];
  const client = {
    request: vi.fn(async (method: string) => {
      asked.push(method);
      return answer(method, asked.filter((m) => m === method).length);
    }),
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
  document.body.querySelector('.vf-plugins-row[data-hot="true"] .vf-plugins-title')?.textContent ??
  null;
const toInstalled = (): void => act(() => part(words.PLUGINS_TAB_WORDS.installed)?.click());

describe("a plugin's page, read only (MK-4c; §8 'Read only first')", () => {
  it("opens a row's page on a press, asking fieldd nothing; its back row and Esc go back, and Esc then folds", async () => {
    const { port, calls } = counting(pluginsFixturePort(NO_REGISTRY));
    await mount(port);
    toInstalled();
    // Comment pad, then Simulators: Built in first, then by title
    act(() => rows()[1]?.click());
    expect(pageTitle()).toBe("Simulators");
    expect(bodyText()).toContain(words.PAGE_WORDS.builtIn);
    expect(bodyText()).toContain("Read what's on the desk");
    expect(bodyText()).toContain("Apple Watch");
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
      expect(hotTitle()).toBe("Simulators");
      const last = seen.at(-1);
      expect(last?.row.querySelector(".vf-plugins-title")?.textContent).toBe("Simulators");
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
    act(() => rows()[1]?.click());
    const said = document.body.querySelector(".vf-plugins-page-act");
    expect(said?.tagName).toBe("P");
    expect(said?.textContent).toBe(words.PAGE_WORDS.installed);
    expect(said?.closest("button")).toBeNull();
    expect(said?.querySelector("button, [tabindex]")).toBeNull();
    expect(said?.hasAttribute("tabindex")).toBe(false);
    // the page's one control is its back row
    const controls = [
      ...document.body.querySelectorAll(".vf-plugins-page button, .vf-plugins-page [tabindex]"),
    ];
    expect(controls.map((node) => node.className)).toEqual(["vf-plugins-back"]);
    // ↑ ↓ and ↵ on a page walk nothing and press nothing
    press("ArrowDown");
    press("Enter");
    expect(pageTitle()).toBe("Simulators");
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
    expect(bodyText()).toContain(words.PAGE_WORDS.tools);
    expect(bodyText()).toContain("A power of its own, named by Kanban");
    expect(bodyText()).not.toContain("Someone Else");
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
