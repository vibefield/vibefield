// @vitest-environment happy-dom
import type { SettingsContribution } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CATALOG_FIXTURES,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_READ_REFUSAL,
  PLUGINS_FIXTURE_REFUSAL,
  PLUGINS_FIXTURE_SETTINGS,
  PLUGINS_FIXTURE_SETTINGS_SNAPSHOT,
  PLUGINS_FIXTURE_SETTINGS_UNREAD,
  type PluginsFixtureActs,
  type PluginsFixtureRead,
  pluginsFixturePort,
} from "../src/design-system/plugins-fixtures";
import { Plugins } from "../src/frame/plugins/Plugins";
import { type PluginsPort, pluginsPortOver } from "../src/frame/plugins/plugins-port";
import * as words from "../src/frame/plugins/plugins-words";
import { PluginSettingsForm } from "../src/panels/PluginSettingsForm";

// MK-4c2b — a plugin's settings on its page in Plugins… (DESIGN.md §8 "Its settings", as corrected
// for James's MK-O6 pick: no Undo and no Redo on the page). A Built in or Development plugin's
// settings, each read as the page opens and after its own change, over the two requests Settings
// → Plugins sends today, with the same parameters (C3: both forms mounted over recording clients);
// no reset, undo or redo (C2); no section and no request on a page that reads only (U2); the off,
// under way, refused, unread and away states. No real fieldd, no network, no child.

const NO_REGISTRY: PluginsFixtureRead = {
  catalog: CATALOG_FIXTURES.unconfigured,
  refresh: CATALOG_FIXTURES.unconfigured,
};
/** A made-up phrase. Every assertion that touches it is a boolean, so a red never prints it. */
const SECRET = "plum orchard lantern";
const SIMULATORS = "vibefield.simulator";
const FRAME = "Show each device's frame";
const RATE = "Frames each second";
const TOKEN = "Account token";
const PHONE = "Phone to show";
const AIR = "iPhone Air";
const KEYS = ["showFrame", "phone", "frameRate", "caption", "token", "sizes"];
const READ_ONLY = { "acme.kanban": "Kanban", "example.kv-service": "Key-value store" };

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

interface Sent {
  readonly what: "get" | "set";
  readonly id: string;
  readonly key: string;
  readonly value?: unknown;
}

/** Every settings request a port sent, in order. */
function recording(inner: PluginsPort): { port: PluginsPort; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    port: {
      ...inner,
      settingsGet: (id, key) => {
        sent.push({ what: "get", id, key });
        return inner.settingsGet(id, key);
      },
      settingsSet: (id, key, value) => {
        sent.push({ what: "set", id, key, value });
        return inner.settingsSet(id, key, value);
      },
    },
  };
}

const fixture = (acts: PluginsFixtureActs = "answers"): PluginsPort =>
  pluginsFixturePort(NO_REGISTRY, acts, PLUGINS_FIXTURE_SETTINGS);
/** The unread plate's fieldd: Simulators' frame rate is one it refuses to read. */
const unreadFixture = (): PluginsPort =>
  pluginsFixturePort(NO_REGISTRY, "answers", PLUGINS_FIXTURE_SETTINGS_UNREAD);

/** A read, its answer, the render it moves and the read that render starts: a few rounds, each
 * in act. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

interface PageProps {
  readonly port: PluginsPort;
  readonly id: string;
  readonly away: boolean;
}

/** The popup open on Installed, at one plugin's page. */
function Page({ port, id, away }: PageProps): ReactElement {
  return (
    <Plugins
      surface="plugins"
      onSurfaceChange={() => undefined}
      port={port}
      snapshot={PLUGINS_FIXTURE_SETTINGS_SNAPSHOT}
      initialTab="installed"
      initialPage={id}
      away={away}
      now={() => PLUGINS_FIXTURE_NOW}
    />
  );
}

async function openPage(port: PluginsPort, id: string, away = false): Promise<void> {
  act(() => root.render(<Page port={port} id={id} away={away} />));
  await settle();
}

const section = (): Element | null => document.body.querySelector(".vf-plugins-settings");

function titles(): string[] {
  const nodes = document.body.querySelectorAll(".vf-plugins-setting-title");
  return [...nodes].map((n) => n.textContent ?? "");
}

/** A setting's row, by its title. */
function row(title: string): Element | null {
  for (const li of document.body.querySelectorAll(".vf-plugins-setting")) {
    if (li.querySelector(".vf-plugins-setting-title")?.textContent === title) return li;
  }
  return null;
}

