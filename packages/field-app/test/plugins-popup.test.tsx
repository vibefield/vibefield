// @vitest-environment happy-dom
import type { PluginRegistrySnapshot, PluginsCatalog } from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CATALOG_FIXTURES,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_READ_AT,
  PLUGINS_FIXTURE_SNAPSHOT,
  type PluginsFixtureRead,
  pluginsFixturePort,
} from "../src/design-system/plugins-fixtures";
import type { FrameSurface } from "../src/frame/frame-surface";
import { Plugins } from "../src/frame/plugins/Plugins";
import { pluginsLayout } from "../src/frame/plugins/plugins-model";
import type { PluginsPort } from "../src/frame/plugins/plugins-port";
import * as words from "../src/frame/plugins/plugins-words";

// MK-4a — the Plugins popup in a window (DESIGN.md §8 "Plugins — the frame's second popup"): the shipping
// controller over a fixture port, drawn on the document's body. Each opening reads the list once and never on a
// re-render (MK-D5; one audit row per opening, `plugin.catalog.refresh`); Esc and the scrim fold it; the keyboard
// goes to its field and back; every state is said, never a blank. No fieldd, no network, no child.

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
}: {
  port: PluginsPort;
  snapshot: PluginRegistrySnapshot | null;
  open: boolean;
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
