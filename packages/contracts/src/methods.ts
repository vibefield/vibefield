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
];
