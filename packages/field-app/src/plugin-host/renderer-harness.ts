import {
  type CommandContribution,
  PLUGIN_LIMITS,
  type PluginManifestV1,
  type PluginModuleUrls,
  type PluginRecord,
  type SurfaceContribution,
  type WidgetContribution,
} from "@vibefield/contracts";
import {
  type CommandInvocation,
  createStorageSurfaces,
  type Disposable,
  type PluginLogger,
  type PluginSurfaceProps,
  type RendererPluginContext,
  type RendererPluginModule,
  type WidgetBinding,
  type WidgetRegistration,
} from "@vibefield/plugin-sdk";
import type { ComponentType } from "react";
import { getRendererLogger } from "../logging";
import { getActiveCanvasEngine } from "./canvas-engine-ref";
import * as commandRegistry from "./command-registry";
import { createPluginProductClient } from "./plugin-client";
import * as surfaceRegistry from "./surface-registry";

// The host-owned renderer harness (spec §10.3, P3a): construct the context,
// invoke activate, validate registrations (§12.1 — declared-by-this-plugin,
// no double-bind), isolate failures. One activation per plugin per renderer
// process — the retired import-side-effect semantic, like build-widget's
// `built` map. A THROWN activation is NOT memoized: the next buildRegistry
// (board open/switch) retries — §11.4's one user-triggered retry, no extra UI.
//
// TWO ENTRY PATHS, ONE CONTEXT (P8b-3). The staged loader (§19.2) imports a
// plugin's own artifact and AWAITS activate under §10.4's deadline; the dev-only
// bundled path still activates SYNCHRONOUSLY inside buildRegistry and still
// refuses a thenable, because a half-awaited activation there would register
// zero widgets silently and nothing is waiting to notice. Both build their
// context through `buildActivation` — the declared⇄bound laws (§12.1), the
// absent-API law (§10.2), and the capability gates are written once, so the
// path a plugin arrives by cannot change what it is allowed to do.

export interface ActivatedRenderer {
  state: "active" | "failed";
  bindings: ReadonlyMap<string, WidgetBinding>;
  error?: string;
}

const activated = new Map<string, ActivatedRenderer>();

/** What the harness needs to build a context, from whichever authority the
 * caller holds: the canonical manifest (bundled) or the sanitized registry
 * record plus its approved module row (staged). Capabilities are the REQUESTED
 * set in both cases — see the §12.7 stopgap note below. */
interface ActivationSpec {
  readonly id: string;
  readonly version: string;
  readonly widgets: readonly WidgetContribution[];
  readonly commands: readonly CommandContribution[];
  readonly surfaces: readonly SurfaceContribution[];
  readonly capabilities: readonly string[];
  readonly manifestHash?: string;
  readonly installRevision?: string;
}

function specFromManifest(manifest: PluginManifestV1): ActivationSpec {
  return {
    id: manifest.id,
    version: manifest.version,
    widgets: manifest.contributes?.widgets ?? [],
    commands: manifest.contributes?.commands ?? [],
    surfaces: manifest.contributes?.surfaces ?? [],
    capabilities: manifest.capabilities,
  };
}

function specFromRecord(record: PluginRecord, module: PluginModuleUrls): ActivationSpec {
  return {
    id: record.id,
    version: record.version,
    widgets: record.contributions.widgets,
    commands: record.contributions.commands,
    surfaces: record.contributions.surfaces,
    // §9.4's record splits requested from granted; the harness gates on
    // REQUESTED for the same reason the manifest path does (see §12.7 below).
    capabilities: record.requestedCapabilities,
    manifestHash: module.manifestHash,
    installRevision: module.installRevision,
  };
}

function makeLogger(id: string): PluginLogger {
  const route = getRendererLogger().child({ component: "plugin.renderer", pluginId: id });
  return {
    debug: (message, fields) => route.debug("plugin.log", message, fields),
    info: (message, fields) => route.info("plugin.log", message, fields),
    warn: (message, fields) => route.warn("plugin.log", message, fields),
    error: (message, fields) => route.error("plugin.log", message, undefined, fields),
  };
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (
    typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function"
  );
}

/** The live pieces of one activation attempt: the context handed to the plugin
 * plus the handles the harness needs to end it (§18.1 — a failed activation
 * disposes what it already registered rather than leaving it bound). */
interface Activation {
  readonly ctx: RendererPluginContext;
  readonly bindings: Map<string, WidgetBinding>;
  readonly resources: Disposable[];
  readonly controller: AbortController;
  readonly logger: PluginLogger;
}

/** End an attempt: no more registrations, and everything it tracked is
 * released. Disposal errors are swallowed on purpose — this runs on the failure
 * path, and a resource that throws on the way out must not replace the real
 * reason with its own. */
