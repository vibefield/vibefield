import { PLUGIN_LIMITS, type PluginManifestV1 } from "@vibefield/contracts";
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
// P3a boundaries, recorded honestly (thinking-p3): bundled modules ride the
// app bundle and activate SYNCHRONOUSLY inside buildRegistry — an async
// activate is refused (memoized failure), because a half-awaited activation
// would register zero widgets silently. The staged import-map loader (§19.2)
// brings the real async path with the §10.4 deadline race; until then the
// deadline is measured and logged, not preempted (sync JS cannot be).

export interface ActivatedRenderer {
  state: "active" | "failed";
  bindings: ReadonlyMap<string, WidgetBinding>;
  error?: string;
}

const activated = new Map<string, ActivatedRenderer>();

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

export function activateRenderer(
  manifest: PluginManifestV1,
  mod: RendererPluginModule,
): ActivatedRenderer {
  const cached = activated.get(manifest.id);
  if (cached !== undefined) return cached;

  const declared = new Set((manifest.contributes?.widgets ?? []).map((w) => w.type));
  // §8.3/§8.4 declared contributions — the manifest is the always-available
  // authority (the fieldd snapshot may be null at boot; two-plane law). Commands
  // and surfaces bind only ids the manifest declares; a surface's SLOT is
  // manifest truth (a component cannot choose its slot — §13.2).
  const declaredCommands = new Set((manifest.contributes?.commands ?? []).map((c) => c.id));
  const declaredSurfaces = new Map(
    (manifest.contributes?.surfaces ?? []).map((s) => [
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
    manifest.capabilities.includes("canvas.read") || manifest.capabilities.includes("canvas.write");
  const client = createPluginProductClient(manifest.id);
  const bindings = new Map<string, WidgetBinding>();
  const resources: Disposable[] = [];
  const controller = new AbortController();
  const logger = makeLogger(manifest.id);
  const ctx: RendererPluginContext = {
    plugin: { id: manifest.id, version: manifest.version },
    signal: controller.signal,
    logger,
    widgets: {
      register(registration: WidgetRegistration): Disposable {
        if (controller.signal.aborted)
          throw new Error(`${manifest.id}: register after activation ended`);
        if (!declared.has(registration.type))
          throw new Error(`${registration.type} is not declared by ${manifest.id} (§12.1)`);
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
                throw new Error(`${manifest.id}: register after activation ended`);
              if (!declaredCommands.has(commandId))
                throw new Error(`${commandId} is not declared by ${manifest.id} (§8.3)`);
              const disp = commandRegistry.register(manifest.id, commandId, handler);
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
                throw new Error(`${manifest.id}: register after activation ended`);
              const decl = declaredSurfaces.get(surfaceId);
              if (decl === undefined)
                throw new Error(`${surfaceId} is not declared by ${manifest.id} (§8.4)`);
              const disp = surfaceRegistry.register(
                manifest.id,
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
    // P5 — present iff the manifest requests storage.self (§10.2 absent-API law)
    ...(manifest.capabilities.includes("storage.self") ? createStorageSurfaces(client) : {}),
    track<T extends Disposable>(resource: T): T {
      resources.push(resource);
      return resource;
    },
  };

  try {
    const started = performance.now();
    const result = mod.activate(ctx);
    if (isThenable(result)) {
      controller.abort();
      const failed: ActivatedRenderer = {
        state: "failed",
        bindings: new Map(),
        error: "async activate needs the staged loader (§19.2) — bundled activation is sync",
      };
      activated.set(manifest.id, failed); // deterministic — retrying cannot help
      logger.error(failed.error ?? "");
      return failed;
    }
    const elapsed = performance.now() - started;
    if (elapsed > PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS)
      logger.warn(`activate took ${Math.round(elapsed)}ms — over the §10.4 deadline`);
    if (result !== undefined && result !== null) resources.push(result);
    const ok: ActivatedRenderer = { state: "active", bindings };
    activated.set(manifest.id, ok);
    return ok;
  } catch (error) {
    controller.abort();
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`activation failed: ${message}`);
    // not memoized — a board reopen retries (§11.4's user-triggered retry)
    return { state: "failed", bindings: new Map(), error: message };
  }
}

/** Renderer-side activation state for diagnostics surfaces (panel, tests). */
export function rendererActivationState(id: string): ActivatedRenderer | undefined {
  return activated.get(id);
}
