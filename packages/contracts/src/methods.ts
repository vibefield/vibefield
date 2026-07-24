import { SCOPES, type Scope } from "./registries";

// Method registry (design-01 §3 + D36): every method declares surface, scope,
// idempotency, and its LOCALITY CLASS. The registry lint (test/registry.test.ts)
// rejects unclassified methods — an unregistered method doesn't ship.

export const SURFACES = ["product", "mgmt", "mcp", "push"] as const;
export type Surface = (typeof SURFACES)[number];

/** D36 locality classes. */
export const LOCALITIES = [
  "local",
  "sync",
  "replicate",
  "stream",
  "federate",
  "native-plane",
] as const;
export type Locality = (typeof LOCALITIES)[number];

export interface MethodDef {
  surface: Surface;
  /** dotted method name, e.g. "system.hello" */
  method: string;
  /** required scope, or null = any authenticated principal */
  scope: Scope | null;
  idempotent: boolean;
  locality: Locality;
  subscription?: boolean;
}

export function defineMethod(def: MethodDef): MethodDef {
  if (!def.method.includes(".")) throw new Error(`method missing namespace: ${def.method}`);
  if (def.scope !== null && !(SCOPES as readonly string[]).includes(def.scope))
    throw new Error(`unknown scope on ${def.method}: ${def.scope}`);
  if (!(LOCALITIES as readonly string[]).includes(def.locality))
    throw new Error(`unknown locality on ${def.method}: ${def.locality}`);
  return def;
}