function endActivation(attempt: Activation): void {
  attempt.controller.abort();
  for (const resource of attempt.resources.splice(0)) {
    try {
      void resource.dispose();
    } catch {
      /* the reason for the failure is already known; this is cleanup */
    }
  }
  attempt.bindings.clear();
}

function buildActivation(spec: ActivationSpec): Activation {
  const declared = new Set(spec.widgets.map((w) => w.type));
  // §8.3/§8.4 declared contributions — the DECLARATION is the always-available
  // authority (the fieldd snapshot may be null at boot; two-plane law). Commands
  // and surfaces bind only ids the plugin declares; a surface's SLOT is declared
  // truth (a component cannot choose its slot — §13.2).
  const declaredCommands = new Set(spec.commands.map((c) => c.id));
  const declaredSurfaces = new Map(
    spec.surfaces.map((s) => [
      s.id,
      {
        slot: s.slot,
        title: s.title,
        ...(s.icon !== undefined ? { icon: s.icon } : {}),
        order: s.order ?? 0,
      },
    ]),
  );
  // §12.7 STOPGAP gate: mirror the storage.self pattern — key on the REQUESTED
  // capability (the manifest ceiling). The daemon's caller matrix enforces the
  // granted set for fabric calls; the canvas handle is an in-renderer direct
  // engine reference with no daemon behind it, so requested-capability is the
  // honest v1 signal (recorded — the curated PA-27 tier will gate on grants).
  const hasCanvas =
    spec.capabilities.includes("canvas.read") || spec.capabilities.includes("canvas.write");
  const client = createPluginProductClient(spec.id);
  const bindings = new Map<string, WidgetBinding>();
  const resources: Disposable[] = [];
  const controller = new AbortController();
  const logger = makeLogger(spec.id);
  const ctx: RendererPluginContext = {
    // §11.4 — the staged loader knows which approved artifact this activation
    // belongs to and says so; the bundled path has neither field to offer and
    // omits them rather than inventing a hash for code that was never installed.
    plugin: {
      id: spec.id,
      version: spec.version,
      ...(spec.manifestHash !== undefined ? { manifestHash: spec.manifestHash } : {}),
      ...(spec.installRevision !== undefined ? { installRevision: spec.installRevision } : {}),
    },
    signal: controller.signal,
    logger,
    widgets: {
      register(registration: WidgetRegistration): Disposable {
        if (controller.signal.aborted)
          throw new Error(`${spec.id}: register after activation ended`);
        if (!declared.has(registration.type))
          throw new Error(`${registration.type} is not declared by ${spec.id} (§12.1)`);
        if (bindings.has(registration.type))
          throw new Error(`${registration.type} already bound in this entry (§12.1)`);
        bindings.set(registration.type, registration.binding);
        return {
          dispose() {
            bindings.delete(registration.type);
          },
        };
      },
    },
    // §11.2: every call this plugin makes rides its own leased connection —
    // the plugin principal, not the window's. Lazy: idle plugins cost nothing.
    client,
    // P6 §8.3/§13.1 — commands present iff the manifest declares them (§10.2).
    // The handler table is spine-owned (command-registry); each registration is
    // tracked so deactivation disposes it (§18.1).
    ...(declaredCommands.size > 0
      ? {
          commands: {
            register(
              commandId: string,
              handler: (args: unknown, invocation: CommandInvocation) => void | Promise<void>,
            ): Disposable {
              if (controller.signal.aborted)
                throw new Error(`${spec.id}: register after activation ended`);
              if (!declaredCommands.has(commandId))
                throw new Error(`${commandId} is not declared by ${spec.id} (§8.3)`);
              const disp = commandRegistry.register(spec.id, commandId, handler);
              resources.push(disp);
              return disp;
            },
          },
        }
      : {}),
    // P6 §8.4/§13.2 — surfaces present iff declared. The harness resolves the
    // manifest-declared slot; the registry owns slot policy (godview refused).
    ...(declaredSurfaces.size > 0
      ? {
          surfaces: {
            register(surfaceId: string, component: ComponentType<PluginSurfaceProps>): Disposable {
              if (controller.signal.aborted)
                throw new Error(`${spec.id}: register after activation ended`);
              const decl = declaredSurfaces.get(surfaceId);
              if (decl === undefined)
                throw new Error(`${surfaceId} is not declared by ${spec.id} (§8.4)`);
              const disp = surfaceRegistry.register(
                spec.id,
                surfaceId,
                decl.slot,
                component,
                decl.order,
                decl.title,
                decl.icon,
              );
              resources.push(disp);
              return disp;
            },
          },
        }
      : {}),
    // P6 §12.7 STOPGAP — the least-power canvas handle, present iff canvas.read
    // or canvas.write is requested. Reads the live engine ref lazily (never
    // captured — a doc switch swaps the engine underneath).
    ...(hasCanvas ? { canvas: { engine: () => getActiveCanvasEngine() } } : {}),
    // P5 — present iff the plugin requests storage.self (§10.2 absent-API law)
    ...(spec.capabilities.includes("storage.self") ? createStorageSurfaces(client) : {}),
    track<T extends Disposable>(resource: T): T {
      resources.push(resource);
      return resource;
    },
  };

  return { ctx, bindings, resources, controller, logger };
}

