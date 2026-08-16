// @vibefield/plugin-sdk — THE import surface for plugin code (spec §11.3: the
// only workspace dependency a plugin declares). Everything a renderer plugin
// touches arrives either from here (contract types, defineRendererPlugin, the
// design kit via ./ui, the canvas vocabulary via ./canvas) or as a PA-29
// singleton bare specifier (react, three, R3F/drei). The HOST implements the
// context (field-app's renderer harness); this package ships types + the
// module normalizer + the testing mock — no host logic.
//
// P3 SUBSET, honest by omission (§10.2 — unavailable APIs are ABSENT, never
// stubs): ctx carries plugin/logger/signal/track/widgets/client. Commands,
// surfaces, and the canvas handle (ctx.canvas) arrive at P6; pool arrives with
// its runtime. ctx.plugin's manifestHash/installRevision are OPTIONAL because
// two loaders supply the context: the staged loader (§19.2) knows both from the
// approved module row, and the dev-only bundled path has neither — a plugin
// riding the app bundle was never installed, so there is no install to revise.

import type { ComponentType } from "react";

export interface Disposable {
  dispose(): void | Promise<void>;
}

/** §23.1 — structured, provenance-stamped by the host; never log secrets. */
export interface PluginLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** The opaque code-side view registration the host's prefab builder consumes
 * (durable schema lives in the MANIFEST — §12.2; nothing here touches docs). */
export interface WidgetBinding {
  component: unknown;
  /** GL-only: DOM chrome portaled UNDER the canvas (CardChrome sandwich). */
  chrome?: unknown;
  /** GL-only: per-frame island repaint opt-in (design-004 §3). */
  animated?: boolean;
  /** tray preview override (tri-tier: absent → sandbox-mounted component). */
  preview?: unknown;
}

export interface WidgetRegistration {
  /** MUST be a widget type this plugin's manifest declares (§12.1). */
  type: string;
  binding: WidgetBinding;
}

export interface RendererWidgetAPI {
  /** Bind the implementation for a declared widget type. Throws on undeclared
   * types and double-binds (§12.1). Returns the un-bind handle. */
  register(registration: WidgetRegistration): Disposable;
}

/** The plugin-principal product connection (§11.2): calls arrive at fieldd
 * attributed to THIS plugin with its granted scopes — never the window's.
 * The credential lives inside the host's closure, not on this object. */
export interface PluginProductClient {
  request(method: string, params?: unknown): Promise<unknown>;
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown) => void,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
}

/** §11.1, the P3 subset. A capability object, not a bag of globals; properties
 * are immutable; APIs reject use after `signal` aborts. */
export interface RendererPluginContext {
  readonly plugin: {
    readonly id: string;
    readonly version: string;
    /** §9.2 identity of the manifest this activation was approved against, and
     * §11.4's install revision. Present iff a staged loader supplied them. */
    readonly manifestHash?: string;
    readonly installRevision?: string;
  };
  readonly signal: AbortSignal;
  readonly logger: PluginLogger;
  readonly widgets: RendererWidgetAPI;
  readonly client: PluginProductClient;
  /** present iff the manifest DECLARES contributes.commands (§8.3/§10.2 — the
   * absent-API law: no contribution, no API surface) */
  readonly commands?: RendererCommandAPI;
  /** present iff the manifest DECLARES contributes.surfaces (§8.4/§10.2) */
  readonly surfaces?: RendererSurfaceAPI;
  /** present iff canvas.read or canvas.write is granted (§12.7 stopgap/§10.2) */
  readonly canvas?: PluginCanvasAPI;
  /** present iff the manifest requests storage.self (§16.3 — absent, not stubbed) */
  readonly settings?: PluginSettingsAPI;
  readonly storage?: PluginStorageAPI;
  track<T extends Disposable>(resource: T): T;
  track<T extends Disposable>(label: string, resource: T): T;
  /** Run one optional/replaceable acquisition inside a pre-owned child lifetime.
   * Every capability on `fx` is bound to that child; retaining it after the
   * effect closes cannot reopen authority. */
  effect<T>(label: string, acquire: (fx: RendererPluginContext) => T | Promise<T>): Promise<T>;
}

/** §10.1 — the one activation shape. Module top-level code MUST NOT perform
 * product work; everything starts in activate. */
export interface RendererPluginModule {
  activate(ctx: RendererPluginContext): void | Disposable | Promise<void | Disposable>;
}

/** Identity with a name: normalizes authoring and gives the host one shape to
 * validate (§10.1 — a default export containing `activate`). */
export function defineRendererPlugin(mod: RendererPluginModule): RendererPluginModule {
  return mod;
}

// --- the service entry (P4, spec §14) ----------------------------------------

/** What a dynamic-method handler learns about its caller — sanitized by the
 * host (§14.4: provider code never trusts caller-supplied identity). */
export interface PluginCallContext {
  readonly caller: { readonly kind: string; readonly pluginId?: string };
}

