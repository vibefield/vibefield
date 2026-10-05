import type { PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import { getRendererLogger, type RendererLogger } from "../logging";
import { typeDefinition } from "./build-widget";
import type { RendererWindowController } from "./renderer-controller";
import type { PreparedRendererPlugins, PreparedStagedPlugin } from "./staged-loader";

// THE RUNTIME WITH KINDS (DK-9; ICE petition I25 — "the kind set is fixed for a layer's life: a host that
// changes its kinds — a plugin enabled, updated or removed — remounts the layer on a new generation, on a
// new engine when its catalog changes"). A window's kinds change at a plugin's enable, its disable and
// its update, and each is taken the one way this realm can take it — never a live registration, never an
// update refused:
//
//   LAYER — a plugin this realm STAGED is disabled, removed or enabled again: its types stay in the
//     engine's catalog (ICE's catalog cannot un-define one), so the DESK remounts on the same engine
//     with the kinds of what is on — a disabled plugin's objects wear ICE's MISSING face, pickable by
//     their box, the bar's words naming the type ("plugin off"; DK-D18 as amended), until the remount
//     that draws them again. The document is untouched (I25: the layer holds no document state).
//   GENERATION — a plugin enabled that this realm never defined: it is staged (imported, activated)
//     and the board REOPENS on a new engine whose catalog compiles its kinds (the B4 remount, the same
//     board and lane, behind the veil — DocManager.remount).
//   RENDERER — a kind this realm already defined some other way: an UPDATE's new code or schema
//     (`migrate` runs at the reopen), or a type a board's ghost stub defined faceless. ICE's catalog
//     cannot re-define a type in a realm (`defineWidget` throws "already defined", strata's components
//     are global), so the window saves its board and REPLACES its renderer, which reopens that board
//     (`vf-window-doc`) with the new kinds. ICE ask (named in DK-9's note): late registration — a type
//     re-defined for a new engine generation in a live realm, so an update remounts warm.

/** What a registry snapshot asks of the window (`planKinds`). */
export type KindsMove =
  | { readonly kind: "none" }
  /** remount the desk on its engine, mounted WITHOUT the kinds of `off` */
  | { readonly kind: "layer"; readonly off: ReadonlySet<string> }
  /** stage these plugins (new to this realm), then reopen the board on a new engine */
  | { readonly kind: "generation"; readonly stage: readonly string[] }
  /** a kind this realm defined otherwise: save the board and replace the renderer */
  | { readonly kind: "renderer"; readonly why: readonly string[] };

/** What a staged plugin is, as the planner reads it: its record at staging and its artifact. */
export interface StagedIdentity {
  readonly record: PluginRecord;
  readonly module: { readonly installRevision: string; readonly manifestHash: string };
}

const short = (revision: string): string => revision.slice(0, 12);

/**
 * THE PLAN, pure: what `snapshot` asks of a window whose realm staged `staged` (by plugin id), whose
 * dev-bundled fallback holds `bundled` (no artifact to compare — drawn while enabled), and whose desk is
 * mounted without `off` now. A plugin mid-update (`updating`) moves when its episode settles.
 */
export function planKinds(input: {
  readonly snapshot: PluginRegistrySnapshot;
  readonly staged: ReadonlyMap<string, StagedIdentity>;
  readonly bundled: ReadonlyMap<string, readonly string[]>;
  readonly off: ReadonlySet<string>;
  readonly updating?: (pluginId: string) => boolean;
}): KindsMove {
  const off = new Set<string>();
  const stage: string[] = [];
  const why: string[] = [];
  const types = (record: PluginRecord): string[] =>
    (record.contributions.objects ?? []).map((row) => row.type);
  for (const record of input.snapshot.plugins) {
    const rows = types(record);
    if (rows.length === 0) continue; // no kinds: nothing on the desk moves
    const staged = input.staged.get(record.id);
    const bundled = input.bundled.has(record.id);
    if (!record.enabled) {
      // a plugin this realm registered goes OFF the desk; one it never staged has no kind here to take off
      if (staged !== undefined || bundled) for (const type of rows) off.add(type);
      continue;
    }
    if (bundled) continue; // the dev fallback: drawn while enabled
    if (staged === undefined) {
      // NEW to this realm — unless a type of it is already defined here (a ghost stub, faceless)
      const clash = rows.filter((type) => typeDefinition(type) !== undefined);
      if (clash.length > 0)
        why.push(`${record.id} enabled: ${clash.join(", ")} already defined in this renderer`);
      else stage.push(record.id);
      continue;
    }
    if (
      staged.module.installRevision !== record.installRevision ||
      staged.module.manifestHash !== record.manifestHash
    ) {
      if (input.updating?.(record.id) === true) continue; // the update's episode settles first
      why.push(
        `${record.id} updated: ${short(staged.module.installRevision)} → ${short(record.installRevision)}`,
      );
    }
  }
  // a staged plugin whose record is gone (uninstalled): its objects wear the missing face
  for (const [id, staged] of input.staged) {
    if (input.snapshot.plugins.some((record) => record.id === id)) continue;
    for (const type of types(staged.record)) off.add(type);
  }
  if (why.length > 0) return { kind: "renderer", why };
  if (stage.length > 0) return { kind: "generation", stage };
  const same = off.size === input.off.size && [...off].every((type) => input.off.has(type));
  return same ? { kind: "none" } : { kind: "layer", off };
}

export interface WindowKindsDeps {
  /** Stage these plugins in this realm (import, activate — the staged loader's own path) on the window's
   * runtime — the boot's, or one made for them when the boot staged none. */
  stage(
    pluginIds: readonly string[],
    runtime: RendererWindowController | undefined,
  ): Promise<{
    readonly staged: readonly PreparedStagedPlugin[];
    readonly runtime: RendererWindowController | undefined;
  }>;
  /** Reopen the open board on a new engine (DocManager.remount — the same board and lane). */
  remountGeneration(reason: string): Promise<unknown>;
  /** Save the board and replace this renderer: it reopens its own board with the new kinds. */
  replaceRenderer(why: readonly string[]): void;
  /** A renderer update episode for this plugin is in flight (its move waits for it to settle). */
  updating?(pluginId: string): boolean;
  readonly logger?: RendererLogger;
}

/**
 * The window's kinds over its life: the plugin set each new generation builds its registry from
 * (`current()` — the boot's, grown by what a mid-session enable staged), the types the desk is mounted
 * WITHOUT (`off()`, a layer's), and the one serialized door every registry snapshot goes through
 * (`observe`).
 */
export class WindowKinds {
  private prepared: PreparedRendererPlugins;
  private offTypes: ReadonlySet<string> = new Set();
  private layer = 0;
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private last: PluginRegistrySnapshot | null = null;
  private replacing = false;
  private readonly log: RendererLogger;

  constructor(
    prepared: PreparedRendererPlugins,
    private readonly deps: WindowKindsDeps,
  ) {
    this.prepared = prepared;
    this.log = deps.logger ?? getRendererLogger().child({ component: "plugin.kinds" });
  }

  /** The plugin set the NEXT generation's registry is built from. */
  current(): PreparedRendererPlugins {
    return this.prepared;
  }

  /** The types whose kinds the desk is mounted WITHOUT (their objects wear the missing face). */
  off(): ReadonlySet<string> {
    return this.offTypes;
  }

  /** Bumps at every layer change — the stage remounts the desk on it. */
  version(): number {
    return this.layer;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The last snapshot again (an update's episode settled since). */
  again(): Promise<KindsMove> {
    return this.last === null ? Promise.resolve({ kind: "none" }) : this.observe(this.last);
  }

  /** Take one registry snapshot — serialized: a move in flight finishes before the next is planned. */
  observe(snapshot: PluginRegistrySnapshot): Promise<KindsMove> {
    this.last = snapshot;
    const task = this.queue.then(() => this.take(snapshot));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private plan(snapshot: PluginRegistrySnapshot): KindsMove {
    return planKinds({
      snapshot,
      staged: new Map(this.prepared.staged.map((s) => [s.record.id, s] as const)),
      bundled: new Map(
        this.prepared.bundled.map(
          (b) =>
            [b.manifest.id, (b.manifest.contributes?.objects ?? []).map((o) => o.type)] as const,
        ),
      ),
      off: this.offTypes,
      ...(this.deps.updating === undefined ? {} : { updating: this.deps.updating }),
    });
  }

  private async take(snapshot: PluginRegistrySnapshot): Promise<KindsMove> {
    if (this.replacing) return { kind: "none" };
    const move = this.plan(snapshot);
    switch (move.kind) {
      case "none":
        return move;
      case "layer":
        this.offTypes = move.off;
        this.layer += 1;
        this.log.info(
          "renderer.plugins.kinds_layer",
          "The desk remounts with the kinds of what is on",
          {
            off: [...move.off],
          },
        );
        for (const fn of [...this.listeners]) fn();
        return move;
      case "generation": {
        this.log.info(
          "renderer.plugins.kinds_generation",
          "Plugins enabled with kinds new to this renderer: staged, and the board reopens on a new engine",
          { plugins: [...move.stage] },
        );
        const { staged: added, runtime } = await this.deps.stage(move.stage, this.prepared.runtime);
        if (added.length > 0) {
          this.prepared = {
            ...this.prepared,
            staged: [...this.prepared.staged, ...added],
            ...(runtime === undefined ? {} : { runtime }),
          };
          // the generation's own registry is the new set's; the layer filter is recomputed for it
          const after = this.plan(snapshot);
          if (after.kind === "layer") this.offTypes = after.off;
          await this.deps.remountGeneration("plugin-enabled");
        }
        return move;
      }
      case "renderer":
        this.replacing = true;
        this.log.warn(
          "renderer.plugins.kinds_renderer",
          "A kind this renderer defined otherwise changed: the board is saved and the renderer replaced",
          { why: [...move.why] },
        );
        this.deps.replaceRenderer(move.why);
        return move;
    }
  }
}
