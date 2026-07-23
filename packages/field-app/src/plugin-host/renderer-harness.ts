import { PLUGIN_LIMITS, type PluginManifestV1 } from "@vibefield/contracts";
import type {
  Disposable,
  PluginLogger,
  RendererPluginContext,
  RendererPluginModule,
  WidgetBinding,
  WidgetRegistration,
} from "@vibefield/plugin-sdk";
import { createPluginProductClient } from "./plugin-client";

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
  const line =
    (fn: (msg: string) => void) =>
    (message: string, fields?: Record<string, unknown>): void => {
      fn(`[plugin:${id}] ${message}${fields !== undefined ? ` ${JSON.stringify(fields)}` : ""}`);
    };
  return {
    debug: line((m) => console.debug(m)),
    info: line((m) => console.info(m)),
    warn: line((m) => console.warn(m)),
    error: line((m) => console.error(m)),
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
    client: createPluginProductClient(manifest.id),
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
