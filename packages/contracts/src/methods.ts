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
  /** UA-4 (spec §7.3, UA-D14): a tailnet-guest principal may call ONLY
   * methods that set this — the scope check alone would pass scope:null
   * methods. The registry's first runtime-read column (`locality`'s sibling);
   * linted: guestOk ⇒ idempotent and a non-mutating scope. Default false. */
  guestOk?: boolean;
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
    // UA-4 v1: the ONLY guest-admitted method — a guest gets a polite hello
    // (grantedScopes: []) and typed refusals everywhere else. Widening this
    // set is a deliberate act against the registry lint, never drift.
    guestOk: true,
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
  defineMethod({
    surface: "product",
    method: "system.revokeWindowToken",
    scope: "tokens.mint",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "system.revokeStaleWindowTokens",
    scope: "tokens.mint",
    idempotent: true,
    locality: "local",
  }),
  // WIN-D5 — the graceful stop verb. Signals are platform folklore (SIGTERM
  // never fires on win32, so every teardown there was a hard kill and fieldd's
  // child sweep / run-file cleanup / audit close silently skipped); the stop
  // REQUEST rides the authenticated channel instead, and signals demote to
  // escalation. native.admin: trusted local principals only — the scope sits in
  // D32's local-only-forever set, so no tailnet caller can stop a daemon.
  defineMethod({
    surface: "product",
    method: "system.shutdown",
    scope: "native.admin",
    idempotent: true,
    locality: "local",
  }),
  // TC-D1 (terminal-custody TC-S1) — the escalation affordance: after the
  // floor's respawn intensity trips to the permanent honest "gone" state, a
  // human overrides ON PURPOSE. Resets the intensity window and runs one
  // respawn cycle. Same trust posture as system.shutdown: local admin only.
  defineMethod({
    surface: "product",
    method: "system.native.restart",
    scope: "native.admin",
    idempotent: false,
    locality: "local",
  }),

  // LOG-L6 — append-only audit ingress for shell-owned actions. The scope is
  // absent from every federated/plugin preset, and fieldd additionally proves
  // a loopback shell-main caller before accepting a record.
  defineMethod({
    surface: "product",
    method: "audit.append",
    scope: "audit.append",
    idempotent: false,
    locality: "local",
  }),

  // AH-3 — Electron main's static provider. Registration/resolution are
  // shell-principal-only in ProductApi; provided calls retain ordinary static
  // scope/locality policy before fieldd dispatches them to main.
  defineMethod({
    surface: "product",
    method: "shell.provider.register",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "shell.provider.resolve",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "shell.dialog.pickFolder",
    scope: "shell.dialog",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "shell.openExternal",
    scope: "shell.open",
    idempotent: false,
    locality: "local",
  }),

  // LOG-L5 — trusted local diagnostics. These scopes are absent from every
  // tailnet/plugin/MCP preset; Electron mints them only for its host viewer.
  defineMethod({
    surface: "product",
    method: "diagnostics.query",
    scope: "diagnostics.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "diagnostics.subscribe",
    scope: "diagnostics.read",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "diagnostics.lease.create",
    scope: "diagnostics.manage",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "diagnostics.lease.list",
    scope: "diagnostics.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "diagnostics.lease.revoke",
    scope: "diagnostics.manage",
    idempotent: true,
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
    method: "native.diagnostics.lease.create",
    scope: null,
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.diagnostics.lease.list",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.diagnostics.lease.revoke",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.self",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.retire",
    scope: null,
    idempotent: false,
    locality: "local",
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

  // C6/D5 — MeshData lane CONTROL. The bytes ride meshdata.sock; nothing here
  // carries a payload. `locality: "local"` is exact and not a copy-paste: the
  // mgmt channel never leaves the device, even though the lane it negotiates is
  // the one thing that does.
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.lane.open",
    scope: null,
    // NOT idempotent: laneId is caller-minted, and re-opening a live lane is a
    // collision to refuse, not a no-op to absorb.
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.lane.close",
    scope: null,
    // Idempotent by intent — closing an already-dead lane is the normal race
    // when both ends hang up at once, and must not read as an error.
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.lane.subscribe",
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
  // UA-D7 — may this doc leave this device? `local` locality is the honest
  // class and not a shortcut: the answer is this device's own, held in this
  // device's registry, and it does not replicate (the C6-4 doc-existence debt).
  defineMethod({
    surface: "product",
    method: "doc.setSyncIntent",
    scope: "doc.write",
    idempotent: true,
    locality: "local",
  }),
  // C6-4 — per-doc sync standing (DocSyncStatus[]), snapshot-then-delta. Always
  // registered: with the mesh off the snapshot is an empty list, which the
  // renderer reads as "sync does not apply" — an honest quiet, not an error.
  // doc.* stays out of TAILNET_SCOPES (D32), so this never federates.
  defineMethod({
    surface: "product",
    method: "doc.sync.subscribe",
    scope: "doc.read",
    idempotent: true,
    locality: "sync",
    subscription: true,
  }),

  // AH-1 — ArtifactService mutations are source-local. Local plugin/agent
  // principals may be explicitly granted artifact.publish, but tailnet callers
  // and D35 device? routing may only read the eventual global catalog.
  defineMethod({
    surface: "product",
    method: "artifact.publish",
    scope: "artifact.publish",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "artifact.update",
    scope: "artifact.publish",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "artifact.unpublish",
    scope: "artifact.publish",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "artifact.refreshPreview",
    scope: "artifact.publish",
    // Every successful gesture creates a new image and monotonic revision;
    // reconnect logic must never replay it as a read-like request.
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "artifact.list",
    scope: "workspace.read",
    idempotent: true,
    locality: "sync",
  }),
  defineMethod({
    surface: "product",
    method: "artifact.subscribe",
    scope: "workspace.read",
    idempotent: true,
    locality: "sync",
    subscription: true,
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
  // PRC-5e — one shell-minted renderer incarnation participates in the disruptive update barrier.
  // Identity is absent from every request body and derived again by each handler from the exact
  // local window bearer. Candidate/retained-old authority crosses only the separately fenced
  // source method; commands themselves remain path- and credential-free.
  defineMethod({
    surface: "product",
    method: "plugins.update.subscribe",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "plugins.update.ack",
    scope: "plugins.read",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.update.source",
    scope: "plugins.read",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.update.source.release",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.update.leave",
    scope: "plugins.read",
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
  // P8b (ESP §8.4) — the approved module URLs a renderer may import. Safe
  // projection only: no filesystem path exists in the result shape.
  defineMethod({
    surface: "product",
    method: "plugins.modules",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
  }),
  // P8b — the privileged half. Electron main resolves ONE token to the bytes it
  // may serve; `plugins.serve` is deliberately a scope the renderer never holds,
  // and the handler gates on the shell-main principal on top of it (the §11.2
  // "scope is necessary, never sufficient" rule, applied to the one method that
  // returns a path).
  defineMethod({
    surface: "product",
    method: "plugins.resolveModule",
    scope: "plugins.serve",
    idempotent: true,
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
  // UA-3 — the user's tailscale link (spec §7.1): link truth + honest mesh
  // reachability for the Account surface; unlink retires the node identity.
  // settings.manage = the trusted desktop surface, same posture as the
  // app-preference rows below; never federates.
  defineMethod({
    surface: "product",
    method: "user.link.get",
    scope: "settings.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "user.link.subscribe",
    scope: "settings.manage",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "user.link.unlink",
    scope: "settings.manage",
    idempotent: false,
    locality: "local",
  }),
  // D29′ app-section preferences. Unlike plugin settings these are an exact,
  // trusted desktop surface; plugins, tailnet callers, and agents never receive
  // settings.manage.
  defineMethod({
    surface: "product",
    method: "storage.appPreferences.get",
    scope: "settings.manage",
    idempotent: true,
    locality: "sync",
  }),
  defineMethod({
    surface: "product",
    method: "storage.appPreferences.set",
    scope: "settings.manage",
    idempotent: false,
    locality: "sync",
  }),
  defineMethod({
    surface: "product",
    method: "storage.appPreferences.subscribe",
    scope: "settings.manage",
    idempotent: true,
    locality: "sync",
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

  // PLUG-P7 — distribution (§5.3.1/§22.1) + the D29′ undo surface. Install
  // mutations are plugins.manage; fetches are user-initiated only (no push
  // feed, no phone-home — §5.3.1). undo/redo are scope:null with the P5
  // caller matrix (plugin principals self-scoped; the pane path needs
  // plugins.manage) and NEVER touch grants or the install-set (D29′ law 2).
  defineMethod({
    surface: "product",
    method: "plugins.install",
    scope: "plugins.manage",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.uninstall",
    scope: "plugins.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.updates.check",
    scope: "plugins.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "storage.settings.undo",
    scope: null,
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "storage.settings.redo",
    scope: null,
    idempotent: false,
    locality: "local",
  }),

  // NF-1 — the terminal floor's product surface (native-floor spec §6, NF-D5).
  // Scope posture v1: terminal.attach covers attach+create+terminate — the
  // single-user posture stated D6-style; a terminal.manage split is the named
  // upgrade. locality "local" is exact, not a copy-paste: the ticket path and
  // the PTY live on THIS device — a remote terminal is reached by ROUTING the
  // call (device?, D35; terminal.attach sits in TAILNET_SCOPES already), never
  // by federating its bytes (those ride TSP1, native-plane). The rest of the
  // design-01 terminal ideas (subscribe, remote TSP1 endpoint info) are
  // deferred and deliberately undeclared — declared == shipped (D36).
  defineMethod({
    surface: "product",
    method: "terminal.list",
    scope: "terminal.attach",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "terminal.get",
    scope: "terminal.attach",
    idempotent: true,
    locality: "local",
  }),
  // NOT idempotent: every mint is a fresh audited grant (the doc.open
  // precedent), even while D6 keeps the credential inside it the shared
  // native service token.
  defineMethod({
    surface: "product",
    method: "terminal.openTicket",
    scope: "terminal.attach",
    idempotent: false,
    locality: "local",
  }),
  // GT-D10: a ticket for a CONNECTION, with no session named and none made.
  // Not idempotent, for openTicket's reason — every mint is a fresh audited
  // grant. Same scope as the other two doors: it hands out the same credential,
  // so a scope split here would be theatre.
  defineMethod({
    surface: "product",
    method: "terminal.connectTicket",
    scope: "terminal.attach",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "terminal.create",
    scope: "terminal.attach",
    idempotent: false,
    locality: "local",
  }),
  // Idempotent by intent — terminating an already-exited session is the normal
  // race when the ladder and a user click converge, and must not read as an
  // error (the lane.close reasoning).
  defineMethod({
    surface: "product",
    method: "terminal.terminate",
    scope: "terminal.attach",
    idempotent: true,
    locality: "local",
  }),
  // GT-3 rider — the `config.ghostty` surface. Scope is `settings.manage`, NOT
  // `terminal.attach`: attaching to a terminal and rewriting the configuration
  // every terminal on the device loads are different powers, and the second one
  // is the trusted desktop shell's alone (settings.manage is absent from
  // TAILNET_SCOPES and from every plugin preset by construction). Stated
  // honestly: this scope gates the PRODUCT door, and a `terminal.attach` holder
  // still receives the floor's shared token in its ticket, whose control socket
  // accepts the same config commands — that is GT-D6's named posture (per-client
  // native tokens are the upgrade), not a claim this scope closes.
  //
  // locality "local": the file is this device's, beside this device's floor.
  // A remote device's config is reached by ROUTING the call, never by
  // federating a path that means something different on each machine.
  defineMethod({
    surface: "product",
    method: "terminal.config.read",
    scope: "settings.manage",
    idempotent: true,
    locality: "local",
  }),
  // NOT idempotent: it is an optimistic replace against a revision, so the
  // second identical call is a CONFLICT, not a no-op — replaying it is exactly
  // the lost update the revision exists to refuse.
  defineMethod({
    surface: "product",
    method: "terminal.config.write",
    scope: "settings.manage",
    idempotent: false,
    locality: "local",
  }),
];
