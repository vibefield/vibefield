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
  type ActivationCloseReason,
  type ActivationCloseReport,
  ActivationEffectSetupError,
  ActivationScope,
  type ActivationScopeSnapshot,
  InactiveActivationScopeError,
} from "@vibefield/plugin-runtime";
import {
  type CommandInvocation,
  createStorageSurfaces,
  type Disposable,
  type PluginLogger,
  type PluginProductClient,
  type PluginSettingsAPI,
  type PluginStorageAPI,
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

export type RendererActivationState = "active" | "failed" | "non-quiescent";

/** The successful activation's host-owned close handle. Close is a synchronous authority gate;
 * observation deadlines never stop or reorder cleanup. Import/shape failures happen before a
 * scope exists, so only those failure rows omit this surface. */
export interface RendererActivationLifetime {
  readonly signal: AbortSignal;
  close(reason: ActivationCloseReason): void;
  observe(deadlineMs?: number): Promise<ActivationCloseReport>;
  whenQuiescent(): Promise<ActivationCloseReport>;
  snapshot(): ActivationScopeSnapshot;
}

export interface ActivatedRenderer {
  readonly state: RendererActivationState;
  readonly bindings: ReadonlyMap<string, WidgetBinding>;
  readonly error?: string;
  readonly cleanup?: ActivationCloseReport;
  readonly lifetime?: RendererActivationLifetime;
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
  readonly grantGeneration?: number;
}

export interface RendererActivationDeps {
  /** Test/alternate transport seam. Production uses the plugin-principal client factory. */
  readonly productClient?: PluginProductClient;
  /** PRC-3d controller seam. The attempt keeps its own scope, but this owner closes it at the
   * controller's synchronous authority edge and awaits its quiescence during adapter cleanup. */
  readonly ownerScope?: ActivationScope;
  /** Controller-only hooks that keep ICE's stable facade honest when an open activation acquires
   * or releases a widget binding after its initial publication commit. */
  readonly validateWidgetBinding?: (type: string, binding: WidgetBinding) => void;
  readonly onWidgetBindingsChanged?: () => void;
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
    grantGeneration: record.grantGeneration,
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
  readonly contextFor: (scope: ActivationScope) => RendererPluginContext;
  readonly bindings: Map<string, WidgetBinding>;
  readonly commandBindings: Map<string, { token: symbol; handler: commandRegistry.CommandHandler }>;
  readonly surfaceBindings: Map<
    string,
    {
      token: symbol;
      component: ComponentType<PluginSurfaceProps>;
      slot: string;
      order: number;
      title: string;
      icon?: string;
    }
  >;
  readonly scope: ActivationScope;
  readonly lifetime: RendererActivationLifetime;
  readonly logger: PluginLogger;
  stagePublications(): RendererPublicationCandidate;
}

interface RendererPublicationCandidate extends Disposable {
  commit(): void;
  dispose(): void;
}

function assertScopeOpen(scope: ActivationScope): void {
  if (scope.state !== "open") throw new InactiveActivationScopeError(scope.label);
}

/** Publication withdrawal is a synchronous close-edge operation (§18.2), distinct from the
 * scope's later awaited LIFO cleanup. The wrapper starts the identity-bound inverse on abort,
 * then lets the ownership record await (and report) that same single-flight task in order. */
function ownPublication(
  scope: ActivationScope,
  label: string,
  publication: Disposable,
): Disposable {
  let withdrawal: Promise<void> | undefined;
  const withdraw = (): void => {
    if (withdrawal !== undefined) return;
    let resolveWithdrawal: (() => void) | undefined;
    let rejectWithdrawal: ((error: unknown) => void) | undefined;
    withdrawal = new Promise<void>((resolve, reject) => {
      resolveWithdrawal = resolve;
      rejectWithdrawal = reject;
    });
    // Attach before invoking plugin-adjacent disposal code so even a synchronous throw is handled.
    void withdrawal.catch(() => undefined);
    try {
      Promise.resolve(publication.dispose()).then(resolveWithdrawal, rejectWithdrawal);
    } catch (error) {
      rejectWithdrawal?.(error);
    }
  };
  const onAbort = (): void => withdraw();
  scope.signal.addEventListener("abort", onAbort, { once: true });
  return scope.track(label, {
    dispose() {
      scope.signal.removeEventListener("abort", onAbort);
      withdraw();
      return withdrawal ?? Promise.resolve();
    },
  });
}

function lifetimeFor(
  scope: ActivationScope,
  bindings: Map<string, WidgetBinding>,
): RendererActivationLifetime {
  return Object.freeze({
    signal: scope.signal,
    close(reason: ActivationCloseReason): void {
      scope.close(reason);
      // Widget implementations are a publication projection, not an inverse. Withdraw them at
      // the synchronous close edge while resource cleanup continues in strict LIFO order.
      bindings.clear();
    },
    observe: (deadlineMs?: number) => scope.observe(deadlineMs),
    whenQuiescent: () => scope.whenQuiescent(),
    snapshot: () => scope.snapshot(),
  });
}

function primaryErrorMessage(error: unknown): string {
  const primary = error instanceof ActivationEffectSetupError ? error.cause : error;
  return primary instanceof Error ? primary.message : String(primary);
}

function buildActivation(
  spec: ActivationSpec,
  deps: RendererActivationDeps = {},
  suppliedScope?: ActivationScope,
): Activation {
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
  const rawClient =
    deps.productClient ??
    createPluginProductClient(spec.id, {
      ...(spec.manifestHash !== undefined ? { manifestHash: spec.manifestHash } : {}),
      ...(spec.grantGeneration !== undefined ? { grantGeneration: spec.grantGeneration } : {}),
    });
  const rawStorage = spec.capabilities.includes("storage.self")
    ? createStorageSurfaces(rawClient)
    : undefined;
  const bindings = new Map<string, WidgetBinding>();
  const widgetGenerations = new Map<string, symbol>();
  const commandBindings = new Map<
    string,
    { token: symbol; handler: commandRegistry.CommandHandler }
  >();
  const surfaceBindings = new Map<
    string,
    {
      token: symbol;
      component: ComponentType<PluginSurfaceProps>;
      slot: string;
      order: number;
      title: string;
      icon?: string;
    }
  >();
  let stagedCommands: commandRegistry.CommandBindingCandidate | undefined;
  let stagedSurfaces: surfaceRegistry.SurfaceBindingCandidate | undefined;
  const scope =
    suppliedScope ??
    new ActivationScope(`renderer:${spec.id}`, {
      failureCleanupDeadlineMs: PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS,
    });
  const logger = makeLogger(spec.id);

  const contextFor = (ownedBy: ActivationScope): RendererPluginContext => {
    const assertOpen = (): void => assertScopeOpen(ownedBy);
    const guardedLogger: PluginLogger = Object.freeze({
      debug(message: string, fields?: Record<string, unknown>) {
        assertOpen();
        logger.debug(message, fields);
      },
      info(message: string, fields?: Record<string, unknown>) {
        assertOpen();
        logger.info(message, fields);
      },
      warn(message: string, fields?: Record<string, unknown>) {
        assertOpen();
        logger.warn(message, fields);
      },
      error(message: string, fields?: Record<string, unknown>) {
        assertOpen();
        logger.error(message, fields);
      },
    });

    const client: PluginProductClient = Object.freeze({
      request(method: string, params?: unknown) {
        assertOpen();
        return rawClient.request(method, params);
      },
      async subscribe(method: string, params: unknown, onEvent: (payload: unknown) => void) {
        assertOpen();
        const subscription = await rawClient.subscribe(method, params, (payload) => {
          if (ownedBy.state === "open") onEvent(payload);
        });
        let live = true;
        const release: Disposable = {
          dispose() {
            if (!live) return;
            live = false;
            subscription.unsubscribe();
          },
        };
        ownedBy.track(`client.subscribe:${method}`, release);
        return Object.freeze({
          snapshot: subscription.snapshot,
          unsubscribe() {
            void release.dispose();
          },
        });
      },
    });

    const settings: PluginSettingsAPI | undefined =
      rawStorage === undefined
        ? undefined
        : Object.freeze({
            get<T>(key: string): Promise<T | undefined> {
              assertOpen();
              return rawStorage.settings.get<T>(key);
            },
            set<T>(key: string, value: T): Promise<void> {
              assertOpen();
              return rawStorage.settings.set(key, value);
            },
            reset(key: string): Promise<void> {
              assertOpen();
              return rawStorage.settings.reset(key);
            },
            subscribe<T>(key: string, observer: (value: T | undefined) => void): Disposable {
              assertOpen();
              const resource = rawStorage.settings.subscribe<T>(key, (value) => {
                if (ownedBy.state === "open") observer(value);
              });
              return ownedBy.track(`settings.subscribe:${key}`, resource);
            },
          });

    const storage: PluginStorageAPI | undefined =
      rawStorage === undefined
        ? undefined
        : Object.freeze({
            kv: Object.freeze({
              get<T>(key: string): Promise<T | null> {
                assertOpen();
                return rawStorage.storage.kv.get<T>(key);
              },
              set<T>(key: string, value: T): Promise<void> {
                assertOpen();
                return rawStorage.storage.kv.set(key, value);
              },
              delete(key: string): Promise<void> {
                assertOpen();
                return rawStorage.storage.kv.delete(key);
              },
              list(prefix?: string): Promise<string[]> {
                assertOpen();
                return rawStorage.storage.kv.list(prefix);
              },
            }),
          });

    function track<T extends Disposable>(resource: T): T;
    function track<T extends Disposable>(label: string, resource: T): T;
    function track<T extends Disposable>(labelOrResource: string | T, resource?: T): T {
      return typeof labelOrResource === "string"
        ? ownedBy.track(labelOrResource, resource as T)
        : ownedBy.track(labelOrResource);
    }

    const ctx: RendererPluginContext = Object.freeze({
      // §11.4 — the staged loader knows which approved artifact this activation belongs to and
      // says so; the bundled path omits identity it cannot honestly supply.
      plugin: Object.freeze({
        id: spec.id,
        version: spec.version,
        ...(spec.manifestHash !== undefined ? { manifestHash: spec.manifestHash } : {}),
        ...(spec.installRevision !== undefined ? { installRevision: spec.installRevision } : {}),
      }),
      signal: ownedBy.signal,
      logger: guardedLogger,
      widgets: Object.freeze({
        register(registration: WidgetRegistration): Disposable {
          assertOpen();
          if (!declared.has(registration.type))
            throw new Error(`${registration.type} is not declared by ${spec.id} (§12.1)`);
          if (bindings.has(registration.type))
            throw new Error(`${registration.type} already bound in this entry (§12.1)`);
          deps.validateWidgetBinding?.(registration.type, registration.binding);
          const generation = Symbol(registration.type);
          widgetGenerations.set(registration.type, generation);
          bindings.set(registration.type, registration.binding);
          deps.onWidgetBindingsChanged?.();
          const resource: Disposable = {
            dispose() {
              if (widgetGenerations.get(registration.type) !== generation) return;
              widgetGenerations.delete(registration.type);
              bindings.delete(registration.type);
              deps.onWidgetBindingsChanged?.();
            },
          };
          return ownPublication(ownedBy, `widget:${registration.type}`, resource);
        },
      }),
      // §11.2: every call rides the plugin's own lazy product connection, with the child scope's
      // activity gate wrapped around it.
      client,
      ...(declaredCommands.size > 0
        ? {
            commands: Object.freeze({
              register(
                commandId: string,
                handler: (args: unknown, invocation: CommandInvocation) => void | Promise<void>,
              ): Disposable {
                assertOpen();
                if (!declaredCommands.has(commandId))
                  throw new Error(`${commandId} is not declared by ${spec.id} (§8.3)`);
                const guardedHandler = (args: unknown, invocation: CommandInvocation) => {
                  assertOpen();
                  return handler(args, invocation);
                };
                if (commandBindings.has(commandId))
                  throw new Error(`command ${commandId} already bound in this entry (§8.3)`);
                const token = Symbol(commandId);
                commandBindings.set(commandId, { token, handler: guardedHandler });
                try {
                  stagedCommands?.bind({ commandId, handler: guardedHandler });
                } catch (error) {
                  commandBindings.delete(commandId);
                  throw error;
                }
                const resource: Disposable = {
                  dispose() {
                    if (commandBindings.get(commandId)?.token === token) {
                      commandBindings.delete(commandId);
                      // Explicit disposal while live withdraws one row. During a scope close the
                      // root publication candidate withdraws the whole batch atomically below.
                      if (ownedBy.state === "open") stagedCommands?.withdraw(commandId);
                    }
                  },
                };
                return ownPublication(ownedBy, `command:${commandId}`, resource);
              },
            }),
          }
        : {}),
      ...(declaredSurfaces.size > 0
        ? {
            surfaces: Object.freeze({
              register(
                surfaceId: string,
                component: ComponentType<PluginSurfaceProps>,
              ): Disposable {
                assertOpen();
                const decl = declaredSurfaces.get(surfaceId);
                if (decl === undefined)
                  throw new Error(`${surfaceId} is not declared by ${spec.id} (§8.4)`);
                if (surfaceBindings.has(surfaceId))
                  throw new Error(`surface ${surfaceId} already bound in this entry (§13.2)`);
                const token = Symbol(surfaceId);
                surfaceBindings.set(surfaceId, {
                  token,
                  component,
                  slot: decl.slot,
                  order: decl.order,
                  title: decl.title,
                  ...(decl.icon === undefined ? {} : { icon: decl.icon }),
                });
                try {
                  stagedSurfaces?.bind({
                    surfaceId,
                    component,
                    slot: decl.slot,
                    order: decl.order,
                    title: decl.title,
                    ...(decl.icon === undefined ? {} : { icon: decl.icon }),
                  });
                } catch (error) {
                  surfaceBindings.delete(surfaceId);
                  throw error;
                }
                const resource: Disposable = {
                  dispose() {
                    if (surfaceBindings.get(surfaceId)?.token === token) {
                      surfaceBindings.delete(surfaceId);
                      if (ownedBy.state === "open") stagedSurfaces?.withdraw(surfaceId);
                    }
                  },
                };
                return ownPublication(ownedBy, `surface:${surfaceId}`, resource);
              },
            }),
          }
        : {}),
      ...(hasCanvas
        ? {
            canvas: Object.freeze({
              engine() {
                assertOpen();
                return getActiveCanvasEngine();
              },
            }),
          }
        : {}),
      ...(settings === undefined ? {} : { settings }),
      ...(storage === undefined ? {} : { storage }),
      track,
      effect<T>(label: string, acquire: (fx: RendererPluginContext) => T | Promise<T>): Promise<T> {
        assertOpen();
        return ownedBy.effect(label, (child) => acquire(contextFor(child)));
      },
    });
    return ctx;
  };

  const stagePublications = (): RendererPublicationCandidate => {
    assertScopeOpen(scope);
    const commands = commandRegistry.stageBindings(
      spec.id,
      [...commandBindings].map(([commandId, binding]) => ({
        commandId,
        handler: binding.handler,
      })),
    );
    let surfaces: surfaceRegistry.SurfaceBindingCandidate;
    try {
      surfaces = surfaceRegistry.stageBindings(
        spec.id,
        [...surfaceBindings].map(([surfaceId, binding]) => ({
          surfaceId,
          slot: binding.slot,
          component: binding.component,
          order: binding.order,
          title: binding.title,
          ...(binding.icon === undefined ? {} : { icon: binding.icon }),
        })),
      );
    } catch (error) {
      commands.dispose();
      throw error;
    }
    stagedCommands = commands;
    stagedSurfaces = surfaces;

    let state: "staged" | "active" | "disposed" = "staged";
    const wasDisposedReentrantly = (): boolean => state === "disposed";
    const candidate: RendererPublicationCandidate = Object.freeze({
      commit(): void {
        if (state === "active") return;
        if (state === "disposed" || scope.state !== "open")
          throw new Error(`renderer publication candidate for ${spec.id} is no longer current`);
        commands.commit();
        try {
          surfaces.commit();
          if (wasDisposedReentrantly())
            throw new Error(`renderer publication candidate for ${spec.id} changed during commit`);
          state = "active";
        } catch (error) {
          commands.dispose();
          throw error;
        }
      },
      dispose(): void {
        if (state === "disposed") return;
        state = "disposed";
        let failure: unknown;
        try {
          surfaces.dispose();
        } catch (error) {
          failure = error;
        }
        try {
          commands.dispose();
        } catch (error) {
          failure ??= error;
        } finally {
          if (stagedSurfaces === surfaces) stagedSurfaces = undefined;
          if (stagedCommands === commands) stagedCommands = undefined;
        }
        if (failure !== undefined) throw failure;
      },
    });
    // One root-owned batch is the synchronous authority inverse. Per-registration handles remain
    // exact for explicit live disposal, but cannot expose partial teardown snapshots on close.
    ownPublication(scope, "host:publications", candidate);
    return candidate;
  };

  return {
    contextFor,
    bindings,
    commandBindings,
    surfaceBindings,
    scope,
    lifetime: lifetimeFor(scope, bindings),
    logger,
    stagePublications,
  };
}

interface StartedActivation {
  readonly task: Promise<void | Disposable>;
  readonly syncValue: void | Disposable | Promise<void | Disposable>;
  readonly syncThrew: boolean;
  readonly syncError: unknown;
}

/** ActivationScope.effect invokes its acquisition synchronously before returning the owning
 * promise. Capturing that immediate result preserves the dev-only bundled API's synchronous
 * thenable refusal while both paths still get the same pre-registered setup marker. */
function beginActivation(attempt: Activation, mod: RendererPluginModule): StartedActivation {
  // Explicit initialization is required for the outer return path: ActivationScope.effect can
  // reject before invoking the acquisition callback, even though the ordinary open-scope path
  // assigns synchronously.
  let syncValue: void | Disposable | Promise<void | Disposable> = undefined;
  let syncThrew = false;
  let syncError: unknown;
  const task = attempt.scope.effect("activate", (effectScope) => {
    try {
      syncValue = mod.activate(attempt.contextFor(effectScope));
      return syncValue;
    } catch (error) {
      syncThrew = true;
      syncError = error;
      throw error;
    }
  });
  return { task, syncValue, syncThrew, syncError };
}

/** Never start a replacement beside a same-realm activation that is still draining. A later
 * call may retry once the old scope proves quiescent; PRC-3 will replace this memo with the full
 * desired/committed target controller. */
function cachedActivation(id: string): ActivatedRenderer | undefined {
  const cached = activated.get(id);
  if (cached === undefined || cached.lifetime === undefined) return cached;
  const cleanup = cached.lifetime.snapshot();
  if (cleanup.state === "open") return cached;
  if (cleanup.quiescent) {
    activated.delete(id);
    return undefined;
  }
  return {
    state: "non-quiescent",
    bindings: new Map(),
    error: cached.error ?? "the previous renderer activation is still draining",
    cleanup,
    lifetime: cached.lifetime,
  };
}

/** DEV-ONLY since P8b-3 (P8-D2): the bundled module rides the app bundle and
 * activates synchronously inside buildRegistry. The thenable refusal below is
 * this path's alone and stays verbatim — nothing here awaits, so a promise
 * would be a plugin that registered nothing and no one to find out. */
export function activateRenderer(
  manifest: PluginManifestV1,
  mod: RendererPluginModule,
): ActivatedRenderer {
  const cached = cachedActivation(manifest.id);
  if (cached !== undefined) return cached;

  const attempt = buildActivation(specFromManifest(manifest));
  const startedAt = performance.now();
  const started = beginActivation(attempt, mod);
  if (started.syncThrew) {
    attempt.lifetime.close({ kind: "activation-failed", detail: manifest.id });
    void started.task.catch(() => undefined);
    const cleanup = attempt.lifetime.snapshot();
    const message = primaryErrorMessage(started.syncError);
    attempt.logger.error(`activation failed: ${message}`);
    const failed: ActivatedRenderer = {
      state: cleanup.quiescent ? "failed" : "non-quiescent",
      bindings: attempt.bindings,
      error: message,
      cleanup,
      lifetime: attempt.lifetime,
    };
    if (!cleanup.quiescent) activated.set(manifest.id, failed);
    return failed;
  }

  if (isThenable(started.syncValue)) {
    attempt.lifetime.close({ kind: "activation-failed", detail: "async-bundled-activation" });
    void started.task.catch(() => undefined);
    const cleanup = attempt.lifetime.snapshot();
    const failed: ActivatedRenderer = {
      state: cleanup.quiescent ? "failed" : "non-quiescent",
      bindings: attempt.bindings,
      error: "async activate needs the staged loader (§19.2) — bundled activation is sync",
      cleanup,
      lifetime: attempt.lifetime,
    };
    activated.set(manifest.id, failed); // blocks overlap while the refused promise is still live
    attempt.logger.error(failed.error ?? "");
    return failed;
  }

  try {
    attempt.stagePublications().commit();
  } catch (error) {
    attempt.lifetime.close({ kind: "activation-failed", detail: manifest.id });
    void started.task.catch(() => undefined);
    const cleanup = attempt.lifetime.snapshot();
    const message = primaryErrorMessage(error);
    const failed: ActivatedRenderer = {
      state: cleanup.quiescent ? "failed" : "non-quiescent",
      bindings: attempt.bindings,
      error: message,
      cleanup,
      lifetime: attempt.lifetime,
    };
    if (!cleanup.quiescent) activated.set(manifest.id, failed);
    attempt.logger.error(`activation publication failed: ${message}`);
    return failed;
  }

  const elapsed = performance.now() - startedAt;
  if (elapsed > PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS)
    attempt.logger.warn(`activate took ${Math.round(elapsed)}ms — over the §10.4 deadline`);
  const ok: ActivatedRenderer = {
    state: "active",
    bindings: attempt.bindings,
    lifetime: attempt.lifetime,
  };
  activated.set(manifest.id, ok);
  // The public bundled door remains synchronous, but the scope's setup marker settles in the next
  // microtask. Any impossible bookkeeping failure closes the published lifetime rather than
  // becoming an unhandled rejection.
  void started.task.catch((error) => {
    attempt.logger.error(`activation ownership failed: ${primaryErrorMessage(error)}`);
    attempt.lifetime.close({ kind: "activation-failed", detail: manifest.id });
  });
  return ok;
}

/** Which half of the §10.4 race answered first. A tagged pair rather than a
 * sentinel value: `activate` resolving with nothing is a normal success, so
 * "settled with undefined" and "never settled" have to stay distinguishable. */
type RacedActivation =
  | { readonly settled: true; readonly value: void | Disposable }
  | { readonly settled: false };

export interface RendererActivationCandidate extends Disposable {
  readonly activation: ActivatedRenderer;
  commit(): void;
  dispose(): Promise<void>;
}

export class RendererActivationStageError extends Error {
  readonly activation: ActivatedRenderer;

  constructor(activation: ActivatedRenderer) {
    super(activation.error ?? "renderer activation failed");
    this.name = "RendererActivationStageError";
    this.activation = activation;
  }
}

function bindAttemptOwner(attempt: Activation, owner: ActivationScope | undefined): void {
  if (owner === undefined) return;
  const close = (): void => {
    const reason = owner.signal.reason;
    attempt.lifetime.close(
      typeof reason === "object" && reason !== null && "kind" in reason
        ? (reason as ActivationCloseReason)
        : { kind: "parent-close", detail: owner.label },
    );
  };
  owner.signal.addEventListener("abort", close, { once: true });
  owner.track("renderer:attempt", {
    async dispose() {
      owner.signal.removeEventListener("abort", close);
      attempt.lifetime.close({ kind: "parent-close", detail: owner.label });
      await attempt.lifetime.whenQuiescent();
    },
  });
}

/** Prepare one staged renderer privately. This is the PRC-3d controller adapter: successful
 * setup returns an exact candidate whose command/surface batch is still reserved, not public. */
export async function stageStagedRenderer(
  record: PluginRecord,
  module: PluginModuleUrls,
  mod: RendererPluginModule,
  deps: RendererActivationDeps = {},
): Promise<RendererActivationCandidate> {
  const attempt = buildActivation(specFromRecord(record, module), deps);
  bindAttemptOwner(attempt, deps.ownerScope);
  const started = beginActivation(attempt, mod);
  const deadlineMs = PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race<RacedActivation>([
      started.task.then((value) => ({ settled: true, value }) as const),
      new Promise<RacedActivation>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), deadlineMs);
      }),
    ]);
    if (!raced.settled) {
      attempt.lifetime.close({ kind: "activation-timeout", detail: record.id });
      const cleanup = await attempt.lifetime.observe(0);
      const error = `activate exceeded the §10.4 renderer deadline (${deadlineMs}ms)`;
      attempt.logger.error(error);
      throw new RendererActivationStageError({
        state: cleanup.quiescent ? "failed" : "non-quiescent",
        bindings: attempt.bindings,
        error,
        cleanup,
        lifetime: attempt.lifetime,
      });
    }
    const publications = attempt.stagePublications();
    const activation: ActivatedRenderer = {
      state: "active",
      bindings: attempt.bindings,
      lifetime: attempt.lifetime,
    };
    let state: "staged" | "active" | "disposed" = "staged";
    let disposeTask: Promise<void> | undefined;
    const candidate: RendererActivationCandidate = Object.freeze({
      activation,
      commit(): void {
        if (state === "active") return;
        if (state === "disposed" || attempt.scope.state !== "open")
          throw new Error(`renderer candidate for ${record.id} is no longer current`);
        publications.commit();
        if (attempt.scope.state !== "open")
          throw new Error(`renderer candidate for ${record.id} changed during commit`);
        state = "active";
      },
      dispose(): Promise<void> {
        if (disposeTask !== undefined) return disposeTask;
        state = "disposed";
        let resolveDispose!: () => void;
        let rejectDispose!: (error: unknown) => void;
        disposeTask = new Promise<void>((resolve, reject) => {
          resolveDispose = resolve;
          rejectDispose = reject;
        });
        attempt.lifetime.close({ kind: "target-changed", detail: record.id });
        void attempt.lifetime.whenQuiescent().then(
          () => resolveDispose(),
          (error) => rejectDispose(error),
        );
        return disposeTask;
      },
    });
    return candidate;
  } catch (error) {
    if (error instanceof RendererActivationStageError) throw error;
    attempt.lifetime.close({ kind: "activation-failed", detail: record.id });
    const cleanup = await attempt.lifetime.observe(PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS);
    const message = primaryErrorMessage(error);
    attempt.logger.error(`activation failed: ${message}`);
    throw new RendererActivationStageError({
      state: cleanup.quiescent ? "failed" : "non-quiescent",
      bindings: attempt.bindings,
      error: message,
      cleanup,
      lifetime: attempt.lifetime,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
  deps: RendererActivationDeps = {},
): Promise<ActivatedRenderer> {
  const cached = cachedActivation(record.id);
  if (cached !== undefined) return cached;
  let candidate: RendererActivationCandidate | undefined;
  try {
    candidate = await stageStagedRenderer(record, module, mod, deps);
    candidate.commit();
    const ok = candidate.activation;
    activated.set(record.id, ok);
    return ok;
  } catch (error) {
    await candidate?.dispose();
    const failed: ActivatedRenderer =
      error instanceof RendererActivationStageError
        ? error.activation
        : { state: "failed" as const, bindings: new Map(), error: primaryErrorMessage(error) };
    if (failed.cleanup !== undefined && !failed.cleanup.quiescent) activated.set(record.id, failed);
    return failed;
  }
}

/** Renderer-side activation state for diagnostics surfaces (panel, tests). */
export function rendererActivationState(id: string): ActivatedRenderer | undefined {
  return cachedActivation(id);
}
