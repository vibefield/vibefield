import type { BehaviorContribution } from "@vibefield/contracts";
import type { ComponentType, ReactElement } from "react";
import { type AnyBehaviorDef, describeBehavior } from "./behavior";
import type {
  CommandInvocation,
  Disposable,
  DynamicMethodHandler,
  PluginAttachmentPool,
  PluginLiveSurfaceOptions,
  PluginLogger,
  PluginSurfaceBrowserState,
  PluginSurfaceDemand,
  PluginSurfaceHandle,
  PluginSurfaceNavigation,
  PluginSurfaceProps,
  PluginSurfaceState,
  PluginSurfaceStatus,
  PluginSurfaceViewProps,
  RendererPluginContext,
  RendererPluginModule,
  ServicePluginContext,
  ServicePluginModule,
  WidgetRegistration,
} from "./index";

type MockCommandHandler = (args: unknown, invocation: CommandInvocation) => void | Promise<void>;
type MockSurfaceComponent = ComponentType<PluginSurfaceProps>;

// §5.4.4 — the mock host lives WITH the SDK contract it mocks. Runs a renderer
// module's activate against a collecting context: no engine, no daemon, no
// React. Its FACE half is the kind-conformance harness (DK-7, kind-harness.ts,
// exported at the foot of this module): an object's face is a GPU kind the desk
// draws, judged over its declared states with no device and no DOM — the mock
// pool's `SurfaceView` draws nothing (`inertSurfaceView` below says why).

export interface MockActivation {
  /** declared widget type → whatever its legacy registration carried. Inert on the desk build
   * (DK-2): a widget binds no face; the map witnesses only the §12.1 activation laws. */
  bindings: Map<string, unknown>;
  /** behavior id → inert code handle bound during the private candidate. */
  behaviors: Map<string, AnyBehaviorDef>;
  /** command id → bound handler (§13.1) — ctx.commands is present iff the
   * options DECLARE the commands contribution (declaredCommands supplied) */
  commands: Map<string, MockCommandHandler>;
  /** surface id → bound component (§13.2) — ctx.surfaces is present iff the
   * options DECLARE the surfaces contribution (declaredSurfaces supplied) */
  surfaces: Map<string, MockSurfaceComponent>;
  /** plugin-declared key → the fake attachment ctx.pool.liveSurface handed out,
   * in acquisition order. `ctx.pool` is unconditional, so this is always live. */
  liveSurfaces: Map<string, MockLiveSurface>;
  logs: Array<{ level: "debug" | "info" | "warn" | "error"; message: string }>;
  disposables: Disposable[];
  /** abort the mock session (fires ctx.signal; further registers throw) */
  abort(): void;
  /** Abort and await every owned inverse in reverse acquisition order. */
  close(): Promise<void>;
}

export interface MockPluginHostOptions {
  id?: string;
  version?: string;
  /** widget types the manifest declares — register() enforces §12.1 against it */
  declaredWidgets?: readonly string[];
  /** command ids the manifest declares. Supplying this (even empty) makes
   * ctx.commands present (the manifest declares the kind); register() accepts
   * declared ids and refuses undeclared ones + double-binds (§8.3/§13.1). */
  declaredCommands?: readonly string[];
  /** surface ids the manifest declares. Supplying this makes ctx.surfaces
   * present; register() enforces declared-id + no-double-bind (§8.4/§13.2). */
  declaredSurfaces?: readonly string[];
  /** Behavior ids or complete manifest rows. Supplying this makes the inert
   * binding door present even when canvas.write is effectively denied; complete
   * rows additionally enforce the same descriptor identity as production. */
  declaredBehaviors?: readonly (string | BehaviorContribution)[];
  /** the opaque canvas handle ctx.canvas.engine() returns. Supplying this makes
   * ctx.canvas present (mirrors canvas.read/write being granted — §12.7). */
  canvasEngine?: unknown;
}

/** One fake attachment, plus the levers a test drives it with. The production
 * pool moves these states off a real transport; here the test is the host. */
