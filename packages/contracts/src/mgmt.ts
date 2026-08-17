import { z } from "zod";

// Management channel (design-01 §5.2, M2 subset): native.lifecycle.* + the mesh
// facade P0 subset (peers / store / serve). Laws honored here:
// - survivor set only: desired state carries adoption + persistence policy,
//   NEVER interactive ops (design-02 §2.7);
// - facade state is rebuilt-not-persisted — fieldd replays its declarative set
//   on reconnect/rebuild ("re-serving is re-creating");
// - every inbound mesh delivery carries WhoIs identity (v0.5 requirement).

// ---- lifecycle ----

export const UnitState = z.enum(["starting", "up", "degraded", "crashed", "disabled"]);
export type UnitState = z.infer<typeof UnitState>;

export const UnitHealth = z
  .object({
    /** "mgmt" | "mesh-gateway" | "terminal" | "mesh-bridge" | "process" */
    unit: z.string(),
    state: UnitState,
    detail: z.string().optional(),
    /** mesh-gateway during browser auth (design-02 §2.4) */
    authUrl: z.string().optional(),
  })
  .passthrough();
export type UnitHealth = z.infer<typeof UnitHealth>;

export const NativeHealth = z
  .object({
    state: z.enum(["starting", "up", "degraded"]),
    bootId: z.string(),
    units: z.array(UnitHealth),
  })
  .passthrough();
export type NativeHealth = z.infer<typeof NativeHealth>;

export const DesiredTerminal = z
  .object({
    sessionId: z.string(),
    /** ghosttea persistence-policy name — opaque passthrough (reference-don't-remodel) */
    persistence: z.string().optional(),
  })
  .passthrough();
export type DesiredTerminal = z.infer<typeof DesiredTerminal>;

export const DesiredWorker = z
  .object({
    id: z.string(),
    kind: z.string(),
    config: z.unknown().optional(),
  })
  .passthrough();
export type DesiredWorker = z.infer<typeof DesiredWorker>;

/** Gateway knobs fieldd may declare; deliberately empty at P0 (tolerant growth). */
export const MeshConfig = z.object({}).passthrough();
export type MeshConfig = z.infer<typeof MeshConfig>;

export const DesiredState = z
  .object({
    generation: z.number().int(),
    /** THE survivor set — sessions not listed run their terminate ladder */
    terminals: z.array(DesiredTerminal),
    workers: z.array(DesiredWorker),
    meshConfig: MeshConfig.optional(),
    /** NF-D2(b) — adopt-before-authority: a set that would TERMINATE ≥1
     * running session must prove it saw THIS boot's inventory by echoing the
     * current native bootId; mismatch or absence ⇒ PRECONDITION_FAILED and
     * zero terminations. Retain-only sets may omit it (silence kills nothing —
     * NF-D2(a)). */
    observedBootId: z.string().optional(),
  })
  .passthrough();
export type DesiredState = z.infer<typeof DesiredState>;

export const ObservedTerminal = z
  .object({
    sessionId: z.string(),
    pid: z.number().int().optional(),
    /** epoch millis. LAW: wire timestamps are ALWAYS integers — bare z.number()
     * becomes f64 in generated Rust and drifts on re-serialization (caught by parity). */
    createdAt: z.number().int().optional(),
    persistence: z.string().optional(),
    title: z.string().optional(),
    cwd: z.string().optional(),
  })
  .passthrough();
export type ObservedTerminal = z.infer<typeof ObservedTerminal>;

export const ObservedWorker = z.object({ id: z.string(), state: UnitState }).passthrough();
export type ObservedWorker = z.infer<typeof ObservedWorker>;

export const ObservedState = z
  .object({
    /** last applied desired generation (0 = none since boot) */
    generation: z.number().int(),
    bootId: z.string(),
    terminals: z.array(ObservedTerminal),
    workers: z.array(ObservedWorker),
  })
  .passthrough();
export type ObservedState = z.infer<typeof ObservedState>;

// ---- mesh facade (P0 subset: peers / store / serve) ----

/** The spoof-safe Tailscale-User-* triple, injected at the sidecar bridge. */
export const WhoIsIdentity = z
  .object({
    login: z.string(),
    deviceName: z.string().optional(),
    tailscaleId: z.string().optional(),
  })
  .passthrough();
export type WhoIsIdentity = z.infer<typeof WhoIsIdentity>;

