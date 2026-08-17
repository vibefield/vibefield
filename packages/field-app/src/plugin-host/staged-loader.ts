import {
  type PluginManifestV1,
  PluginModulesResult,
  type PluginModuleUrls,
  type PluginRecord,
  PluginRegistrySnapshot,
} from "@vibefield/contracts";
import type { RendererPluginModule } from "@vibefield/plugin-sdk";
import { getRendererLogger, type RendererLogger } from "../logging";
import { type PluginClientBackend, setPluginClientBackend } from "./plugin-client";
import { getPluginRegistrySnapshot } from "./plugin-registry-store";
import { RendererPluginController, RendererWindowController } from "./renderer-controller";
import type { ActivatedRenderer } from "./renderer-harness";

export { ensureStyleLink } from "./plugin-style";

// THE STAGED RENDERER LOADER (plugin spec §11.6/§10.4/§19.2, P8b-3) — the
// consumer half of the pipeline P8b-1 and P8b-2 built.
//
// fieldd decides what may load and answers `plugins.modules` with approved,
// path-free URLs on `vibefield-plugin://<token>`; Electron main serves the bytes
// for a token fieldd authorized; this module imports them. The renderer never
// sees a filesystem path, never names a plugin to load, and cannot widen the
// set — it asks the authority and consumes the answer.
//
// IT RUNS BEHIND THE SPLASH, AND IT IS ON A CLOCK. buildRegistry is synchronous
// (one ICE engine generation, built in a memo), so every module must be imported
// and activated BEFORE the first one runs. That puts this work on the boot path,
// where design-03 §4.3's law applies: a daemon-side service never gates the
// reveal. So the whole ask is bounded — an unreachable or silent fieldd yields
// an EMPTY prepared set inside the budget and the field opens anyway, honestly
// short of plugins rather than never.

/** How long the whole ask gets — one budget for the two reads, not one each.
 *
 * fieldd is a local daemon the boot machine has ALREADY waited for (the
 * connection is established before this runs), so this is not a "is the daemon
 * up" timeout; it is the guarantee that a daemon which is up but not answering
 * cannot hold the splash. Loopback RPC round trips here are single-digit
 * milliseconds, so 3s is roughly two orders of magnitude of headroom and still
 * a delay a person would forgive once. */
export const STAGED_MODULES_BUDGET_MS = 3_000;

/** One plugin that fieldd approved, whose module was imported and activated. */
export interface PreparedStagedPlugin {
  /** the sanitized registry record — the renderer's registration authority */
  readonly record: PluginRecord;
  /** the approved module row this activation belongs to (§11.4 identity) */
  readonly module: PluginModuleUrls;
  readonly activation: ActivatedRenderer;
  /** Exact plugin/window lifecycle controller for this imported artifact. */
  readonly controller?: RendererPluginController;
}

/** What the boot phase hands buildRegistry. `bundled` is the DEV-ONLY fallback
 * (P8-D2) and is empty in every production build. */
export interface PreparedRendererPlugins {
  /** fieldd's registry generation these rows were minted under, or -1 when the
   * staged path produced nothing (no daemon, no answer, no approved modules). */
  readonly generation: number;
  readonly staged: readonly PreparedStagedPlugin[];
  readonly bundled: readonly BundledRendererPlugin[];
  /** Present for a staged production set; attached to registry observations after mount and closed
   * at the window's prepare-close barrier. */
  readonly runtime?: RendererWindowController;
}

/** A dev-bundled pair, kept structural so field-engine owns the imports. */
export interface BundledRendererPlugin {
  readonly manifest: PluginManifestV1;
  readonly mod: RendererPluginModule;
  /** Prepared by the app boot path when a dev fallback needs window-owned behavior intent. */
  readonly activation?: ActivatedRenderer;
}

export const EMPTY_PREPARED: PreparedRendererPlugins = {
  generation: -1,
  staged: [],
  bundled: [],
};