export interface MockLiveSurface {
  readonly key: string;
  readonly options: PluginLiveSurfaceOptions;
  /** Every demand this holder declared, `initialDemand` first. */
  readonly demands: PluginSurfaceDemand[];
  /** Every chrome navigation the plugin fired while the mock was live. */
  readonly navigations: PluginSurfaceNavigation[];
  readonly handle: PluginSurfaceHandle;
  readonly released: boolean;
  readonly retries: number;
  /** Drive the fake: `set("live")`, `set("lost", error)`. Released is terminal. */
  set(status: PluginSurfaceStatus, error?: Error | null): void;
  /** Drive the browser truth the handle reports (chrome renders from THIS). */
  setBrowser(state: PluginSurfaceBrowserState | null): void;
}

/** The mock pool's `SurfaceView` (DK-7): it renders NOTHING, and says so by
 * being nothing. The product's view paints a live surface's frames into a DOM
 * box (field-app's surface door); the mock host has no frames and no DOM to
 * paint — a mock that drew would claim a presentation path it does not have.
 * A plugin's face on the desk is an object KIND, and the SDK judges that with
 * `runKindConformance` (below), never with a mounted view. It never throws: a
 * panel that mounts the pool's view still activates and closes under the mock,
 * and its handle (`ctx.pool.liveSurface`) is driven by the test as before. */
function inertSurfaceView(_props: PluginSurfaceViewProps): ReactElement | null {
  return null;
}

function mockLiveSurface(
  options: PluginLiveSurfaceOptions,
  assertOpen: () => void,
): MockLiveSurface {
  const listeners = new Set<(state: PluginSurfaceState) => void>();
  const demands: PluginSurfaceDemand[] = [options.initialDemand];
  const navigations: PluginSurfaceNavigation[] = [];
  let status: PluginSurfaceStatus = "attaching";
  let browser: PluginSurfaceBrowserState | null = null;
  let error: Error | null = null;
  let retries = 0;
  const state = (): PluginSurfaceState => ({
    status,
    browser: status === "live" ? browser : null,
    error,
  });
  const notify = (): void => {
    for (const listener of [...listeners]) listener(state());
  };
  const handle: PluginSurfaceHandle = {
    get status(): PluginSurfaceStatus {
      return status;
    },
    get browser(): PluginSurfaceBrowserState | null {
      return state().browser;
    },
    get error(): Error | null {
      return error;
    },
    onState(listener): () => void {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    setDemand(demand): void {
      assertOpen();
      if (status === "released") return;
      demands.push(demand);
    },
    navigate(command): boolean {
      assertOpen();
      // The production contract: only a LIVE browser surface can be steered.
      if (status !== "live" || browser === null) return false;
      navigations.push(command);
      return true;
    },
    retry(): void {
      assertOpen();
      if (status !== "lost") return;
      retries += 1;
      status = "attaching";
      error = null;
      notify();
    },
    release(): void {
      if (status === "released") return;
      status = "released";
      error = null;
      notify();
      listeners.clear();
    },
  };
  return {
    key: options.key,
    options,
    demands,
    navigations,
    handle,
    get released(): boolean {
      return status === "released";
    },
    get retries(): number {
      return retries;
    },
    set(next, nextError = null): void {
      if (status === "released") return;
      status = next;
      error = nextError;
      notify();
    },
    setBrowser(next): void {
      if (status === "released") return;
      browser = next;
      notify();
    },
  };
}

function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { dispose?: unknown }).dispose === "function"
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A deliberately small authoring twin of the production ownership contract. Host runtime code
 * still lives in plugin-runtime; the SDK testing door models the observable author semantics
 * without taking a dependency on host implementation. */
class MockOwnership {
  readonly signal: AbortSignal;

  private readonly controller = new AbortController();
  private readonly records: Disposable[] = [];
  private readonly children: MockOwnership[] = [];
  private readonly owned = new WeakSet<object>();
  private readonly all: Disposable[];
  private readonly errors: unknown[];
  private closeTask?: Promise<void>;
  private open = true;