/** DEV-ONLY since P8b-3 (P8-D2): the bundled module rides the app bundle and
 * activates synchronously inside buildRegistry. The thenable refusal below is
 * this path's alone and stays verbatim — nothing here awaits, so a promise
 * would be a plugin that registered nothing and no one to find out. */
export function activateRenderer(
  manifest: PluginManifestV1,
  mod: RendererPluginModule,
): ActivatedRenderer {
  const cached = activated.get(manifest.id);
  if (cached !== undefined) return cached;

  const attempt = buildActivation(specFromManifest(manifest));
  try {
    const started = performance.now();
    const result = mod.activate(attempt.ctx);
    if (isThenable(result)) {
      endActivation(attempt);
      const failed: ActivatedRenderer = {
        state: "failed",
        bindings: new Map(),
        error: "async activate needs the staged loader (§19.2) — bundled activation is sync",
      };
      activated.set(manifest.id, failed); // deterministic — retrying cannot help
      attempt.logger.error(failed.error ?? "");
      return failed;
    }
    const elapsed = performance.now() - started;
    if (elapsed > PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS)
      attempt.logger.warn(`activate took ${Math.round(elapsed)}ms — over the §10.4 deadline`);
    if (result !== undefined && result !== null) attempt.resources.push(result);
    const ok: ActivatedRenderer = { state: "active", bindings: attempt.bindings };
    activated.set(manifest.id, ok);
    return ok;
  } catch (error) {
    endActivation(attempt);
    const message = error instanceof Error ? error.message : String(error);
    attempt.logger.error(`activation failed: ${message}`);
    // not memoized — a board reopen retries (§11.4's user-triggered retry)
    return { state: "failed", bindings: new Map(), error: message };
  }
}

/** Which half of the §10.4 race answered first. A tagged pair rather than a
 * sentinel value: `activate` resolving with nothing is a normal success, so
 * "settled with undefined" and "never settled" have to stay distinguishable. */
type RacedActivation =
  | { readonly settled: true; readonly value: void | Disposable }
  | { readonly settled: false };

/** THE STAGED PATH (§19.2 + §10.4): the module came from the plugin's own
 * approved artifact, so `activate` may be async and this awaits it under the
 * deadline rather than merely measuring it.
 *
 * The deadline is a RACE, not a timer that logs afterwards: on the miss the
 * controller aborts (registrations made later are refused by the context's own
 * guards) and everything already tracked is disposed, so a plugin that never
 * settles cannot leave half-bound widgets behind. That failure is NOT memoized
 * — a deadline says something about this machine at this moment, not about the
 * plugin, and the next boot is entitled to a fresh answer. A plugin that THREW
 * is not memoized either, for §11.4's reason; only the sync path's thenable
 * refusal is, because that one is deterministic. */
export async function activateStagedRenderer(
  record: PluginRecord,
  module: PluginModuleUrls,
  mod: RendererPluginModule,
): Promise<ActivatedRenderer> {
  const cached = activated.get(record.id);
  if (cached !== undefined) return cached;

  const attempt = buildActivation(specFromRecord(record, module));
  const deadlineMs = PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race<RacedActivation>([
      Promise.resolve(mod.activate(attempt.ctx)).then(
        (value) => ({ settled: true, value }) as const,
      ),
      new Promise<RacedActivation>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), deadlineMs);
      }),
    ]);
    if (!raced.settled) {
      endActivation(attempt);
      const error = `activate exceeded the §10.4 renderer deadline (${deadlineMs}ms)`;
      attempt.logger.error(error);
      return { state: "failed", bindings: new Map(), error };
    }
    const result = raced.value;
    if (result !== undefined && result !== null) attempt.resources.push(result);
    const ok: ActivatedRenderer = { state: "active", bindings: attempt.bindings };
    activated.set(record.id, ok);
    return ok;
  } catch (error) {
    endActivation(attempt);
    const message = error instanceof Error ? error.message : String(error);
    attempt.logger.error(`activation failed: ${message}`);
    return { state: "failed", bindings: new Map(), error: message };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Renderer-side activation state for diagnostics surfaces (panel, tests). */
export function rendererActivationState(id: string): ActivatedRenderer | undefined {
  return activated.get(id);
}