function switchIn(scope: ParentNode, label: string): HTMLButtonElement | null {
  for (const node of scope.querySelectorAll<HTMLButtonElement>('[role="switch"]')) {
    if (node.getAttribute("aria-label") === label) return node;
  }
  return null;
}

function switchOf(title: string): HTMLButtonElement | null {
  const at = row(title);
  return at === null ? null : switchIn(at, title);
}

function fieldOf(title: string): HTMLInputElement | null {
  return row(title)?.querySelector<HTMLInputElement>("input") ?? null;
}

function menuOf(title: string): HTMLSelectElement | null {
  return row(title)?.querySelector("select") ?? null;
}

/** Picking a menu's option, by its value (the option's place). */
function choose(menu: HTMLSelectElement | null, at: string): void {
  act(() => {
    if (menu === null) return;
    menu.value = at;
    menu.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function refusedLine(title: string): string | null {
  return row(title)?.querySelector(".vf-plugins-page-refused")?.textContent ?? null;
}

function foot(): string {
  return section()?.querySelector(".vf-plugins-settings-foot")?.textContent ?? "";
}

const gets = (sent: Sent[], key: string): number =>
  sent.filter((s) => s.what === "get" && s.key === key).length;
const sets = (sent: Sent[]): Sent[] => sent.filter((s) => s.what === "set");
const allGets = (): Sent[] => KEYS.map((key) => ({ what: "get", id: SIMULATORS, key }));

function typeInto(input: HTMLInputElement | null, text: string): void {
  act(() => {
    if (input === null) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enter(input: HTMLInputElement | null): Promise<void> {
  act(() => {
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

/** Leaving a field: React's onBlur hears focusout. */
async function leave(input: HTMLInputElement | null): Promise<void> {
  act(() => {
    input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await settle();
}

describe("a plugin's settings on its page (MK-4c2b; §8 'Its settings')", () => {
  it("stands in the first column after What it adds, reads each setting once as the page opens, and has no Undo or Redo", async () => {
    const { port, sent } = recording(fixture());
    await openPage(port, SIMULATORS);
    const first = document.body.querySelector(".vf-plugins-page-column:not([data-column])");
    expect(first?.querySelector(".vf-plugins-settings")).not.toBeNull();
    const heads = [...(first?.querySelectorAll(".vf-plugins-page-head") ?? [])];
    expect(heads.map((n) => n.textContent)).toEqual([
      words.PAGE_WORDS.adds,
      words.SETTINGS_WORDS.head,
    ]);
    expect(titles()).toEqual([
      FRAME,
      "Phone to show",
      RATE,
      "Caption under each device",
      TOKEN,
      "Screen sizes",
    ]);
    expect(sent).toEqual(allGets());
    const buttons = [...document.body.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    const said = buttons.map((b) => `${b.textContent} ${b.getAttribute("aria-label")}`);
    expect(said.some((s) => /\b(undo|redo)\b/i.test(s))).toBe(false);
    expect(foot()).toBe(words.SETTINGS_WORDS.footSynced);
    // no mark for where a setting is kept or that it is the default, and no Reset (§8)
    expect(section()?.textContent ?? "").not.toMatch(/\b(user|secret|default|reset)\b/i);
  });

  it("shows what fieldd keeps, or the declared default, and never a secret's value", async () => {
    await openPage(fixture(), SIMULATORS);
    expect(switchOf(FRAME)?.getAttribute("aria-checked")).toBe("false");
    expect(row("Phone to show")?.querySelector("select")?.value).toBe("1");
    const rate = fieldOf(RATE);
    expect([rate?.type, rate?.value, rate?.min, rate?.max]).toEqual(["number", "30", "1", "60"]);
    expect(fieldOf("Caption under each device")?.value).toBe("");
    const token = fieldOf(TOKEN);
    expect([token?.type, token?.value, token?.placeholder]).toEqual([
      "password",
      "",
      words.SETTINGS_WORDS.saved,
    ]);
    expect(row("Screen sizes")?.textContent).toContain(words.SETTINGS_WORDS.cantDraw);
    expect(row("Screen sizes")?.querySelector("input, select, button")).toBeNull();
  });

  it("a switch sends one set with its new value, takes no second press while it is out, and moves when fieldd's next read says so", async () => {
    const inner = fixture();
    // the set is held until the test lets it go
    const held: (() => void)[] = [];
    const { port, sent } = recording({
      ...inner,
      settingsSet: async (id, key, value) => {
        await new Promise<void>((resolve) => {
          held.push(() => resolve());
        });
        return inner.settingsSet(id, key, value);
      },
    });
    await openPage(port, SIMULATORS);
    act(() => switchOf(FRAME)?.click());
    await settle();
    expect(sets(sent)).toEqual([{ what: "set", id: SIMULATORS, key: "showFrame", value: true }]);
    expect(switchOf(FRAME)?.getAttribute("aria-checked")).toBe("false");
    expect(switchOf(FRAME)?.disabled).toBe(true);
    act(() => switchOf(FRAME)?.click());
    expect(sets(sent)).toHaveLength(1);
    act(() => {
      for (const go of held) go();
    });
    await settle();
    expect(switchOf(FRAME)?.getAttribute("aria-checked")).toBe("true");
    expect(switchOf(FRAME)?.disabled).toBe(false);
    expect(gets(sent, "showFrame")).toBe(2);
  });

  it("a menu sends the option picked, takes no input while it is out, and moves when fieldd's next read says so", async () => {
    const inner = fixture();
    // the set is held until the test lets it go
    const held: (() => void)[] = [];
    const { port, sent } = recording({
      ...inner,
      settingsSet: async (id, key, value) => {
        await new Promise<void>((resolve) => {
          held.push(() => resolve());
        });
        return inner.settingsSet(id, key, value);
      },
    });
    await openPage(port, SIMULATORS);
    choose(menuOf(PHONE), "2");
    await settle();
    expect(sets(sent)).toEqual([{ what: "set", id: SIMULATORS, key: "phone", value: AIR }]);
    expect(menuOf(PHONE)?.value).toBe("1");
    expect(menuOf(PHONE)?.disabled).toBe(true);
    act(() => {
      for (const go of held) go();
    });
    await settle();
    expect(menuOf(PHONE)?.value).toBe("2");
    expect(menuOf(PHONE)?.disabled).toBe(false);
    expect(gets(sent, "phone")).toBe(2);
  });

  it("a menu with nothing kept and no default says Choose… above its options", async () => {
    await openPage(pluginsFixturePort(NO_REGISTRY), SIMULATORS);
    const options = menuOf(PHONE)?.querySelectorAll("option") ?? [];
    const said = [...options].map((option) => option.textContent);
    expect(said).toEqual([words.SETTINGS_WORDS.choose, "iPhone 17", "iPhone 17 Pro", AIR]);
    expect(menuOf(PHONE)?.value).toBe("");
  });

  it("a refusal says §9's words under the setting, never the error's own text, and keeps the value", async () => {
    const { port, sent } = recording(fixture("refuses"));
    await openPage(port, SIMULATORS);
    act(() => switchOf(FRAME)?.click());
    await settle();
    expect(refusedLine(FRAME)).toBe(words.SETTINGS_WORDS.refused);
    expect(document.body.textContent?.includes(PLUGINS_FIXTURE_REFUSAL)).toBe(false);
    expect(switchOf(FRAME)?.getAttribute("aria-checked")).toBe("false");
    expect(gets(sent, "showFrame")).toBe(1);
  });

  it("a field sends what was typed on ↵ or on leaving it, a number as a number, and nothing when it is unchanged", async () => {
    const { port, sent } = recording(fixture());
    await openPage(port, SIMULATORS);
    await leave(fieldOf(RATE));
    await enter(fieldOf(RATE));
    expect(sets(sent)).toEqual([]);
    typeInto(fieldOf(RATE), "45");
    await enter(fieldOf(RATE));
    expect(sets(sent)).toEqual([{ what: "set", id: SIMULATORS, key: "frameRate", value: 45 }]);
    expect(fieldOf(RATE)?.value).toBe("45");
    expect(gets(sent, "frameRate")).toBe(2);
    typeInto(fieldOf("Caption under each device"), "Lab bench");
    await leave(fieldOf("Caption under each device"));
    expect(sets(sent).at(-1)).toEqual({
      what: "set",
      id: SIMULATORS,
      key: "caption",
      value: "Lab bench",
    });
  });

  it("a secret is sent as typed and never shown: once it is kept, its field empties and says it is saved", async () => {
    const { port, sent } = recording(fixture());
    await openPage(port, SIMULATORS);
    typeInto(fieldOf(TOKEN), SECRET);
    await enter(fieldOf(TOKEN));
    expect(sets(sent).some((s) => s.key === "token" && s.value === SECRET)).toBe(true);
    expect(fieldOf(TOKEN)?.value === "").toBe(true);
    expect(fieldOf(TOKEN)?.placeholder).toBe(words.SETTINGS_WORDS.saved);
    expect(document.body.innerHTML.includes(SECRET)).toBe(false);
  });

  it("a secret that is refused stays in its masked field, and its refusal line never says it", async () => {
    const { port, sent } = recording(fixture("refuses"));
    await openPage(port, SIMULATORS);
    typeInto(fieldOf(TOKEN), SECRET);
    await enter(fieldOf(TOKEN));
    expect(sets(sent).some((s) => s.key === "token" && s.value === SECRET)).toBe(true);
    expect(fieldOf(TOKEN)?.type === "password").toBe(true);
    expect(fieldOf(TOKEN)?.value === SECRET).toBe(true);
    expect(refusedLine(TOKEN) === words.SETTINGS_WORDS.refused).toBe(true);
    expect(gets(sent, "token")).toBe(1);
  });

  it("while the plugin is off, shows its values, takes no input, says how to change them, and a press sends nothing", async () => {
    const { port, sent } = recording(fixture());
    await openPage(port, "example.desk-clock");
    const note = section()?.querySelector(".vf-plugins-page-note")?.textContent;
    expect(note).toBe(words.SETTINGS_WORDS.off);
    const hand = switchOf("Second hand");
    expect([hand?.getAttribute("aria-checked"), hand?.disabled]).toEqual(["true", true]);
    act(() => hand?.click());
    await settle();
    expect(sets(sent)).toEqual([]);
    expect(gets(sent, "secondHand")).toBe(1);
  });

  it("while fieldd isn't answering, reads nothing and takes no input; when it answers again, each setting is read", async () => {
    const { port, sent } = recording(fixture());
    await openPage(port, SIMULATORS, true);
    expect(titles()).toHaveLength(KEYS.length);
    expect(sent).toEqual([]);
    expect(switchOf(FRAME)?.disabled).toBe(true);
    expect(fieldOf(RATE)?.disabled).toBe(true);
    await openPage(port, SIMULATORS, false);
    expect(sent).toEqual(allGets());
    expect(switchOf(FRAME)?.disabled).toBe(false);
    expect(fieldOf(RATE)?.disabled).toBe(false);
  });

  it("reads nothing anew when fieldd answers again after being away, once each setting was read (S1)", async () => {
    const { port, sent } = recording(fixture());
    await openPage(port, SIMULATORS);
    await openPage(port, SIMULATORS, true);
    expect(switchOf(FRAME)?.disabled).toBe(true);
    await openPage(port, SIMULATORS);
    expect(sent).toEqual(allGets());
    expect(switchOf(FRAME)?.getAttribute("aria-checked")).toBe("false");
    expect(switchOf(FRAME)?.disabled).toBe(false);
  });

  it("a setting fieldd refuses to read says §9's words under it, never the error's own text, and takes no input", async () => {
    const { port, sent } = recording(unreadFixture());
    await openPage(port, SIMULATORS);
    expect(refusedLine(RATE)).toBe(words.SETTINGS_WORDS.unread);
    expect(document.body.textContent?.includes(PLUGINS_FIXTURE_READ_REFUSAL)).toBe(false);
    expect(fieldOf(RATE)?.disabled).toBe(true);
    // a key dispatched to the field reaches the row, which has nothing read to send from
    typeInto(fieldOf(RATE), "45");
    await enter(fieldOf(RATE));
    expect(sets(sent)).toEqual([]);
    expect(gets(sent, "frameRate")).toBe(1);
    // the other settings were read, and take input
    expect(refusedLine(FRAME)).toBeNull();
    expect(switchOf(FRAME)?.disabled).toBe(false);
  });

  it("a setting fieldd refused to read is read again when fieldd answers after being away, and its line goes", async () => {
    const inner = fixture();
    let refusing = true;
    const { port, sent } = recording({
      ...inner,
      settingsGet: (id, key) => {
        if (refusing && key === "frameRate") {
          return Promise.reject(new Error(PLUGINS_FIXTURE_READ_REFUSAL));
        }
        return inner.settingsGet(id, key);
      },
    });
    await openPage(port, SIMULATORS);
    expect(refusedLine(RATE)).toBe(words.SETTINGS_WORDS.unread);
    refusing = false;
    await openPage(port, SIMULATORS, true);
    await openPage(port, SIMULATORS);
    expect(refusedLine(RATE)).toBeNull();
    expect([fieldOf(RATE)?.value, fieldOf(RATE)?.disabled]).toEqual(["30", false]);
    expect(gets(sent, "frameRate")).toBe(2);
    // the settings that were read are not read again (S1)
    expect(gets(sent, "showFrame")).toBe(1);
  });

  it("a setting whose read after its own change is refused takes no input, and a second change sends nothing", async () => {
    const inner = fixture();
    let reads = 0;
    const { port, sent } = recording({
      ...inner,
      settingsGet: (id, key) => {
        if (key === "frameRate") {
          reads += 1;
          if (reads === 2) return Promise.reject(new Error(PLUGINS_FIXTURE_READ_REFUSAL));
        }
        return inner.settingsGet(id, key);
      },
    });
    await openPage(port, SIMULATORS);
    typeInto(fieldOf(RATE), "45");
    await enter(fieldOf(RATE));
    expect(sets(sent)).toEqual([{ what: "set", id: SIMULATORS, key: "frameRate", value: 45 }]);
    expect(refusedLine(RATE)).toBe(words.SETTINGS_WORDS.unread);
    expect(fieldOf(RATE)?.disabled).toBe(true);
    // a dispatched change reaches the row, which sends nothing while its read is refused
    typeInto(fieldOf(RATE), "50");
    await enter(fieldOf(RATE));
    expect(sets(sent)).toHaveLength(1);
    expect(gets(sent, "frameRate")).toBe(2);
  });

  it("a page that reads only — a plugin from the list, or a Sideloaded one — has no Settings section and asks fieldd nothing (U2)", async () => {
    for (const [id, title] of Object.entries(READ_ONLY)) {
      const { port, sent } = recording(fixture());
      await openPage(port, id);
      expect(document.body.querySelector(".vf-plugins-page-title")?.textContent).toBe(title);
      expect(section()).toBeNull();
      expect(sent).toEqual([]);
      act(() => root.render(null));
    }
  });

  it("a plugin whose settings all stay on this desktop says so in the foot", async () => {
    await openPage(fixture(), "vibefield.comment-pad");
    expect(titles()).toEqual(["Show resolved comments"]);
    expect(foot()).toBe(words.SETTINGS_WORDS.footHere);
  });

  it("the port asks fieldd for a setting and keeps one, and has no reset, undo or redo (C2; James's MK-O6)", () => {
    const port = pluginsPortOver({ request: () => Promise.resolve({}) });
    expect(Object.keys(port).sort()).toEqual([
      "catalog",
      "disable",
      "enable",
      "grant",
      "refresh",
      "settingsGet",
      "settingsSet",
    ]);
  });
});

type Asked = [string, Record<string, unknown>][];

/** A window's fieldd: settings kept in a fixture port's store, the plugin list answered as
 * unconfigured. */
function fielddKeeping(): { client: FielddClient; asked: Asked } {
  const store = fixture();
  const asked: Asked = [];
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    request: async (method: string, params: Record<string, unknown>) => {
      asked.push([method, params]);
      const id = String(params.pluginId);
      const key = String(params.key);
      if (method === "storage.settings.get") return store.settingsGet(id, key);
      if (method === "storage.settings.set") return store.settingsSet(id, key, params.value);
      if (method.startsWith("plugins.catalog.")) return CATALOG_FIXTURES.unconfigured;
      throw new Error(`the fixture's fieldd has no ${method}`);
    },
  } as unknown as FielddClient;
  return { client, asked };
}

const settingsAsked = (asked: Asked): Asked =>
  asked.filter(([method]) => method.startsWith("storage.settings."));

function simulatorsSettings(): SettingsContribution["properties"] {
  const simulators = PLUGINS_FIXTURE_SETTINGS_SNAPSHOT.plugins.find((p) => p.id === SIMULATORS);
  const properties = simulators?.contributions.settings?.properties;
  if (properties === undefined) throw new Error("the fixture's Simulators has no settings");
  return properties;
}

interface FormProps {
  readonly client: FielddClient;
  readonly properties: SettingsContribution["properties"];
}

/** Settings → Plugins' own form for Simulators, in a window's fieldd. */
function SettingsForm({ client, properties }: FormProps): ReactElement {
  return (
    <FielddProvider client={client}>
      <PluginSettingsForm pluginId={SIMULATORS} properties={properties} />
    </FielddProvider>
  );
}

describe("the page asks fieldd what Settings → Plugins asks (C3)", () => {
  it("reads each setting, and keeps a switch's new value, with Settings' own requests and parameters, in order", async () => {
    // Settings → Plugins' own form, over one recording fieldd
    const form = fielddKeeping();
    const properties = simulatorsSettings();
    act(() => root.render(<SettingsForm client={form.client} properties={properties} />));
    await settle();
    act(() => switchIn(host, FRAME)?.click());
    await settle();
    act(() => root.render(null));
    // the page, over another, through the port's own requests
    const page = fielddKeeping();
    await openPage(pluginsPortOver(page.client), SIMULATORS);
    act(() => switchOf(FRAME)?.click());
    await settle();
    expect(settingsAsked(form.asked)).toHaveLength(KEYS.length + 2);
    expect(settingsAsked(page.asked)).toEqual(settingsAsked(form.asked));
  });
});