/** Truffle peer, mirrored minimally (parity fixture vs truffle-core serde lands with the embedding).
 * TWO id keyspaces ride here, and truffle's contract says they never collide:
 * `id` is the Tailscale stable node id (what `lane.open`/`resolve_peer` dial);
 * `deviceId` is the durable published ULID — the SyncedStore slice key (D30).
 * Joins must never mix them (the T1 §6 keyspace bug). `deviceId` is absent for
 * peers that never published into the mesh registry. */
export const PeerInfo = z
  .object({
    id: z.string(),
    deviceId: z.string().optional(),
    name: z.string().optional(),
    online: z.boolean(),
    addresses: z.array(z.string()).optional(),
    whois: WhoIsIdentity.optional(),
  })
  .passthrough();
export type PeerInfo = z.infer<typeof PeerInfo>;

/** UA-3 — `native.mesh.self`: the node's OWN identity, including the S1
 * self-whois login (best-effort — absent means the sidecar could not answer
 * for self, or a tagged node has no user; never synthesized, EL7). This is
 * the left-hand side of UA-4's self/guest comparison, captured once at link
 * time into link.json, never looked up per request. */
export const MeshSelfIdentity = z
  .object({
    deviceId: z.string(),
    deviceName: z.string().optional(),
    dnsName: z.string().optional(),
    tailscaleId: z.string().optional(),
    ip: z.string().optional(),
    login: z.string().optional(),
  })
  .passthrough();
export type MeshSelfIdentity = z.infer<typeof MeshSelfIdentity>;

/** UA-3 — `native.mesh.retire`: unlink's native half. Stops the node (the
 * sidecar dies with it), archives the state dir to `mesh.retired-<ts>`
 * beside itself, and reports where. `retired: false` = nothing to retire
 * (no state on disk) — an honest no-op, not an error. Answered BEFORE the
 * node gate: retiring a half-authed or disabled mesh must still work. */
export const MeshRetireResult = z
  .object({
    retired: z.boolean(),
    archivedTo: z.string().nullable(),
  })
  .passthrough();
export type MeshRetireResult = z.infer<typeof MeshRetireResult>;

/** SyncedStore view: device-owned slices, merged at the reader. `store.set` writes OWN slice only. */
export const StoreSnapshot = z
  .object({
    storeId: z.string(),
    slices: z.record(z.unknown()),
  })
  .passthrough();
export type StoreSnapshot = z.infer<typeof StoreSnapshot>;

export const ServeTarget = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("port"),
      port: z.number().int().min(1).max(65535),
      scheme: z.enum(["http", "https"]).optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("dir"),
      path: z.string(),
      fallback: z.literal("/index.html").optional(),
    })
    .passthrough(),
]);
export type ServeTarget = z.infer<typeof ServeTarget>;

export const ServeConfig = z
  .object({
    /** Stable engine identity. Omitted by v1 callers, where it defaults to name. */
    serveId: z.string().min(1).optional(),
    name: z.string(),
    /** Tailnet listener, independent of a port target. Omitted preserves v1 behavior. */
    listenPort: z.number().int().min(1).max(65535).optional(),
    target: ServeTarget,
    /** per-route allow-globs (WhoIs-gated at the proxy, pre-injection, fails
     * closed on empty caller login — tagged nodes never reach the backend) */
    allow: z.array(z.string()).optional(),
    /** false = plain HTTP inside WireGuard (no MagicDNS-cert dependency —
     * the product-API serve's choice). Default true upstream. v2-sidecar. */
    tls: z.boolean().optional(),
    /** Optional app-owned static preview root mounted ahead of the source route. */
    previewDir: z.string().min(1).optional(),
    /** C3 provenance proof: when set, the serve is a single route
     * `/t/<pathSecret>` → the target with strip_prefix OFF, so the backend
     * sees the secret on every proxied request. Only the sidecar's route
     * config and the declaring daemon hold it — a same-uid local caller
     * (EL7's adversary) cannot mint tailnet identity without it. */
    pathSecret: z.string().optional(),
  })
  .passthrough();
export type ServeConfig = z.infer<typeof ServeConfig>;

/** ProxyStatus/ProxyEvent mirror — the serve's live runtime state. */
export const ServeStatus = z.enum(["starting", "running", "stopped", "error"]);
export type ServeStatus = z.infer<typeof ServeStatus>;

