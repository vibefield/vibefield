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
  // AR-0 — the index daemon's escalation affordance (rosettad; the same
  // posture as system.native.restart: local admin only). Answers the health
  // projection — the daemon's origin never crosses this surface (EL7).
  defineMethod({
    surface: "product",
    method: "system.index.restart",
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
  // TC-D15 (TC-S2): the revisioned terminal route snapshot. Snapshot on
  // subscribe, FULL snapshots as deltas — state transfer, never edges, so a
  // missed delta is repaired by the next one and reconnect re-subscribes.
  defineMethod({
    surface: "mgmt",
    method: "native.lifecycle.terminal.routes.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  // RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3):
  // the mgmt row `native.terminal.mirrorWriteCapability`, by which the floor
  // handed its mirror-write capability to its ONE paired management client so
  // fieldd could grant it to a self peer. The floor's mint, its key file and
  // `FIELD_NATIVE_TERMINAL_MIRROR_WRITE` went with it: the write right is a
  // claim in a per-client expiring attach grant, so no mgmt verb carries a
  // durable secret for it.
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
  // UA-P-0a (D1) — the posture verbs. The floor runs no node until fieldd asks,
  // and fieldd asks because of the LINK and nothing else. `FIELD_NATIVE_MESH`
  // survives beside these only as a forced-on development override.
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.start",
    scope: null,
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.stop",
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

  // DS-1 — EGRESS (design-02 §2.4's egress bullet; shapes in mgmt.ts). The
  // mirror image of `serve`: a desktop reaches a peer THROUGH its own node, so
  // no desktop-to-desktop path needs the OS Tailscale app (DS-L5). CONTROL
  // only, like lanes: an address, a credential, a route row. Until truffle
  // ships RFC 026 the floor answers every one of these `UNAVAILABLE {service:
  // "mesh", state: "egress-unsupported"}`, and fieldd falls back honestly.
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.egress.proxy",
    scope: null,
    // the node's loopback proxy is started once and answers the same address
    // and credential for the node's lifetime
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.egress.route.add",
    scope: null,
    // the caller mints the id: the same id and target answers the bound route,
    // another target under that id is a CONFLICT (a route never re-aims)
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.egress.route.remove",
    scope: null,
    // an unknown id is NOT_FOUND, which a releasing caller reads as done —
    // the same contract as `serve.remove`
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.egress.route.list",
    scope: null,
    idempotent: true,
    locality: "local",
  }),
  // The route table's stream. A node teardown or rebuild empties the table
  // (rebuilt-not-persisted), and the fresh snapshot this pushes is the
  // facade's `reset`: every listen address fieldd handed out is dead.
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.egress.route.subscribe",
    scope: null,
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "mgmt",
    method: "native.mesh.egress.httpProxy",
    scope: null,
    idempotent: true,
    locality: "local",
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
  // DS-5 (DS-D6) — a tombstone in the library: the canvas leaves every desktop's
  // list and its lanes stop; the bytes stay on disk (deleting is an act).
  defineMethod({
    surface: "product",
    method: "doc.delete",
    scope: "doc.write",
    idempotent: false,
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
  // DS-2 (DS-D15, 2026-09-30) — the receipt of a keyed forwarded mutation, as
  // THIS daemon knows it: applied, refused, or outcome-unknown (the forward
  // left and its answer was lost), with `inFlight` while an attempt is out.
  // Local: it reads this daemon's journal of its own forwards
  // (forward-receipts.ts), so a UI can show the state; the retry is the same
  // call carrying the same `idempotencyKey`, answered from the OWNER's
  // receipt. Scope-free like system.health: the key is unguessable, the
  // answer names only the call it was handed back for.
  defineMethod({
    surface: "product",
    method: "forward.receipt",
    scope: null,
    idempotent: true,
    locality: "local",
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
  // PRC-6b — passive runtime observation is a sibling of, never traffic on, the update command
  // lane. Report identity is transport-derived and handler-gated to an already-known renderer;
  // get/subscribe expose only the bounded path-free host fold.
  defineMethod({
    surface: "product",
    method: "plugins.runtime.report",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.runtime.get",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "plugins.runtime.subscribe",
    scope: "plugins.read",
    idempotent: true,
    locality: "local",
    subscription: true,
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
  // UA-P-0a (D1) — the LINK ACT. Before this verb there was none: a node came
  // up because an env flag said so, and "linking" was a side effect of the
  // interactive login happening to run. Now the user asks, the floor starts the
  // node in `capture` mode, and the link COMPLETES when the login is captured —
  // which is also when the first serve is declared and the first slice may go
  // out. The answer is the status, so a caller watches one shape throughout.
  defineMethod({
    surface: "product",
    method: "user.link.begin",
    scope: "settings.manage",
    idempotent: false,
    locality: "local",
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
  // *Correction 2026-09-30 (SB §9):* since AR-4b (2026-09-13) the product API REFUSES a foreign
  // `device` on every `local` method before the forwarder (product-api.ts, D36), so nothing here is
  // reached by routing today; a routable birth is the sync plane's to add (DS-2, the spawn bloom's SB-6).
  // *DS-4 (2026-09-30):* `terminal.openTicket`, `terminal.renewAttach` and `terminal.terminate`
  // are `federate` — a terminal on another desktop (design-06 §6; design-04 §7's 2026-09-30 note):
  // the call forwards WHOLE to the owner, the owner mints and acts from its own rule (its audit row
  // names the calling node), and the caller's daemon carries a ticket's doors onto an egress route
  // of its own. Everything else here stays `local`, the birth included.
  defineMethod({
    surface: "product",
    method: "terminal.list",
    scope: "terminal.attach",
    idempotent: true,
    locality: "local",
  }),
  // TP-S3/G23 — the transport-private Ghosttea summaries the routed runtime
  // needs before mounting. Separate from terminal.list (floor observation) and
  // terminal.roster (UI projection): notably, this carries the TRF1 handle.
  defineMethod({
    surface: "product",
    method: "terminal.sessions",
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
    locality: "federate",
  }),
  // GT-D10's `terminal.connectTicket` (a ticket for a CONNECTION, no session)
  // RETIRED at TP-S3e with the bridge it fed: the routed transport dials per
  // SESSION via openTicket/create, and there is no sessionless credential.
  defineMethod({
    surface: "product",
    method: "terminal.create",
    scope: "terminal.attach",
    idempotent: false,
    locality: "local",
  }),
  // TP-S1 (terminal-pipeline-v3 §5.1): renew a session's attach grant — a CAS
  // on the generation the caller holds, idempotent by requestId (a retried
  // renewal returns the grant it already got), so retry-safe by construction.
  defineMethod({
    surface: "product",
    method: "terminal.renewAttach",
    scope: "terminal.attach",
    idempotent: true,
    locality: "federate",
  }),
  // TP-D4: the UI's roster projection — ids, class, health, provenance and NO
  // placement; terminal.list stays the transport-facing inventory.
  defineMethod({
    surface: "product",
    method: "terminal.roster",
    scope: "terminal.attach",
    idempotent: true,
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
    locality: "federate",
  }),
  // DS-4 (DS-D5's note; TPv3 §6 amended 2026-09-30) — the TAKE as a product door,
  // for a host that cannot speak a cell's control leg (the phone's kit, DS-4b). A
  // routed runtime takes over its own control leg and never calls it. Declared so
  // the name is reserved in the registry; fieldd answers UNAVAILABLE
  // {service: "terminal", state: "not_implemented"} until DS-4b. Not idempotent:
  // a take is an act (one CAS), and a second one is a second act.
  defineMethod({
    surface: "product",
    method: "terminal.takeGeometry",
    scope: "terminal.attach",
    idempotent: false,
    locality: "local",
  }),
  // RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3):
  // the product row `terminal.mirrorWriteGrant` on `terminal.attach`, by which
  // the phone asked this desktop for the floor's mirror-write capability. What
  // it handed out was a DURABLE shared secret: one per floor, revoked only by
  // deleting the floor's key file and bouncing the pair, which revoked every
  // device at once. Since TM-2 the right to type is a claim in the attach grant
  // `terminal.openTicket`/`terminal.create` already mints — per client, per
  // session, expiring, revocable by generation — so a WhoIs-verified self peer
  // is minted `rights: ["input", "read"]` and there is nothing left to ask for.
  // *(2026-09-30, DS-4: a self peer is minted `["geometry", "input", "read"]`
  // since DS-D5's note — the last focused pane takes the seat; the retirement
  // below is unchanged, and `rightsFor` is still the only door to `input`.)*
  // The audit action `capability.mirror_write.grant` retired with the door;
  // `AuditActionV1` is a regex, not an enumeration, so this is the only place
  // that names it. `MIRROR_WRITE_GRANT_ADMITTED_PRINCIPALS` and its refusal
  // rule went with it (fieldd's `daemon.ts`). Nothing has to enumerate who may
  // NOT hold the write right any more, which is why that allow-list could go:
  // `rightsFor` (fieldd's `terminal-grants.ts`) mints `input` for a self peer
  // and a window, and `["read"]` for every other principal — a plugin, an
  // `mcp-agent`'s claim, a guest, an unlinked tailnet peer — so a caller the
  // old door would have refused is now minted a grant that cannot type.
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
  // *Correction 2026-09-30 (SB §9):* since AR-4b (2026-09-13) the product API REFUSES a foreign
  // `device` on every `local` method before the forwarder (product-api.ts, D36), so nothing here is
  // reached by routing today; a routable birth is the sync plane's to add (DS-2, the spawn bloom's SB-6).
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
  // GT-7: the DRY RUN. The loader reads the candidate in the overlay's place
  // and answers what it would make of it; nothing is written, so it is
  // idempotent — but it is still `settings.manage`, because a loader pointed at
  // arbitrary text reads whatever files that text includes. The includes rule
  // (`terminalConfigIncludesAllowed`) is enforced here before the loader runs.
  defineMethod({
    surface: "product",
    method: "terminal.config.validate",
    scope: "settings.manage",
    idempotent: true,
    locality: "local",
  }),
  // GT-7's file actions — each a native dialog or the file manager, reached
  // through the scoped `shell.*` provider (ESR §6.2), with fieldd doing the
  // bounded file IO. import only READS a file the user picked (idempotent: no
  // state moves; the text goes back as a draft); export WRITES where the user's
  // save dialog says (audited, bytes only); reveal shows the overlay the floor
  // names, so the caller hands no path at all.
  defineMethod({
    surface: "product",
    method: "terminal.config.import",
    scope: "settings.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "terminal.config.export",
    scope: "settings.manage",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "terminal.config.reveal",
    scope: "settings.manage",
    idempotent: true,
    locality: "local",
  }),
  // GT-8a (GT-D22) — a terminal link, ⌘-clicked in the deck: a web link to the
  // default browser, a file link shown in the file manager, anything else
  // refused (fieldd's `terminal-links.ts` is the policy). Its OWN scope,
  // `terminal.link`, which only the window's token holds — not `shell.open`,
  // which renderer plugins may be granted: a plugin must not reach a door that
  // opens http links and reveals paths without a person's click. locality
  // "local": the link opens on the Mac in front of the person who clicked, and
  // the scope is in no tailnet preset, so no peer can make this Mac open
  // anything. NOT idempotent: a second click is a second open.
  defineMethod({
    surface: "product",
    method: "terminal.link.open",
    scope: "terminal.link",
    idempotent: false,
    locality: "local",
  }),
  // ── surface.* (DT-1 — thinking-devtools-pack.md DT-D2/DT-D3) ──
  // The registry scope is the BASE gate; one row carries one scope, so the
  // SurfaceService additionally enforces the kind→scope matrix on `open`
  // (browser → surface.browser · sck-window/ios-simulator → surface.capture),
  // service-level and tested. `sources` lists capture kinds only, hence the
  // capture scope outright. locality "local": a surface is a window on THIS
  // device — remote surfaces are not a v1 concept, and none of these rows may
  // ever gain `guestOk` or enter a tailnet preset.
  defineMethod({
    surface: "product",
    method: "surface.sources",
    scope: "surface.capture",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "surface.open",
    scope: "surface.attach",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "surface.close",
    scope: "surface.attach",
    idempotent: true,
    locality: "local",
  }),
  // ── index.* (AR-1 — thinking-ar-data-topology.md §7; shapes in agent-index.ts) ──
  // The agent index is rosetta, one daemon per user, supervised by fieldd.
  // Reads ride `index.read`: the roll call's census (`discoveries`) and the
  // folded status (`status` — the phase, the daemon projection, the record,
  // every runtime). Mutations ride the NEW local-only `index.manage`: `enroll`
  // declares the complete consented set of discovered kinds, `retire` stops
  // watching one runtime (rows kept, AR-D19); both rewrite THIS user's
  // enrollment record, are audited, and restart the daemon when the record
  // changed (RO-2's start-time scoping). locality "local": consent is an act
  // of the person at this device — the doors never federate, and a discovered
  // root is the OS user's own home. Every answer is a projection: the daemon's
  // loopback origin never crosses this surface (EL7), and an enrolled root's
  // path stays inside fieldd (the persona is named by profile id).
  // *DS-2 (2026-09-30 — DS-D1 ruled; thinking-desktop-sync-plane.md §6.1,
  // design-04 §7's census):* the five READS federate now — `discoveries`,
  // `status`, `sessions`, `search`, `recent` are queried on demand at the
  // device that owns the index (a foreign `device` forwards the call whole; a
  // peer daemon may call them). The two consent ACTS, `enroll` and `retire`,
  // stay `local`: consent is still an act of the person at this device.
  // Scopes do not move — `index.search` is in no tailnet preset here, so a
  // peer is still refused the content reads at the scope gate.
  defineMethod({
    surface: "product",
    method: "index.discoveries",
    scope: "index.read",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "index.status",
    scope: "index.read",
    idempotent: true,
    locality: "local",
  }),
  // AR-5e — the find sheet's two questions: `sessions` is what the index
  // knows about the live runs (by provider-native id) and `search` is one
  // query over the transcript history, scoped by those runs. Both are
  // projections of CONTENT — no origin, no enrolled root's path (a session's
  // own cwd does ride `index.sessions`, as the daemon reports it), and a
  // daemon that cannot answer says so (`answered: false`) rather than
  // answering "no matches". AR-5b: they ride `index.search`, their own scope,
  // not the census scope `index.read` a plugin may hold for the roll call —
  // a search over every consented transcript is a different consent.
  // DS-6 (2026-09-30, DS-D8 RULED) — `federate`, no longer `local`: search is
  // BY ASKING, so a self peer's daemon must be served both (the D36 wall
  // refuses every `local` method to a peer-fieldd principal before its scope
  // is read), and a `device` routes either to the desktop that holds the
  // history. Each still defaults to `scope: "local"` (this desktop's index);
  // `scope: "mesh"` pages the merged replica (`sessions`) or asks every awake
  // self desktop (`search`). A peer is granted `index.search` by its own
  // preset (PEER_FIELDD_SCOPES); guests stay refused at the registry, and the
  // phone's preset is unchanged (SP-D13).
  // At the landing of 2026-10-01 the two lanes' censuses were reconciled: DS-2 had
  // moved every index READ to `federate`; DS-6's doors are the index rows that
  // leave the device — `index.discoveries`, `index.status` and `index.recent`
  // (the census, the status, the launcher's list) stay this desktop's, `local`.
  defineMethod({
    surface: "product",
    method: "index.sessions",
    scope: "index.search",
    idempotent: true,
    locality: "federate",
  }),
  defineMethod({
    surface: "product",
    method: "index.search",
    scope: "index.search",
    idempotent: true,
    locality: "federate",
  }),
  // DS-6 — the history catalog across desktops (design-06 §5): `projects`
  // pages projects (rosetta's, with the repository family, DS-D9) newest
  // activity first, this desktop's or the merged replica's; the catalog door
  // is the PEER replication stream (rows, DS-L3; its handler admits only a
  // peer-fieldd principal — a window pages the merged replica instead);
  // `changes` is the invalidation ping a visible History page listens to. All
  // three read the history's content (titles, folders, project names), so all
  // ride `index.search`, the consent AR-5b gave that content.
  defineMethod({
    surface: "product",
    method: "index.projects",
    scope: "index.search",
    idempotent: true,
    locality: "federate",
  }),
  defineMethod({
    surface: "product",
    method: "index.catalog.subscribe",
    scope: "index.search",
    idempotent: true,
    locality: "stream",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "index.changes.subscribe",
    scope: "index.search",
    idempotent: true,
    locality: "stream",
    subscription: true,
  }),
  // QL (thinking-ql-empty-pane-launcher.md, QL-D9) — the empty pane
  // launcher's list: a folder's past sessions (its rosetta project) or every
  // project's, newest first. The same consent as the two above — titles,
  // summaries and each session's cwd are the history's content — so the same
  // scope, and the same locality: the history is the device's own. *DS-2
  // (2026-09-30): `federate`, like the two above.*
  defineMethod({
    surface: "product",
    method: "index.recent",
    scope: "index.search",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "index.enroll",
    scope: "index.manage",
    idempotent: true, // declarative: the same set twice writes and restarts nothing
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "index.retire",
    scope: "index.manage",
    idempotent: true, // retiring a retired runtime is a no-op
    locality: "local",
  }),
  // ── agents.* (AR-1 — the contract; handlers land with puppeteer's first
  // import at AR-2, until when the dispatcher answers NOT_FOUND for them) ──
  // Distribution is MACHINE scope (AR-D15/D16): the installs puppeteer
  // classifies, the release facts it can learn, the vendor's own updater run
  // under the root lock, and the one choice VibeField owns — which executable
  // new spawns use. All four ride the NEW local-only `agents.manage`, the
  // native.admin posture: an update is an attended act (AR-D22), and even the
  // reads name executable paths on this machine.
  defineMethod({
    surface: "product",
    method: "agents.installs",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.releases",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.update",
    scope: "agents.manage",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.setActive",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  // The Agents settings section (2026-09-22). Three more rows on the same
  // local-only `agents.manage`: the running and last-finished distribution
  // act per provider with the vendor command's own output (display text,
  // never parsed — the receipt is the outcome), Show in Finder for a path
  // fieldd's own inventory holds (the renderer names an install, never a
  // path), and Stop for a running update. The first two are reads; a stop ends
  // a process tree and is audited. Stopping twice is stopping once.
  defineMethod({
    surface: "product",
    method: "agents.operations.subscribe",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "agents.reveal",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.update.stop",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  // Personas are per USER-on-device (AR-D20): puppeteer profiles whose roots
  // are the agent data folders, enrolled in this user's index by construction
  // (AR-D18). Decided with AR-1 (the topology left it open): they ride
  // `agent.spawn` — a persona is what one spawns AS, creating one is a
  // spawn-class act (its login runs in a pane), and no third scope was
  // warranted. locality "local": roots and credentials never roam, and a
  // create/verify needs a pane on THIS device — so although `agent.spawn` sits
  // in TAILNET_SCOPES, these rows do not federate.
  defineMethod({
    surface: "product",
    method: "agents.profiles.list",
    scope: "agent.spawn",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.profiles.create",
    scope: "agent.spawn",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.profiles.delete",
    scope: "agent.spawn",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.profiles.verify",
    scope: "agent.spawn",
    idempotent: false,
    locality: "local",
  }),
  // The persona login pane (AR-3): the vendor's own interactive login in a
  // PTY on THIS device, bound to the persona's root; the persona is verified
  // from native evidence when that terminal ends. Spawn-class, like create.
  defineMethod({
    surface: "product",
    method: "agents.profiles.login",
    scope: "agent.spawn",
    idempotent: false,
    locality: "local",
  }),
  // AR-S2 — Agent Profiles (AR-D23…D25): puppeteer's profile SETS, each a
  // named place holding one sign-in per agent in ONE folder under this user
  // (`agents/profiles/<set>/`), one of them the default new sessions use. The
  // same scope and posture as the persona rows beside them — a profile is
  // what one spawns in, its sign-ins run in panes on THIS device, and its
  // folder never roams — so `agent.spawn`, local. The mutations are audited;
  // the list, its subscription (whole snapshots at the tick) and Show in
  // Finder change nothing. A delete stops the sessions running under the
  // profile first, so it is idempotent only in the sense that deleting a
  // deleted profile is refused as NOT_FOUND, never done twice.
  defineMethod({
    surface: "product",
    method: "agents.profileSets.list",
    scope: "agent.spawn",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.profileSets.subscribe",
    scope: "agent.spawn",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  defineMethod({
    surface: "product",
    method: "agents.profileSets.create",
    scope: "agent.spawn",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.profileSets.update",
    scope: "agent.spawn",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.profileSets.delete",
    scope: "agent.spawn",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.profileSets.reveal",
    scope: "agent.spawn",
    idempotent: true,
    locality: "local",
  }),
  // Account usage (AR-5d — the usage column's feed): one reading per provider
  // and per registered account, polled by fieldd and pushed as full batches.
  // It is a READ of the agent plane, but not the fold's: a reading is the
  // account's billing state and costs a credentialed vendor call, which is a
  // different consent from watching sessions. AR-5b: it rides `agent.usage`,
  // its own scope (local-only, plugin-ineligible), not `agent.observe` —
  // a plugin that asked to watch the fold must not also read quotas or make
  // fieldd spend the user's token. Nothing here mutates. locality "local"
  // like every other agents.* row (D36): a quota belongs to THIS device's
  // accounts and its credentials never roam, so the column of a peer's usage
  // would be a different door, not this one federated.
  // AR-S4b — Extensions (agent-extensions.ts): what each agent in an Agent
  // Profile holds — MCP servers, skills, plugins, marketplaces — read from the
  // agent's own stores and grouped into the profile page's lens. A read of the
  // agent plane's configuration on THIS machine: it names servers and folders,
  // and reading Codex starts its app-server — so the native.admin posture of
  // the distribution reads beside it, `agents.manage`, local-only. Nothing here
  // mutates; the acts (S4c) join the same scope, audited.
  defineMethod({
    surface: "product",
    method: "agents.extensions.list",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.extensions.subscribe",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  // AR-S4c — an act: one server or skill an agent holds turned on, off or
  // out, through the agent's own command or protocol (RFC 006 C2); audited,
  // one at a time per Agent Profile, its output on the subscription above.
  // AR-S4e — a plugin an agent holds too: its switch, its update, its removal.
  defineMethod({
    surface: "product",
    method: "agents.extensions.act",
    scope: "agents.manage",
    idempotent: false,
    locality: "local",
  }),
  // AR-S4c — a remote server's sign-in: the agent's own login in a pane on the
  // page (it opens a browser, and may ask for a code), so it takes
  // `agent.spawn` as `agents.profiles.login` does; audited, one act at a time
  // per Agent Profile, the receipt on the subscription when the pane ends.
  defineMethod({
    surface: "product",
    method: "agents.extensions.signIn",
    scope: "agent.spawn",
    idempotent: false,
    locality: "local",
  }),
  // AR-S4d — a server kept once for the profile: Add server keeps its
  // definition and the values it reads (the keychain), then runs each agent's
  // own add, audited, one run at a time; the plan beside it says what each
  // agent would run before anything is kept.
  defineMethod({
    surface: "product",
    method: "agents.extensions.add",
    scope: "agents.manage",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.extensions.plan",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  // AR-S4d2 — a skill kept once: Add skill copies a folder into the profile's
  // skills folder, then gives it to each agent (a link where it looks),
  // audited, one run at a time; its plan reads the folder and says what each
  // agent would run before anything is copied.
  defineMethod({
    surface: "product",
    method: "agents.extensions.addSkill",
    scope: "agents.manage",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.extensions.planSkill",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  // AR-S4e2 — browse and install: an agent's catalog read from what it already
  // fetched (nothing is fetched by the read), "Check for updates" (the agent's
  // own fetch of each catalog, audited, one run at a time), what a typed source
  // would run (a read), and an act the person answers in a pane — an install
  // that asks for values or consent — which takes `agent.spawn` as a sign-in does.
  defineMethod({
    surface: "product",
    method: "agents.extensions.catalog",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.extensions.check",
    scope: "agents.manage",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.extensions.planSource",
    scope: "agents.manage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.extensions.terminal",
    scope: "agent.spawn",
    idempotent: false,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.usage",
    scope: "agent.usage",
    idempotent: true,
    locality: "local",
  }),
  defineMethod({
    surface: "product",
    method: "agents.usage.subscribe",
    scope: "agent.usage",
    idempotent: true,
    locality: "local",
    subscription: true,
  }),
  // ── agent.* (AR-3 — managed sessions: spawn, resume, the fold) ──
  // A managed session is born in a PTY on this device's floor with a clean
  // allow-listed environment (EL7) and observed/controlled by puppeteer inside
  // fieldd; the fold projects one SessionSummary v2 row per run. Reads ride
  // `agent.observe`, births `agent.spawn` (design-01 §7). locality "local"
  // for all five in v1: a spawn needs THIS device's floor, and the remote
  // tier's rows reach the deck through the mesh's own roster today — the
  // `device?` federation of `agent.list`/`agent.subscribe` (D35) is a later
  // widening of the locality column, not a new door.
  // *DS-2 (2026-09-30 — DS-D1 ruled; thinking-desktop-sync-plane.md §6.1):
  // that widening, made. The ACTS (`spawn`, `resume`, `interrupt`) are
  // `federate`: executed only on the device that owns the floor and the run,
  // reached by routing — a foreign `device` forwards the call whole, the owner
  // authorizes it as the peer daemon under its own rule, records the window
  // behind it (DS-L7) and answers a retry from its receipt
  // (forward-receipts.ts). The fold's READS are `stream` (`list`, `subscribe`
  // — the board), the owner's offer lists `federate` (`providers`,
  // `catalog`). Scopes do not move; `agents.*` (machine distribution) stays
  // local.*
  defineMethod({
    surface: "product",
    method: "agent.providers",
    scope: "agent.spawn",
    idempotent: true,
    locality: "federate",
  }),
  // AC-1 (thinking-ar-agent-catalog.md) — the catalog: the visible rows with
  // `surfaces` applied for the caller; `declined` rows never leave fieldd.
  // Read-only and content-free like `agent.list`, hence `agent.observe` and the
  // same locality — the phone's link calls it the way it calls `agent.list`.
  // *DS-2 (2026-09-30): `federate` — another device's catalog is asked of it,
  // while `agent.list` reads the fold (`stream`).*
  defineMethod({
    surface: "product",
    method: "agent.catalog",
    scope: "agent.observe",
    idempotent: true,
    locality: "federate",
  }),
  defineMethod({
    surface: "product",
    method: "agent.spawn",
    scope: "agent.spawn",
    idempotent: false,
    locality: "federate",
  }),
  // Scope exception, stated (2026-09-13, AR-4b): `agent.resume` rides
  // `agent.spawn` although it now TERMINATES a live PTY — the pending run's —
  // before resuming it, while `terminal.terminate` itself asks for
  // `terminal.attach` (the posture comment on the terminal rows above).
  // Accepted, because the PTY it ends is always the RECORD'S OWN: the door's
  // params name a RUN (`AgentResumeParams` = runtimeRunId, cwd?), never a
  // terminal id, and fieldd resolves the PTY through the record it wrote when
  // it spawned that run — a record this boot re-adopts only when the floor
  // still lists that very id. So the act is "resume my session", which is
  // spawn-class; it is not a terminate of an arbitrary terminal, and a caller
  // holding only `agent.spawn` reaches no PTY it did not already own. The
  // named upgrade, if agent cells ever adopt a PTY the record did not mint: a
  // resume that replaces a PTY asks for `terminal.attach` as well.
  // QL-D10 (2026-09-28) widens the params to a second form — a conversation
  // by its provider-native id (`AgentResumeNativeParams`, the empty pane
  // launcher's resume of an `index.recent` row). That form ends NO PTY: it
  // has no record of ours to resolve one through, and a conversation a live
  // run still continues is refused rather than replaced. It births a run,
  // which is exactly `agent.spawn`'s consent, so the scope stands.
  defineMethod({
    surface: "product",
    method: "agent.resume",
    scope: "agent.spawn",
    idempotent: false,
    locality: "federate",
  }),
  // AR-6-0 (MF-1 §10.2) — the stop verb: interrupt what a run is doing without
  // ending it, the ⎋ a person at the keyboard would press. Scope is
  // `agent.control`, the one scope in the AR-3 trio that has waited for a
  // door: this neither observes the fold (`agent.observe`) nor births a
  // session (`agent.spawn`) — it STEERS a run that already exists, which is
  // what `agent.control` was consented for. NOT idempotent: a second interrupt
  // is a second act on a run that may have moved on, never a replay of the
  // first. locality "local" like the rest of agent.*: the params name a RUN,
  // and fieldd reaches its PTY through the record it minted for it — a peer's
  // run is stopped by ROUTING the call (D35), never by federating this one.
  // *Correction 2026-09-30 (SB §9):* since AR-4b (2026-09-13) the product API REFUSES a foreign
  // `device` on every `local` method before the forwarder (product-api.ts, D36), so nothing here is
  // reached by routing today; a routable birth is the sync plane's to add (DS-2, the spawn bloom's SB-6).
  // *DS-2 (2026-09-30): added — `federate` is that routing: a foreign `device`
  // forwards the interrupt whole to the run's owner, which reaches the PTY
  // through ITS record and journals a receipt so a retry stops it once.*
  defineMethod({
    surface: "product",
    method: "agent.interrupt",
    scope: "agent.control",
    idempotent: false,
    locality: "federate",
  }),
  defineMethod({
    surface: "product",
    method: "agent.list",
    scope: "agent.observe",
    idempotent: true,
    locality: "stream",
  }),
  // MF-1 — the row is unchanged; its PARAMS are now `AgentSubscribeParams`
  // (agent-field.ts): absent or `{projection: "full"}` is today's subscription
  // byte for byte, `{projection: "field"}` answers the content-free projection
  // as a snapshot plus deltas at a per-subscriber floor. One door, one scope —
  // a phone watching the field is watching the fold, at a phone's cadence.
  // DS-3 (2026-09-30, DS-D4) — `stream`, not `local`: the mesh board's
  // upstreams are this very door on each self desktop, asked by a PEER daemon
  // (`peer-fieldd`), which the D36 wall refuses on a `local` method. What stays
  // local is the handler's to hold: the `full` projection is refused to a peer,
  // and so is `scope: "mesh"` (a peer reads a device's OWN board; aggregation
  // is for this device's clients, DS-L4). DS-2's census reclassifies the agent
  // reads as a set (design-04 §7's 2026-09-30 note); this row is its first
  // member, and that reclass supersedes this comment when both land.
  defineMethod({
    surface: "product",
    method: "agent.subscribe",
    scope: "agent.observe",
    idempotent: true,
    locality: "stream",
    subscription: true,
  }),
];
