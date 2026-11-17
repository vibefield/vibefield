// @vitest-environment happy-dom

import {
  PluginRecord,
  PluginRuntimeControllerDiagnostic,
  PluginRuntimeDiagnosticsSnapshot,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTALLED_LINE } from "../src/frame/plugins/plugins-words";
import {
  PLUGINS_DIAGNOSTICS_WORDS,
  PluginsDiagnosticsSection,
} from "../src/panels/PluginsDiagnosticsSection";
import { PluginsSection, SETTINGS_PLUGINS_WORDS } from "../src/panels/PluginsSection";
import { setPluginRegistrySnapshot } from "../src/plugin-host/plugin-registry-store";
import { nameUnstartedPlugin, resetUnstartedPlugins } from "../src/plugin-host/unstarted-plugins";

// MK-5. Settings → Diagnostics' Plugins section (MK-D10; item 282-6's plugin half, MK-E12;
// DESIGN.md §8 "Settings → Diagnostics' Plugins section"): each plugin's runtime, moved here
// from Settings → Plugins' Runtime disclosure, one block per plugin under its title, as rows,
// with no disclosure; an issue in its ink; a plugin's last error and a folder that is not a
// plugin said here; never a blank. And Settings → Plugins (§8 "Settings → Plugins, until
// Plugins… holds every switch"): VF-PM's ruling of 2026-11-14 04:33Z kept a plugin from the plugin
// list or a Sideloaded one there whole until the Plugins popup carried its controls; N18 widened
// the popup to them, so the page lists no plugin from any source, reads nothing and sends nothing,
// and says where your plugins and their settings are; and, by VF-PM's ruling of 06:56Z (C22), it
// never says fieldd's own text. No real fieldd, no network, no child.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLUGIN_ID = "com.example.runtime-ui";
const HASH = `sha256:${"a".repeat(64)}`;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function controller() {
  const target = {
    face: "renderer" as const,
    pluginId: PLUGIN_ID,
    artifact: { installRevision: "revision-1", manifestHash: HASH },
    authorityFingerprint: "[]",
    observedGrantGeneration: 0,
    instanceKey: { windowId: "field" },
  };
  return PluginRuntimeControllerDiagnostic.parse({
    label: `renderer:${PLUGIN_ID}`,
    state: "active",
    desired: target,
    committed: target,
    desiredRevision: 1,
    blocked: null,
    scope: null,
    lastClose: null,
    force: { confirmedCount: 0, last: null },
    history: [],
    omittedHistory: 0,
  });
}

const WARNING = {
  code: "renderer-disconnected",
  severity: "warning",
  face: "renderer",
  participantId: "renderer:window-a",
  message: "renderer:window-a is disconnected; the last bounded report is retained",
};

const ERROR = {
  code: "controller-failed",
  severity: "error",
  face: "service",
  message: "the service controller failed to commit",
};

interface Shape {
  readonly plugins?: boolean;
  readonly issues?: readonly object[];
  readonly lastError?: { readonly kind: string; readonly message: string };
  readonly omitted?: number;
}

function runtimeSnapshot({
  plugins = true,
  issues = [WARNING],
  lastError,
  omitted = 0,
}: Shape = {}) {
  return PluginRuntimeDiagnosticsSnapshot.parse({
    version: 1,
    generation: 3,
    capturedAt: 100,
    plugins: plugins
      ? [
          {
            pluginId: PLUGIN_ID,
            registry: {
              state: "enabled",
              installRevision: "revision-1",
              manifestHash: HASH,
              grantGeneration: 0,
              renderer: "active",
              service: "none",
              ...(lastError === undefined ? {} : { lastError }),
            },
            commitEpoch: 4,
            serviceController: null,
            serviceControllerOmitted: false,
            renderers: [
              {
                participantId: "renderer:window-a",
                incarnation: "document-a1",
                connected: false,
                status: "live",
                sequence: 2,
                receivedAt: 99,
                controller: controller(),
                behaviorGeneration: {
                  pluginId: PLUGIN_ID,
                  state: "active",
                  target: {
                    windowId: "field",
                    documentId: "doc-a",
                    runtimeGeneration: "engine-a",
                  },
                  rendererTargets: [
                    {
                      face: "renderer",
                      pluginId: PLUGIN_ID,
                      artifact: { installRevision: "revision-1", manifestHash: HASH },
                      authorityFingerprint: "[]",
                      observedGrantGeneration: 0,
                      instanceKey: { windowId: "field" },
                    },
                  ],
                  desiredCount: 1,
                  installedCount: 1,
                  blockedCount: 0,
                  failedCount: 0,
                  suspendedCount: 1,
                  declarations: [
                    {
                      declarationId: `${PLUGIN_ID}:layout`,
                      rendererTarget: 0,
                      status: "installed",
                      breaker: { strikes: 3, suspended: true },
                    },
                  ],
                  omittedDeclarations: 0,
                },
              },
            ],
            omittedRenderers: 0,
            update: null,
            issues,
            omittedIssues: 0,
          },
        ]
      : [],
    omittedPlugins: omitted,
    omittedControllers: 0,
  });
}

