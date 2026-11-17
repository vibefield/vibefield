import type { PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import { reaskDelayMs } from "@vibefield/fieldd-client";
import { getRendererLogger, type RendererLogger } from "../logging";
import { typeDefinition } from "./build-widget";
import type { RendererWindowController } from "./renderer-controller";
import type { PreparedRendererPlugins, PreparedStagedPlugin } from "./staged-loader";
import {
  clearUnstartedPlugin,
  getUnstartedPlugins,
  nameUnstartedPlugin,
  subscribeUnstartedPlugins,
} from "./unstarted-plugins";

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
//
// A FAILED LANE IS THE RETRY'S, NOT THE PLANNER'S (item 476, item 490). A plugin whose update lane could
// not open is left UNSTAGED and named in the window's own set (staged-loader.ts, unstarted-plugins.ts),
// and while it is on the planner makes NO move for it. Before, the planner read it as any unstaged
// plugin at every registry snapshot: staged again by accident whenever the registry next changed, never
// on a clock; or, where a board's ghost stub had defined its type, answered with a renderer replace,
// whose new boot could fail the same lane and be replaced again at its first snapshot — a reload with
// no bound (item 490). The one who asks again is THE RETRY: one timer for the window, on the shared
// feed's own backoff (`reaskDelayMs`: 1 s, 2, 4, 8, 16, then every 30 s for as long as the window's
// kinds stand), each firing through the same serialized queue as a snapshot. It asks only a lane
// fieldd refused for ROOM (asking again cures no other failure), and only for a plugin none of whose
// types this realm defined: that one is staged the GENERATION's way and the board reopens once (a
// plugin with no kinds joins with no remount). A plugin whose type a stub already defined cannot be
// staged in this realm whatever its lane says, and a lane opened only to learn whether there is room
// would have fieldd count this window as running the plugin, so it is never asked: it says it isn't
// working, is tried at the window's next start, and turning it off and on is a person's own retry
// (off, it leaves the set; on, it is the planner's again). The retry never replaces a renderer.

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
 * mounted without `off` now. A plugin mid-update (`updating`) moves when its episode settles. A plugin
 * that is on, unstaged, and whose update lane failed in this window (`laneFailed`) moves nothing: it is
 * the retry's (item 476, item 490).
 */
export function planKinds(input: {
  readonly snapshot: PluginRegistrySnapshot;
  readonly staged: ReadonlyMap<string, StagedIdentity>;
  readonly bundled: ReadonlyMap<string, readonly string[]>;
  readonly off: ReadonlySet<string>;
  readonly updating?: (pluginId: string) => boolean;
  readonly laneFailed?: ReadonlySet<string>;
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
      // its lane failed: neither staged again at each snapshot nor, over a stub, a renderer replaced
      if (input.laneFailed?.has(record.id) === true) continue;
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

/** The plugins in the window's own set whose update lane failed (item 476), as the planner reads them. */
function laneFailed(): Set<string> {
  const ids = new Set<string>();
  for (const [id, why] of getUnstartedPlugins()) if (why.reason === "lane") ids.add(id);
  return ids;
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
 * (`observe`). Item 476: and the retry of a lane refused for room, one timer through that same door,
 * which runs between `listen()` and `dispose()` and never before or after.
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
  // the retry (item 476): whether it runs, its hold on the window's set, its one timer, the step of
  // the backoff the next wait is read at, and whether a firing is on the queue now
  private listening = false;
  private offUnstarted: (() => void) | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryStep = 0;
  private retrying = false;

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
      laneFailed: laneFailed(),
    });
  }

  private async take(snapshot: PluginRegistrySnapshot): Promise<KindsMove> {
    if (this.replacing) return { kind: "none" };
    // Item 476: the window's set follows the snapshot here, where it is taken (the planner is pure).
    // A plugin gone from it leaves the set. One turned off leaves it too when what failed was its
    // lane (turned on again it is the planner's ordinary move) or its activation (the runtime
    // activates it again, below); a module that would not import is still that when it is turned
    // on again, so it stays named, and its rows say it is off meanwhile.
    for (const [id, why] of getUnstartedPlugins()) {
      const record = snapshot.plugins.find((plugin) => plugin.id === id);
      if (record === undefined || (!record.enabled && why.reason !== "import")) {
        clearUnstartedPlugin(id);
      }
    }
    // A staged plugin's activation is the runtime's to move after the loader named it (turned on
    // again, an update's episode), and the runtime has converged on this snapshot before it is
    // taken (field.tsx). So for a plugin that is on, the set says what its controller holds NOW:
    // live, it is no longer named for its activation; not live, it is, though the loader never
    // saw that failure. One the loader staged with no controller (its import failed) is left as it
    // was named, and one mid-update is read when its episode settles (`again`).
    for (const staged of this.prepared.staged) {
      const record = snapshot.plugins.find((plugin) => plugin.id === staged.record.id);
      if (record === undefined || !record.enabled) continue;
      if (this.deps.updating?.(record.id) === true) continue;
      const now = staged.controller?.activation;
      if (now === undefined || now === null) continue;
      const named = getUnstartedPlugins().get(record.id);
      if (now.state === "active") {
        if (named?.reason === "activation") clearUnstartedPlugin(record.id);
      } else if (named === undefined) {
        nameUnstartedPlugin(record.id, { reason: "activation" });
      }
    }
    // the retry reads the last snapshot: one that turned a refused plugin on or off moves its timer
    this.rearm();
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
        // a renderer on its way out asks no lane again
        this.rearm();
        this.log.warn(
          "renderer.plugins.kinds_renderer",
          "A kind this renderer defined otherwise changed: the board is saved and the renderer replaced",
          { why: [...move.why] },
        );
        this.deps.replaceRenderer(move.why);
        return move;
    }
  }

  /**
   * Start the retry (item 476): hear the window's set, and arm the timer when it holds a plugin to
   * ask. Called from the effect that subscribes this window to the registry, never from the
   * constructor (React may make a WindowKinds it never mounts). `dispose()` ends it, and it may
   * start again after.
   */
  listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.retryStep = 0;
    this.offUnstarted = subscribeUnstartedPlugins(() => this.rearm());
    this.rearm();
  }

  /** Stop the retry: its timer cleared, the set no longer heard. A firing already on the queue asks
   * nothing. */
  dispose(): void {
    this.listening = false;
    this.offUnstarted?.();
    this.offUnstarted = undefined;
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retryStep = 0;
  }

  /**
   * The plugins the retry asks now: named for a lane refused for ROOM, on in the last snapshot, and
   * with no object type this realm already defined. A type a ghost stub defined cannot be re-defined
   * here, so staging its plugin would bring nothing back, and its lane is never opened only to learn
   * whether there is room (the head's rule). None while the renderer is being replaced.
   */
  private retryable(): string[] {
    const snapshot = this.last;
    if (snapshot === null || this.replacing) return [];
    const ids: string[] = [];
    for (const [id, why] of getUnstartedPlugins()) {
      if (why.reason !== "lane" || !why.room) continue;
      const record = snapshot.plugins.find((plugin) => plugin.id === id);
      if (record === undefined || !record.enabled) continue;
      const types = (record.contributions.objects ?? []).map((row) => row.type);
      if (types.some((type) => typeDefinition(type) !== undefined)) continue;
      ids.push(id);
    }
    return ids;
  }

  /** Arm the one timer while there is a plugin to ask, and clear it (the step with it) when there is
   * none. A timer that stands is left as it is: a second refused plugin joins the first one's wait. */
  private rearm(): void {
    if (!this.listening) return;
    if (this.retryable().length === 0) {
      if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      this.retryStep = 0;
      return;
    }
    if (this.retryTimer !== undefined || this.retrying) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.retrying = true;
      // through the snapshots' own queue: a retry never runs beside a move
      const pass = this.queue.then(() => this.retry());
      this.queue = pass.then(
        (opened) => this.retried(opened),
        (error) => {
          this.log.error(
            "renderer.plugins.kinds_lane_retry_failed",
            "A retry of plugins whose update lane was refused for room did not finish",
            error,
          );
          this.retried(false);
        },
      );
    }, reaskDelayMs(this.retryStep));
  }

  /** A firing ended: a lane that opened starts the backoff over, none takes its next step. */
  private retried(opened: boolean): void {
    this.retrying = false;
    this.retryStep = opened ? 0 : this.retryStep + 1;
    this.rearm();
  }

  /**
   * One firing of the retry: stage the plugins it asks exactly as the GENERATION move stages a
   * plugin (the staged loader's own path opens each lane, and closes one it does not stage). What
   * comes back joins the set the next generation builds from, and the board reopens ONCE if any of it
   * has object kinds; a plugin with none joins with no remount, for nothing on the desk moves. A
   * plugin still refused stays named and is asked at the next step. Answers whether a lane opened.
   */
  private async retry(): Promise<boolean> {
    if (!this.listening) return false;
    const ids = this.retryable();
    if (ids.length === 0) return false;
    // Said at info ONCE per run of refusals, at its first step, and at debug at each later one: a
    // plugin a holder never leaves room for is asked every 30 s for as long as that holder stays,
    // and a log at info is not written to at every firing. A lane that opens starts the run over.
    const asking = "Plugins whose update lane was refused for room are asked again";
    const attrs = { plugins: [...ids], step: this.retryStep };
    if (this.retryStep === 0) this.log.info("renderer.plugins.kinds_lane_retry", asking, attrs);
    else this.log.debug("renderer.plugins.kinds_lane_retry", asking, attrs);
    const { staged: added, runtime } = await this.deps.stage(ids, this.prepared.runtime);
    if (added.length === 0) return false;
    this.prepared = {
      ...this.prepared,
      staged: [...this.prepared.staged, ...added],
      ...(runtime === undefined ? {} : { runtime }),
    };
    for (const plugin of added) {
      // staged, its lane is open: no longer a lane's failure (the loader says so for one that is
      // live, and names one whose import or activation then failed for that instead)
      if (getUnstartedPlugins().get(plugin.record.id)?.reason === "lane") {
        clearUnstartedPlugin(plugin.record.id);
      }
    }
    if (added.some((plugin) => (plugin.record.contributions.objects ?? []).length > 0)) {
      // as the generation move: the layer filter is recomputed for the new set's registry
      if (this.last !== null) {
        const after = this.plan(this.last);
        if (after.kind === "layer") this.offTypes = after.off;
      }
      await this.deps.remountGeneration("plugin-enabled");
    }
    return true;
  }
}