export const ServeEntry = z
  .object({
    serveId: z.string().min(1),
    name: z.string(),
    listenPort: z.number().int().min(1).max(65535),
    target: ServeTarget,
    url: z.string(),
    allow: z.array(z.string()).optional(),
    /** Benign declared listener policy, rehydrated from field-native's private config cache. */
    tls: z.boolean().optional(),
    status: ServeStatus.optional(),
    /** ProxyEvent::Error passthrough (SERVE_ERROR / CONNECTION_REFUSED / …) */
    error: z.string().optional(),
  })
  .passthrough();
export type ServeEntry = z.infer<typeof ServeEntry>;

// ---- MeshData lanes (C6 / D5) ----
//
// CONTROL ONLY. Lane bytes ride native/run/meshdata.sock (see meshdata.ts);
// nothing below ever carries a payload. That split is EL2 made structural: a
// lane is negotiated on a contract surface and then gets out of the way, so
// doc bytes never touch JSON-RPC and control never queues behind a snapshot.

/** Delivery class, mapped 1:1 from strata's DeliveryClass by fieldd's Channel
 * impl. `reliable` = one QUIC stream per lane (per-lane FIFO, flow control
 * propagates); `lossy` = bounded logical snapshots fragmented into datagrams,
 * latest-first healing, with reliable terminal replay on graceful close. */
export const MeshLaneClass = z.enum(["reliable", "lossy"]);
export type MeshLaneClass = z.infer<typeof MeshLaneClass>;

/** What the lane carries. The BRIDGE does not interpret this — it is dumb by
 * design (D5) — but fieldd routes inbound lanes by it, and it is what makes a
 * `lane.peerOpened` actionable without decoding a byte. */
export const MeshLaneProtocol = z.enum(["doc-sync", "presence"]);
export type MeshLaneProtocol = z.infer<typeof MeshLaneProtocol>;

/** native.mesh.lane.open — fieldd asks the bridge for a lane to a peer.
 * The caller mints laneId: it owns the numbering for lanes it opens, which
 * removes a round-trip and lets it send DATA as soon as the call returns. */
export const MeshLaneOpenRequest = z
  .object({
    laneId: z.number().int().nonnegative(),
    class: MeshLaneClass,
    /** truffle peer id, as carried by PeerInfo.id */
    peer: z.string(),
    protocol: MeshLaneProtocol,
    /** Document room this lane is for (`doc-sync` and `presence`). A snapshot
     * takes its own short-lived lane, so this is not unique per document. */
    docId: z.string().optional(),
  })
  .passthrough();
export type MeshLaneOpenRequest = z.infer<typeof MeshLaneOpenRequest>;

export const MeshLaneCloseRequest = z
  .object({
    laneId: z.number().int().nonnegative(),
    reason: z.string().optional(),
  })
  .passthrough();
export type MeshLaneCloseRequest = z.infer<typeof MeshLaneCloseRequest>;

/** Notification: a PEER opened a lane to us. Lane ids from the two directions
 * share no space, so the `inbound` flag is what keeps them apart rather than a
 * numbering convention nobody can enforce across a network. */
export const MeshLanePeerOpened = z
  .object({
    laneId: z.number().int().nonnegative(),
    inbound: z.literal(true),
    class: MeshLaneClass,
    peer: z.string(),
    protocol: MeshLaneProtocol,
    docId: z.string().optional(),
    /** WhoIs-verified identity of the opening peer — every inbound delivery
     * carries it (the v0.5 requirement), so authorization never rests on a
     * self-declared id. */
    whois: WhoIsIdentity.optional(),
  })
  .passthrough();
export type MeshLanePeerOpened = z.infer<typeof MeshLanePeerOpened>;

/** Notification: a lane ended, from either side. Lanes are cheap and mortal —
 * D5's law is that a torn frame tears the LANE, never the daemon — so this is
 * an ordinary event, not an error path. */
export const MeshLaneClosed = z
  .object({
    laneId: z.number().int().nonnegative(),
    inbound: z.boolean().optional(),
    /** "peer-closed" | "peer-unreachable" | "torn-frame" | "local" | … —
     * open vocabulary, logged verbatim (tolerant reader). */
    reason: z.string(),
  })
  .passthrough();
export type MeshLaneClosed = z.infer<typeof MeshLaneClosed>;