  constructor(all: Disposable[], errors: unknown[]) {
    this.all = all;
    this.errors = errors;
    this.signal = this.controller.signal;
  }

  assertOpen(): void {
    if (!this.open) throw new Error("mock host: capability used after abort");
  }

  track<T extends Disposable>(resource: T): T {
    if (this.owned.has(resource)) {
      this.assertOpen();
      return resource;
    }
    this.owned.add(resource);
    this.records.push(resource);
    this.all.push(resource);
    if (!this.open) {
      void this.dispose(resource);
      this.assertOpen();
    }
    return resource;
  }

  child(): MockOwnership {
    this.assertOpen();
    const child = new MockOwnership(this.all, this.errors);
    this.children.push(child);
    this.track({ dispose: () => child.close() });
    return child;
  }

  close(): Promise<void> {
    if (this.open) {
      const sealed: MockOwnership[] = [];
      this.sealTree(sealed);
      for (const scope of sealed) scope.controller.abort();
    }
    if (this.closeTask !== undefined) return this.closeTask;
    this.closeTask = (async () => {
      for (const resource of [...this.records].reverse()) await this.dispose(resource);
    })();
    return this.closeTask;
  }

  private async dispose(resource: Disposable): Promise<void> {
    try {
      await resource.dispose();
    } catch (error) {
      this.errors.push(error);
    }
  }

  private sealTree(sealed: MockOwnership[]): void {
    if (!this.open) return;
    this.open = false;
    sealed.push(this);
    for (const child of this.children) child.sealTree(sealed);
  }
}

/** Activate a module against a mock context; returns the collected surface.
 * Async activates are awaited — the mock has no deadline (tests own timing). */