/** A window's fieldd: the runtime read answers with `snapshot`, never answers (`"pending"`), or
 * fails (`"refused"`). The section only reads, so `request` is never called. */
function fielddWith(snapshot: unknown) {
  const request = vi.fn(async () => ({ ok: true }));
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    request,
    subscribe: vi.fn(async (method: string) => {
      if (method !== "plugins.runtime.subscribe") throw new Error(`unexpected ${method}`);
      if (snapshot === "pending") return new Promise<never>(() => undefined);
      if (snapshot === "refused") throw new Error("the runtime read was refused");
      return { subId: "plugin-runtime", snapshot, unsubscribe: () => undefined };
    }),
  } as unknown as FielddClient;
  return { client, request };
}

/** A plugin this desktop has: by default a Built in one, on, that declares nothing. */
function plugin(fields: Record<string, unknown> = {}): PluginRecord {
  return PluginRecord.parse({
    id: PLUGIN_ID,
    version: "1.0.0",
    title: "Runtime UI",
    source: "bundled",
    manifestHash: HASH,
    installRevision: "revision-1",
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    contributions: {},
    renderer: "active",
    service: "none",
    ...fields,
  });
}

const PROBLEM = {
  root: "half-a-plugin",
  error: { kind: "PLUGIN_INVALID" as const, message: "its manifest is not valid JSON" },
};

async function render(client: FielddClient, section: () => ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(FielddProvider, { client }, section()));
    // the read's answer or its refusal, and the render each moves
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(snapshot: unknown, problems: readonly (typeof PROBLEM)[] = []) {
  setPluginRegistrySnapshot({ generation: 1, plugins: [plugin()], problems: [...problems] });
  const fieldd = fielddWith(snapshot);
  await render(fieldd.client, () => createElement(PluginsDiagnosticsSection));
  return fieldd.request;
}

const text = (): string => container?.textContent ?? "";
const block = (): HTMLElement | null =>
  container?.querySelector<HTMLElement>(`[data-plugin-runtime="${PLUGIN_ID}"]`) ?? null;
const head = (): string => block()?.firstElementChild?.textContent ?? "";
/** What the block's row named `name` says at its end. */
function rowSays(name: string): string | null | undefined {
  const row = Array.from(block()?.children ?? []).find(
    (child) => child.firstElementChild?.textContent === name,
  );
  return row?.lastElementChild?.textContent;
}
/** The paragraph that says `words`, in the section. */
const said = (words: string): HTMLElement | undefined =>
  Array.from(container?.querySelectorAll<HTMLElement>("p") ?? []).find(
    (node) => node.textContent === words,
  );

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  setPluginRegistrySnapshot({ generation: 0, plugins: [], problems: [] });
  // item 476: the window's set of plugins that cannot start is a module's too
  resetUnstartedPlugins();
});

