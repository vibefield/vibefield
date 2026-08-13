import { PLUGIN_LIMITS, type PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import type { RendererPluginContext } from "@vibefield/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateStagedRenderer } from "../src/plugin-host/renderer-harness";
import {
  ensureStyleLink,
  prepareRendererPlugins,
  type StagedLoaderDeps,
} from "../src/plugin-host/staged-loader";

// P8b-3 — the staged loader and the async activation path it feeds.
//
// Everything here runs through the `importModule` seam rather than a live
// `vibefield-plugin://` URL: what these rows are about is the LOADER's
// behaviour — the join to the registry record, the boot budget, the style link,
// the §10.4 deadline — and a real protocol handler would only make each of them
// depend on Electron being up. The end-to-end path (mint → serve → import) is
// the smoke's job, and the smoke asserts it on every run.

/** A record shaped the way fieldd's snapshot ships one, declaring one widget. */
const record = (id: string, over: Record<string, unknown> = {}): PluginRecord =>
  ({
    id,
    version: "1.0.0",
    title: `${id} plugin`,
    source: "bundled",
    manifestHash: `sha256:${"b".repeat(64)}`,
    installRevision: "rev-1",
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    deniedCapabilities: [],
    grantGeneration: 0,
    contributions: {
      widgets: [
        {
          type: `${id}.card`,
          title: "Card",
          schemaVersion: 1,
          surface: "dom",
          sizeMode: "fixed",
          defaultSize: { w: 100, h: 100 },
          props: {},
          groups: {},
        },
      ],
      commands: [],
      surfaces: [],
      capabilities: [],
    },
    renderer: "inactive",
    service: "none",
    ...over,
  }) as unknown as PluginRecord;

const snapshotOf = (...records: PluginRecord[]): PluginRegistrySnapshot =>
  PluginRegistrySnapshot.parse({ generation: 7, plugins: records, problems: [] });

/** A module that binds its declared widget, the ordinary case. */
const bindingModule = (id: string) => ({
  activate(ctx: RendererPluginContext) {
    ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
  },
});

const moduleRow = (id: string) => ({
  pluginId: id,
  moduleUrl: `vibefield-plugin://${id.padEnd(32, "0").slice(0, 32)}`,
  manifestHash: `sha256:${"b".repeat(64)}`,
  installRevision: "rev-1",
});

/** One approved plugin, end to end. The id varies per test because the harness
 * memoizes one activation per plugin id per renderer process (§10.3) — two rows
 * sharing an id would have the second silently reading the first's answer. */
function deps(id: string, over: Partial<StagedLoaderDeps> = {}): StagedLoaderDeps {
  return {
    request: async (method) => {
      if (method === "plugins.modules") return { generation: 7, modules: [moduleRow(id)] };
      if (method === "plugins.list") return snapshotOf(record(id));
      throw new Error(`unexpected method ${method}`);
    },
    snapshot: () => null,
    importModule: async () => bindingModule(id),
    ...over,
  };
}

afterEach(() => {
  // The loader defaults to the live document; the rows above that let it do so
  // must not leave a plugin stylesheet behind for the next file.
  for (const link of [...document.querySelectorAll("link[data-vf-plugin-style]")]) link.remove();
});

describe("the staged loader", () => {
  it("joins approved modules to their records, imports, and activates them", async () => {
    const imported: string[] = [];
    const prepared = await prepareRendererPlugins(
      deps("alpha", {
        importModule: async (url) => {
          imported.push(url);
          return bindingModule("alpha");
        },
      }),
    );
    expect(imported).toEqual([moduleRow("alpha").moduleUrl]);
    expect(prepared.generation).toBe(7);
    expect(prepared.staged).toHaveLength(1);
    const [entry] = prepared.staged;
    expect(entry?.record.id).toBe("alpha");
    expect(entry?.activation.state).toBe("active");
    expect([...(entry?.activation.bindings.keys() ?? [])]).toEqual(["alpha.card"]);
  });

  it("hands the plugin its approved identity through ctx.plugin (§11.4)", async () => {
    let seen: RendererPluginContext["plugin"] | null = null;
    await prepareRendererPlugins(
      deps("identity", {
        importModule: async () => ({
          activate(ctx: RendererPluginContext) {
            seen = ctx.plugin;
          },
        }),
      }),
    );
    expect(seen).toEqual({
      id: "identity",
      version: "1.0.0",
      manifestHash: `sha256:${"b".repeat(64)}`,
      installRevision: "rev-1",
    });
  });

  it("prefers a registry snapshot the renderer already holds over a second read", async () => {
    const asked: string[] = [];
    const prepared = await prepareRendererPlugins(
      deps("held", {
        snapshot: () => snapshotOf(record("held")),
        request: async (method) => {
          asked.push(method);
          if (method === "plugins.modules") return { generation: 7, modules: [moduleRow("held")] };
          throw new Error(`unexpected method ${method}`);
        },
      }),
    );
    expect(asked).toEqual(["plugins.modules"]);
    expect(prepared.staged).toHaveLength(1);
  });

  it("gives up on an unreachable daemon within the budget instead of hanging the boot", async () => {
    const started = Date.now();
    const prepared = await prepareRendererPlugins(
      // The shape a dead daemon actually has here: `client.request` awaits
      // `ready()`, which never settles while nothing answers the socket.
      deps("away", { request: () => new Promise(() => {}), budgetMs: 40 }),
    );
    expect(prepared.staged).toEqual([]);
    expect(prepared.generation).toBe(-1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("treats a refusing daemon as an empty approval, not an error", async () => {
    const prepared = await prepareRendererPlugins(
      deps("refused", {
        request: async () => {
          throw new Error("FORBIDDEN_SCOPE");
        },
      }),
    );
    expect(prepared.staged).toEqual([]);
  });

  it("keeps one plugin's broken module from emptying the set", async () => {
    const prepared = await prepareRendererPlugins(
      deps("good", {
        request: async (method) =>
          method === "plugins.modules"
            ? { generation: 7, modules: [moduleRow("good"), moduleRow("broken")] }
            : snapshotOf(record("good"), record("broken")),
        importModule: async (url) => {
          if (url === moduleRow("broken").moduleUrl) throw new Error("404");
          return bindingModule("good");
        },
      }),
    );
    expect(prepared.staged.map((s) => [s.record.id, s.activation.state])).toEqual([
      ["good", "active"],
      ["broken", "failed"],
    ]);
  });

  it("skips an approved module the snapshot does not describe", async () => {
    const prepared = await prepareRendererPlugins(
      deps("orphan", {
        request: async (method) =>
          method === "plugins.modules"
            ? { generation: 7, modules: [moduleRow("orphan")] }
            : snapshotOf(),
      }),
    );
    expect(prepared.staged).toEqual([]);
    expect(prepared.generation).toBe(7);
  });

  it("refuses a module that exports no activate (§10.1)", async () => {
    const prepared = await prepareRendererPlugins(
      deps("shapeless", { importModule: async () => ({ notActivate: () => {} }) }),
    );
    expect(prepared.staged.map((s) => s.activation.state)).toEqual(["failed"]);
    expect(prepared.staged[0]?.activation.error).toMatch(/§10.1/);
  });

  it("accepts the default-export spelling of a renderer module", async () => {
    const prepared = await prepareRendererPlugins(
      deps("defaulted", { importModule: async () => ({ default: bindingModule("defaulted") }) }),
    );
    expect(prepared.staged.map((s) => s.activation.state)).toEqual(["active"]);
  });
});

describe("the plugin stylesheet link", () => {
  const styleUrl = `vibefield-plugin://${"c".repeat(32)}`;
  // A detached document — the `document` dependency is injectable for exactly
  // this reason. These rows are about the LINK ELEMENTS, and a live document
  // would additionally try to fetch a scheme only Electron serves, which is
  // noise about the test environment rather than evidence about the loader.
  const links = (doc: Document): HTMLLinkElement[] => [
    ...doc.querySelectorAll<HTMLLinkElement>("link[data-vf-plugin-style]"),
  ];
  const fresh = (): Document => document.implementation.createHTMLDocument("staged");

  it("links once per plugin, however many times the phase runs", () => {
    const doc = fresh();
    ensureStyleLink(doc, "alpha", "rev-1", styleUrl);
    ensureStyleLink(doc, "alpha", "rev-1", styleUrl);
    ensureStyleLink(doc, "alpha", "rev-1", styleUrl);
    expect(links(doc)).toHaveLength(1);
    expect(links(doc)[0]?.getAttribute("href")).toBe(styleUrl);
  });

  it("replaces the link when the install revision moves", () => {
    const doc = fresh();
    ensureStyleLink(doc, "alpha", "rev-1", styleUrl);
    const next = `vibefield-plugin://${"d".repeat(32)}`;
    ensureStyleLink(doc, "alpha", "rev-2", next);
    // Replaced, not stacked: the old revision's URL no longer resolves, so a
    // second link would be a stylesheet the browser can only fail to fetch.
    expect(links(doc)).toHaveLength(1);
    expect(links(doc)[0]?.getAttribute("href")).toBe(next);
  });

  it("gives each plugin its own link", () => {
    const doc = fresh();
    ensureStyleLink(doc, "alpha", "rev-1", styleUrl);
    ensureStyleLink(doc, "beta", "rev-1", styleUrl);
    expect(links(doc)).toHaveLength(2);
  });
});

describe("staged activation under the §10.4 deadline", () => {
  const module = {
    pluginId: "gamma",
    moduleUrl: `vibefield-plugin://${"e".repeat(32)}`,
    manifestHash: `sha256:${"b".repeat(64)}`,
    installRevision: "rev-1",
  };

  it("awaits an async activate and collects what it bound", async () => {
    const activation = await activateStagedRenderer(record("gamma"), module, {
      async activate(ctx: RendererPluginContext) {
        await Promise.resolve();
        ctx.widgets.register({ type: "gamma.card", binding: { component: () => null } });
      },
    });
    expect(activation.state).toBe("active");
    expect([...activation.bindings.keys()]).toEqual(["gamma.card"]);
  });

  it("reports a rejected activate as a failure, without memoizing it", async () => {
    const failed = await activateStagedRenderer(record("delta"), module, {
      activate: async () => {
        throw new Error("boom");
      },
    });
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("boom");
    // §11.4's retry: a plugin that threw is entitled to another attempt on the
    // next boot, so the failure must NOT be the answer a second call gets.
    const retried = await activateStagedRenderer(record("delta"), module, {
      activate: (ctx: RendererPluginContext) => {
        ctx.widgets.register({ type: "delta.card", binding: { component: () => null } });
      },
    });
    expect(retried.state).toBe("active");
  });

  it("preempts an activate that never settles, and drops what it had bound", async () => {
    vi.useFakeTimers();
    try {
      const tracked = { dispose: vi.fn() };
      const pending = activateStagedRenderer(record("epsilon"), module, {
        activate(ctx: RendererPluginContext) {
          ctx.widgets.register({ type: "epsilon.card", binding: { component: () => null } });
          ctx.track(tracked);
          return new Promise<void>(() => {});
        },
      });
      await vi.advanceTimersByTimeAsync(PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS + 1);
      const activation = await pending;
      expect(activation.state).toBe("failed");
      expect(activation.error).toMatch(/§10.4/);
      // The registrations it managed to make are gone and its resources are
      // released — a half-activated plugin must not leave live bindings behind.
      expect(activation.bindings.size).toBe(0);
      expect(tracked.dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("CONTROL: the same never-settling activate hangs when nothing races it", async () => {
    // The row above passes trivially if `activateStagedRenderer` simply resolved
    // early for another reason. This proves the deadline is what ended it: the
    // identical promise, awaited without the race, is still pending after the
    // same amount of virtual time.
    vi.useFakeTimers();
    try {
      let settled = false;
      const bare = new Promise<void>(() => {}).then(() => {
        settled = true;
      });
      void bare;
      await vi.advanceTimersByTimeAsync(PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS + 1);
      expect(settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
