import type { BehaviorContribution } from "@vibefield/contracts";
import type { ComponentType } from "react";
import { type AnyBehaviorDef, describeBehavior } from "./behavior";
import type {
  CommandInvocation,
  Disposable,
  DynamicMethodHandler,
  PluginLogger,
  PluginSurfaceProps,
  RendererPluginContext,
  RendererPluginModule,
  ServicePluginContext,
  ServicePluginModule,
  WidgetBinding,
  WidgetRegistration,
} from "./index";

type MockCommandHandler = (args: unknown, invocation: CommandInvocation) => void | Promise<void>;
type MockSurfaceComponent = ComponentType<PluginSurfaceProps>;

// §5.4.4 — the mock host lives WITH the SDK contract it mocks. Runs a renderer
// module's activate against a collecting context: no engine, no daemon, no
// React. Widget-state fixture rendering (the playground) builds on this later.

export interface MockActivation {
  bindings: Map<string, WidgetBinding>;
  /** behavior id → inert code handle bound during the private candidate. */
  behaviors: Map<string, AnyBehaviorDef>;
  /** command id → bound handler (§13.1) — ctx.commands is present iff the
   * options DECLARE the commands contribution (declaredCommands supplied) */
  commands: Map<string, MockCommandHandler>;
  /** surface id → bound component (§13.2) — ctx.surfaces is present iff the
   * options DECLARE the surfaces contribution (declaredSurfaces supplied) */
  surfaces: Map<string, MockSurfaceComponent>;
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
  const bindings = new Map<string, WidgetBinding>();
  const behaviors = new Map<string, AnyBehaviorDef>();
  const commands = new Map<string, MockCommandHandler>();
  const surfaces = new Map<string, MockSurfaceComponent>();
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