describe("Settings → Diagnostics' Plugins section (MK-5; DESIGN.md §8)", () => {
  it("says each plugin's runtime under its title, as rows, with no disclosure, and sends nothing", async () => {
    const request = await mount(runtimeSnapshot());
    expect(text()).toContain(PLUGINS_DIAGNOSTICS_WORDS.line);
    expect(head()).toContain("Runtime UI");
    expect(head()).toContain(PLUGIN_ID);
    const rows = block()?.textContent ?? "";
    expect(rowSays("commit epoch")).toBe("4");
    expect(rows).toContain("0 connected · 1 renderer report");
    expect(rows).toContain("disconnected · active");
    expect(rows).toContain("behaviors · doc-a");
    expect(rows).toContain("1/1 installed · 0 blocked · 1 suspended");
    expect(rows).toContain("target revision-1");
    expect(rows).toContain("3 strikes · breaker suspended");
    expect(rows).toContain("the last bounded report is retained");
    // no disclosure: nothing to press, and nothing asked of fieldd beyond the one read
    expect(container?.querySelectorAll("button")).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("wears an issue's ink: a warning the attention ink, an error the danger ink, never raw red or amber (§2.5)", async () => {
    await mount(runtimeSnapshot({ issues: [WARNING, ERROR] }));
    expect(said(WARNING.message)?.className).toContain("text-[var(--vf-ink-attention)]");
    expect(said(ERROR.message)?.className).toContain("text-[var(--vf-ink-danger)]");
    expect(container?.querySelector('[class*="text-red-"], [class*="text-amber-"]')).toBeNull();
  });

  it("says a plugin's last error and a folder that is not a plugin, each in the danger ink", async () => {
    const lastError = { kind: "PLUGIN_ACTIVATION_FAILED", message: "its renderer threw on start" };
    await mount(runtimeSnapshot({ lastError }), [PROBLEM]);
    expect(said(lastError.message)?.className).toContain("text-[var(--vf-ink-danger)]");
    const folder = container?.querySelector(`[data-plugin-problem="${PROBLEM.root}"]`);
    expect(folder?.textContent).toContain(PROBLEM.root);
    expect(said(PROBLEM.error.message)?.className).toContain("text-[var(--vf-ink-danger)]");
  });

  it("names a plugin the window holds no record of by its id", async () => {
    await mount(runtimeSnapshot());
    act(() => setPluginRegistrySnapshot({ generation: 2, plugins: [], problems: [] }));
    expect(head()).not.toContain("Runtime UI");
    expect(head()).toContain(PLUGIN_ID);
  });

  it("says no plugins are installed when fieldd has none, and how many its budget left out", async () => {
    await mount(runtimeSnapshot({ plugins: false }));
    expect(said(PLUGINS_DIAGNOSTICS_WORDS.none)).toBeDefined();
    expect(block()).toBeNull();
    act(() => root?.unmount());
    root = null;
    container?.remove();
    await mount(runtimeSnapshot({ omitted: 2 }));
    expect(said(PLUGINS_DIAGNOSTICS_WORDS.omittedPlugins(2))).toBeDefined();
  });

  it("says the read while it is out, and that the runtime is unavailable when it fails — never a blank (EL5)", async () => {
    await mount("pending");
    expect(said(PLUGINS_DIAGNOSTICS_WORDS.reading)).toBeDefined();
    act(() => root?.unmount());
    root = null;
    container?.remove();
    await mount("refused");
    expect(said(PLUGINS_DIAGNOSTICS_WORDS.unavailable)).toBeDefined();
    expect(text()).not.toContain("the runtime read was refused");
  });
});

const BUILT_IN = "com.example.desk-clock";
const SIDELOADED = "com.example.pad";
const LISTED = "com.example.kanban";

/** Settings a plugin declares: one in the synced history, one kept on this desktop. */
const SETTINGS = {
  properties: {
    rate: { title: "Frames each second", scope: "user", schema: { type: "integer", default: 30 } },
    caption: { title: "Caption", scope: "device", schema: { type: "string" } },
  },
};

type Asked = [string, Record<string, unknown>][];

/** fieldd's own words for a refusal: its uninstall's, for a Sideloaded plugin, as C22 quotes them
 * (`fieldd/src/plugin-install.ts`, `uninstall`). An inside a person must never read, so every
 * refusal below says them, and no assertion expects them on screen. */
const FIELDD_SAYS = `${SIDELOADED} is sideload — only registry installs uninstall here`;

/** A refusal as the window's client hands one on: fieldd's text, its code and its kind. */
function refusal(): Error {
  return Object.assign(new Error(FIELDD_SAYS), {
    code: "PRECONDITION_FAILED",
    details: { pluginKind: "PLUGIN_CAPABILITY_DENIED" },
  });
}

/** A window's fieldd for Settings → Plugins: the settings in `kept` are kept, every other is not,
 * and each request is recorded. It refuses each method in `refuse`, or one setting's read named
 * `method:key`, in its own text. It answers no subscription, for the page holds none. */
function fielddKeeping(
  kept: Readonly<Record<string, unknown>>,
  refuse: readonly string[] = [],
): {
  client: FielddClient;
  asked: Asked;
} {
  const asked: Asked = [];
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    request: vi.fn(async (method: string, params: Record<string, unknown>) => {
      asked.push([method, params]);
      if (refuse.includes(method) || refuse.includes(`${method}:${String(params.key)}`)) {
        throw refusal();
      }
      if (method !== "storage.settings.get") return { ok: true };
      const key = String(params.key);
      return key in kept ? { isSet: true, value: kept[key] } : { isSet: false };
    }),
    subscribe: vi.fn(async (method: string) => {
      throw new Error(`unexpected ${method}`);
    }),
  } as unknown as FielddClient;
  return { client, asked };
}

async function mountSettings(
  plugins: readonly PluginRecord[],
  kept: Readonly<Record<string, unknown>> = {},
  refuse: readonly string[] = [],
): Promise<Asked> {
  setPluginRegistrySnapshot({ generation: 1, plugins: [...plugins], problems: [] });
  const fieldd = fielddKeeping(kept, refuse);
  await render(fieldd.client, () => createElement(PluginsSection));
  return fieldd.asked;
}

const buttons = (): HTMLButtonElement[] =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []);

