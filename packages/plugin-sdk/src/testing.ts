import type { ComponentType } from "react";
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
  /** the opaque canvas handle ctx.canvas.engine() returns. Supplying this makes
   * ctx.canvas present (mirrors canvas.read/write being granted — §12.7). */
  canvasEngine?: unknown;
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
  const controller = new AbortController();
  const bindings = new Map<string, WidgetBinding>();
  const commands = new Map<string, MockCommandHandler>();
  const surfaces = new Map<string, MockSurfaceComponent>();
  const logs: MockActivation["logs"] = [];
  const disposables: Disposable[] = [];
  const log =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string): void => {
      logs.push({ level, message });
    };
  const logger: PluginLogger = {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
  };
  const ctx: RendererPluginContext = {
    plugin: { id: opts.id ?? "vibefield.mock", version: opts.version ?? "0.0.0" },
    signal: controller.signal,
    logger,
    widgets: {
      register(registration: WidgetRegistration): Disposable {
        if (controller.signal.aborted) throw new Error("mock host: register after abort");
        if (declared !== undefined && !declared.includes(registration.type))
          throw new Error(`mock host: ${registration.type} is not declared by this plugin`);
        if (bindings.has(registration.type))
          throw new Error(`mock host: ${registration.type} already bound in this entry`);
        bindings.set(registration.type, registration.binding);
        return {
          dispose() {
            bindings.delete(registration.type);
          },
        };
      },
    },
    client: {
      request() {
        return Promise.reject(new Error("mock host: no product connection"));
      },
      subscribe() {
        return Promise.reject(new Error("mock host: no product connection"));
      },
    },
    // §10.2 absent-API law: the three P6 surfaces are present iff their
    // contribution/capability is declared (mirrors the real renderer harness).
    ...(declaredCommands !== undefined
      ? {
          commands: {
            register(commandId: string, handler: MockCommandHandler): Disposable {
              if (controller.signal.aborted) throw new Error("mock host: register after abort");
              if (!declaredCommands.includes(commandId))
                throw new Error(`mock host: ${commandId} is not declared by this plugin`);
              if (commands.has(commandId))
                throw new Error(`mock host: ${commandId} already bound in this entry`);
              commands.set(commandId, handler);
              return {
                dispose() {
                  commands.delete(commandId);
                },
              };
            },
          },
        }
      : {}),
    ...(declaredSurfaces !== undefined
      ? {
          surfaces: {
            register(surfaceId: string, component: MockSurfaceComponent): Disposable {
              if (controller.signal.aborted) throw new Error("mock host: register after abort");
              if (!declaredSurfaces.includes(surfaceId))
                throw new Error(`mock host: ${surfaceId} is not declared by this plugin`);
              if (surfaces.has(surfaceId))
                throw new Error(`mock host: ${surfaceId} already bound in this entry`);
              surfaces.set(surfaceId, component);
              return {
                dispose() {
                  surfaces.delete(surfaceId);
                },
              };
            },
          },
        }
      : {}),
    ...(opts.canvasEngine !== undefined
      ? { canvas: { engine: () => opts.canvasEngine ?? null } }
      : {}),
    track<T extends Disposable>(resource: T): T {
      disposables.push(resource);
      return resource;
    },
  };
  const result = await mod.activate(ctx);
  if (result !== undefined && result !== null) disposables.push(result);
  return { bindings, commands, surfaces, logs, disposables, abort: () => controller.abort() };
}

// --- the service-side twin (P4) ----------------------------------------------

export interface MockServiceActivation {
  /** namespace → method name → handler, exactly as provided */
  provided: Map<string, Map<string, DynamicMethodHandler>>;
  logs: Array<{ level: "debug" | "info" | "warn" | "error"; message: string }>;
  disposables: Disposable[];
  abort(): void;
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
  const controller = new AbortController();
  const provided = new Map<string, Map<string, DynamicMethodHandler>>();
  const logs: MockServiceActivation["logs"] = [];
  const disposables: Disposable[] = [];
  const log =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string): void => {
      logs.push({ level, message });
    };
  const ctx: ServicePluginContext = {
    plugin: { id, version: opts.version ?? "0.0.0" },
    signal: controller.signal,
    logger: {
      debug: log("debug"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
    },
    client: {
      request: () => Promise.reject(new Error("mock host: no product connection")),
      subscribe: () => Promise.reject(new Error("mock host: no product connection")),
    },
    services: {
      provide(registration) {
        if (controller.signal.aborted) throw new Error("mock host: provide after abort");
        if (registration.namespace !== `x.${id}`)
          throw new Error(
            `mock host: ${registration.namespace} is not this plugin's namespace (x.${id})`,
          );
        if (provided.has(registration.namespace))
          throw new Error(`mock host: ${registration.namespace} already provided in this entry`);
        provided.set(registration.namespace, new Map(Object.entries(registration.methods)));
        return {
          dispose() {
            provided.delete(registration.namespace);
          },
        };
      },
    },
    track<T extends Disposable>(resource: T): T {
      disposables.push(resource);
      return resource;
    },
  };
  const result = await mod.activate(ctx);
  if (result !== undefined && result !== null) disposables.push(result);
  return { provided, logs, disposables, abort: () => controller.abort() };
}
