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
// surfaces, canvas mutations (ctx.canvas), pool, settings, storage arrive with
// their runtimes (P4+). ctx.plugin omits manifestHash/installRevision until
// the staged loader supplies them (recorded delta, thinking-p3).

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
  readonly plugin: { readonly id: string; readonly version: string };
  readonly signal: AbortSignal;
  readonly logger: PluginLogger;
  readonly widgets: RendererWidgetAPI;
  readonly client: PluginProductClient;
  /** present iff the manifest requests storage.self (§16.3 — absent, not stubbed) */
  readonly settings?: PluginSettingsAPI;
  readonly storage?: PluginStorageAPI;
  track<T extends Disposable>(resource: T): T;
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

/** §14.1, the P4 subset — settings/storage/process/endpoints/mcp/net arrive
 * with their runtimes (P5/P6); absent APIs are ABSENT, never stubs. */
export interface ServicePluginContext {
  readonly plugin: { readonly id: string; readonly version: string };
  readonly signal: AbortSignal;
  readonly logger: PluginLogger;
  readonly client: PluginProductClient;
  readonly services: PluginServiceProviderAPI;
  /** present iff the manifest requests storage.self (§16.3 — absent, not stubbed) */
  readonly settings?: PluginSettingsAPI;
  readonly storage?: PluginStorageAPI;
  track<T extends Disposable>(resource: T): T;
}

export interface ServicePluginModule {
  activate(ctx: ServicePluginContext): void | Disposable | Promise<void | Disposable>;
}

export function defineServicePlugin(mod: ServicePluginModule): ServicePluginModule {
  return mod;
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
