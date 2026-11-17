// @vitest-environment node
/**
 * DK-9 — THE RUNTIME WITH KINDS (plugin-host/window-kinds.ts; ICE petition I25: a desk's kinds are the set it
 * was MOUNTED with, and a host that changes them remounts). What a registry snapshot asks of a window — the
 * planner, pure — and the store that carries it out: a plugin this renderer staged turned OFF or ON → the
 * desk remounts on its engine without or with its kinds (LAYER); one enabled that this renderer never
 * defined → staged, then the board reopens on a new engine (GENERATION); a kind this renderer defined
 * otherwise — an UPDATE's new artifact, a type a ghost stub defined faceless → the renderer is replaced
 * (RENDERER), never an update refused. A plugin mid-update moves when its episode settles.
 *
 * Item 476, item 490 — A FAILED LANE IS THE RETRY'S, NOT THE PLANNER'S: a plugin whose update lane failed is
 * named in the window's own set (plugin-host/unstarted-plugins.ts) and the planner makes no move for it, so
 * no renderer is replaced at each snapshot; a lane refused for ROOM is asked again on one timer (1 s, 2, 4,
 * 8, 16, then every 30 s), staged the generation's way when it opens, and never where a ghost stub already
 * defined its type. Those rows run on fake timers, and each names its own plugin and types: a realm's
 * definitions cannot be taken back, and the set is emptied after every row.
 */
import type { PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRegistry } from "../src/field-engine";
import type { RendererLogger } from "../src/logging";
import { buildFacelessType, typeDefinition } from "../src/plugin-host/build-widget";
import type {
  PreparedRendererPlugins,
  PreparedStagedPlugin,
} from "../src/plugin-host/staged-loader";
import {
  getUnstartedPlugins,
  nameUnstartedPlugin,
  resetUnstartedPlugins,
} from "../src/plugin-host/unstarted-plugins";
import { planKinds, type StagedIdentity, WindowKinds } from "../src/plugin-host/window-kinds";

afterEach(() => {
  // the window's set is the realm's (a module-level store): a row leaves none of it to the next
  resetUnstartedPlugins();
});

function record(
  id: string,
  opts: {
    readonly enabled?: boolean;
    readonly installRevision?: string;
    readonly types?: readonly string[];
  } = {},
): PluginRecord {
  const enabled = opts.enabled ?? true;
  return {
    id,
    version: "1.0.0",
    title: `${id} plugin`,
    source: "dev-linked",
    manifestHash: `sha256:${"c".repeat(64)}`,
    installRevision: opts.installRevision ?? "a".repeat(64),
    state: enabled ? "enabled" : "disabled",
    compatible: true,
    enabled,
    requestedCapabilities: [],
    grantedCapabilities: [],
    deniedCapabilities: [],
    grantGeneration: 1,
    contributions: {
      objects: (opts.types ?? [`${id}.thing`]).map((type) => ({
        type,
        title: "Thing",
        schemaVersion: 1,
        size: { w: 100, h: 100 },
        provides: ["desk.object"],
        props: {},
        groups: {},
        binding: { kind: "thing" },
      })),
      commands: [],
      surfaces: [],
      capabilities: [],
    },
    renderer: "inactive",
    service: "none",
  } as unknown as PluginRecord;
}

const snapshot = (...plugins: PluginRecord[]): PluginRegistrySnapshot =>
  ({ generation: 1, plugins, problems: [] }) as unknown as PluginRegistrySnapshot;

const stagedOf = (r: PluginRecord): StagedIdentity => ({
  record: r,
  module: { installRevision: r.installRevision, manifestHash: r.manifestHash },
});

const plan = (
  snap: PluginRegistrySnapshot,
  staged: readonly PluginRecord[],
  opts: {
    off?: readonly string[];
    bundled?: readonly PluginRecord[];
    updating?: string[];
    laneFailed?: readonly string[];
  } = {},
) =>
  planKinds({
    snapshot: snap,
    staged: new Map(staged.map((r) => [r.id, stagedOf(r)] as const)),
    bundled: new Map(
      (opts.bundled ?? []).map(
        (r) => [r.id, (r.contributions.objects ?? []).map((o) => o.type)] as const,
      ),
    ),
    off: new Set(opts.off ?? []),
    updating: (id) => (opts.updating ?? []).includes(id),
    laneFailed: new Set(opts.laneFailed ?? []),
  });

