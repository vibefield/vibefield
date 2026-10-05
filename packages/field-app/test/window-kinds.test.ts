// @vitest-environment node
/**
 * DK-9 — THE RUNTIME WITH KINDS (plugin-host/window-kinds.ts; ICE petition I25: a desk's kinds are the set it
 * was MOUNTED with, and a host that changes them remounts). What a registry snapshot asks of a window — the
 * planner, pure — and the store that carries it out: a plugin this renderer staged turned OFF or ON → the
 * desk remounts on its engine without or with its kinds (LAYER); one enabled that this renderer never
 * defined → staged, then the board reopens on a new engine (GENERATION); a kind this renderer defined
 * otherwise — an UPDATE's new artifact, a type a ghost stub defined faceless → the renderer is replaced
 * (RENDERER), never an update refused. A plugin mid-update moves when its episode settles.
 */
import type { PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildFacelessType } from "../src/plugin-host/build-widget";
import type {
  PreparedRendererPlugins,
  PreparedStagedPlugin,
} from "../src/plugin-host/staged-loader";
import { planKinds, type StagedIdentity, WindowKinds } from "../src/plugin-host/window-kinds";

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
  opts: { off?: readonly string[]; bundled?: readonly PluginRecord[]; updating?: string[] } = {},
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
});