/** §14.5 — snapshot-then-delta, both schema-validated by the host router. */
export interface SnapshotDeltaSink {
  snapshot(value: unknown): void;
  delta(value: unknown): void;
}

export type DynamicMethodHandler =
  | {
      kind: "query" | "mutation";
      handle(params: unknown, call: PluginCallContext): Promise<unknown> | unknown;
    }
  | {
      kind: "subscription";
      subscribe(
        params: unknown,
        call: PluginCallContext,
        sink: SnapshotDeltaSink,
      ): Disposable | Promise<Disposable>;
    };

/** §14.4 — registration is accepted only when every implemented method has an
 * exact manifest declaration and every declaration an implementation. */
export interface PluginServiceProviderAPI {
  provide(registration: {
    namespace: string;
    methods: Record<string, DynamicMethodHandler>;
  }): Disposable;
}

/** §14.1 — the absent-API law (§10.2) throughout: every optional surface is
 * present iff its capability is granted; mcp/net still await their slices. */
export interface ServicePluginContext {
  readonly plugin: { readonly id: string; readonly version: string };
  readonly signal: AbortSignal;
  readonly logger: PluginLogger;
  readonly client: PluginProductClient;
  readonly services: PluginServiceProviderAPI;
  /** present iff the manifest requests storage.self (§16.3 — absent, not stubbed) */
  readonly settings?: PluginSettingsAPI;
  readonly storage?: PluginStorageAPI;
  /** P6 — present iff process.spawn is granted (§17.1) */
  readonly process?: PluginProcessAPI;
  /** P6 — present iff services.provide is granted (§17.3) */
  readonly endpoints?: PluginEndpointAPI;
  track<T extends Disposable>(resource: T): T;
}

export interface ServicePluginModule {
  activate(ctx: ServicePluginContext): void | Disposable | Promise<void | Disposable>;
}

export function defineServicePlugin(mod: ServicePluginModule): ServicePluginModule {
  return mod;
}

// --- processes + endpoints (P6, spec §17.1/§17.3) ------------------------------

/** §17.1 — fieldd owns the child: policy, env stripping, the process group,
 * the termination ladder, provenance. Plugin code MUST NOT reach for ambient
 * child_process (the import wall enforces it). */
export interface PluginProcessHandle extends Disposable {
  readonly procId: string;
  /** term = group SIGTERM then SIGKILL after grace; kill = group SIGKILL now */
  signal(sig: "term" | "kill"): Promise<void>;
  stat(): Promise<unknown>;
}

export interface PluginProcessAPI {
  spawn(request: {
    executable: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    restart: "never" | "on-crash";
  }): Promise<PluginProcessHandle>;
}

/** §17.3 — adopt a local server under a declared service id. Health is
 * mandatory; v1 exposure is app-only (mesh/mcp exposure refuse honestly until
 * their runtimes land). */
export interface PluginEndpointAPI {
  register(request: {
    serviceId: string;
    endpoint: { protocol: "http"; port: number };
    health: { path: string; intervalMs: number };
    expose: { app: boolean; mesh: boolean; mcp: boolean };
  }): Promise<Disposable>;
}

/** ONE implementation for the worker harness (the renderer never spawns):
 * everything rides the plugin's product client — the daemon's caller matrix
 * is the enforcement, this is a veneer. */
export function createProcessSurfaces(client: PluginProductClient): {
  process: PluginProcessAPI;
  endpoints: PluginEndpointAPI;
} {
  const process: PluginProcessAPI = {
    async spawn(request) {
      const res = (await client.request("process.spawn", request)) as {
        proc: { procId: string };
      };
      const procId = res.proc.procId;
      return {
        procId,
        async signal(sig) {
          await client.request("process.signal", { procId, signal: sig });
        },
        async stat() {
          const stat = (await client.request("process.stat", { procId })) as {
            processes: unknown[];
          };
          return stat.processes[0];
        },
        dispose() {
          void client.request("process.signal", { procId, signal: "term" }).catch(() => {
            // already gone — dispose is best-effort by contract (§18.1)
          });
        },
      };
    },
  };
  const endpoints: PluginEndpointAPI = {
    async register(request) {
      await client.request("services.registerEndpoint", request);
      const serviceId = request.serviceId;
      return {
        dispose() {
          void client.request("services.unregisterEndpoint", { serviceId }).catch(() => {
            // withdrawal on disable already removed it — best-effort (§18.1)
          });
        },
      };
    },
  };
  return { process, endpoints };
}

// --- settings + storage (P5, spec §16.2/§16.3) --------------------------------

/** §16.2 — declared keys only; values validate host-side; defaults come from
 * the schema (an unset key with a default resolves to it). */
export interface PluginSettingsAPI {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  reset(key: string): Promise<void>;
  subscribe<T>(key: string, observer: (value: T | undefined) => void): Disposable;
}

/** §16.3 — the KV half. Files are deliberately ABSENT this slice: bodies ride
 * a ticketed lane (EL2), which is its own slice — absent, never a stub. */