export async function activateWithMockHost(
  mod: RendererPluginModule,
  opts: MockPluginHostOptions = {},
): Promise<MockActivation> {
  const declared = opts.declaredWidgets;
  const declaredCommands = opts.declaredCommands;
  const declaredSurfaces = opts.declaredSurfaces;
  const declaredBehaviors = opts.declaredBehaviors;
  const declaredBehaviorIds = declaredBehaviors?.map((row) =>
    typeof row === "string" ? row : row.id,
  );
  const declaredBehaviorRows = new Map(
    (declaredBehaviors ?? [])
      .filter((row): row is BehaviorContribution => typeof row !== "string")
      .map((row) => [row.id, row]),
  );
  const bindings = new Map<string, unknown>();
  const behaviors = new Map<string, AnyBehaviorDef>();
  const commands = new Map<string, MockCommandHandler>();
  const surfaces = new Map<string, MockSurfaceComponent>();
  const liveSurfaces = new Map<string, MockLiveSurface>();
  const widgetGenerations = new Map<string, symbol>();
  const commandGenerations = new Map<string, symbol>();
  const surfaceGenerations = new Map<string, symbol>();
  const behaviorGenerations = new Map<string, symbol>();
  let behaviorsSealed = false;
  const logs: MockActivation["logs"] = [];
  const disposables: Disposable[] = [];
  const cleanupErrors: unknown[] = [];
  const root = new MockOwnership(disposables, cleanupErrors);
  const log =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string): void => {
      logs.push({ level, message });
    };
  const contextFor = (ownedBy: MockOwnership): RendererPluginContext => {
    const assertOpen = (): void => ownedBy.assertOpen();
    const logger: PluginLogger = {
      debug(message) {
        assertOpen();
        log("debug")(message);
      },
      info(message) {
        assertOpen();
        log("info")(message);
      },
      warn(message) {
        assertOpen();
        log("warn")(message);
      },
      error(message) {
        assertOpen();
        log("error")(message);
      },
    };

    function track<T extends Disposable>(resource: T): T;
    function track<T extends Disposable>(label: string, resource: T): T;
    function track<T extends Disposable>(labelOrResource: string | T, resource?: T): T {
      return ownedBy.track(typeof labelOrResource === "string" ? (resource as T) : labelOrResource);
    }

    return {
      plugin: { id: opts.id ?? "vibefield.mock", version: opts.version ?? "0.0.0" },
      signal: ownedBy.signal,
      logger,
      widgets: {
        register(registration: WidgetRegistration): Disposable {
          assertOpen();
          if (declared !== undefined && !declared.includes(registration.type))
            throw new Error(`mock host: ${registration.type} is not declared by this plugin`);
          if (bindings.has(registration.type))
            throw new Error(`mock host: ${registration.type} already bound in this entry`);
          const generation = Symbol(registration.type);
          widgetGenerations.set(registration.type, generation);
          bindings.set(registration.type, registration.binding);
          return ownedBy.track({
            dispose() {
              if (widgetGenerations.get(registration.type) !== generation) return;
              widgetGenerations.delete(registration.type);
              bindings.delete(registration.type);
            },
          });
        },
      },
      client: {
        request() {
          assertOpen();
          return Promise.reject(new Error("mock host: no product connection"));
        },
        subscribe() {
          assertOpen();
          return Promise.reject(new Error("mock host: no product connection"));
        },
      },
      pool: {
        liveSurface(options: PluginLiveSurfaceOptions): PluginSurfaceHandle {
          assertOpen();
          const surface = mockLiveSurface(options, assertOpen);
          liveSurfaces.set(options.key, surface);
          // Production releases every handle a plugin acquired when the
          // activation closes (§18.1). The mock owns the same inverse, so a
          // test asserts the law rather than the mock's convenience.
          ownedBy.track({ dispose: () => surface.handle.release() });
          return surface.handle;
        },
        SurfaceView: inertSurfaceView,
      } satisfies PluginAttachmentPool,
      ...(declaredCommands !== undefined
        ? {
            commands: {
              register(commandId: string, handler: MockCommandHandler): Disposable {
                assertOpen();
                if (!declaredCommands.includes(commandId))
                  throw new Error(`mock host: ${commandId} is not declared by this plugin`);
                if (commands.has(commandId))
                  throw new Error(`mock host: ${commandId} already bound in this entry`);
                const generation = Symbol(commandId);
                commandGenerations.set(commandId, generation);
                commands.set(commandId, handler);
                return ownedBy.track({
                  dispose() {
                    if (commandGenerations.get(commandId) !== generation) return;
                    commandGenerations.delete(commandId);
                    commands.delete(commandId);
                  },
                });
              },
            },
          }
        : {}),
      ...(declaredSurfaces !== undefined
        ? {
            surfaces: {
              register(surfaceId: string, component: MockSurfaceComponent): Disposable {
                assertOpen();
                if (!declaredSurfaces.includes(surfaceId))
                  throw new Error(`mock host: ${surfaceId} is not declared by this plugin`);
                if (surfaces.has(surfaceId))
                  throw new Error(`mock host: ${surfaceId} already bound in this entry`);
                const generation = Symbol(surfaceId);
                surfaceGenerations.set(surfaceId, generation);
                surfaces.set(surfaceId, component);
                return ownedBy.track({
                  dispose() {
                    if (surfaceGenerations.get(surfaceId) !== generation) return;
                    surfaceGenerations.delete(surfaceId);
                    surfaces.delete(surfaceId);
                  },
                });
              },
            },
          }
        : {}),
      ...(opts.canvasEngine !== undefined || declaredBehaviors !== undefined
        ? {
            canvas: {
              behaviors: {
                bind(behaviorId: string, behavior: AnyBehaviorDef): Disposable {
                  assertOpen();
                  if (behaviorsSealed) {
                    throw new Error("mock host: behavior bindings are sealed after activation");
                  }
                  if (
                    declaredBehaviorIds === undefined ||
                    !declaredBehaviorIds.includes(behaviorId)
                  ) {
                    throw new Error(`mock host: ${behaviorId} is not declared by this plugin`);
                  }
                  if (behavior.name !== behaviorId) {
                    throw new Error(
                      `mock host: behavior handle ${behavior.name} does not match ${behaviorId}`,
                    );
                  }
                  const declaration = declaredBehaviorRows.get(behaviorId);
                  if (
                    declaration !== undefined &&
                    canonicalJson(describeBehavior(behavior)) !==
                      canonicalJson({ id: declaration.id, ...declaration.definition })
                  ) {
                    throw new Error(
                      `mock host: behavior ${behaviorId} descriptor does not match its manifest declaration`,
                    );
                  }
                  if (behaviors.has(behaviorId)) {
                    throw new Error(`mock host: ${behaviorId} already bound in this entry`);
                  }
                  const generation = Symbol(behaviorId);
                  behaviorGenerations.set(behaviorId, generation);
                  behaviors.set(behaviorId, behavior);
                  const resource: Disposable = {
                    dispose() {
                      if (behaviorGenerations.get(behaviorId) !== generation) return;
                      behaviorGenerations.delete(behaviorId);
                      behaviors.delete(behaviorId);
                    },
                  };
                  // Match production: the complete declaration set belongs to the activation,
                  // not to whichever child effect happened to perform a bind.
                  activation.track(resource);
                  return {
                    dispose(): void {
                      if (behaviorsSealed) return;
                      resource.dispose();
                    },
                  };
                },
              },
              engine() {
                assertOpen();
                return opts.canvasEngine ?? null;
              },
            },
          }
        : {}),
      track,
      async effect<T>(
        _label: string,
        acquire: (fx: RendererPluginContext) => T | Promise<T>,
      ): Promise<T> {
        assertOpen();
        const child = ownedBy.child();
        try {
          const value = await acquire(contextFor(child));
          if (isDisposable(value)) child.track(value);
          return value;
        } catch (error) {
          await child.close();
          throw error;
        }
      },
    };
  };

  const activation = root.child();
  try {
    const result = await mod.activate(contextFor(activation));
    if (isDisposable(result)) activation.track(result);
    if (declaredBehaviors !== undefined) {
      const missing = (declaredBehaviorIds ?? []).filter((id) => !behaviors.has(id));
      if (missing.length > 0) {
        throw new Error(`mock host: missing behavior bindings: ${missing.join(", ")}`);
      }
      behaviorsSealed = true;
    }
  } catch (error) {
    await activation.close();
    await root.close();
    throw error;
  }
  const close = async (): Promise<void> => {
    await root.close();
    if (cleanupErrors.length > 0)
      throw new AggregateError(cleanupErrors, "mock host cleanup failed");
  };
  return {
    bindings,
    behaviors,
    commands,
    surfaces,
    liveSurfaces,
    logs,
    disposables,
    abort: () => void root.close(),
    close,
  };
}