/** The catalog grows per milestone: M1 seeds → M2 mgmt channel → M3 product core. */
export const METHODS: MethodDef[] = [
  // M1 — product seeds
  defineMethod({
    surface: "product",
    method: "system.hello",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "system.health",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "system.capabilities",
    scope: null,
    idempotent: true,
    locality: "local",
  }),

  // Track A — walking skeleton (shell bootstrap + live health)
  defineMethod({
    surface: "product",
    method: "system.health.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "system.unsubscribe",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "system.mintWindowToken",
    scope: "tokens.mint",
    idempotent: false,
    locality: "local",
  }),

  // M2 — management channel (auth = D8 pairing hello; no scope system on this surface)
  defineMethod({
    surface: "mgmt",
    method: "native.lifecycle.hello",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.lifecycle.health.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.lifecycle.desired.set",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.lifecycle.observed.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.diagnostics.query",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.diagnostics.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.peers.list",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.peers.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.store.open",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.store.get",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.store.set",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.store.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.serve.add",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.serve.remove",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.serve.list",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  // C3 — serve runtime stream (ProxyEvent: started/stopped/error). Without it
  // a serve that dies at runtime is invisible to fieldd (honest-state law).
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.serve.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),

  // B3 — DocumentService, P0 local-only subset (design-01 §5.1, M4; design-02 §5 fence).
  // The rest of the doc.* catalog (subscribeRegistry/close/delete/compact/export/import)
  // is deferred and deliberately undeclared — the lint enforces declared == shipped.
  defineMethod({
    surface: "product",
    method: "doc.create",
    scope: "doc.write",
    idempotent: false,
    locality: "sync",
  }),
  defineMethod({
    surface: "product",
    method: "doc.list",
    scope: "doc.read",
    idempotent: true,
    locality: "sync",
  }),
  // Mints a fresh one-shot lane ticket per call (EL2 — bytes ride the ticketed
  // :9411 lane this method fronts, hence the stream class).
  defineMethod({
    surface: "product",
    method: "doc.open",
    scope: "doc.write",
    idempotent: false,
    locality: "stream",
  }),
  // Relabels a doc; idempotent, and never bumps updatedAt (recency is content, not the label).
  defineMethod({
    surface: "product",
    method: "doc.rename",
    scope: "doc.write",
    idempotent: true,
    locality: "sync",
  }),

  // C4 — DeviceService (design-04 D31, P1-lite: roster only; PeerLink/D32 and
  // heartbeats deferred). workspace.read sits in the C3 tailnet preset, so
  // peers may read the roster too.
  defineMethod({
    surface: "product",
    method: "device.list",
    scope: "workspace.read",
    idempotent: true,
    locality: "sync",
  }),
  defineMethod({
    surface: "product",
    method: "device.get",
    scope: "workspace.read",
    idempotent: true,
    locality: "sync",
  }),
  defineMethod({
    surface: "product",
    method: "device.subscribe",
    scope: "workspace.read",
    idempotent: true,
    locality: "sync",
    subscription: true,
  }),

  // PLUG-P2 — PluginRegistry (plugin spec §21.3/§22.1). Registry truth is
  // per-device (install-set sync is P7's D29 doc, not method federation), so
  // every method is local; reads and writes split plugins.read/plugins.manage
  // like doc.*. The rest of the §22.1 catalog (openRendererSession, install/
  // uninstall/updates.check) is deferred and deliberately undeclared.
  defineMethod({
    surface: "product",
    method: "plugins.list",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.get",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.subscribe",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "plugins.enable",
    scope: "plugins.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.disable",
    scope: "plugins.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.reload",
    scope: "plugins.manage",
    idempotent: true,
    locality: "local",
  }),
  // P3b — the renderer principal lease (§11.2). Scope is necessary, never
  // sufficient: the handler additionally gates on principal kind (renderer/
  // shell-main local-token callers only) — a scope alone cannot open sessions.
  defineMethod({
    surface: "product",
    method: "plugins.openRendererSession",
    scope: "plugins.read",
    idempotent: false,
    locality: "local",
  }),

  // PLUG-P4 — dynamic services observation (§14/§22.2). The x.* methods
  // themselves are DELIBERATELY not here: they are manifest data routed by the
  // registered-namespace exact map (§6.2/§14.6); ProductApi hands any "x."-
  // prefixed method to the ServiceRegistry, whose registration schema is the
  // static validation (§22.4). services.provide/unregister as PRODUCT methods
  // await the process host (the worker port is the only provider transport in
  // P4); endpoints await §17.3's slice — declared == shipped (D36).
  defineMethod({
    surface: "product",
    method: "services.list",
    scope: "workspace.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "services.subscribe",
    scope: "workspace.read",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),

  // PLUG-P5 — settings + KV storage (§16.2/§16.3/§22.3). scope null on
  // purpose: the HANDLER enforces the caller matrix (plugin principals need
  // storage.self in their lease and are self-scoped; the pane path needs
  // plugins.manage + explicit pluginId; kv.* is plugin-only). storage.file.*
  // is deliberately undeclared — file BODIES ride a ticketed lane (EL2), and
  // that lane is its own slice (D36: declared == shipped).
  defineMethod({
    surface: "product",
    method: "storage.settings.get",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "storage.settings.set",
    scope: null,
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "storage.settings.reset",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "storage.settings.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "storage.kv.get",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "storage.kv.set",
    scope: null,
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "storage.kv.delete",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "storage.kv.list",
    scope: null,
    idempotent: true,
    locality: "local",
  }),

  // PLUG-P6 — remaining powers (§17/§22.4). The P5 pattern holds: scope null
  // means the HANDLER enforces the caller matrix. process.* and the endpoint
  // pair are plugin-principal surfaces (self-scoped, gated on the granted
  // capability); plugins.manage callers get read access for doctor/UX.
  // storage.file.* remains undeclared (ticketed lane, its own slice — D36).
  defineMethod({
    surface: "product",
    method: "services.registerEndpoint",
    scope: null, // plugin principal owning the serviceId, services.provide granted
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "services.unregisterEndpoint",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "services.health",
    scope: "workspace.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "process.spawn",
    scope: null, // service-entry plugin principal with process.spawn granted
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "process.signal",
    scope: null,
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "process.stat",
    scope: null, // owner sees self; plugins.manage sees all
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "process.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "mcp.servers.add",
    scope: null, // local shell with plugins.manage — user policy surface (§17.4)
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "mcp.servers.remove",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "mcp.servers.list",
    scope: "mcp.consume",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "mcp.tools.list",
    scope: "mcp.consume",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "mcp.tools.call",
    scope: "mcp.consume",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "mcp.contribute.set",
    scope: null, // plugin principal with mcp.contribute — narrows its own tools
    idempotent: true,
    locality: "local",
  }),
  // §15.3 — v1 grants are device-local fieldd state; plugins.* is already in
  // D32's local-only-forever set, so this can never federate.
  defineMethod({
    surface: "product",
    method: "plugins.grants.set",
    scope: "plugins.manage",
    idempotent: true,
    locality: "local",
  }),
];