export interface PluginStorageAPI {
  readonly kv: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
  };
}

/** ONE implementation for both hosts (worker harness + renderer harness):
 * everything rides the plugin's own product client, so the daemon's caller
 * matrix (self-scoping, storage.self, quotas) is the enforcement — this is a
 * convenience veneer, never an authority. */
export function createStorageSurfaces(client: PluginProductClient): {
  settings: PluginSettingsAPI;
  storage: PluginStorageAPI;
} {
  const settings: PluginSettingsAPI = {
    async get(key) {
      const res = (await client.request("storage.settings.get", { key })) as {
        value?: unknown;
      };
      return res.value as never;
    },
    async set(key, value) {
      await client.request("storage.settings.set", { key, value });
    },
    async reset(key) {
      await client.request("storage.settings.reset", { key });
    },
    subscribe(key, observer) {
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      void client
        .subscribe("storage.settings.subscribe", {}, (payload) => {
          if (cancelled) return;
          const snap = payload as { values?: Record<string, unknown> } | null;
          if (snap?.values !== undefined) observer(snap.values[key] as never);
        })
        .then((sub) => {
          if (cancelled) {
            sub.unsubscribe();
            return;
          }
          unsubscribe = sub.unsubscribe;
          const snap = sub.snapshot as { values?: Record<string, unknown> } | null;
          if (snap?.values !== undefined) observer(snap.values[key] as never);
        })
        .catch(() => undefined); // daemon away — the observer simply never fires
      return {
        dispose() {
          cancelled = true;
          unsubscribe?.();
        },
      };
    },
  };
  const storage: PluginStorageAPI = {
    kv: {
      async get(key) {
        const res = (await client.request("storage.kv.get", { key })) as { value: unknown };
        return res.value as never;
      },
      async set(key, value) {
        await client.request("storage.kv.set", { key, value });
      },
      async delete(key) {
        await client.request("storage.kv.delete", { key });
      },
      async list(prefix) {
        const res = (await client.request("storage.kv.list", {
          ...(prefix !== undefined ? { prefix } : {}),
        })) as { keys: string[] };
        return res.keys;
      },
    },
  };
  return { settings, storage };
}

// --- commands + surfaces at runtime (P6, spec §8.3/§8.4/§13) -------------------

/** §13.1 verbatim — what a command handler learns about its invocation. The
 * SPINE sets every field; a handler cannot claim a different source or user
 * gesture (§13.1). `selection` is the current canvas selection at invoke time;
 * `windowId` names the invoking window. */
export interface CommandInvocation {
  source: "palette" | "widget-context" | "canvas-context" | "hud" | "godview";
  windowId: string;
  selection: string[];
  userGesture: boolean;
}

/** §13.1 — bind a handler to a command THIS plugin's manifest declares. The
 * spine owns palette ordering, args validation, provenance, and invocation
 * (§8.3); a handler for an undeclared id or a double-bind is refused. Returns
 * the un-bind handle (auto-tracked by the host — §18.1). */
export interface RendererCommandAPI {
  register(
    commandId: string,
    handler: (args: unknown, invocation: CommandInvocation) => void | Promise<void>,
  ): Disposable;
}

/** §8.4/§13.2 — the props the spine supplies to a bound surface component.
 * The slot is manifest truth. Only a side panel may ask its host stage to
 * close; open state and the top-right toggle remain spine truth. */
export type PluginSurfaceProps =
  | {
      slot: "hud.attention" | "hud.panel";
      windowId: string;
    }
  | {
      slot: "hud.side-panel";
      windowId: string;
      requestClose(): void;
    }
  | {
      slot: "godview.row" | "godview.lens";
      windowId: string;
    };

/** §13.2 — bind a React component to a surface THIS plugin's manifest declares.
 * Undeclared ids are refused; forward-declared-but-not-yet-live slots
 * (godview.*) are refused honestly at bind time (§8.4). Returns the un-bind
 * handle (auto-tracked — §18.1). */
export interface RendererSurfaceAPI {
  register(surfaceId: string, component: ComponentType<PluginSurfaceProps>): Disposable;
}

/** §12.7 A2-tier STOPGAP: the curated canvas tier (PA-27 — a provenance-
 * stamping, write-gated view speaking ICE's own vocabulary) supersedes this;
 * this is the least-power v1 handle so declared commands can act on the canvas
 * — a recorded delta (thinking-p3). The raw mutable World stays unreachable
 * (PA-22); callers cast the opaque handle through the SDK ./canvas CanvasEngine
 * door. Present on ctx iff canvas.read or canvas.write is granted (§10.2). */
export interface PluginCanvasAPI {
  /** The active canvas engine, or null when none is mounted (daemon-away boot,
   * between doc switches). Opaque `unknown` — the SDK ./canvas re-export types
   * the cast; a command reads a null return as "no canvas, no-op". */
  engine(): unknown | null;
}