export interface StagedLoaderDeps {
  /** One-shot RPC against the window's own fieldd connection. */
  request(method: string, params?: unknown): Promise<unknown>;
  /** Makes ctx.client usable during activate, before FieldView effects mount. */
  pluginClientBackend?: PluginClientBackend;
  /** The registry snapshot, if the renderer already holds one. At BOOT it does
   * not — `usePluginRegistryFeed` mounts inside FieldView, which is downstream
   * of this call — so the default returns null and the loader reads
   * `plugins.list` itself. Injected so a test can supply either world. */
  snapshot?(): PluginRegistrySnapshot | null;
  /** The import seam. Defaults to a real dynamic import; tests replace it so
   * they never need a live protocol handler behind a URL. */
  importModule?(url: string): Promise<unknown>;
  /** Where stylesheet links land. Defaults to the live document. */
  document?: Document;
  /** Exact renderer instance identity. V1 has one honest window named `field`. */
  windowId?: string;
  budgetMs?: number;
}

/** THE ASK, bounded. Resolves with whatever was ready in time — never rejects,
 * because the caller is the boot path and there is no failure here that should
 * be allowed to become a hung splash. */
export async function prepareRendererPlugins(
  deps: StagedLoaderDeps,
): Promise<PreparedRendererPlugins> {
  if (deps.pluginClientBackend !== undefined) setPluginClientBackend(deps.pluginClientBackend);
  const log = getRendererLogger().child({ component: "plugin.host" });
  const budgetMs = deps.budgetMs ?? STAGED_MODULES_BUDGET_MS;
  const approved = await withBudget(readApproved(deps), budgetMs);
  if (approved === "overdue") {
    log.warn(
      "renderer.plugins.staged_budget_exceeded",
      "The plugin authority did not answer in time; the field opened without staged plugins",
      { budgetMs },
    );
    return EMPTY_PREPARED;
  }
  if (approved === null) return EMPTY_PREPARED;
  const { generation, modules, records } = approved;
  if (modules.length === 0) return { generation, staged: [], bundled: [] };
  const runtime = new RendererWindowController(deps.windowId);

  // Imports run in parallel and one plugin's failure is its own (§11.4): a
  // module that will not load leaves the others staged rather than emptying the
  // set. The activation the harness returns for a failure is a `failed` row,
  // which is what buildRegistry needs to draw honest failed faces.
  const staged = await Promise.all(
    modules.map(async (module) => await stageOne(module, records, deps, log, runtime)),
  );
  return {
    generation,
    staged: staged.filter((entry): entry is PreparedStagedPlugin => entry !== null),
    bundled: [],
    runtime,
  };
}

interface ApprovedSet {
  readonly generation: number;
  readonly modules: readonly PluginModuleUrls[];
  readonly records: ReadonlyMap<string, PluginRecord>;
}

/** Both reads, in parallel, tolerantly parsed. Returns null when the authority
 * could not be read at all — indistinguishable, on purpose, from "it approved
 * nothing": both mean this renderer stages no plugins right now. */
async function readApproved(deps: StagedLoaderDeps): Promise<ApprovedSet | null> {
  const held = (deps.snapshot ?? getPluginRegistrySnapshot)();
  try {
    const [rawModules, rawSnapshot] = await Promise.all([
      deps.request("plugins.modules"),
      held !== null ? Promise.resolve(null) : deps.request("plugins.list"),
    ]);
    const parsedModules = PluginModulesResult.safeParse(rawModules);
    if (!parsedModules.success) return null;
    const snapshot =
      held ?? (rawSnapshot === null ? null : PluginRegistrySnapshot.safeParse(rawSnapshot).data);
    const records = new Map<string, PluginRecord>();
    for (const record of snapshot?.plugins ?? []) records.set(record.id, record);
    return {
      generation: parsedModules.data.generation,
      modules: parsedModules.data.modules,
      records,
    };
  } catch {
    // A daemon that refused, dropped, or never answered is the same answer as
    // an empty approval list, and the field opens either way.
    return null;
  }
}

