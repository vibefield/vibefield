import type {
  Disposable,
  DynamicMethodHandler,
  PluginLogger,
  RendererPluginContext,
  RendererPluginModule,
  ServicePluginContext,
  ServicePluginModule,
  WidgetBinding,
  WidgetRegistration,
} from "./index";

// §5.4.4 — the mock host lives WITH the SDK contract it mocks. Runs a renderer
// module's activate against a collecting context: no engine, no daemon, no
// React. Widget-state fixture rendering (the playground) builds on this later.

export interface MockActivation {
  bindings: Map<string, WidgetBinding>;
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
}

/** Activate a module against a mock context; returns the collected surface.
 * Async activates are awaited — the mock has no deadline (tests own timing). */
export async function activateWithMockHost(
  mod: RendererPluginModule,
  opts: MockPluginHostOptions = {},
): Promise<MockActivation> {
  const declared = opts.declaredWidgets;
  const controller = new AbortController();
  const bindings = new Map<string, WidgetBinding>();
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
    track<T extends Disposable>(resource: T): T {
      disposables.push(resource);
      return resource;
    },
  };
  const result = await mod.activate(ctx);
  if (result !== undefined && result !== null) disposables.push(result);
  return { bindings, logs, disposables, abort: () => controller.abort() };
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