// --- the service-side twin (P4) ----------------------------------------------

export interface MockServiceActivation {
  /** namespace → method name → handler, exactly as provided */
  provided: Map<string, Map<string, DynamicMethodHandler>>;
  logs: Array<{ level: "debug" | "info" | "warn" | "error"; message: string }>;
  disposables: Disposable[];
  abort(): void;
  /** Abort and await every service-owned inverse in reverse acquisition order. */
  close(): Promise<void>;
}

export interface MockServiceHostOptions {
  id?: string;
  version?: string;
}

/** Activate a SERVICE module against a collecting context: no worker, no
 * daemon. Namespace ownership (§14.6 — only `x.<own id>`) is enforced like the
 * real host; declaration exact-match is the host router's job, asserted in the
 * plugin's own test against its manifest. */
export async function activateServiceWithMockHost(
  mod: ServicePluginModule,
  opts: MockServiceHostOptions = {},
): Promise<MockServiceActivation> {
  const id = opts.id ?? "vibefield.mock";
  const provided = new Map<string, Map<string, DynamicMethodHandler>>();
  const providerGenerations = new Map<string, symbol>();
  const logs: MockServiceActivation["logs"] = [];
  const disposables: Disposable[] = [];
  const cleanupErrors: unknown[] = [];
  const root = new MockOwnership(disposables, cleanupErrors);
  const log =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string): void => {
      logs.push({ level, message });
    };
  const contextFor = (ownedBy: MockOwnership): ServicePluginContext => {
    const assertOpen = (): void => ownedBy.assertOpen();
    const logger: PluginLogger = {
      debug(message) {
        assertOpen();
        log("debug")(message);
      },
      info(message) {
        assertOpen();
        log("info")(message);
      },
      warn(message) {
        assertOpen();
        log("warn")(message);
      },
      error(message) {
        assertOpen();
        log("error")(message);
      },
    };

    function track<T extends Disposable>(resource: T): T;
    function track<T extends Disposable>(label: string, resource: T): T;
    function track<T extends Disposable>(labelOrResource: string | T, resource?: T): T {
      return ownedBy.track(typeof labelOrResource === "string" ? (resource as T) : labelOrResource);
    }

    return {
      plugin: { id, version: opts.version ?? "0.0.0" },
      signal: ownedBy.signal,
      logger,
      client: {
        request() {
          assertOpen();
          return Promise.reject(new Error("mock host: no product connection"));
        },
        subscribe() {
          assertOpen();
          return Promise.reject(new Error("mock host: no product connection"));
        },
      },
      services: {
        provide(registration) {
          assertOpen();
          if (registration.namespace !== `x.${id}`)
            throw new Error(
              `mock host: ${registration.namespace} is not this plugin's namespace (x.${id})`,
            );
          if (provided.has(registration.namespace))
            throw new Error(`mock host: ${registration.namespace} already provided in this entry`);
          const generation = Symbol(registration.namespace);
          providerGenerations.set(registration.namespace, generation);
          provided.set(registration.namespace, new Map(Object.entries(registration.methods)));
          let live = true;
          const withdraw = (): void => {
            if (!live) return;
            live = false;
            if (providerGenerations.get(registration.namespace) !== generation) return;
            providerGenerations.delete(registration.namespace);
            provided.delete(registration.namespace);
          };
          ownedBy.signal.addEventListener("abort", withdraw, { once: true });
          return ownedBy.track({
            dispose() {
              ownedBy.signal.removeEventListener("abort", withdraw);
              withdraw();
            },
          });
        },
      },
      track,
      async effect<T>(
        _label: string,
        acquire: (fx: ServicePluginContext) => T | Promise<T>,
      ): Promise<T> {
        assertOpen();
        const child = ownedBy.child();
        try {
          const value = await acquire(contextFor(child));
          if (isDisposable(value)) child.track(value);
          return value;
        } catch (error) {
          await child.close();
          throw error;
        }
      },
    };
  };

  const activation = root.child();
  try {
    const result = await mod.activate(contextFor(activation));
    if (isDisposable(result)) activation.track(result);
  } catch (error) {
    await activation.close();
    await root.close();
    throw error;
  }
  const close = async (): Promise<void> => {
    await root.close();
    if (cleanupErrors.length > 0)
      throw new AggregateError(cleanupErrors, "mock service host cleanup failed");
  };
  return { provided, logs, disposables, abort: () => void root.close(), close };
}

export {
  type BindingResource,
  bindingsUsedBy,
  type GpuProblem,
  type GpuProblemCode,
  type RecordedModule,
  type RecordingGpu,
  readWgsl,
  recordingGpu,
  uncommented,
  type WgslBinding,
  type WgslRead,
  type WgslStage,
} from "./kind-gpu";
// --- THE FACE HALF: the kind-conformance harness (DK-7) ------------------------
// An object's code half (its `ObjectBinding`) against its durable half (the
// manifest row), with NO device and NO DOM: the declaration the host reads, the
// program on a recording device (its WGSL read — never compiled), every
// declared state driven through resolve / record / hit / frame / chip / the
// opening / prepare / drawRange, then dispose. `{ states, verdicts }`.
export {
  checkKindDeclaration,
  checkKindProgram,
  DESK_ZOOMS,
  defaultProps,
  hangZoom,
  KIND_EXPECTED,
  type KindConformanceInput,
  type KindMode,
  type KindNoteCode,
  type KindPlan,
  type KindRefusalCode,
  type KindReport,
  type KindVerdict,
  type KindVerdictStatus,
  kindOfBinding,
  kindPlan,
  type PropRefusal,
  runKindConformance,
  validateStateProps,
} from "./kind-harness";