async function stageOne(
  module: PluginModuleUrls,
  records: ReadonlyMap<string, PluginRecord>,
  deps: StagedLoaderDeps,
  log: RendererLogger,
  runtime: RendererWindowController,
): Promise<PreparedStagedPlugin | null> {
  const record = records.get(module.pluginId);
  if (record === undefined) {
    // The two reads disagree — a plugin was approved that the snapshot does not
    // describe. Its declarations ARE its registration (§12.2), so there is
    // nothing to register it as; skipped loudly rather than half-loaded.
    log.warn(
      "renderer.plugins.staged_record_missing",
      "An approved plugin module has no registry record and was skipped",
      { pluginId: module.pluginId },
    );
    return null;
  }
  const importModule = deps.importModule ?? defaultImport;
  let imported: unknown;
  try {
    imported = await importModule(module.moduleUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error(
      "renderer.plugins.staged_import_failed",
      "A staged plugin module could not be imported",
      error,
      { pluginId: module.pluginId },
    );
    return {
      record,
      module,
      activation: { state: "failed", bindings: new Map(), behaviors: new Map(), error: detail },
    };
  }
  const mod = asRendererModule(imported);
  if (mod === null) {
    log.error(
      "renderer.plugins.staged_module_shape",
      "A staged plugin module exports no activate (§10.1)",
      undefined,
      { pluginId: module.pluginId },
    );
    return {
      record,
      module,
      activation: {
        state: "failed",
        bindings: new Map(),
        behaviors: new Map(),
        error: "the module exports no activate (§10.1)",
      },
    };
  }
  const doc = deps.document ?? (typeof document === "undefined" ? undefined : document);
  const controller = new RendererPluginController(record, module, mod, runtime.windowId, {
    ...(module.styleUrl === undefined || doc === undefined
      ? {}
      : { style: { document: doc, href: module.styleUrl } }),
  });
  runtime.add(controller);
  try {
    const activation =
      (await controller.reconcile(record)) ??
      ({
        state: "failed",
        bindings: new Map(),
        behaviors: new Map(),
        error: "renderer target is unavailable",
      } as const);
    return { record, module, activation, controller };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error(
      "renderer.plugins.staged_activation_failed",
      "A staged plugin module could not be activated",
      error,
      { pluginId: module.pluginId },
    );
    return {
      record,
      module,
      activation: { state: "failed", bindings: new Map(), behaviors: new Map(), error: detail },
      controller,
    };
  }
}

/** The §10.1 module shape, from either spelling: a namespace carrying
 * `activate`, or one whose `default` does. Nothing else is a plugin module. */
function asRendererModule(imported: unknown): RendererPluginModule | null {
  const candidates = [
    imported,
    typeof imported === "object" && imported !== null
      ? (imported as { default?: unknown }).default
      : undefined,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { activate?: unknown }).activate === "function"
    ) {
      return candidate as RendererPluginModule;
    }
  }
  return null;
}

/** The real import. The vite-ignore hint is required, not decorative: the URL
 * is DATA from the daemon, so the bundler must be told not to analyse it as a
 * build-time specifier and try to resolve a chunk for it. */
async function defaultImport(url: string): Promise<unknown> {
  return await import(/* @vite-ignore */ url);
}

/** Resolve with the work's answer, or the string "overdue" once the budget is
 * spent. The work is NOT cancelled — there is nothing to cancel an in-flight
 * RPC with — it is simply no longer waited on. */
async function withBudget<T>(work: Promise<T>, budgetMs: number): Promise<T | "overdue"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T | "overdue">([
      work,
      new Promise<"overdue">((resolve) => {
        timer = setTimeout(() => resolve("overdue"), budgetMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
