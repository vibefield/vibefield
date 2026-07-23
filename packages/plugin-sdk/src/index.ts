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