describe("planKinds — what a registry snapshot asks of a window (I25)", () => {
  const clock = record("vendor.clock");

  it("asks nothing while every staged plugin is on and unchanged", () => {
    expect(plan(snapshot(clock), [clock])).toEqual({ kind: "none" });
  });

  it("a staged plugin DISABLED → the desk remounts without its kinds; enabled again → with them (LAYER)", () => {
    const off = plan(snapshot(record("vendor.clock", { enabled: false })), [clock]);
    expect(off).toEqual({ kind: "layer", off: new Set(["vendor.clock.thing"]) });
    expect(plan(snapshot(clock), [clock], { off: ["vendor.clock.thing"] })).toEqual({
      kind: "layer",
      off: new Set(),
    });
  });

  it("a staged plugin UNINSTALLED (its record gone) → its objects wear the missing face (LAYER)", () => {
    expect(plan(snapshot(), [clock])).toEqual({
      kind: "layer",
      off: new Set(["vendor.clock.thing"]),
    });
  });

  it("a plugin disabled that this renderer never staged has no kind here to take off — nothing moves", () => {
    expect(plan(snapshot(clock, record("vendor.idle", { enabled: false })), [clock])).toEqual({
      kind: "none",
    });
  });

  it("a plugin ENABLED that this renderer never defined → staged, the board reopens on a new engine (GENERATION)", () => {
    const fresh = record("vendor.fresh", { types: ["vendor.fresh.dial"] });
    expect(plan(snapshot(clock, fresh), [clock])).toEqual({
      kind: "generation",
      stage: ["vendor.fresh"],
    });
  });

  it("a plugin enabled whose type a ghost stub already defined faceless here → the renderer is replaced (RENDERER)", () => {
    buildFacelessType({
      type: "vendor.ghosted.dial",
      schemaVersion: 1,
      size: { w: 1, h: 1 },
      props: {},
      groups: {},
    });
    const ghosted = record("vendor.ghosted", { types: ["vendor.ghosted.dial"] });
    const move = plan(snapshot(clock, ghosted), [clock]);
    expect(move.kind).toBe("renderer");
    expect(move.kind === "renderer" ? move.why : []).toEqual([
      "vendor.ghosted enabled: vendor.ghosted.dial already defined in this renderer",
    ]);
  });

  it("ITEM 490: …but one whose update lane FAILED moves nothing — no renderer is replaced for it, snapshot after snapshot", async () => {
    buildFacelessType({
      type: "vendor.lane-ghosted.dial",
      schemaVersion: 1,
      size: { w: 1, h: 1 },
      props: {},
      groups: {},
    });
    const ghosted = record("vendor.lane-ghosted", { types: ["vendor.lane-ghosted.dial"] });
    // in the window's set of failed lanes the planner stands back (before item 490: `renderer`, and
    // the new renderer's first snapshot answered `renderer` again if its lane failed too)
    const failed = { laneFailed: [ghosted.id] };
    expect(plan(snapshot(clock, ghosted), [clock], failed)).toEqual({ kind: "none" });
    // not in the set, it is the renderer's still (the row above)
    expect(plan(snapshot(clock, ghosted), [clock]).kind).toBe("renderer");
    // and one this realm never defined is not staged at each snapshot either: it is the retry's
    const fresh = record("vendor.lane-fresh", { types: ["vendor.lane-fresh.dial"] });
    const freshFailed = { laneFailed: [fresh.id] };
    expect(plan(snapshot(clock, fresh), [clock], freshFailed)).toEqual({ kind: "none" });
    // over a real window, its lane failed for a reason other than room: three snapshots in a row
    // replace no renderer and stage nothing
    nameUnstartedPlugin(ghosted.id, { reason: "lane", room: false });
    const stage = vi.fn();
    const replaceRenderer = vi.fn();
    const none: PreparedRendererPlugins = { generation: 1, staged: [], bundled: [] };
    const kinds = new WindowKinds(none, {
      stage,
      remountGeneration: vi.fn(),
      replaceRenderer,
    });
    for (let n = 0; n < 3; n += 1) {
      expect(await kinds.observe(snapshot(ghosted))).toEqual({ kind: "none" });
    }
    expect(replaceRenderer).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it("a staged plugin UPDATED (its artifact moved) → the renderer is replaced — never refused (RENDERER)", () => {
    const updated = record("vendor.clock", { installRevision: "b".repeat(64) });
    const move = plan(snapshot(updated), [clock]);
    expect(move).toEqual({
      kind: "renderer",
      why: [`vendor.clock updated: ${"a".repeat(12)} → ${"b".repeat(12)}`],
    });
  });

  it("…but not while the plugin's update episode is in flight: it moves when the episode settles", () => {
    const updated = record("vendor.clock", { installRevision: "b".repeat(64) });
    expect(plan(snapshot(updated), [clock], { updating: ["vendor.clock"] })).toEqual({
      kind: "none",
    });
  });

  it("the dev-bundled fallback is drawn while enabled and goes off when disabled", () => {
    const pad = record("vendor.pad");
    expect(plan(snapshot(pad), [], { bundled: [pad] })).toEqual({ kind: "none" });
    expect(
      plan(snapshot(record("vendor.pad", { enabled: false })), [], { bundled: [pad] }),
    ).toEqual({
      kind: "layer",
      off: new Set(["vendor.pad.thing"]),
    });
  });

  it("a plugin with no object kinds moves nothing on the desk, whatever happens to it", () => {
    const panel = {
      ...record("vendor.panel"),
      contributions: { ...record("vendor.panel").contributions, objects: [] },
    } as PluginRecord;
    expect(plan(snapshot({ ...panel, enabled: false } as PluginRecord), [panel])).toEqual({
      kind: "none",
    });
  });
});

describe("WindowKinds — the window's kinds over its life", () => {
  const clock = record("vendor.window-clock");
  const prepared = (staged: readonly PluginRecord[]): PreparedRendererPlugins => ({
    generation: 1,
    staged: staged.map(
      (r) =>
        ({
          record: r,
          module: {
            pluginId: r.id,
            moduleUrl: `vibefield-plugin://${r.id}`,
            installRevision: r.installRevision,
            manifestHash: r.manifestHash,
          },
          activation: { state: "active", behaviors: new Map() },
        }) as unknown as PreparedStagedPlugin,
    ),
    bundled: [],
  });

  it("LAYER: bumps its version and tells the stage — the off set is what the next mount leaves out", async () => {
    const kinds = new WindowKinds(prepared([clock]), {
      stage: vi.fn(),
      remountGeneration: vi.fn(),
      replaceRenderer: vi.fn(),
    });
    const told = vi.fn();
    kinds.subscribe(told);
    expect(kinds.version()).toBe(0);
    await kinds.observe(snapshot(record("vendor.window-clock", { enabled: false })));
    expect(kinds.version()).toBe(1);
    expect([...kinds.off()]).toEqual(["vendor.window-clock.thing"]);
    expect(told).toHaveBeenCalledTimes(1);
    await kinds.observe(snapshot(record("vendor.window-clock", { enabled: false }))); // the same snapshot again
    expect(kinds.version()).toBe(1);
    await kinds.observe(snapshot(clock));
    expect(kinds.version()).toBe(2);
    expect(kinds.off().size).toBe(0);
  });

  it("GENERATION: stages the new plugin on the runtime, grows the set the NEXT generation builds from, then reopens the board", async () => {
    const fresh = record("vendor.window-fresh", { types: ["vendor.window-fresh.dial"] });
    const order: string[] = [];
    const staged = prepared([fresh]).staged;
    const kinds = new WindowKinds(prepared([clock]), {
      stage: vi.fn(async (ids: readonly string[]) => {
        order.push(`stage ${ids.join(",")}`);
        return { staged, runtime: undefined };
      }),
      remountGeneration: vi.fn(async (reason: string) => {
        order.push(`remount ${reason}`);
        return true;
      }),
      replaceRenderer: vi.fn(),
    });
    const before = kinds.current();
    await kinds.observe(snapshot(clock, fresh));
    expect(order).toEqual(["stage vendor.window-fresh", "remount plugin-enabled"]);
    expect(kinds.current()).not.toBe(before);
    expect(kinds.current().staged.map((s) => s.record.id)).toEqual([
      "vendor.window-clock",
      "vendor.window-fresh",
    ]);
    // staged now: the same snapshot asks nothing more
    await kinds.observe(snapshot(clock, fresh));
    expect(order).toHaveLength(2);
  });

  it("GENERATION: a plugin fieldd has not approved yet is not staged — no remount, its objects keep the missing face", async () => {
    const fresh = record("vendor.window-unapproved", { types: ["vendor.window-unapproved.dial"] });
    const remountGeneration = vi.fn();
    const kinds = new WindowKinds(prepared([clock]), {
      stage: vi.fn(async () => ({ staged: [], runtime: undefined })),
      remountGeneration,
      replaceRenderer: vi.fn(),
    });
    await kinds.observe(snapshot(clock, fresh));
    expect(remountGeneration).not.toHaveBeenCalled();
  });

  it("RENDERER: replaces the renderer ONCE for an update, and takes no other move meanwhile", async () => {
    const replaceRenderer = vi.fn();
    const kinds = new WindowKinds(prepared([clock]), {
      stage: vi.fn(),
      remountGeneration: vi.fn(),
      replaceRenderer,
    });
    const updated = record("vendor.window-clock", { installRevision: "e".repeat(64) });
    await kinds.observe(snapshot(updated));
    await kinds.observe(snapshot(updated));
    await kinds.observe(snapshot(record("vendor.window-clock", { enabled: false })));
    expect(replaceRenderer).toHaveBeenCalledTimes(1);
    expect(replaceRenderer.mock.calls[0]?.[0]).toEqual([
      `vendor.window-clock updated: ${"a".repeat(12)} → ${"e".repeat(12)}`,
    ]);
    expect(kinds.version()).toBe(0);
  });

  it("an update mid-episode waits for it to settle — `again()` re-reads the last snapshot then", async () => {
    let updating = true;
    const replaceRenderer = vi.fn();
    const kinds = new WindowKinds(prepared([clock]), {
      stage: vi.fn(),
      remountGeneration: vi.fn(),
      replaceRenderer,
      updating: () => updating,
    });
    await kinds.observe(
      snapshot(record("vendor.window-clock", { installRevision: "f".repeat(64) })),
    );
    expect(replaceRenderer).not.toHaveBeenCalled();
    updating = false;
    await kinds.again();
    expect(replaceRenderer).toHaveBeenCalledTimes(1);
  });

  /** A lane fieldd refused for want of room, as the staged loader names it in the window's set. */
  const roomRefused = { reason: "lane", room: true } as const;

  it("ITEM 476, CASE 1: a lane refused for room is asked again at 1 s and at 2 s and no sooner; once it opens the plugin is staged, its kinds compile, and the board reopens ONCE", async () => {
    vi.useFakeTimers();
    try {
      const late = record("vendor.window-late", { types: ["vendor.window-late.dial"] });
      nameUnstartedPlugin(late.id, roomRefused);
      const opened = prepared([late]).staged;
      // the lane refuses for room twice more, then opens (the stage dep is the staged loader's path)
      const asked: string[] = [];
      const stage = vi.fn(async (ids: readonly string[]) => {
        asked.push(ids.join(","));
        return { staged: asked.length < 3 ? [] : opened, runtime: undefined };
      });
      const remounts: string[] = [];
      const remountGeneration = vi.fn(async (reason: string) => {
        remounts.push(reason);
        return true;
      });
      const replaceRenderer = vi.fn();
      const kinds = new WindowKinds(prepared([clock]), {
        stage,
        remountGeneration,
        replaceRenderer,
      });
      // the snapshot stages nothing: the plugin is the retry's (before item 476 the planner staged
      // it here, at whichever snapshot came next, and never on a clock)
      await kinds.observe(snapshot(clock, late));
      expect(asked).toEqual([]);
      kinds.listen();
      await vi.advanceTimersByTimeAsync(999);
      expect(asked).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(asked).toEqual(["vendor.window-late"]);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(asked).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(asked).toHaveLength(2);
      // refused twice: nothing staged, nothing reopened, and it is still named
      expect(remounts).toEqual([]);
      expect(getUnstartedPlugins().get(late.id)).toEqual(roomRefused);
      expect(typeDefinition("vendor.window-late.dial")).toBeUndefined();
      await vi.advanceTimersByTimeAsync(3_999);
      expect(asked).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(asked).toHaveLength(3);
      // the third ask opened it: staged, out of the set, the board reopened once, no timer left
      expect(kinds.current().staged.map((s) => s.record.id)).toEqual([
        "vendor.window-clock",
        "vendor.window-late",
      ]);
      expect(remounts).toEqual(["plugin-enabled"]);
      expect(getUnstartedPlugins().has(late.id)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      // the registry the next generation builds from `current()` compiles its kinds (faceless here:
      // this row's staged plugin carries no module to bind a kind from)
      const registry = buildRegistry(kinds.current());
      expect(typeDefinition("vendor.window-late.dial")).toBeDefined();
      expect(registry.allWidgets().has("vendor.window-late.dial")).toBe(true);
      // nothing asks after, and no renderer was replaced on the way
      await vi.advanceTimersByTimeAsync(120_000);
      expect(asked).toHaveLength(3);
      expect(replaceRenderer).not.toHaveBeenCalled();
      kinds.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ITEM 476: one firing asks the window's room-refused plugins together; one with no object kinds joins with NO remount, and the one still refused is asked again", async () => {
    vi.useFakeTimers();
    try {
      const full = record("vendor.window-full", { types: ["vendor.window-full.dial"] });
      const plain = record("vendor.window-plain", { types: [] });
      nameUnstartedPlugin(full.id, roomRefused);
      nameUnstartedPlugin(plain.id, roomRefused);
      const opened = prepared([plain]).staged;
      // the first firing is refused whole; at the second the plain plugin's lane opens, alone
      const asked: string[] = [];
      const stage = vi.fn(async (ids: readonly string[]) => {
        asked.push(ids.join(","));
        return { staged: asked.length === 2 ? opened : [], runtime: undefined };
      });
      const remountGeneration = vi.fn();
      const kinds = new WindowKinds(prepared([clock]), {
        stage,
        remountGeneration,
        replaceRenderer: vi.fn(),
      });
      await kinds.observe(snapshot(clock, full, plain));
      expect(asked).toEqual([]);
      kinds.listen();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(asked).toEqual(["vendor.window-full,vendor.window-plain"]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(asked).toHaveLength(2);
      expect(kinds.current().staged.map((s) => s.record.id)).toEqual([
        "vendor.window-clock",
        "vendor.window-plain",
      ]);
      // nothing on the desk moves for a plugin with no kinds: no board reopens
      expect(remountGeneration).not.toHaveBeenCalled();
      expect([...getUnstartedPlugins().keys()]).toEqual(["vendor.window-full"]);
      // a lane opened, so the backoff starts over for the one still refused: 1 s again
      await vi.advanceTimersByTimeAsync(999);
      expect(asked).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(asked[2]).toBe("vendor.window-full");
      expect(vi.getTimerCount()).toBe(1);
      kinds.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ITEM 476, CASE 2: a room-refused plugin whose type a ghost stub defined here is never asked, and no renderer is replaced for it", async () => {
    vi.useFakeTimers();
    try {
      buildFacelessType({
        type: "vendor.window-stubbed.dial",
        schemaVersion: 1,
        size: { w: 1, h: 1 },
        props: {},
        groups: {},
      });
      const stubbed = record("vendor.window-stubbed", { types: ["vendor.window-stubbed.dial"] });
      nameUnstartedPlugin(stubbed.id, roomRefused);
      const stage = vi.fn(async () => ({ staged: [], runtime: undefined }));
      const replaceRenderer = vi.fn();
      const kinds = new WindowKinds(prepared([clock]), {
        stage,
        remountGeneration: vi.fn(),
        replaceRenderer,
      });
      await kinds.observe(snapshot(clock, stubbed));
      expect(replaceRenderer).not.toHaveBeenCalled();
      kinds.listen();
      // it cannot be staged in this realm whatever its lane says: no timer is armed for it
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(stage).not.toHaveBeenCalled();
      expect(replaceRenderer).not.toHaveBeenCalled();
      // it keeps its place in the set (its rows say it isn't working) until the window's next start
      expect(getUnstartedPlugins().get(stubbed.id)).toEqual(roomRefused);
      kinds.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ITEM 476: a lane that failed for any reason but room is never asked again on the timer", async () => {
    vi.useFakeTimers();
    try {
      const away = record("vendor.window-away", { types: ["vendor.window-away.dial"] });
      nameUnstartedPlugin(away.id, { reason: "lane", room: false });
      const stage = vi.fn(async () => ({ staged: [], runtime: undefined }));
      const kinds = new WindowKinds(prepared([clock]), {
        stage,
        remountGeneration: vi.fn(),
        replaceRenderer: vi.fn(),
      });
      await kinds.observe(snapshot(clock, away));
      expect(stage).not.toHaveBeenCalled();
      kinds.listen();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(stage).not.toHaveBeenCalled();
      kinds.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ITEM 476: a lane that never opens is asked every 30 s for as long as the window's kinds stand, on ONE timer; dispose() ends it", async () => {
    vi.useFakeTimers();
    try {
      const never = record("vendor.window-never", { types: ["vendor.window-never.dial"] });
      nameUnstartedPlugin(never.id, roomRefused);
      const stage = vi.fn(async () => ({ staged: [], runtime: undefined }));
      const replaceRenderer = vi.fn();
      const kinds = new WindowKinds(prepared([clock]), {
        stage,
        remountGeneration: vi.fn(),
        replaceRenderer,
      });
      await kinds.observe(snapshot(clock, never));
      expect(stage).not.toHaveBeenCalled();
      // React's double effect: started, stopped and started again leaves one timer
      kinds.listen();
      kinds.dispose();
      kinds.listen();
      expect(vi.getTimerCount()).toBe(1);
      // 1 s, 2, 4, 8, 16, then 30 s for good: asked at 1, 3, 7, 15, 31, 61 and 91 s
      await vi.advanceTimersByTimeAsync(120_000);
      expect(stage).toHaveBeenCalledTimes(7);
      expect(vi.getTimerCount()).toBe(1);
      // and at 121 s and 151 s: the ceiling holds
      await vi.advanceTimersByTimeAsync(999);
      expect(stage).toHaveBeenCalledTimes(7);
      await vi.advanceTimersByTimeAsync(1);
      expect(stage).toHaveBeenCalledTimes(8);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(stage).toHaveBeenCalledTimes(8);
      await vi.advanceTimersByTimeAsync(1);
      expect(stage).toHaveBeenCalledTimes(9);
      expect(vi.getTimerCount()).toBe(1);
      expect(replaceRenderer).not.toHaveBeenCalled();
      kinds.dispose();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(stage).toHaveBeenCalledTimes(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ITEM 476: the retry says it is asking at info at the first step of a run of refusals and at debug at each later step; a lane that opened starts the run over", async () => {
    vi.useFakeTimers();
    try {
      const loud = record("vendor.window-loud", { types: ["vendor.window-loud.dial"] });
      const mute = record("vendor.window-mute", { types: [] });
      nameUnstartedPlugin(loud.id, roomRefused);
      nameUnstartedPlugin(mute.id, roomRefused);
      const opened = prepared([mute]).staged;
      // refused whole three times; at the fourth firing the plugin with no kinds opens, alone
      let firings = 0;
      const stage = vi.fn(async () => {
        firings += 1;
        return { staged: firings === 4 ? opened : [], runtime: undefined };
      });
      // the level of each "asked again" line, in the order said
      const said: string[] = [];
      const say = (level: string) => (event: string) => {
        if (event === "renderer.plugins.kinds_lane_retry") said.push(level);
      };
      const logger: RendererLogger = {
        child: () => logger,
        trace: say("trace"),
        debug: say("debug"),
        info: say("info"),
        warn: say("warn"),
        error: say("error"),
        fatal: say("fatal"),
        isLevelEnabled: () => true,
      };
      const kinds = new WindowKinds(prepared([clock]), {
        stage,
        remountGeneration: vi.fn(),
        replaceRenderer: vi.fn(),
        logger,
      });
      await kinds.observe(snapshot(clock, loud, mute));
      kinds.listen();
      // asked at 1 s (the run's first step), 3 s, 7 s and 15 s: once at info, then at debug
      await vi.advanceTimersByTimeAsync(15_000);
      expect(stage).toHaveBeenCalledTimes(4);
      expect(said).toEqual(["info", "debug", "debug", "debug"]);
      // the fourth opened a lane, so the one still refused starts a run: at info at 16 s, and at
      // debug at 18 s
      await vi.advanceTimersByTimeAsync(1_000);
      expect(said).toEqual(["info", "debug", "debug", "debug", "info"]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(said).toEqual(["info", "debug", "debug", "debug", "info", "debug"]);
      expect(stage).toHaveBeenCalledTimes(6);
      kinds.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ITEM 476: a plugin turned off, or gone from the snapshot, leaves the window's set and the retry; turned on again it is the planner's", async () => {
    vi.useFakeTimers();
    try {
      const left = record("vendor.window-left", { types: ["vendor.window-left.dial"] });
      const gone = record("vendor.window-gone", { types: ["vendor.window-gone.dial"] });
      nameUnstartedPlugin(left.id, roomRefused);
      nameUnstartedPlugin(gone.id, { reason: "lane", room: false });
      const asked: string[] = [];
      const stage = vi.fn(async (ids: readonly string[]) => {
        asked.push(ids.join(","));
        return { staged: [], runtime: undefined };
      });
      const kinds = new WindowKinds(prepared([clock]), {
        stage,
        remountGeneration: vi.fn(),
        replaceRenderer: vi.fn(),
      });
      await kinds.observe(snapshot(clock, left, gone));
      expect(asked).toEqual([]);
      kinds.listen();
      expect(vi.getTimerCount()).toBe(1);
      // one turned off, the other uninstalled: both leave the set, and the timer with them
      const off = record("vendor.window-left", {
        enabled: false,
        types: ["vendor.window-left.dial"],
      });
      await kinds.observe(snapshot(clock, off));
      expect(getUnstartedPlugins().size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(asked).toEqual([]);
      // turned on again it is in no set: the planner's ordinary move (new to this realm: staged)
      await kinds.observe(snapshot(clock, left));
      expect(asked).toEqual(["vendor.window-left"]);
      kinds.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ITEM 476: for a staged plugin that is on, the set says what its controller holds at each snapshot; a module that would not import stays named through off and on", async () => {
    // a staged plugin whose activation the runtime moves after the loader staged it
    const held: { activation: { state: string } | null } = { activation: { state: "active" } };
    const moody = record("vendor.window-moody", { types: [] });
    const unloaded = record("vendor.window-unloaded", { types: [] });
    const base = prepared([moody, unloaded]);
    const staged = base.staged.map((s) =>
      s.record.id === moody.id
        ? ({
            ...s,
            controller: {
              get activation() {
                return held.activation;
              },
            },
          } as unknown as PreparedStagedPlugin)
        : s,
    );
    // the loader named the one whose module would not import (it has no controller)
    nameUnstartedPlugin(unloaded.id, { reason: "import" });
    const kinds = new WindowKinds(
      { ...base, staged },
      { stage: vi.fn(), remountGeneration: vi.fn(), replaceRenderer: vi.fn() },
    );
    await kinds.observe(snapshot(moody, unloaded));
    expect(getUnstartedPlugins().has(moody.id)).toBe(false);
    // the runtime's own activation of it fails (turned on again, an update's episode): no loader
    // saw it, and before item 476 nothing said it
    held.activation = { state: "failed" };
    await kinds.observe(snapshot(moody, unloaded));
    expect(getUnstartedPlugins().get(moody.id)).toEqual({ reason: "activation" });
    // nothing settled yet says nothing new; live again, it is named no more
    held.activation = null;
    await kinds.observe(snapshot(moody, unloaded));
    expect(getUnstartedPlugins().get(moody.id)).toEqual({ reason: "activation" });
    held.activation = { state: "active" };
    await kinds.observe(snapshot(moody, unloaded));
    expect(getUnstartedPlugins().has(moody.id)).toBe(false);
    // turned off, a failed activation leaves the set; the module that would not import stays
    // named through off and on, for it is still that
    held.activation = { state: "failed" };
    await kinds.observe(snapshot(moody, unloaded));
    const off = (r: PluginRecord): PluginRecord => ({ ...r, enabled: false, state: "disabled" });
    await kinds.observe(snapshot(off(moody), off(unloaded)));
    expect(getUnstartedPlugins().has(moody.id)).toBe(false);
    expect(getUnstartedPlugins().get(unloaded.id)).toEqual({ reason: "import" });
    held.activation = { state: "active" };
    await kinds.observe(snapshot(moody, unloaded));
    expect(getUnstartedPlugins().has(moody.id)).toBe(false);
    expect(getUnstartedPlugins().get(unloaded.id)).toEqual({ reason: "import" });
    // gone from the snapshot, it leaves
    await kinds.observe(snapshot(moody));
    expect(getUnstartedPlugins().size).toBe(0);
  });
});