/** One plugin of every source, each with settings (one kept), a power, or both: what the kept rows
 * showed until N18. */
const everySource = (): PluginRecord[] => [
  plugin({ id: BUILT_IN, title: "Desk clock", contributions: { settings: SETTINGS } }),
  plugin({ id: "com.example.lab", title: "Lab bench", source: "dev-linked" }),
  plugin({
    id: SIDELOADED,
    title: "Pad",
    source: "sideload",
    requestedCapabilities: ["canvas.read"],
    grantedCapabilities: ["canvas.read"],
    contributions: { settings: SETTINGS },
  }),
  plugin({
    id: LISTED,
    title: "Kanban",
    source: "registry",
    contributions: { settings: SETTINGS },
  }),
];

describe("Settings → Plugins, now that Plugins… holds every switch (MK-5, N18; DESIGN.md §8)", () => {
  it("lists no plugin, from any source, and says where your plugins and their settings are", async () => {
    const asked = await mountSettings(everySource(), { rate: 45 });
    // MK's words, ‹draft›, for James's eye (DESIGN.md §9 "Settings and Diagnostics")
    expect(SETTINGS_PLUGINS_WORDS.line).toBe("Your plugins are in Plugins… in the Me menu.");
    const page = "Each plugin's switches and settings are on its page there.";
    expect(said(`${SETTINGS_PLUGINS_WORDS.line} ${page}`)).toBeDefined();
    expect(container?.querySelectorAll("article")).toHaveLength(0);
    for (const title of ["Desk clock", "Lab bench", "Pad", "Kanban"]) {
      expect(text()).not.toContain(title);
    }
    // no switch, no Settings +, no Reset, no Capabilities + and no Uninstall: nothing to press
    expect(buttons()).toEqual([]);
    expect(container?.querySelector('[role="switch"]')).toBeNull();
    // and the kept rows' words left with them
    expect(text()).not.toContain("A setting goes back to its default here");
    expect(text()).not.toContain("keep their switches here");
    expect(text()).not.toContain("Disabled plugin cards remain");
    expect(text()).not.toContain(PLUGINS_DIAGNOSTICS_WORDS.none);
    // it reads nothing and sends nothing
    expect(asked).toEqual([]);
  });

  it("says nothing of a plugin's trouble, which Plugins… or Settings → Diagnostics says, and never fieldd's text (C22, N21, item 476)", async () => {
    // a stopped service (N21) and one that cannot start here (item 476) are said on its row in
    // Plugins…; a last error in Diagnostics' Plugins section alone (N18), as a Built in plugin's
    // has been since MK-5, for Plugins… never reads one
    const lastError = { kind: "PLUGIN_ACTIVATION_FAILED", message: "its service threw on start" };
    const plugins = [
      plugin({ id: SIDELOADED, title: "Pad", source: "sideload", lastError }),
      plugin({ id: LISTED, title: "Kanban", source: "registry", service: "quarantined" }),
    ];
    // a fieldd that would refuse every request the kept rows sent: none is sent
    const every = [
      "plugins.enable",
      "plugins.disable",
      "plugins.grants.set",
      "storage.settings.get",
      "storage.settings.reset",
    ];
    const asked = await mountSettings(plugins, {}, every);
    act(() => nameUnstartedPlugin(LISTED, { reason: "import" }));
    expect(text()).not.toContain(INSTALLED_LINE.broken("Pad"));
    expect(text()).not.toContain(INSTALLED_LINE.broken("Kanban"));
    expect(text()).not.toContain(lastError.message);
    expect(text()).not.toContain(FIELDD_SAYS);
    expect(text()).not.toMatch(/stopped|Uninstall|Remove/u);
    expect(asked).toEqual([]);
  });
});
